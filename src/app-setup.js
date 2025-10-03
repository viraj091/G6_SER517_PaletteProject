// Main Application Setup - Palette 2.0
const express = require('express');
const path = require('path');
const cors = require('cors');

// Import new services
const DatabaseManager = require('./services/database_manager.js');
const CanvasAuthService = require('./services/authentication_service.js');
const CanvasSyncService = require('./services/canvas_sync_service.js');
const GradingService = require('./services/grading_service.js');
const RubricManager = require('./services/rubric-manager.js');

class PaletteApp {
    constructor() {
        this.app = express();
        this.db = null;
        this.authService = null;
        this.syncService = null;
        this.gradingService = null;
        this.rubricManager = null;
        this.config = this.loadConfig();
    }

    loadConfig() {
        return {
            canvas: {
                baseUrl: process.env.CANVAS_BASE_URL || 'https://canvas.instructure.com',
                clientId: process.env.CANVAS_CLIENT_ID,
                clientSecret: process.env.CANVAS_CLIENT_SECRET,
                redirectUri: process.env.CANVAS_REDIRECT_URI || 'http://localhost:5173/auth/canvas/callback'
            },
            database: {
                path: process.env.DB_PATH || './data/palette.db'
            },
            server: {
                port: process.env.PORT || 5173,
                sessionSecret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex')
            },
            sync: {
                autoSyncInterval: parseInt(process.env.AUTO_SYNC_INTERVAL) || 5
            }
        };
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Palette 2.0...');

            // Initialize database
            this.db = new DatabaseManager(this.config.database.path);
            await this.db.initialize();
            console.log('✅ Database initialized');

            // Initialize services
            this.authService = new CanvasAuthService({
                clientId: this.config.canvas.clientId,
                clientSecret: this.config.canvas.clientSecret,
                redirectUri: this.config.canvas.redirectUri,
                canvasBaseUrl: this.config.canvas.baseUrl,
                sessionSecret: this.config.server.sessionSecret
            }, this.db);

            this.rubricManager = new RubricManager(this.db);
            this.gradingService = new GradingService(this.db, null); // Will set sync service later

            // Initialize sync service (requires auth)
            this.syncService = new CanvasSyncService(
                this.config.canvas.baseUrl,
                'placeholder-token', // Will be updated per session
                this.db
            );

            this.gradingService.sync = this.syncService;
            console.log('✅ Services initialized');

            // Setup Express middleware
            this.setupMiddleware();

            // Setup API routes
            this.setupRoutes();

            // Setup error handling
            this.setupErrorHandling();

            console.log('✅ Express app configured');

        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            throw error;
        }
    }

    setupMiddleware() {
        // CORS configuration
        this.app.use(cors({
            origin: ['http://localhost:3000', 'http://localhost:5173'],
            credentials: true
        }));

        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // Mount auth service middleware
        this.app.use(this.authService.app);

        // Serve static files (if frontend is built)
        const distPath = path.join(__dirname, '../frontend/dist');
        if (require('fs').existsSync(distPath)) {
            this.app.use(express.static(distPath));
        } else {
            console.log('⚠️  Frontend not built, serving API-only mode');
        }
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                version: '2.0.0',
                features: ['offline-grading', 'oauth-auth', 'auto-sync'],
                database: this.db ? 'connected' : 'disconnected'
            });
        });

        // Legacy Frontend Compatibility Routes (BEFORE API routes)
        this.setupLegacyRoutes();

        // API Routes
        this.setupAPIRoutes();

        // Frontend fallback
        this.app.get('*', (req, res) => {
            const indexPath = path.join(__dirname, '../frontend/dist/index.html');
            if (require('fs').existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                res.json({
                    message: 'Palette 2.0 API Server',
                    version: '2.0.0',
                    status: 'running',
                    endpoints: {
                        health: '/health',
                        auth: '/auth/*',
                        api: '/api/*'
                    },
                    note: 'Frontend not built. Use API endpoints or build frontend with: npm run build -w frontend'
                });
            }
        });
    }

    setupAPIRoutes() {
        const router = express.Router();

        // Settings routes (for personal token like previous version) - BEFORE auth middleware
        router.get('/api/settings', async (req, res) => {
            try {
                const settings = {
                    authenticated: !!req.session.user,
                    token_type: req.session.tokens?.token_type || 'none',
                    user: req.session.user || null
                };
                res.json(settings);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/settings/token', async (req, res) => {
            try {
                const { token } = req.body;

                if (!token) {
                    return res.status(400).json({ error: 'Token is required' });
                }

                // Use the auth service's personal token endpoint
                const authResult = await this.authService.getUserInfo(token);

                // Store user session
                req.session.user = {
                    id: authResult.id,
                    name: authResult.name,
                    email: authResult.email,
                    canvas_id: authResult.id
                };

                // Store token (encrypted)
                req.session.tokens = {
                    access_token: this.authService.encryptToken(token),
                    token_type: 'personal',
                    expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
                };

                res.json({
                    success: true,
                    message: 'Token updated successfully',
                    user: req.session.user
                });

            } catch (error) {
                console.error('Token validation failed:', error.message);
                res.status(401).json({
                    error: 'Invalid token',
                    details: error.message
                });
            }
        });

        // Middleware to ensure authentication for API routes (AFTER settings routes)
        router.use('/api', (req, res, next) => {
            if (req.path.startsWith('/auth') ||
                req.path === '/health' ||
                req.path.startsWith('/settings') ||
                req.path.startsWith('/user/settings') ||
                req.path.startsWith('/courses')) {
                return next();
            }
            this.authService.requireAuth(req, res, next);
        });

        // Middleware to get valid access token
        router.use('/api', async (req, res, next) => {
            if (req.path.startsWith('/auth') ||
                req.path === '/health' ||
                req.path.startsWith('/settings') ||
                req.path.startsWith('/courses') ||
                req.path.startsWith('/user/settings')) {
                return next();
            }
            await this.authService.getValidAccessToken(req, res, next);
        });

        // Rubric Management Routes
        router.get('/api/rubrics', async (req, res) => {
            try {
                const rubrics = await this.rubricManager.getRubricLibrary(req.session.user.id);
                res.json(rubrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/rubrics', async (req, res) => {
            try {
                const rubricId = await this.rubricManager.createRubric(req.body, req.session.user.id);
                const rubric = await this.db.getRubricTemplate(rubricId);
                res.json({ id: rubricId, rubric });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/api/rubrics/:id', async (req, res) => {
            try {
                const rubric = await this.db.getRubricTemplate(req.params.id);
                if (!rubric) {
                    return res.status(404).json({ error: 'Rubric not found' });
                }
                res.json(rubric);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.put('/api/rubrics/:id', async (req, res) => {
            try {
                const rubricId = await this.rubricManager.editRubric(
                    req.params.id,
                    req.body,
                    req.session.user.id
                );
                const rubric = await this.db.getRubricTemplate(rubricId);
                res.json({ id: rubricId, rubric });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/rubrics/:id/copy', async (req, res) => {
            try {
                const newRubricId = await this.rubricManager.copyRubric(
                    req.params.id,
                    req.body.name,
                    req.session.user.id
                );
                const rubric = await this.db.getRubricTemplate(newRubricId);
                res.json({ id: newRubricId, rubric });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/api/rubrics/:id/export', async (req, res) => {
            try {
                const exportData = await this.rubricManager.exportRubric(req.params.id);
                res.json(exportData);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/rubrics/import', async (req, res) => {
            try {
                const rubricId = await this.rubricManager.importRubric(req.body, req.session.user.id);
                const rubric = await this.db.getRubricTemplate(rubricId);
                res.json({ id: rubricId, rubric });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Grading Routes
        router.post('/api/grading/sessions', async (req, res) => {
            try {
                const session = await this.gradingService.startGradingSession(
                    req.body.assignmentId,
                    req.session.user.id
                );
                res.json(session);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/api/grading/submissions/:id', async (req, res) => {
            try {
                const submission = await this.gradingService.getSubmissionForGrading(req.params.id);
                res.json(submission);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/grading/submissions/:id/grade', async (req, res) => {
            try {
                const result = await this.gradingService.gradeSubmission(
                    req.params.id,
                    req.body,
                    req.session.user.id
                );
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/api/grading/assignments/:id/progress', async (req, res) => {
            try {
                const progress = await this.gradingService.getGradingProgress(req.params.id);
                res.json(progress);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/api/grading/assignments/:id/analytics', async (req, res) => {
            try {
                const analytics = await this.gradingService.getGradingAnalytics(req.params.id);
                res.json(analytics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Sync Routes
        router.get('/api/sync/status', async (req, res) => {
            try {
                const status = await this.syncService.getConnectionStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/sync/manual', async (req, res) => {
            try {
                const result = await this.syncService.syncAll();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/sync/rubrics/:id/upload', async (req, res) => {
            try {
                const canvasId = await this.syncService.uploadRubric(req.params.id, req.body.courseId);
                res.json({ canvasId });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Canvas Integration Routes
        router.get('/api/canvas/courses', async (req, res) => {
            try {
                const courses = await this.authService.getUserCourses(req.accessToken);
                res.json(courses);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/api/canvas/courses/:id/assignments/download', async (req, res) => {
            try {
                const count = await this.syncService.downloadAssignments(req.params.id);
                res.json({ downloaded: count });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Frontend compatibility - /api/courses endpoint
        router.get('/api/courses', async (req, res) => {
            try {
                // Auto-authenticate with environment token if not already authenticated
                if (!req.session.user && process.env.CANVAS_PERSONAL_TOKEN) {
                    try {
                        const userInfo = await this.authService.getUserInfo(process.env.CANVAS_PERSONAL_TOKEN);
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(process.env.CANVAS_PERSONAL_TOKEN),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000)
                        };
                        await this.authService.storeUserSettings(userInfo);
                        console.log('🔐 Auto-authenticated with environment token for API courses');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed for API courses:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                // Get valid access token first
                try {
                    const fiveMinutes = 5 * 60 * 1000;
                    if (req.session.tokens && req.session.tokens.expires_at - Date.now() < fiveMinutes) {
                        if (req.session.tokens.token_type !== 'personal') {
                            const refreshToken = this.authService.decryptToken(req.session.tokens.refresh_token);
                            const newTokens = await this.authService.refreshAccessToken(refreshToken);
                            req.session.tokens = {
                                access_token: this.authService.encryptToken(newTokens.access_token),
                                refresh_token: this.authService.encryptToken(newTokens.refresh_token || refreshToken),
                                expires_at: Date.now() + (newTokens.expires_in * 1000)
                            };
                        }
                    }

                    const accessToken = this.authService.decryptToken(req.session.tokens.access_token);
                    const courses = await this.authService.getUserCourses(accessToken);

                    res.json({
                        success: true,
                        data: courses
                    });
                } catch (tokenError) {
                    return res.json({
                        success: false,
                        error: 'Authentication failed',
                        data: []
                    });
                }
            } catch (error) {
                console.error('Error fetching courses:', error);
                res.status(500).json({ error: error.message, success: false });
            }
        });

        // Frontend compatibility - /api/courses/:id/assignments endpoint
        router.get('/api/courses/:id/assignments', async (req, res) => {
            try {
                // Auto-authenticate with environment token if not already authenticated
                if (!req.session.user && process.env.CANVAS_PERSONAL_TOKEN) {
                    try {
                        const userInfo = await this.authService.getUserInfo(process.env.CANVAS_PERSONAL_TOKEN);
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(process.env.CANVAS_PERSONAL_TOKEN),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000)
                        };
                        await this.authService.storeUserSettings(userInfo);
                        console.log('🔐 Auto-authenticated with environment token for API assignments');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed for API assignments:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                // Get valid access token first
                try {
                    const fiveMinutes = 5 * 60 * 1000;
                    if (req.session.tokens && req.session.tokens.expires_at - Date.now() < fiveMinutes) {
                        if (req.session.tokens.token_type !== 'personal') {
                            const refreshToken = this.authService.decryptToken(req.session.tokens.refresh_token);
                            const newTokens = await this.authService.refreshAccessToken(refreshToken);
                            req.session.tokens = {
                                access_token: this.authService.encryptToken(newTokens.access_token),
                                refresh_token: this.authService.encryptToken(newTokens.refresh_token || refreshToken),
                                expires_at: Date.now() + (newTokens.expires_in * 1000)
                            };
                        }
                    }

                    const accessToken = this.authService.decryptToken(req.session.tokens.access_token);
                    const assignments = await this.authService.getCourseAssignments(accessToken, req.params.id);

                    res.json({
                        success: true,
                        data: assignments
                    });
                } catch (tokenError) {
                    return res.json({
                        success: false,
                        error: 'Authentication failed',
                        data: []
                    });
                }
            } catch (error) {
                console.error('Error fetching assignments:', error);
                res.status(500).json({ error: error.message, success: false });
            }
        });



        this.app.use(router);
    }

    setupLegacyRoutes() {
        // Legacy Frontend Compatibility Routes (mounted directly on app to avoid router conflicts)
        this.app.get('/user/settings', async (req, res) => {
            try {
                const settings = {
                    authenticated: !!req.session.user,
                    token_type: req.session.tokens?.token_type || 'none',
                    user: req.session.user || null,
                    success: true,
                    data: {
                        userName: req.session.user?.name || "admin",
                        token: req.session.user ? "***" : "",
                        templateCriteria: [],
                        course_filter_presets: [],
                        preferences: {
                            defaultRatings: {
                                maxDefaultPoints: 5,
                                maxDefaultDescription: "Well done!",
                                minDefaultPoints: 0,
                                minDefaultDescription: "Not included",
                            },
                            darkMode: false,
                            defaultScale: 1,
                        }
                    }
                };
                res.json(settings);
            } catch (error) {
                res.status(500).json({ error: error.message, success: false });
            }
        });

        this.app.put('/user/settings', async (req, res) => {
            try {
                const { token, userName, preferences } = req.body;

                // If token is provided and changed, authenticate
                if (token && token !== "***" && token !== "") {
                    try {
                        const userInfo = await this.authService.getUserInfo(token);

                        // Store user session
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };

                        // Store token (encrypted)
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(token),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
                        };

                        // Store user settings
                        await this.authService.storeUserSettings(userInfo);
                    } catch (tokenError) {
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid token provided'
                        });
                    }
                }

                // TODO: Store other settings like userName and preferences in database if needed

                res.json({
                    success: true,
                    message: 'Settings updated successfully'
                });

            } catch (error) {
                res.status(500).json({ error: error.message, success: false });
            }
        });

        // Also add API prefix versions for useFetch compatibility
        this.app.get('/api/user/settings', async (req, res) => {
            try {
                // Auto-authenticate with environment token if not already authenticated
                if (!req.session.user && process.env.CANVAS_PERSONAL_TOKEN) {
                    try {
                        const userInfo = await this.authService.getUserInfo(process.env.CANVAS_PERSONAL_TOKEN);
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(process.env.CANVAS_PERSONAL_TOKEN),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000)
                        };
                        await this.authService.storeUserSettings(userInfo);
                        console.log('🔐 Auto-authenticated with environment token');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                const settings = {
                    authenticated: !!req.session.user,
                    token_type: req.session.tokens?.token_type || 'none',
                    user: req.session.user || null,
                    success: true,
                    data: {
                        userName: req.session.user?.name || "admin",
                        token: req.session.user ? "***" : (process.env.CANVAS_PERSONAL_TOKEN || ""),
                        templateCriteria: [],
                        course_filter_presets: [],
                        preferences: {
                            defaultRatings: {
                                maxDefaultPoints: 5,
                                maxDefaultDescription: "Well done!",
                                minDefaultPoints: 0,
                                minDefaultDescription: "Not included",
                            },
                            darkMode: false,
                            defaultScale: 1,
                        }
                    }
                };
                res.json(settings);
            } catch (error) {
                res.status(500).json({ error: error.message, success: false });
            }
        });

        this.app.put('/api/user/settings', async (req, res) => {
            try {
                const { token, userName, preferences } = req.body;

                // If token is provided and changed, authenticate
                if (token && token !== "***" && token !== "") {
                    try {
                        const userInfo = await this.authService.getUserInfo(token);

                        // Store user session
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };

                        // Store token (encrypted)
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(token),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
                        };

                        // Store user settings
                        await this.authService.storeUserSettings(userInfo);
                    } catch (tokenError) {
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid token provided'
                        });
                    }
                }

                // TODO: Store other settings like userName and preferences in database if needed

                res.json({
                    success: true,
                    message: 'Settings updated successfully'
                });

            } catch (error) {
                res.status(500).json({ error: error.message, success: false });
            }
        });

        this.app.get('/courses', async (req, res) => {
            try {
                // Auto-authenticate with environment token if not already authenticated
                if (!req.session.user && process.env.CANVAS_PERSONAL_TOKEN) {
                    try {
                        const userInfo = await this.authService.getUserInfo(process.env.CANVAS_PERSONAL_TOKEN);
                        req.session.user = {
                            id: userInfo.id,
                            name: userInfo.name,
                            email: userInfo.email,
                            canvas_id: userInfo.id
                        };
                        req.session.tokens = {
                            access_token: this.authService.encryptToken(process.env.CANVAS_PERSONAL_TOKEN),
                            token_type: 'personal',
                            expires_at: Date.now() + (365 * 24 * 60 * 60 * 1000)
                        };
                        await this.authService.storeUserSettings(userInfo);
                        console.log('🔐 Auto-authenticated with environment token for courses');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed for courses:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.json({
                        success: false,
                        error: 'Authentication required',
                        data: []
                    });
                }

                // Get valid access token first
                try {
                    const fiveMinutes = 5 * 60 * 1000;
                    if (req.session.tokens && req.session.tokens.expires_at - Date.now() < fiveMinutes) {
                        if (req.session.tokens.token_type !== 'personal') {
                            const refreshToken = this.authService.decryptToken(req.session.tokens.refresh_token);
                            const newTokens = await this.authService.refreshAccessToken(refreshToken);
                            req.session.tokens = {
                                access_token: this.authService.encryptToken(newTokens.access_token),
                                refresh_token: this.authService.encryptToken(newTokens.refresh_token || refreshToken),
                                expires_at: Date.now() + (newTokens.expires_in * 1000)
                            };
                        }
                    }

                    const accessToken = this.authService.decryptToken(req.session.tokens.access_token);
                    const courses = await this.authService.getUserCourses(accessToken);

                    res.json({
                        success: true,
                        data: courses
                    });
                } catch (tokenError) {
                    return res.json({
                        success: false,
                        error: 'Invalid or expired token',
                        data: []
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                    data: []
                });
            }
        });
    }

    setupErrorHandling() {
        // 404 handler
        this.app.use((req, res, next) => {
            res.status(404).json({ error: 'Not found' });
        });

        // Global error handler
        this.app.use((error, req, res, next) => {
            console.error('Unhandled error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        });
    }

    async start() {
        const port = this.config.server.port;

        this.app.listen(port, () => {
            console.log(`🎨 Palette 2.0 running on http://localhost:${port}`);
            console.log(`📚 Canvas OAuth: ${this.config.canvas.baseUrl}`);
            console.log(`💾 Database: ${this.config.database.path}`);

            // Enable development mode if needed
            if (process.env.NODE_ENV === 'development' && !this.config.canvas.clientId) {
                this.authService.enableDevMode({
                    id: 'dev-user',
                    name: 'Development User',
                    email: 'dev@example.com'
                });
                console.log('🔧 Development authentication enabled');
            }

            // Start auto-sync
            if (this.config.sync.autoSyncInterval > 0) {
                // Will be started per user session with valid token
                console.log(`🔄 Auto-sync configured (${this.config.sync.autoSyncInterval} min)`);
            }
        });
    }

    async shutdown() {
        console.log('🛑 Shutting down Palette...');

        if (this.syncService) {
            this.syncService.stopAutoSync();
        }

        if (this.gradingService) {
            this.gradingService.stopAutoSave();
        }

        if (this.db) {
            await this.db.close();
        }

        console.log('✅ Shutdown complete');
    }
}

module.exports = PaletteApp;