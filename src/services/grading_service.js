// Offline-First Grading Service
const { v4: uuidv4 } = require('uuid');
const DatabaseManager = require('./database-manager');

class GradingService {
    constructor(dbManager, syncService) {
        this.db = dbManager;
        this.sync = syncService;
        this.autoSaveInterval = null;
        this.unsavedChanges = new Map(); // Track unsaved changes
    }

    // Start grading session for an assignment
    async startGradingSession(assignmentId, userId) {
        try {
            // Get assignment and rubric info
            const assignment = await this.db.get(`
                SELECT a.*, rt.name as rubric_name, c.name as course_name
                FROM assignments a
                LEFT JOIN rubric_templates rt ON a.rubric_template_id = rt.id
                LEFT JOIN courses c ON a.course_id = c.id
                WHERE a.id = ?
            `, [assignmentId]);

            if (!assignment) {
                throw new Error('Assignment not found');
            }

            if (!assignment.rubric_template_id) {
                throw new Error('Assignment has no rubric attached');
            }

            // Get submissions
            const submissions = await this.db.all(`
                SELECT s.*, st.name as student_name, st.email as student_email,
                       ra.id as assessment_id, ra.score as current_score
                FROM submissions s
                JOIN students st ON s.student_id = st.id
                LEFT JOIN rubric_assessments ra ON s.id = ra.submission_id
                WHERE s.assignment_id = ?
                ORDER BY st.name
            `, [assignmentId]);

            // Get rubric
            const rubric = await this.db.getRubricTemplate(assignment.rubric_template_id);

            // Start auto-save for this session
            this.startAutoSave(userId);

            const session = {
                sessionId: uuidv4(),
                assignment,
                rubric,
                submissions,
                userId,
                startedAt: new Date().toISOString()
            };

            console.log(`Started grading session for ${assignment.name} (${submissions.length} submissions)`);
            return session;

        } catch (error) {
            console.error('Failed to start grading session:', error.message);
            throw error;
        }
    }

    // Grade a single submission
    async gradeSubmission(submissionId, gradingData, userId) {
        try {
            return await this.db.runTransaction(async (db) => {
                // Get or create assessment
                let assessment = await db.get(`
                    SELECT * FROM rubric_assessments WHERE submission_id = ?
                `, [submissionId]);

                let assessmentId;
                const now = new Date().toISOString();

                if (!assessment) {
                    // Create new assessment
                    assessmentId = uuidv4();
                    await db.run(`
                        INSERT INTO rubric_assessments 
                        (id, submission_id, rubric_template_id, assessor_id, score, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        criterionAssessmentId, assessmentId, criterionGrade.criterion_id,
                        criterionGrade.rating_id, criterionGrade.points || 0,
                        criterionGrade.comments || ''
                    ]);

                    totalScore += criterionGrade.points || 0;
                }

                // Update total score
                await db.run(`
                    UPDATE rubric_assessments SET score = ? WHERE id = ?
                `, [totalScore, assessmentId]);

                // Handle comments
                if (gradingData.comments) {
                    await this.saveComments(submissionId, assessmentId, gradingData.comments, userId, db);
                }

                // Mark for sync
                await this.db.addToSyncQueue('assessment', assessmentId, 'update');

                console.log(`Graded submission ${submissionId} with score ${totalScore}`);
                return {
                    assessmentId,
                    totalScore,
                    gradedAt: now
                };
            });

        } catch (error) {
            console.error('Failed to grade submission:', error.message);
            throw error;
        }
    }

    // Save comments for a submission
    async saveComments(submissionId, assessmentId, comments, userId, db = null) {
        const dbToUse = db || this.db;

        // Delete existing comments for this assessment
        await dbToUse.run(`
            DELETE FROM comments 
            WHERE submission_id = ? AND assessment_id = ?
        `, [submissionId, assessmentId]);

        // Add new comments
        for (const comment of comments) {
            const commentId = uuidv4();
            await dbToUse.run(`
                INSERT INTO comments 
                (id, submission_id, assessment_id, comment_type, content, author_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                commentId, submissionId, assessmentId,
                comment.type || 'general', comment.content, userId
            ]);

            // Mark for sync
            await this.db.addToSyncQueue('comment', commentId, 'create');
        }
    }

    // Get grading progress for an assignment
    async getGradingProgress(assignmentId) {
        const progress = await this.db.get(`
            SELECT 
                COUNT(s.id) as total_submissions,
                COUNT(ra.id) as graded_submissions,
                COUNT(CASE WHEN ra.is_synced = 1 THEN 1 END) as synced_submissions,
                AVG(ra.score) as average_score,
                MIN(ra.score) as min_score,
                MAX(ra.score) as max_score
            FROM submissions s
            LEFT JOIN rubric_assessments ra ON s.id = ra.submission_id
            WHERE s.assignment_id = ?
        `, [assignmentId]);

        const unsynced = await this.db.all(`
            SELECT s.id, st.name as student_name, ra.score
            FROM submissions s
            JOIN students st ON s.student_id = st.id
            JOIN rubric_assessments ra ON s.id = ra.submission_id
            WHERE s.assignment_id = ? AND ra.is_synced = 0
        `, [assignmentId]);

        return {
            ...progress,
            completion_percentage: progress.total_submissions > 0 
                ? Math.round((progress.graded_submissions / progress.total_submissions) * 100) 
                : 0,
            sync_percentage: progress.graded_submissions > 0
                ? Math.round((progress.synced_submissions / progress.graded_submissions) * 100)
                : 0,
            unsynced_submissions: unsynced
        };
    }

    // Get detailed submission for grading
    async getSubmissionForGrading(submissionId) {
        // Get submission details
        const submission = await this.db.get(`
            SELECT s.*, st.name as student_name, st.email as student_email,
                   a.name as assignment_name, a.rubric_template_id
            FROM submissions s
            JOIN students st ON s.student_id = st.id
            JOIN assignments a ON s.assignment_id = a.id
            WHERE s.id = ?
        `, [submissionId]);

        if (!submission) {
            throw new Error('Submission not found');
        }

        // Get existing assessment if any
        const assessment = await this.db.getAssessment(submissionId);
        
        // Get rubric
        const rubric = await this.db.getRubricTemplate(submission.rubric_template_id);

        // Get comments
        const comments = await this.db.getComments(submissionId);

        return {
            submission,
            assessment,
            rubric,
            comments: {
                individual: comments.filter(c => c.comment_type === 'individual'),
                group: comments.filter(c => c.comment_type === 'group'),
                general: comments.filter(c => c.comment_type === 'general')
            }
        };
    }

    // Bulk grading operations
    async bulkGrade(submissionIds, gradingTemplate, userId) {
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        for (const submissionId of submissionIds) {
            try {
                await this.gradeSubmission(submissionId, gradingTemplate, userId);
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    submissionId,
                    error: error.message
                });
            }
        }

        console.log(`Bulk grading completed: ${results.success} success, ${results.failed} failed`);
        return results;
    }

    // Auto-save functionality
    startAutoSave(userId, intervalSeconds = 30) {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        this.autoSaveInterval = setInterval(async () => {
            await this.saveUnsavedChanges(userId);
        }, intervalSeconds * 1000);

        console.log(`Auto-save started (every ${intervalSeconds} seconds)`);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
            console.log('Auto-save stopped');
        }
    }

