// Rubric Manager - Handles stable rubric creation and editing
const { v4: uuidv4 } = require('uuid');
const DatabaseManager = require('./database_manager');

class RubricManager {
    constructor(dbManager) {
        this.db = dbManager;
    }

    // Create a new rubric from scratch
    async createRubric(data, userId) {
        return await this.db.runTransaction(async (db) => {
            const rubricId = uuidv4();
            const now = new Date().toISOString();

            // Create base rubric
            await db.run(`
                INSERT INTO rubric_templates 
                (id, name, description, points_possible, created_by, last_modified_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                rubricId, data.name, data.description || '',
                data.points_possible || 0, userId, userId, now, now
            ]);

            // Add default criteria if none provided
            if (!data.criteria || data.criteria.length === 0) {
                await this.addDefaultCriteria(rubricId, db);
            } else {
                // Add provided criteria
                for (let i = 0; i < data.criteria.length; i++) {
                    const criterion = data.criteria[i];
                    await this.createCriterion(rubricId, criterion, i, db);
                }
            }

            console.log(`Created rubric: ${data.name} (${rubricId})`);
            return rubricId;
        });
    }

    // Create a copy of existing rubric (for safe editing)
    async copyRubric(sourceRubricId, newName, userId) {
        return await this.db.runTransaction(async (db) => {
            const sourceRubric = await this.db.getRubricTemplate(sourceRubricId);
            if (!sourceRubric) {
                throw new Error('Source rubric not found');
            }

            const newRubricId = uuidv4();
            const now = new Date().toISOString();

            // Create copy of rubric template
            await db.run(`
                INSERT INTO rubric_templates 
                (id, name, description, points_possible, created_by, last_modified_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                newRubricId, newName || `${sourceRubric.name} (Copy)`,
                sourceRubric.description, sourceRubric.points_possible,
                userId, userId, now, now
            ]);

            // Copy criteria and ratings
            for (const criterion of sourceRubric.criteria) {
                const newCriterionId = uuidv4();
                
                await db.run(`
                    INSERT INTO rubric_criteria 
                    (id, rubric_template_id, description, long_description, points, position)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    newCriterionId, newRubricId, criterion.description,
                    criterion.long_description, criterion.points, criterion.position
                ]);

                // Copy ratings
                for (const rating of criterion.ratings) {
                    await db.run(`
                        INSERT INTO rubric_ratings 
                        (id, criterion_id, description, long_description, points, position)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        uuidv4(), newCriterionId, rating.description,
                        rating.long_description, rating.points, rating.position
                    ]);
                }
            }

            console.log(`Copied rubric: ${newRubricId} from ${sourceRubricId}`);
            return newRubricId;
        });
    }

    // Safe rubric editing that preserves existing assessments
    async editRubric(rubricId, changes, userId) {
        return await this.db.runTransaction(async (db) => {
            // Check if rubric is in use
            const inUse = await db.get(`
                SELECT COUNT(*) as count FROM rubric_assessments 
                WHERE rubric_template_id = ?
            `, [rubricId]);

            if (inUse.count > 0) {
                // Rubric is in use - create a new version
                return await this.createRubricVersion(rubricId, changes, userId);
            } else {
                // Safe to edit in place
                return await this.updateRubricInPlace(rubricId, changes, userId);
            }
        });
    }

    async createRubricVersion(originalRubricId, changes, userId) {
        // Deactivate original rubric
        await this.db.run(`
            UPDATE rubric_templates 
            SET is_active = 0, updated_at = ?
            WHERE id = ?
        `, [new Date().toISOString(), originalRubricId]);

        // Create new version with changes
        const newVersionId = await this.copyRubric(originalRubricId, null, userId);
        await this.updateRubricInPlace(newVersionId, changes, userId);

        // Update any assignments to point to new version
        await this.db.run(`
            UPDATE assignments 
            SET rubric_template_id = ?
            WHERE rubric_template_id = ?
        `, [newVersionId, originalRubricId]);

        console.log(`Created new version ${newVersionId} for rubric ${originalRubricId}`);
        return newVersionId;
    }

    async updateRubricInPlace(rubricId, changes, userId) {
        const now = new Date().toISOString();

        // Update basic rubric info
        if (changes.name || changes.description || changes.points_possible) {
            await this.db.run(`
                UPDATE rubric_templates 
                SET name = COALESCE(?, name),
                    description = COALESCE(?, description),
                    points_possible = COALESCE(?, points_possible),
                    last_modified_by = ?,
                    updated_at = ?,
                    version = version + 1
                WHERE id = ?
            `, [
                changes.name, changes.description, changes.points_possible,
                userId, now, rubricId
            ]);
        }

        // Handle criteria changes
        if (changes.criteria) {
            await this.updateCriteria(rubricId, changes.criteria);
        }

        console.log(`Updated rubric ${rubricId} in place`);
        return rubricId;
    }

    async updateCriteria(rubricId, criteriaChanges) {
        for (const change of criteriaChanges) {
            switch (change.action) {
                case 'add':
                    await this.addCriterion(rubricId, change.data);
                    break;
                case 'update':
                    await this.updateCriterion(change.criterionId, change.data);
                    break;
                case 'delete':
                    await this.deleteCriterion(change.criterionId);
                    break;
                case 'reorder':
                    await this.reorderCriteria(rubricId, change.newOrder);
                    break;
            }
        }
    }

    async addCriterion(rubricId, criterionData) {
        return await this.db.runTransaction(async (db) => {
            // Get next position
            const maxPos = await db.get(`
                SELECT MAX(position) as max_pos 
                FROM rubric_criteria 
                WHERE rubric_template_id = ?
            `, [rubricId]);

            const position = (maxPos?.max_pos || -1) + 1;
            
            return await this.createCriterion(rubricId, criterionData, position, db);
        });
    }

    async createCriterion(rubricId, criterionData, position, db = null) {
        const dbToUse = db || this.db;
        const criterionId = uuidv4();

        await dbToUse.run(`
            INSERT INTO rubric_criteria 
            (id, rubric_template_id, description, long_description, points, position)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            criterionId, rubricId, criterionData.description,
            criterionData.long_description || '', criterionData.points || 0, position
        ]);

        // Add default ratings if none provided
        const ratings = criterionData.ratings || this.getDefaultRatings(criterionData.points || 10);
        
        for (let i = 0; i < ratings.length; i++) {
            const rating = ratings[i];
            await dbToUse.run(`
                INSERT INTO rubric_ratings 
                (id, criterion_id, description, long_description, points, position)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                uuidv4(), criterionId, rating.description,
                rating.long_description || '', rating.points, i
            ]);
        }

        return criterionId;
    }

    async updateCriterion(criterionId, updates) {
        return await this.db.runTransaction(async (db) => {
            // Update criterion
            await db.run(`
                UPDATE rubric_criteria 
                SET description = COALESCE(?, description),
                    long_description = COALESCE(?, long_description),
                    points = COALESCE(?, points)
                WHERE id = ?
            `, [updates.description, updates.long_description, updates.points, criterionId]);

            // Update ratings if provided
            if (updates.ratings) {
                // Delete existing ratings
                await db.run('DELETE FROM rubric_ratings WHERE criterion_id = ?', [criterionId]);
                
                // Add new ratings
                for (let i = 0; i < updates.ratings.length; i++) {
                    const rating = updates.ratings[i];
                    await db.run(`
                        INSERT INTO rubric_ratings 
                        (id, criterion_id, description, long_description, points, position)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        uuidv4(), criterionId, rating.description,
                        rating.long_description || '', rating.points, i
                    ]);
                }
            }
        });
    }

    async deleteCriterion(criterionId) {
        return await this.db.runTransaction(async (db) => {
            // Check if criterion is used in any assessments
            const inUse = await db.get(`
                SELECT COUNT(*) as count FROM criterion_assessments 
                WHERE criterion_id = ?
            `, [criterionId]);

            if (inUse.count > 0) {
                throw new Error('Cannot delete criterion that has been used in assessments');
            }

            // Delete ratings first (cascade should handle this)
            await db.run('DELETE FROM rubric_ratings WHERE criterion_id = ?', [criterionId]);
            
            // Delete criterion
            await db.run('DELETE FROM rubric_criteria WHERE id = ?', [criterionId]);

            console.log(`Deleted criterion ${criterionId}`);
        });
    }

    async reorderCriteria(rubricId, newOrder) {
        return await this.db.runTransaction(async (db) => {
            for (let i = 0; i < newOrder.length; i++) {
                await db.run(`
                    UPDATE rubric_criteria 
                    SET position = ? 
                    WHERE id = ? AND rubric_template_id = ?
                `, [i, newOrder[i], rubricId]);
            }
        });
    }

    // Template and library functions
    async createRubricFromTemplate(templateId, name, userId) {
        const template = await this.db.getRubricTemplate(templateId);
        if (!template) {
            throw new Error('Template not found');
        }

        return await this.copyRubric(templateId, name, userId);
    }

    async saveAsTemplate(rubricId, templateName, userId) {
        const copy = await this.copyRubric(rubricId, templateName, userId);
        
        // Mark as template
        await this.db.run(`
            UPDATE rubric_templates 
            SET description = CONCAT(description, ' [TEMPLATE]')
            WHERE id = ?
        `, [copy]);

        return copy;
    }

    async getRubricLibrary(userId = null) {
        let query = `
            SELECT rt.*, 
                   COUNT(DISTINCT a.id) as assignment_count,
                   COUNT(DISTINCT ra.id) as assessment_count
            FROM rubric_templates rt
            LEFT JOIN assignments a ON rt.id = a.rubric_template_id
            LEFT JOIN rubric_assessments ra ON rt.id = ra.rubric_template_id
            WHERE rt.is_active = 1
        `;
        let params = [];

        if (userId) {
            query += ' AND rt.created_by = ?';
            params.push(userId);
        }

        query += `
            GROUP BY rt.id
            ORDER BY rt.updated_at DESC
        `;

        return await this.db.all(query, params);
    }

    // Import/Export functionality
    async exportRubric(rubricId) {
        const rubric = await this.db.getRubricTemplate(rubricId);
        if (!rubric) {
            throw new Error('Rubric not found');
        }

        // Clean export format
        const exportData = {
            version: '1.0',
            rubric: {
                name: rubric.name,
                description: rubric.description,
                points_possible: rubric.points_possible,
                criteria: rubric.criteria.map(criterion => ({
                    description: criterion.description,
                    long_description: criterion.long_description,
                    points: criterion.points,
                    ratings: criterion.ratings.map(rating => ({
                        description: rating.description,
                        long_description: rating.long_description,
                        points: rating.points
                    }))
                }))
            },
            exported_at: new Date().toISOString(),
            exported_by: rubric.created_by
        };

        return exportData;
    }

    async importRubric(importData, userId) {
        if (!importData.rubric) {
            throw new Error('Invalid import data format');
        }

        const rubricData = {
            name: importData.rubric.name,
            description: importData.rubric.description,
            points_possible: importData.rubric.points_possible,
            criteria: importData.rubric.criteria
        };

        return await this.createRubric(rubricData, userId);
    }

    // Helper methods
    async addDefaultCriteria(rubricId, db) {
        const defaultCriteria = [
            {
                description: 'Quality of Work',
                long_description: 'Overall quality and completeness of the submission',
                points: 10
            },
            {
                description: 'Following Instructions',
                long_description: 'How well the submission follows the assignment requirements',
                points: 10
            }
        ];

        for (let i = 0; i < defaultCriteria.length; i++) {
            await this.createCriterion(rubricId, defaultCriteria[i], i, db);
        }
    }

    getDefaultRatings(maxPoints) {
        return [
            {
                description: 'Excellent',
                long_description: 'Exceeds expectations',
                points: maxPoints
            },
            {
                description: 'Good',
                long_description: 'Meets expectations',
                points: Math.round(maxPoints * 0.8)
            },
            {
                description: 'Satisfactory',
                long_description: 'Mostly meets expectations',
                points: Math.round(maxPoints * 0.6)
            },
            {
                description: 'Needs Improvement',
                long_description: 'Below expectations',
                points: Math.round(maxPoints * 0.4)
            },
            {
                description: 'Unsatisfactory',
                long_description: 'Does not meet expectations',
                points: 0
            }
        ];
    }

    // Validation
    async validateRubric(rubricId) {
        const rubric = await this.db.getRubricTemplate(rubricId);
        const issues = [];

        if (!rubric) {
            issues.push('Rubric not found');
            return issues;
        }

        if (!rubric.name || rubric.name.trim() === '') {
            issues.push('Rubric name is required');
        }

        if (!rubric.criteria || rubric.criteria.length === 0) {
            issues.push('Rubric must have at least one criterion');
        }

        for (const criterion of rubric.criteria || []) {
            if (!criterion.description || criterion.description.trim() === '') {
                issues.push(`Criterion at position ${criterion.position} missing description`);
            }

            if (!criterion.ratings || criterion.ratings.length === 0) {
                issues.push(`Criterion "${criterion.description}" has no ratings`);
            }

            // Check for duplicate point values
            const pointValues = criterion.ratings.map(r => r.points);
            const uniquePoints = [...new Set(pointValues)];
            if (pointValues.length !== uniquePoints.length) {
                issues.push(`Criterion "${criterion.description}" has duplicate point values`);
            }
        }

        return issues;
    }
}

module.exports = RubricManager;