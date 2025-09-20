// Database Manager - SQLite implementation for offline-first grading
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

class DatabaseManager {
    constructor(dbPath = './data/palette.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        try {
            // Ensure data directory exists
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

            // Open database connection
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            // Enable foreign keys
            await this.db.exec('PRAGMA foreign_keys = ON');
            
            // Initialize schema
            await this.initializeSchema();
            
            console.log('Database initialized successfully');
            return this.db;
        } catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }

    async initializeSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        try {
            const schema = await fs.readFile(schemaPath, 'utf8');
            await this.db.exec(schema);
        } catch (error) {
            console.error('Schema initialization failed:', error);
            throw error;
        }
    }

    async close() {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    // Rubric Template Operations
    async createRubricTemplate(data) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO rubric_templates 
            (id, canvas_id, name, description, points_possible, created_by, last_modified_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, data.canvas_id || null, data.name, data.description || '',
            data.points_possible || 0, data.created_by, data.created_by, now, now
        ]);

        return id;
    }

    async updateRubricTemplate(id, data) {
        const now = new Date().toISOString();
        
        // Create new version instead of updating in place for better stability
        const currentVersion = await this.db.get(
            'SELECT version FROM rubric_templates WHERE id = ?', [id]
        );
        
        await this.db.run(`
            UPDATE rubric_templates 
            SET name = ?, description = ?, points_possible = ?, 
                last_modified_by = ?, updated_at = ?, version = ?
            WHERE id = ?
        `, [
            data.name, data.description, data.points_possible,
            data.last_modified_by, now, (currentVersion?.version || 0) + 1, id
        ]);

        return id;
    }

    async getRubricTemplate(id) {
        const template = await this.db.get(
            'SELECT * FROM rubric_templates WHERE id = ? AND is_active = 1', [id]
        );

        if (!template) return null;

        // Get criteria and ratings
        const criteria = await this.db.all(`
            SELECT c.*, 
                   json_group_array(
                       json_object(
                           'id', r.id,
                           'description', r.description,
                           'long_description', r.long_description,
                           'points', r.points,
                           'position', r.position
                       ) ORDER BY r.position
                   ) as ratings
            FROM rubric_criteria c
            LEFT JOIN rubric_ratings r ON c.id = r.criterion_id
            WHERE c.rubric_template_id = ?
            GROUP BY c.id
            ORDER BY c.position
        `, [id]);

        // Parse JSON ratings
        criteria.forEach(criterion => {
            criterion.ratings = JSON.parse(criterion.ratings || '[]');
        });

        return {
            ...template,
            criteria
        };
    }

    async listRubricTemplates(userId = null) {
        let query = `
            SELECT id, name, description, points_possible, created_at, updated_at, version
            FROM rubric_templates 
            WHERE is_active = 1
        `;
        let params = [];

        if (userId) {
            query += ' AND created_by = ?';
            params.push(userId);
        }

        query += ' ORDER BY updated_at DESC';
        
        return await this.db.all(query, params);
    }

    // Rubric Criteria Operations
    async createRubricCriterion(rubricId, data) {
        const id = uuidv4();
        
        await this.db.run(`
            INSERT INTO rubric_criteria 
            (id, rubric_template_id, canvas_criterion_id, description, long_description, points, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id, rubricId, data.canvas_criterion_id || null,
            data.description, data.long_description || '', 
            data.points || 0, data.position || 0
        ]);

        return id;
    }

    async createRubricRating(criterionId, data) {
        const id = uuidv4();
        
        await this.db.run(`
            INSERT INTO rubric_ratings 
            (id, criterion_id, canvas_rating_id, description, long_description, points, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id, criterionId, data.canvas_rating_id || null,
            data.description, data.long_description || '',
            data.points || 0, data.position || 0
        ]);

        return id;
    }

    // Assessment Operations
    async createAssessment(data) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO rubric_assessments 
            (id, submission_id, rubric_template_id, assessor_id, score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id, data.submission_id, data.rubric_template_id,
            data.assessor_id, data.score || 0, now, now
        ]);

        return id;
    }

    async updateAssessment(id, data) {
        const now = new Date().toISOString();
        
        await this.db.run(`
            UPDATE rubric_assessments 
            SET score = ?, updated_at = ?, is_synced = 0
            WHERE id = ?
        `, [data.score, now, id]);

        return id;
    }

    async createCriterionAssessment(data) {
        const id = uuidv4();
        
        await this.db.run(`
            INSERT INTO criterion_assessments 
            (id, assessment_id, criterion_id, rating_id, points, comments)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            id, data.assessment_id, data.criterion_id,
            data.rating_id || null, data.points || 0, data.comments || ''
        ]);

        return id;
    }

    async getAssessment(submissionId) {
        const assessment = await this.db.get(`
            SELECT ra.*, rt.name as rubric_name
            FROM rubric_assessments ra
            JOIN rubric_templates rt ON ra.rubric_template_id = rt.id
            WHERE ra.submission_id = ?
        `, [submissionId]);

        if (!assessment) return null;

        // Get criterion assessments
        const criterionAssessments = await this.db.all(`
            SELECT ca.*, rc.description as criterion_description,
                   rr.description as rating_description, rr.points as rating_points
            FROM criterion_assessments ca
            JOIN rubric_criteria rc ON ca.criterion_id = rc.id
            LEFT JOIN rubric_ratings rr ON ca.rating_id = rr.id
            WHERE ca.assessment_id = ?
            ORDER BY rc.position
        `, [assessment.id]);

        return {
            ...assessment,
            criterionAssessments
        };
    }

    // Comment Operations
    async createComment(data) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO comments 
            (id, submission_id, assessment_id, comment_type, content, author_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id, data.submission_id, data.assessment_id || null,
            data.comment_type, data.content, data.author_id, now
        ]);

        return id;
    }

    async getComments(submissionId, commentType = null) {
        let query = 'SELECT * FROM comments WHERE submission_id = ?';
        let params = [submissionId];

        if (commentType) {
            query += ' AND comment_type = ?';
            params.push(commentType);
        }

        query += ' ORDER BY created_at ASC';
        
        return await this.db.all(query, params);
    }

    // Course and Assignment Operations
    async createCourse(data) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO courses (id, canvas_id, name, course_code, term, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, data.canvas_id, data.name, data.course_code || '', data.term || '', now]);

        return id;
    }

    async createAssignment(data) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO assignments 
            (id, canvas_id, course_id, name, description, points_possible, due_at, rubric_template_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, data.canvas_id, data.course_id, data.name,
            data.description || '', data.points_possible || 0,
            data.due_at, data.rubric_template_id, now
        ]);

        return id;
    }

    async getActiveAssignments(courseId = null) {
        let query = 'SELECT * FROM active_assignments';
        let params = [];

        if (courseId) {
            query += ' WHERE course_id = ?';
            params.push(courseId);
        }

        query += ' ORDER BY due_at DESC';
        
        return await this.db.all(query, params);
    }

    // Sync Queue Operations
    async addToSyncQueue(entityType, entityId, operation) {
        const id = uuidv4();
        const now = new Date().toISOString();
        
        await this.db.run(`
            INSERT INTO sync_queue (id, entity_type, entity_id, operation, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [id, entityType, entityId, operation, now]);

        return id;
    }

    async getPendingSyncItems(limit = 10) {
        return await this.db.all(`
            SELECT * FROM sync_queue 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT ?
        `, [limit]);
    }

    async updateSyncStatus(id, status, error = null) {
        const now = new Date().toISOString();
        
        await this.db.run(`
            UPDATE sync_queue 
            SET status = ?, last_error = ?, processed_at = ?
            WHERE id = ?
        `, [status, error, now, id]);
    }

    // Backup and Recovery
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `./data/backup/palette-backup-${timestamp}.db`;
        
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.copyFile(this.dbPath, backupPath);
        
        return backupPath;
    }

    async getGradingProgress() {
        return await this.db.all('SELECT * FROM grading_progress');
    }

    // Transaction support for complex operations
    async runTransaction(callback) {
        await this.db.run('BEGIN TRANSACTION');
        try {
            const result = await callback(this.db);
            await this.db.run('COMMIT');
            return result;
        } catch (error) {
            await this.db.run('ROLLBACK');
            throw error;
        }
    }
}

module.exports = DatabaseManager;