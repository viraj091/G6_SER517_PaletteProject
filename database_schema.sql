-- Palette Database Schema Design
-- SQLite implementation for offline-first grading

-- Core rubric template storage
CREATE TABLE rubric_templates (
    id TEXT PRIMARY KEY, -- UUID for internal use
    canvas_id INTEGER, -- Canvas rubric ID (nullable for offline-only rubrics)
    name TEXT NOT NULL,
    description TEXT,
    points_possible REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT 1,
    created_by TEXT, -- User identifier
    last_modified_by TEXT
);

-- Rubric criteria (the rows in a rubric)
CREATE TABLE rubric_criteria (
    id TEXT PRIMARY KEY,
    rubric_template_id TEXT NOT NULL,
    canvas_criterion_id TEXT, -- Canvas criterion ID
    description TEXT NOT NULL,
    long_description TEXT,
    points REAL NOT NULL,
    position INTEGER NOT NULL, -- Order in rubric
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rubric_template_id) REFERENCES rubric_templates(id) ON DELETE CASCADE
);

-- Rubric ratings (the columns in a rubric)
CREATE TABLE rubric_ratings (
    id TEXT PRIMARY KEY,
    criterion_id TEXT NOT NULL,
    canvas_rating_id TEXT, -- Canvas rating ID
    description TEXT NOT NULL,
    long_description TEXT,
    points REAL NOT NULL,
    position INTEGER NOT NULL, -- Order within criterion
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (criterion_id) REFERENCES rubric_criteria(id) ON DELETE CASCADE
);

-- Course information
CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    course_code TEXT,
    term TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced DATETIME
);

-- Assignment information
CREATE TABLE assignments (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER,
    course_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    points_possible REAL,
    due_at DATETIME,
    rubric_template_id TEXT, -- Link to rubric template
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced DATETIME,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (rubric_template_id) REFERENCES rubric_templates(id)
);

-- Student information
CREATE TABLE students (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER,
    course_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    sis_user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- Assignment submissions
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER,
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    group_id TEXT, -- For group assignments
    submitted_at DATETIME,
    score REAL,
    grade TEXT,
    workflow_state TEXT, -- submitted, graded, etc.
    submission_type TEXT, -- online_text_entry, online_upload, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced DATETIME,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Rubric assessments (actual grading data)
CREATE TABLE rubric_assessments (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER,
    submission_id TEXT NOT NULL,
    rubric_template_id TEXT NOT NULL,
    assessor_id TEXT, -- Who did the grading
    score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_synced BOOLEAN DEFAULT 0, -- Whether synced to Canvas
    last_synced DATETIME,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (rubric_template_id) REFERENCES rubric_templates(id)
);

-- Individual criterion assessments
CREATE TABLE criterion_assessments (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL,
    criterion_id TEXT NOT NULL,
    rating_id TEXT, -- Selected rating
    points REAL,
    comments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assessment_id) REFERENCES rubric_assessments(id) ON DELETE CASCADE,
    FOREIGN KEY (criterion_id) REFERENCES rubric_criteria(id),
    FOREIGN KEY (rating_id) REFERENCES rubric_ratings(id)
);

-- Comments (individual and group)
CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    assessment_id TEXT, -- Link to rubric assessment
    comment_type TEXT NOT NULL CHECK (comment_type IN ('individual', 'group', 'general')),
    content TEXT NOT NULL,
    author_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_synced BOOLEAN DEFAULT 0,
    last_synced DATETIME,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (assessment_id) REFERENCES rubric_assessments(id) ON DELETE CASCADE
);

-- Sync tracking for Canvas integration
CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL, -- 'rubric', 'assessment', 'comment', etc.
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);

-- User sessions and settings
CREATE TABLE user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, setting_key)
);

-- Application state for recovery
CREATE TABLE app_state (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_rubric_criteria_template ON rubric_criteria(rubric_template_id);
CREATE INDEX idx_rubric_ratings_criterion ON rubric_ratings(criterion_id);
CREATE INDEX idx_assignments_course ON assignments(course_id);
CREATE INDEX idx_students_course ON students(course_id);
CREATE INDEX idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_assessments_submission ON rubric_assessments(submission_id);
CREATE INDEX idx_criterion_assessments_assessment ON criterion_assessments(assessment_id);
CREATE INDEX idx_comments_submission ON comments(submission_id);
CREATE INDEX idx_sync_queue_status ON sync_queue(status);
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);

-- Views for common queries
CREATE VIEW active_assignments AS
SELECT 
    a.*,
    c.name as course_name,
    rt.name as rubric_name
FROM assignments a
JOIN courses c ON a.course_id = c.id
LEFT JOIN rubric_templates rt ON a.rubric_template_id = rt.id
WHERE a.rubric_template_id IS NOT NULL;

CREATE VIEW grading_progress AS
SELECT 
    a.id as assignment_id,
    a.name as assignment_name,
    COUNT(s.id) as total_submissions,
    COUNT(ra.id) as graded_submissions,
    COUNT(CASE WHEN ra.is_synced = 1 THEN 1 END) as synced_submissions
FROM assignments a
LEFT JOIN submissions s ON a.id = s.assignment_id
LEFT JOIN rubric_assessments ra ON s.id = ra.submission_id
GROUP BY a.id, a.name;