    // Track unsaved changes in memory
    addUnsavedChange(submissionId, gradingData) {
        this.unsavedChanges.set(submissionId, {
            ...gradingData,
            timestamp: new Date().toISOString()
        });
    }

    async saveUnsavedChanges(userId) {
        if (this.unsavedChanges.size === 0) return;

        const changes = Array.from(this.unsavedChanges.entries());
        let saved = 0;

        for (const [submissionId, gradingData] of changes) {
            try {
                await this.gradeSubmission(submissionId, gradingData, userId);
                this.unsavedChanges.delete(submissionId);
                saved++;
            } catch (error) {
                console.error(`Failed to auto-save submission ${submissionId}:`, error.message);
            }
        }

        if (saved > 0) {
            console.log(`Auto-saved ${saved} submissions`);
        }
    }

    // Grade validation
    async validateGrade(submissionId, gradingData) {
        const errors = [];

        // Check if rubric exists
        const rubric = await this.db.getRubricTemplate(gradingData.rubric_template_id);
        if (!rubric) {
            errors.push('Rubric template not found');
            return errors;
        }

        // Validate criterion grades
        const criterionIds = new Set(rubric.criteria.map(c => c.id));
        
        for (const criterionGrade of gradingData.criterionGrades || []) {
            if (!criterionIds.has(criterionGrade.criterion_id)) {
                errors.push(`Invalid criterion ID: ${criterionGrade.criterion_id}`);
            }

            // Check if points are within valid range
            const criterion = rubric.criteria.find(c => c.id === criterionGrade.criterion_id);
            if (criterion) {
                const maxPoints = Math.max(...criterion.ratings.map(r => r.points));
                if (criterionGrade.points > maxPoints) {
                    errors.push(`Points ${criterionGrade.points} exceed maximum ${maxPoints} for criterion "${criterion.description}"`);
                }
            }

            // Validate rating ID if provided
            if (criterionGrade.rating_id) {
                const validRatingIds = criterion.ratings.map(r => r.id);
                if (!validRatingIds.includes(criterionGrade.rating_id)) {
                    errors.push(`Invalid rating ID: ${criterionGrade.rating_id}`);
                }
            }
        }

        return errors;
    }

