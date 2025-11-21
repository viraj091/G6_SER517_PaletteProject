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

            // Initialize schema if needed
            await this.initializeSchema();

            console.log('Database initialized successfully');
            return this.db;
        } catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }

    async initializeSchema() {
        // Schema will be created if database doesn't exist
        const schema = `
        -- Core rubric template storage
        CREATE TABLE IF NOT EXISTS rubric_templates (
            id TEXT PRIMARY KEY,
            canvas_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            points_possible REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_by TEXT,
            last_modified_by TEXT
        );

        -- Rubric criteria
        CREATE TABLE IF NOT EXISTS rubric_criteria (
            id TEXT PRIMARY KEY,
            rubric_template_id TEXT NOT NULL,
            canvas_criterion_id TEXT,
            description TEXT NOT NULL,
            long_description TEXT,
            points REAL NOT NULL,
            position INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (rubric_template_id) REFERENCES rubric_templates(id) ON DELETE CASCADE
        );

        -- Rubric ratings
        CREATE TABLE IF NOT EXISTS rubric_ratings (
            id TEXT PRIMARY KEY,
            criterion_id TEXT NOT NULL,
            canvas_rating_id TEXT,
            description TEXT NOT NULL,
            long_description TEXT,
            points REAL NOT NULL,
            position INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (criterion_id) REFERENCES rubric_criteria(id) ON DELETE CASCADE
        );

        -- Comments
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            submission_id TEXT NOT NULL,
            assessment_id TEXT,
            comment_type TEXT NOT NULL CHECK (comment_type IN ('individual', 'group', 'general')),
            content TEXT NOT NULL,
            author_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_synced BOOLEAN DEFAULT 0,
            last_synced DATETIME
        );

        -- Sync queue
        CREATE TABLE IF NOT EXISTS sync_queue (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
            retry_count INTEGER DEFAULT 0,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            processed_at DATETIME
        );

        -- User settings
        CREATE TABLE IF NOT EXISTS user_settings (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, setting_key)
        );

        -- Templates
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT,
            points REAL DEFAULT 0,
            criteria_json TEXT NOT NULL,
            tags_json TEXT,
            quick_start BOOLEAN DEFAULT 0,
            saved BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME,
            usage_count INTEGER DEFAULT 0,
            created_by TEXT
        );

        -- Tags
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            color TEXT,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME,
            usage_count INTEGER DEFAULT 0
        );

        -- Assignment-Rubric mapping
        CREATE TABLE IF NOT EXISTS assignment_rubrics (
            assignment_id TEXT PRIMARY KEY,
            rubric_id TEXT NOT NULL,
            course_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (rubric_id) REFERENCES rubric_templates(id) ON DELETE CASCADE
        );

        -- Draft grades (local offline storage)
        CREATE TABLE IF NOT EXISTS draft_grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            grades_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(course_id, assignment_id)
        );
        `;

        await this.db.exec(schema);
    }

    async close() {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    // Basic database operations
    async run(sql, params = []) {
        return await this.db.run(sql, params);
    }

    async get(sql, params = []) {
        return await this.db.get(sql, params);
    }

    async all(sql, params = []) {
        return await this.db.all(sql, params);
    }

    // Transaction support
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

    // Rubric operations
    async createRubricTemplate(data) {
        const id = uuidv4();
        const now = new Date().toISOString();

        await this.run(`
            INSERT INTO rubric_templates
            (id, canvas_id, name, description, points_possible, created_by, last_modified_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, data.canvas_id || null, data.name, data.description || '',
            data.points_possible || 0, data.created_by, data.created_by, now, now
        ]);

        return id;
    }

    async getRubricTemplate(id) {
        const template = await this.get(
            'SELECT * FROM rubric_templates WHERE id = ? AND is_active = 1', [id]
        );

        if (!template) return null;

        // Get criteria and ratings
        const criteria = await this.all(`
            SELECT c.*,
                   GROUP_CONCAT(
                       json_object(
                           'id', r.id,
                           'description', r.description,
                           'long_description', r.long_description,
                           'points', r.points,
                           'position', r.position
                       )
                   ) as ratings
            FROM rubric_criteria c
            LEFT JOIN rubric_ratings r ON c.id = r.criterion_id
            WHERE c.rubric_template_id = ?
            GROUP BY c.id
            ORDER BY c.position
        `, [id]);

        // Parse ratings JSON
        criteria.forEach(criterion => {
            try {
                criterion.ratings = criterion.ratings ? JSON.parse('[' + criterion.ratings + ']') : [];
            } catch (e) {
                criterion.ratings = [];
            }
        });

        return {
            ...template,
            criteria
        };
    }

    // Sync queue operations
    async addToSyncQueue(entityType, entityId, operation) {
        const id = uuidv4();
        const now = new Date().toISOString();

        await this.run(`
            INSERT INTO sync_queue (id, entity_type, entity_id, operation, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [id, entityType, entityId, operation, now]);

        return id;
    }

    async getPendingSyncItems(limit = 10) {
        return await this.all(`
            SELECT * FROM sync_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?
        `, [limit]);
    }

    async updateSyncStatus(id, status, error = null) {
        const now = new Date().toISOString();

        await this.run(`
            UPDATE sync_queue
            SET status = ?, last_error = ?, processed_at = ?
            WHERE id = ?
        `, [status, error, now, id]);
    }
}

module.exports = DatabaseManager;