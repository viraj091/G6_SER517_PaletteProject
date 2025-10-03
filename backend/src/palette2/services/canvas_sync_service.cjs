// Canvas Synchronization Service - Handles offline/online sync
const axios = require('axios');
const DatabaseManager = require('./database_manager.cjs');

class CanvasSyncService {
    constructor(baseUrl, accessToken, dbManager) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.accessToken = accessToken;
        this.db = dbManager;
        this.isOnline = true;
        this.syncInProgress = false;
        
        // Setup axios instance
        this.api = axios.create({
            baseURL: `${this.baseUrl}/api/v1`,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Monitor connectivity
        this.setupConnectivityMonitoring();
    }

    setupConnectivityMonitoring() {
        // Check connectivity periodically
        setInterval(async () => {
            try {
                await this.api.get('/users/self');
                this.isOnline = true;
            } catch (error) {
                this.isOnline = false;
                console.log('Canvas API unavailable, working offline');
            }
        }, 60000); // Check every minute
    }

    // Rubric Synchronization
    async downloadRubric(canvasRubricId, courseId) {
        try {
            if (!this.isOnline) {
                throw new Error('Cannot download rubric while offline');
            }

            const response = await this.api.get(`/courses/${courseId}/rubrics/${canvasRubricId}`);
            const canvasRubric = response.data;

            // Store in local database
            const rubricId = await this.db.createRubricTemplate({
                canvas_id: canvasRubric.id,
                name: canvasRubric.title,
                description: canvasRubric.description || '',
                points_possible: canvasRubric.points_possible,
                created_by: 'canvas_import',
                last_modified_by: 'canvas_import'
            });

            // Store criteria and ratings
            for (let i = 0; i < canvasRubric.data.length; i++) {
                const criterion = canvasRubric.data[i];
                
                const criterionId = await this.db.createRubricCriterion(rubricId, {
                    canvas_criterion_id: criterion.id,
                    description: criterion.description,
                    long_description: criterion.long_description || '',
                    points: criterion.points,
                    position: i
                });

                // Store ratings for this criterion
                for (let j = 0; j < criterion.ratings.length; j++) {
                    const rating = criterion.ratings[j];
                    
                    await this.db.createRubricRating(criterionId, {
                        canvas_rating_id: rating.id,
                        description: rating.description,
                        long_description: rating.long_description || '',
                        points: rating.points,
                        position: j
                    });
                }
            }

            console.log(`Downloaded rubric: ${canvasRubric.title}`);
            return rubricId;

        } catch (error) {
            console.error('Failed to download rubric:', error.message);
            throw error;
        }
    }

    async uploadRubric(localRubricId, courseId) {
        try {
            if (!this.isOnline) {
                await this.db.addToSyncQueue('rubric', localRubricId, 'create');
                return null;
            }

            const rubric = await this.db.getRubricTemplate(localRubricId);
            if (!rubric) throw new Error('Rubric not found');

            // Convert to Canvas format
            const canvasRubric = {
                rubric: {
                    title: rubric.name,
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
                }
            };

            const response = await this.api.post(`/courses/${courseId}/rubrics`, canvasRubric);
            const canvasRubricData = response.data;

            // Update local record with Canvas ID
            await this.db.updateRubricTemplate(localRubricId, {
                ...rubric,
                canvas_id: canvasRubricData.id
            });

            console.log(`Uploaded rubric: ${rubric.name}`);
            return canvasRubricData.id;

        } catch (error) {
            console.error('Failed to upload rubric:', error.message);
            await this.db.addToSyncQueue('rubric', localRubricId, 'create');
            throw error;
        }
    }

    // Assignment and Submission Synchronization
    async downloadAssignments(courseId) {
        try {
            if (!this.isOnline) {
                throw new Error('Cannot download assignments while offline');
            }

            const response = await this.api.get(`/courses/${courseId}/assignments`);
            const assignments = response.data;

            for (const assignment of assignments) {
                await this.db.createAssignment({
                    canvas_id: assignment.id,
                    course_id: courseId,
                    name: assignment.name,
                    description: assignment.description,
                    points_possible: assignment.points_possible,
                    due_at: assignment.due_at
                });

                // Download submissions for this assignment
                await this.downloadSubmissions(assignment.id, courseId);
            }

            console.log(`Downloaded ${assignments.length} assignments`);
            return assignments.length;

        } catch (error) {
            console.error('Failed to download assignments:', error.message);
            throw error;
        }
    }

    async downloadSubmissions(assignmentId, courseId) {
        try {
            const response = await this.api.get(`/courses/${courseId}/assignments/${assignmentId}/submissions`, {
                params: { include: ['user'] }
            });
            const submissions = response.data;

            for (const submission of submissions) {
                // Ensure student exists
                await this.db.students.upsert({
                    canvas_id: submission.user.id,
                    course_id: courseId,
                    name: submission.user.name,
                    email: submission.user.email
                });

                // Store submission
                await this.db.createSubmission({
                    canvas_id: submission.id,
                    assignment_id: assignmentId,
                    student_id: submission.user.id,
                    submitted_at: submission.submitted_at,
                    score: submission.score,
                    grade: submission.grade,
                    workflow_state: submission.workflow_state,
                    submission_type: submission.submission_type
                });
            }

            return submissions.length;

        } catch (error) {
            console.error('Failed to download submissions:', error.message);
            throw error;
        }
    }

    // Assessment Synchronization
    async uploadAssessment(assessmentId) {
        try {
            if (!this.isOnline) {
                await this.db.addToSyncQueue('assessment', assessmentId, 'update');
                return null;
            }

            const assessment = await this.db.getAssessment(assessmentId);
            if (!assessment) throw new Error('Assessment not found');

            // Get submission info
            const submission = await this.db.get(`
                SELECT s.*, a.canvas_id as assignment_canvas_id, st.canvas_id as student_canvas_id
                FROM submissions s
                JOIN assignments a ON s.assignment_id = a.id
                JOIN students st ON s.student_id = st.id
                WHERE s.id = ?
            `, [assessment.submission_id]);

            // Convert to Canvas format
            const canvasAssessment = {
                rubric_assessment: {}
            };

            for (const criterionAssessment of assessment.criterionAssessments) {
                const criterion = await this.db.get(
                    'SELECT canvas_criterion_id FROM rubric_criteria WHERE id = ?',
                    [criterionAssessment.criterion_id]
                );

                if (criterion.canvas_criterion_id) {
                    canvasAssessment.rubric_assessment[criterion.canvas_criterion_id] = {
                        points: criterionAssessment.points,
                        comments: criterionAssessment.comments || ''
                    };
                }
            }

            // Upload to Canvas
            const response = await this.api.put(
                `/courses/${submission.course_id}/assignments/${submission.assignment_canvas_id}/submissions/${submission.student_canvas_id}`,
                canvasAssessment
            );

            // Mark as synced
            await this.db.run(
                'UPDATE rubric_assessments SET is_synced = 1, last_synced = ? WHERE id = ?',
                [new Date().toISOString(), assessmentId]
            );

            console.log(`Uploaded assessment for submission ${submission.canvas_id}`);
            return response.data;

        } catch (error) {
            console.error('Failed to upload assessment:', error.message);
            await this.db.addToSyncQueue('assessment', assessmentId, 'update');
            throw error;
        }
    }

    // Comment Synchronization
    async uploadComments(submissionId) {
        try {
            if (!this.isOnline) {
                const comments = await this.db.getComments(submissionId);
                for (const comment of comments.filter(c => !c.is_synced)) {
                    await this.db.addToSyncQueue('comment', comment.id, 'create');
                }
                return null;
            }

            const comments = await this.db.getComments(submissionId);
            const unsynced = comments.filter(c => !c.is_synced);

            for (const comment of unsynced) {
                const submission = await this.db.get(`
                    SELECT s.*, a.canvas_id as assignment_canvas_id, 
                           st.canvas_id as student_canvas_id, c.canvas_id as course_canvas_id
                    FROM submissions s
                    JOIN assignments a ON s.assignment_id = a.id
                    JOIN students st ON s.student_id = st.id
                    JOIN courses c ON a.course_id = c.id
                    WHERE s.id = ?
                `, [submissionId]);

                const canvasComment = {
                    comment: {
                        text_comment: comment.content
                    }
                };

                const response = await this.api.put(
                    `/courses/${submission.course_canvas_id}/assignments/${submission.assignment_canvas_id}/submissions/${submission.student_canvas_id}`,
                    canvasComment
                );

                // Mark as synced
                await this.db.run(
                    'UPDATE comments SET is_synced = 1, last_synced = ? WHERE id = ?',
                    [new Date().toISOString(), comment.id]
                );
            }

            console.log(`Uploaded ${unsynced.length} comments`);
            return unsynced.length;

        } catch (error) {
            console.error('Failed to upload comments:', error.message);
            throw error;
        }
    }

    // Bulk Synchronization
    async syncAll() {
        if (this.syncInProgress) {
            console.log('Sync already in progress');
            return;
        }

        this.syncInProgress = true;
        const syncResults = {
            uploaded: 0,
            failed: 0,
            errors: []
        };

        try {
            if (!this.isOnline) {
                console.log('Cannot sync while offline');
                return syncResults;
            }

            console.log('Starting full synchronization...');

            // Process sync queue
            const pendingItems = await this.db.getPendingSyncItems(50);
            
            for (const item of pendingItems) {
                try {
                    await this.db.updateSyncStatus(item.id, 'in_progress');

                    switch (item.entity_type) {
                        case 'rubric':
                            if (item.operation === 'create') {
                                // Need course ID - should be stored in context
                                const rubric = await this.db.getRubricTemplate(item.entity_id);
                                if (rubric.canvas_id) {
                                    await this.uploadRubric(item.entity_id, rubric.course_id);
                                }
                            }
                            break;

                        case 'assessment':
                            await this.uploadAssessment(item.entity_id);
                            break;

                        case 'comment':
                            const comment = await this.db.get(
                                'SELECT submission_id FROM comments WHERE id = ?',
                                [item.entity_id]
                            );
                            if (comment) {
                                await this.uploadComments(comment.submission_id);
                            }
                            break;

                        default:
                            console.warn(`Unknown entity type: ${item.entity_type}`);
                    }

                    await this.db.updateSyncStatus(item.id, 'completed');
                    syncResults.uploaded++;

                } catch (error) {
                    console.error(`Failed to sync ${item.entity_type} ${item.entity_id}:`, error.message);
                    await this.db.updateSyncStatus(item.id, 'failed', error.message);
                    syncResults.failed++;
                    syncResults.errors.push({
                        entity: `${item.entity_type}:${item.entity_id}`,
                        error: error.message
                    });
                }
            }

            console.log(`Sync completed: ${syncResults.uploaded} uploaded, ${syncResults.failed} failed`);

        } catch (error) {
            console.error('Sync process failed:', error.message);
            syncResults.errors.push({ error: error.message });
        } finally {
            this.syncInProgress = false;
        }

        return syncResults;
    }

    // Auto-sync functionality
    startAutoSync(intervalMinutes = 5) {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }

        this.autoSyncInterval = setInterval(async () => {
            if (this.isOnline && !this.syncInProgress) {
                try {
                    await this.syncAll();
                } catch (error) {
                    console.error('Auto-sync failed:', error.message);
                }
            }
        }, intervalMinutes * 60 * 1000);

        console.log(`Auto-sync started (every ${intervalMinutes} minutes)`);
    }

    stopAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
            console.log('Auto-sync stopped');
        }
    }

    // OAuth Authentication (replaces token-based auth)
    static async authenticateWithOAuth(canvasUrl, clientId, redirectUri) {
        const authUrl = `${canvasUrl}/login/oauth2/auth?` +
            `client_id=${clientId}&` +
            `response_type=code&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `scope=url:GET|/api/v1/courses/*&` +
            `url:POST|/api/v1/courses/*/rubrics&` +
            `url:PUT|/api/v1/courses/*/assignments/*/submissions/*`;
        
        return authUrl;
    }

    static async exchangeCodeForToken(canvasUrl, clientId, clientSecret, code, redirectUri) {
        try {
            const response = await axios.post(`${canvasUrl}/login/oauth2/token`, {
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri
            });

            return {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                expires_in: response.data.expires_in,
                user: response.data.user
            };
        } catch (error) {
            console.error('Token exchange failed:', error.response?.data || error.message);
            throw error;
        }
    }

    // Utility methods
    async getConnectionStatus() {
        return {
            isOnline: this.isOnline,
            syncInProgress: this.syncInProgress,
            pendingItems: await this.db.get('SELECT COUNT(*) as count FROM sync_queue WHERE status = "pending"')
        };
    }

    async getLastSyncTime() {
        const result = await this.db.get(`
            SELECT MAX(processed_at) as last_sync 
            FROM sync_queue 
            WHERE status = 'completed'
        `);
        return result?.last_sync;
    }

    async clearSyncQueue() {
        await this.db.run('DELETE FROM sync_queue WHERE status IN ("completed", "failed")');
        console.log('Sync queue cleared');
    }

    // Error recovery
    async retryFailedSync(maxRetries = 3) {
        const failedItems = await this.db.all(`
            SELECT * FROM sync_queue 
            WHERE status = 'failed' AND retry_count < ?
            ORDER BY created_at ASC
        `, [maxRetries]);

        for (const item of failedItems) {
            try {
                await this.db.run(`
                    UPDATE sync_queue 
                    SET status = 'pending', retry_count = retry_count + 1
                    WHERE id = ?
                `, [item.id]);
            } catch (error) {
                console.error(`Failed to retry item ${item.id}:`, error.message);
            }
        }

        console.log(`Queued ${failedItems.length} items for retry`);
        return failedItems.length;
    }
}

module.exports = CanvasSyncService;