    // Grading analytics
    async getGradingAnalytics(assignmentId) {
        const analytics = await this.db.get(`
            SELECT 
                COUNT(ra.id) as total_graded,
                AVG(ra.score) as mean_score,
                MIN(ra.score) as min_score,
                MAX(ra.score) as max_score,
                (SELECT COUNT(*) FROM rubric_assessments ra2 
                 JOIN submissions s2 ON ra2.submission_id = s2.id 
                 WHERE s2.assignment_id = ? AND ra2.score >= (
                     SELECT AVG(ra3.score) FROM rubric_assessments ra3 
                     JOIN submissions s3 ON ra3.submission_id = s3.id 
                     WHERE s3.assignment_id = ?
                 )) as above_average_count
            FROM rubric_assessments ra
            JOIN submissions s ON ra.submission_id = s.id
            WHERE s.assignment_id = ?
        `, [assignmentId, assignmentId, assignmentId]);

        // Get score distribution
        const distribution = await this.db.all(`
            SELECT 
                ROUND(ra.score / 10) * 10 as score_range,
                COUNT(*) as count
            FROM rubric_assessments ra
            JOIN submissions s ON ra.submission_id = s.id
            WHERE s.assignment_id = ?
            GROUP BY score_range
            ORDER BY score_range
        `, [assignmentId]);

        // Get criterion-level analytics
        const criterionAnalytics = await this.db.all(`
            SELECT 
                rc.description as criterion_name,
                AVG(ca.points) as avg_points,
                MIN(ca.points) as min_points,
                MAX(ca.points) as max_points,
                COUNT(ca.id) as assessment_count
            FROM criterion_assessments ca
            JOIN rubric_criteria rc ON ca.criterion_id = rc.id
            JOIN rubric_assessments ra ON ca.assessment_id = ra.id
            JOIN submissions s ON ra.submission_id = s.id
            WHERE s.assignment_id = ?
            GROUP BY rc.id, rc.description
            ORDER BY rc.position
        `, [assignmentId]);

        return {
            ...analytics,
            score_distribution: distribution,
            criterion_analytics: criterionAnalytics,
            standard_deviation: await this.calculateStandardDeviation(assignmentId)
        };
    }

    async calculateStandardDeviation(assignmentId) {
        const scores = await this.db.all(`
            SELECT ra.score
            FROM rubric_assessments ra
            JOIN submissions s ON ra.submission_id = s.id
            WHERE s.assignment_id = ?
        `, [assignmentId]);

        if (scores.length < 2) return 0;

        const mean = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s.score - mean, 2), 0) / scores.length;
        return Math.sqrt(variance);
    }

    // Export grading results
    async exportGrades(assignmentId, format = 'csv') {
        const grades = await this.db.all(`
            SELECT 
                st.name as student_name,
                st.email as student_email,
                s.submitted_at,
                ra.score as rubric_score,
                ra.created_at as graded_at,
                GROUP_CONCAT(
                    rc.description || ': ' || ca.points || 
                    CASE WHEN ca.comments != '' THEN ' (' || ca.comments || ')' ELSE '' END,
                    '; '
                ) as criterion_details
            FROM submissions s
            JOIN students st ON s.student_id = st.id
            LEFT JOIN rubric_assessments ra ON s.id = ra.submission_id
            LEFT JOIN criterion_assessments ca ON ra.id = ca.assessment_id
            LEFT JOIN rubric_criteria rc ON ca.criterion_id = rc.id
            WHERE s.assignment_id = ?
            GROUP BY s.id, st.name, st.email, s.submitted_at, ra.score, ra.created_at
            ORDER BY st.name
        `, [assignmentId]);

        if (format === 'csv') {
            return this.formatAsCSV(grades);
        } else if (format === 'json') {
            return JSON.stringify(grades, null, 2);
        }

        return grades;
    }

    formatAsCSV(data) {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];

        for (const row of data) {
            const values = headers.map(header => {
                const value = row[header];
                return typeof value === 'string' && value.includes(',') 
                    ? `"${value.replace(/"/g, '""')}"` 
                    : value;
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    }

    // Recovery functions
    async recoverSession(sessionId) {
        // Implement session recovery from auto-saved state
        console.log(`Recovering grading session ${sessionId}`);
        // This could restore from app_state table or local storage
    }

    async createGradingBackup(assignmentId) {
        const backup = {
            assignment_id: assignmentId,
            created_at: new Date().toISOString(),
            assessments: await this.db.all(`
                SELECT ra.*, 
                       json_group_array(
                           json_object(
                               'criterion_id', ca.criterion_id,
                               'rating_id', ca.rating_id,
                               'points', ca.points,
                               'comments', ca.comments
                           )
                       ) as criterion_assessments
                FROM rubric_assessments ra
                LEFT JOIN criterion_assessments ca ON ra.id = ca.assessment_id
                JOIN submissions s ON ra.submission_id = s.id
                WHERE s.assignment_id = ?
                GROUP BY ra.id
            `, [assignmentId])
        };

        const backupPath = `./data/grading-backup-${assignmentId}-${Date.now()}.json`;
        await require('fs').promises.writeFile(backupPath, JSON.stringify(backup, null, 2));
        
        console.log(`Created grading backup: ${backupPath}`);
        return backupPath;
    }
}

module.exports = GradingService; 