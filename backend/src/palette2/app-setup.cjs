// Main Application Setup - Palette 2.0
const express = require('express');
const path = require('path');
const cors = require('cors');

// Import new services
const DatabaseManager = require('./services/database_manager.cjs');
const CanvasAuthService = require('./services/authentication_service.cjs');
const CanvasSyncService = require('./services/canvas_sync_service.cjs');
const GradingService = require('./services/grading_service.cjs');
const RubricManager = require('./services/rubric-manager.cjs');

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
        // In Electron mode, look for frontend in the app root
        // In development/production, look relative to backend dist
        const isElectron = process.env.ELECTRON_MODE === 'true';
        const distPath = isElectron
            ? path.join(process.resourcesPath || __dirname, '../../dist/frontend')
            : path.join(__dirname, '../../dist/frontend');

        if (require('fs').existsSync(distPath)) {
            this.app.use(express.static(distPath));
            console.log(`✅ Serving frontend from: ${distPath}`);
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
            const isElectron = process.env.ELECTRON_MODE === 'true';
            const indexPath = isElectron
                ? path.join(process.resourcesPath || __dirname, '../../dist/frontend/index.html')
                : path.join(__dirname, '../../dist/frontend/index.html');

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

        // Canvas browser-based login endpoint
        router.post('/api/user/canvas-login', async (req, res) => {
            try {
                const { spawn } = require('child_process');
                const fs = require('fs');
                const os = require('os');

                // Determine correct Python script path
                const isElectron = process.env.ELECTRON_MODE === 'true';
                const pythonScriptPath = isElectron
                    ? path.join(process.resourcesPath || __dirname, 'python', 'canvas_login.py')
                    : path.join(__dirname, '..', 'python', 'canvas_login.py');

                console.log('🐍 Python script path:', pythonScriptPath);

                // Check if Python script exists
                if (!fs.existsSync(pythonScriptPath)) {
                    console.error('❌ Python script not found at:', pythonScriptPath);
                    return res.status(500).json({
                        success: false,
                        message: 'Python script not found',
                        error: `Script path: ${pythonScriptPath}`
                    });
                }

                // Create temp file path for output
                const outputFile = path.join(os.tmpdir(), `palette_canvas_login_${Date.now()}.json`);
                console.log('📄 Output file:', outputFile);

                // Find Python executable - use pythonw.exe for GUI apps on Windows
                const { execSync } = require('child_process');
                let pythonCmd = 'pythonw'; // Use pythonw for GUI apps on Windows
                try {
                    // Try to find pythonw.exe first (Windows GUI version)
                    const pythonwPath = execSync('where pythonw', { encoding: 'utf8' }).split('\n')[0].trim();
                    console.log('🐍 Found pythonw at:', pythonwPath);
                    pythonCmd = pythonwPath;
                } catch (err) {
                    // Fall back to regular python
                    try {
                        const pythonPath = execSync('where python', { encoding: 'utf8' }).split('\n')[0].trim();
                        console.log('🐍 Found python at:', pythonPath);
                        pythonCmd = pythonPath;
                    } catch (err2) {
                        console.log('⚠️  Using default "pythonw" command');
                        pythonCmd = 'pythonw';
                    }
                }

                console.log('✅ Launching Python process as detached for GUI access...');

                // Launch Python as a completely detached process so it can show GUI
                // Using pythonw.exe and proper Windows flags for GUI applications
                const spawnOptions = {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: false,
                    shell: false
                };

                // On Windows, also set environment to ensure GUI can display
                if (process.platform === 'win32') {
                    spawnOptions.env = { ...process.env };
                }

                const pythonProcess = spawn(pythonCmd, [pythonScriptPath, outputFile], spawnOptions);

                // Detach the process so it can run independently
                pythonProcess.unref();

                console.log('🚀 Python process launched (detached)');

                // Poll for the output file (wait up to 120 seconds for user to log in)
                const maxWaitTime = 120000; // 120 seconds
                const pollInterval = 500; // Check every 500ms
                let waited = 0;

                const checkFile = async () => {
                    while (waited < maxWaitTime) {
                        if (fs.existsSync(outputFile)) {
                            console.log('✅ Output file found, reading results...');
                            try {
                                const fileContent = fs.readFileSync(outputFile, 'utf8');
                                const result = JSON.parse(fileContent);

                                // Clean up the temp file
                                try {
                                    fs.unlinkSync(outputFile);
                                } catch (cleanupErr) {
                                    console.warn('⚠️  Could not delete temp file:', cleanupErr.message);
                                }

                                if (result.success && result.cookies) {
                                    req.session.canvasCookies = result.cookies;
                                    return res.json({
                                        success: true,
                                        data: { authenticated: true },
                                        message: 'Canvas login successful'
                                    });
                                } else {
                                    return res.status(500).json({
                                        success: false,
                                        message: 'Canvas login failed',
                                        error: result.error || 'Unknown error'
                                    });
                                }
                            } catch (readError) {
                                return res.status(500).json({
                                    success: false,
                                    message: 'Failed to read login results',
                                    error: String(readError)
                                });
                            }
                        } // Close the if (fs.existsSync(outputFile)) block
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        waited += pollInterval;
                    }

                    // Timeout - user didn't complete login in time
                    console.error('⏱️  Timeout waiting for Canvas login');
                    return res.status(408).json({
                        success: false,
                        message: 'Canvas login timeout',
                        error: 'Login window did not complete within 120 seconds'
                    });
                };

                // Start polling for the file
                checkFile().catch(error => {
                    console.error('❌ Error in file polling:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Canvas login failed',
                        error: String(error)
                    });
                });

            } catch (error) {
                console.error('❌ Canvas login endpoint error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Canvas login failed',
                    error: String(error)
                });
            }
        });

        // Middleware to ensure authentication for API routes (AFTER settings routes)
        router.use('/api', (req, res, next) => {
            if (req.path.startsWith('/auth') ||
                req.path === '/health' ||
                req.path.startsWith('/settings') ||
                req.path.startsWith('/user/settings') ||
                req.path.startsWith('/user/canvas-login') ||
                req.path.startsWith('/courses') ||
                req.path.startsWith('/templates') ||
                req.path.startsWith('/tags')) {
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
                req.path.startsWith('/user/settings') ||
                req.path.startsWith('/user/canvas-login') ||
                req.path.startsWith('/templates') ||
                req.path.startsWith('/tags')) {
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

        // Frontend compatibility - /api/courses/:course_id/rubrics/:assignment_id endpoint (CREATE)
        router.post('/api/courses/:course_id/rubrics/:assignment_id', async (req, res) => {
            try {
                console.log(`✨ CREATE rubric request - course: ${req.params.course_id}, assignment: ${req.params.assignment_id}`);
                console.log('✨ Request body:', JSON.stringify(req.body, null, 2));

                // Auto-authenticate if needed
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
                        console.log('🔐 Auto-authenticated for rubric creation');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required'
                    });
                }

                // Create rubric in local database
                const rubricData = {
                    name: req.body.title || 'Untitled Rubric',
                    description: req.body.description || '',
                    points_possible: req.body.points_possible || 0,
                    criteria: req.body.criteria || []
                };

                const rubricId = await this.rubricManager.createRubric(rubricData, req.session.user.id);
                const rubric = await this.db.getRubricTemplate(rubricId);

                // Store assignment-rubric mapping
                const now = new Date().toISOString();
                await this.db.run(`
                    INSERT OR REPLACE INTO assignment_rubrics
                    (assignment_id, rubric_id, course_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `, [req.params.assignment_id, rubricId, req.params.course_id, now, now]);

                console.log(`✅ Created rubric: ${rubricData.name} (${rubricId}) for assignment ${req.params.assignment_id}`);

                // Automatically sync to Canvas
                try {
                    console.log(`📤 Auto-syncing rubric to Canvas assignment ${req.params.assignment_id}...`);
                    const token = this.authService.decryptToken(req.session.tokens.access_token);
                    const canvasId = await this.syncService.uploadRubric(rubricId, req.params.course_id, req.params.assignment_id, token);
                    console.log(`✅ Rubric synced to Canvas with ID: ${canvasId}`);
                } catch (syncError) {
                    console.error('⚠️  Canvas sync failed (rubric saved locally):', syncError.message);
                    // Don't fail the request if sync fails - rubric is still saved locally
                }

                res.json({
                    success: true,
                    message: 'New rubric created successfully',
                    data: rubric
                });
            } catch (error) {
                console.error('Error creating rubric:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Frontend compatibility - /api/courses/:course_id/rubrics/:rubric_id/:assignment_id endpoint (UPDATE)
        router.put('/api/courses/:course_id/rubrics/:rubric_id/:assignment_id', async (req, res) => {
            try {
                console.log(`📝 UPDATE rubric request - course: ${req.params.course_id}, rubric: ${req.params.rubric_id}, assignment: ${req.params.assignment_id}`);
                console.log('📝 Request body:', JSON.stringify(req.body, null, 2));

                // Auto-authenticate if needed
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
                        console.log('🔐 Auto-authenticated for rubric update');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required'
                    });
                }

                // Check if this is actually a CREATE request (rubric_id is undefined/null/0)
                const rubricIdParam = req.params.rubric_id;
                const isNewRubric = !rubricIdParam || rubricIdParam === 'undefined' || rubricIdParam === 'null' || req.body.id === 0;

                if (isNewRubric) {
                    console.log('🔄 Detected new rubric, redirecting to CREATE');

                    // Create rubric in local database
                    const rubricData = {
                        name: req.body.title || 'Untitled Rubric',
                        description: req.body.description || '',
                        points_possible: req.body.pointsPossible || 0,
                        criteria: req.body.criteria || []
                    };

                    const rubricId = await this.rubricManager.createRubric(rubricData, req.session.user.id);
                    const rubric = await this.db.getRubricTemplate(rubricId);

                    // Store assignment-rubric mapping
                    const now = new Date().toISOString();
                    await this.db.run(`
                        INSERT OR REPLACE INTO assignment_rubrics
                        (assignment_id, rubric_id, course_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    `, [req.params.assignment_id, rubricId, req.params.course_id, now, now]);

                    console.log(`✅ Created rubric: ${rubricData.name} (${rubricId}) for assignment ${req.params.assignment_id}`);

                    // Automatically sync to Canvas
                    try {
                        console.log(`📤 Auto-syncing rubric to Canvas assignment ${req.params.assignment_id}...`);
                        const token = this.authService.decryptToken(req.session.tokens.access_token);
                        const canvasId = await this.syncService.uploadRubric(rubricId, req.params.course_id, req.params.assignment_id, token);
                        console.log(`✅ Rubric synced to Canvas with ID: ${canvasId}`);
                    } catch (syncError) {
                        console.error('⚠️  Canvas sync failed (rubric saved locally):', syncError.message);
                        // Don't fail the request if sync fails - rubric is still saved locally
                    }

                    return res.json({
                        success: true,
                        message: 'New rubric created successfully',
                        data: rubric
                    });
                }

                // Update existing rubric in local database
                const updates = {
                    name: req.body.title,
                    description: req.body.description,
                    points_possible: req.body.pointsPossible,
                    criteria: req.body.criteria
                };

                const rubricId = await this.rubricManager.editRubric(
                    rubricIdParam,
                    updates,
                    req.session.user.id
                );
                const rubric = await this.db.getRubricTemplate(rubricId);

                console.log(`✅ Updated rubric: ${rubricId} for assignment ${req.params.assignment_id}`);

                // Automatically sync to Canvas
                try {
                    console.log(`📤 Auto-syncing updated rubric to Canvas assignment ${req.params.assignment_id}...`);
                    const token = this.authService.decryptToken(req.session.tokens.access_token);
                    const canvasId = await this.syncService.uploadRubric(rubricId, req.params.course_id, req.params.assignment_id, token);
                    console.log(`✅ Rubric synced to Canvas with ID: ${canvasId}`);
                } catch (syncError) {
                    console.error('⚠️  Canvas sync failed (rubric saved locally):', syncError.message);
                }

                res.json({
                    success: true,
                    message: 'Rubric updated successfully!',
                    data: rubric
                });
            } catch (error) {
                console.error('Error updating rubric:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Frontend compatibility - /api/courses/:course_id/rubrics/:rubric_id endpoint (GET)
        router.get('/api/courses/:course_id/rubrics/:rubric_id', async (req, res) => {
            try {
                const rubric = await this.db.getRubricTemplate(req.params.rubric_id);
                if (!rubric) {
                    return res.status(404).json({
                        success: false,
                        error: 'Rubric not found'
                    });
                }
                res.json({
                    success: true,
                    message: 'Here is the rubric',
                    data: rubric
                });
            } catch (error) {
                console.error('Error fetching rubric:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // GET rubric by assignment ID (for RubricContext compatibility)
        router.get('/api/courses/:course_id/assignments/:assignment_id/rubric', async (req, res) => {
            try {
                console.log(`🔍 Fetching rubric for assignment ${req.params.assignment_id}`);

                // Auto-authenticate if needed
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
                        console.log('🔐 Auto-authenticated for rubric fetch');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                // Look up the rubric ID from the assignment mapping (local database)
                const mapping = await this.db.get(`
                    SELECT rubric_id FROM assignment_rubrics
                    WHERE assignment_id = ? AND course_id = ?
                `, [req.params.assignment_id, req.params.course_id]);

                let rubric = null;

                if (mapping) {
                    // Fetch the rubric from local database
                    rubric = await this.db.getRubricTemplate(mapping.rubric_id);
                    if (rubric) {
                        console.log(`✅ Found local rubric: ${rubric.name} (${rubric.id})`);
                    }
                }

                // If no local rubric found, try to fetch from Canvas
                if (!rubric && req.session.user) {
                    console.log('📡 No local rubric found, checking Canvas...');

                    try {
                        const token = this.authService.decryptToken(req.session.tokens.access_token);

                        // Fetch assignment from Canvas (includes rubric if attached)
                        const assignmentResponse = await fetch(
                            `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}?include[]=rubric`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${token}`
                                }
                            }
                        );

                        if (assignmentResponse.ok) {
                            const assignment = await assignmentResponse.json();

                            if (assignment.rubric && assignment.rubric.length > 0) {
                                console.log(`✅ Found Canvas rubric for assignment ${req.params.assignment_id}`);

                                // Check if we already imported this Canvas rubric
                                const canvasRubricId = assignment.rubric_settings?.id;
                                if (canvasRubricId) {
                                    const existing = await this.db.get(`
                                        SELECT id FROM rubric_templates
                                        WHERE canvas_id = ?
                                    `, [canvasRubricId]);

                                    if (existing) {
                                        console.log(`📋 Canvas rubric already imported, using existing local rubric`);

                                        // Make sure mapping exists
                                        const now = new Date().toISOString();
                                        await this.db.run(`
                                            INSERT OR REPLACE INTO assignment_rubrics
                                            (assignment_id, rubric_id, course_id, created_at, updated_at)
                                            VALUES (?, ?, ?, ?, ?)
                                        `, [req.params.assignment_id, existing.id, req.params.course_id, now, now]);

                                        rubric = await this.db.getRubricTemplate(existing.id);

                                        if (!rubric) {
                                            return res.status(404).json({
                                                success: false,
                                                error: 'Rubric not found'
                                            });
                                        }

                                        console.log(`✅ Found rubric: ${rubric.name} (${rubric.id})`);
                                    }
                                }

                                // If not already imported, import it now
                                if (!rubric) {
                                    // Import the Canvas rubric into local database
                                    const canvasRubric = assignment.rubric;
                                    const rubricData = {
                                    name: assignment.name || 'Imported Rubric',
                                    description: assignment.description || '',
                                    points_possible: assignment.points_possible || 0,
                                    criteria: canvasRubric.map(criterion => ({
                                        description: criterion.description || '',
                                        long_description: criterion.long_description || '',
                                        points: criterion.points || 0,
                                        canvas_criterion_id: criterion.id,
                                        ratings: (criterion.ratings || []).map(rating => ({
                                            description: rating.description || '',
                                            long_description: rating.long_description || '',
                                            points: rating.points || 0,
                                            canvas_rating_id: rating.id
                                        }))
                                    }))
                                };

                                // Create rubric in local database
                                const rubricId = await this.rubricManager.createRubric(rubricData, req.session.user.id);

                                    // Update the rubric to store Canvas rubric ID
                                    await this.db.run(`
                                        UPDATE rubric_templates
                                        SET canvas_id = ?
                                        WHERE id = ?
                                    `, [assignment.rubric_settings?.id || null, rubricId]);

                                    // Store assignment-rubric mapping
                                    const now = new Date().toISOString();
                                    await this.db.run(`
                                        INSERT OR REPLACE INTO assignment_rubrics
                                        (assignment_id, rubric_id, course_id, created_at, updated_at)
                                        VALUES (?, ?, ?, ?, ?)
                                    `, [req.params.assignment_id, rubricId, req.params.course_id, now, now]);

                                    console.log(`💾 Imported Canvas rubric to local database (${rubricId})`);

                                    // Fetch the newly created rubric
                                    rubric = await this.db.getRubricTemplate(rubricId);
                                }
                            }
                        }
                    } catch (canvasError) {
                        console.error('Error fetching from Canvas:', canvasError);
                        // Continue - we'll return 404 if no rubric found
                    }
                }

                if (!rubric) {
                    return res.status(404).json({
                        success: false,
                        error: 'No rubric found for this assignment'
                    });
                }

                console.log(`✅ Found rubric: ${rubric.name} (${rubric.id})`);

                // Transform database format to frontend format
                const frontendRubric = {
                    id: rubric.canvas_id || -1, // Use canvas_id if available, otherwise -1 for local rubrics (truthy value)
                    title: rubric.name,
                    pointsPossible: rubric.points_possible || 0,
                    key: rubric.id, // Use the UUID as the React key
                    criteria: (rubric.criteria || []).map(criterion => ({
                        id: criterion.canvas_criterion_id || '',
                        description: criterion.description,
                        longDescription: criterion.long_description || '',
                        pointsPossible: criterion.points || 0,
                        key: criterion.id, // Use UUID as React key
                        ratings: (criterion.ratings || []).map(rating => ({
                            id: rating.canvas_rating_id || '',
                            description: rating.description,
                            longDescription: rating.long_description || '',
                            points: rating.points || 0,
                            key: rating.id // Use UUID as React key
                        }))
                    }))
                };

                console.log('📤 Returning transformed rubric data:', JSON.stringify(frontendRubric, null, 2));

                res.json({
                    success: true,
                    message: 'Rubric found',
                    data: frontendRubric
                });
            } catch (error) {
                console.error('Error fetching rubric by assignment:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // GET submissions for assignment (with group information)
        router.get('/api/courses/:course_id/assignments/:assignment_id/submissions', async (req, res) => {
            try {
                console.log(`📥 Fetching submissions for assignment ${req.params.assignment_id}`);

                // Auto-authenticate if needed
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
                        console.log('🔐 Auto-authenticated for submissions fetch');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required'
                    });
                }

                const token = this.authService.decryptToken(req.session.tokens.access_token);

                // Fetch submissions from Canvas with rubric assessments and comments
                const submissionsResponse = await fetch(
                    `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}/submissions?include[]=user&include[]=rubric_assessment&include[]=submission_comments&per_page=100`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                if (!submissionsResponse.ok) {
                    throw new Error(`Canvas API error: ${submissionsResponse.status}`);
                }

                const submissions = await submissionsResponse.json();

                // Transform Canvas rubric assessments to use local criterion IDs
                // Get our local rubric template
                const mapping = await this.db.get(`
                    SELECT rubric_id FROM assignment_rubrics
                    WHERE assignment_id = ? AND course_id = ?
                `, [req.params.assignment_id, req.params.course_id]);

                let canvasToLocalIdMap = {};

                if (mapping) {
                    const localRubric = await this.db.getRubricTemplate(mapping.rubric_id);

                    // Fetch Canvas rubric to create ID mapping
                    const canvasAssignmentResponse = await fetch(
                        `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}?include[]=rubric`,
                        {
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        }
                    );

                    if (canvasAssignmentResponse.ok) {
                        const canvasAssignment = await canvasAssignmentResponse.json();
                        const canvasRubric = canvasAssignment.rubric;

                        if (canvasRubric && localRubric) {
                            // Create mapping: Canvas ID -> local ID (by matching descriptions)
                            canvasRubric.forEach(canvasCriterion => {
                                const matchingLocal = localRubric.criteria.find(
                                    local => local.description === canvasCriterion.description
                                );
                                if (matchingLocal) {
                                    canvasToLocalIdMap[canvasCriterion.id] = matchingLocal.id;
                                }
                            });
                            console.log(`🔄 Created rubric ID mapping for ${Object.keys(canvasToLocalIdMap).length} criteria`);
                        }
                    }

                    // Transform all submissions' rubric assessments
                    submissions.forEach(submission => {
                        if (submission.rubric_assessment) {
                            const transformedAssessment = {};
                            Object.entries(submission.rubric_assessment).forEach(([canvasId, assessment]) => {
                                const localId = canvasToLocalIdMap[canvasId];
                                if (localId) {
                                    transformedAssessment[localId] = assessment;
                                }
                            });
                            submission.rubric_assessment = transformedAssessment;
                        }
                    });
                }

                // First, fetch the assignment details to get the group_category_id
                const assignmentResponse = await fetch(
                    `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                let groupedSubmissions = { "No Group": [] };

                if (assignmentResponse.ok) {
                    const assignment = await assignmentResponse.json();
                    console.log(`📋 Assignment group_category_id: ${assignment.group_category_id || 'none'}`);

                    if (assignment.group_category_id) {
                        // First, fetch assignment overrides to see which groups are assigned
                        const overridesResponse = await fetch(
                            `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}/overrides`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${token}`
                                }
                            }
                        );

                        let assignedGroupIds = new Set();

                        if (overridesResponse.ok) {
                            const overrides = await overridesResponse.json();
                            // Filter for group overrides (not student or section overrides)
                            const groupOverrides = overrides.filter(override => override.group_id);
                            assignedGroupIds = new Set(groupOverrides.map(override => override.group_id));
                            console.log(`🎯 Assignment has ${assignedGroupIds.size} group overrides:`, Array.from(assignedGroupIds));
                        } else {
                            console.log('⚠️  Could not fetch assignment overrides, will show all groups in category');
                        }

                        // Fetch groups from the group category
                        const groupsResponse = await fetch(
                            `${process.env.CANVAS_BASE_URL}/api/v1/group_categories/${assignment.group_category_id}/groups?per_page=100`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${token}`
                                }
                            }
                        );

                        console.log(`🔍 Groups endpoint status: ${groupsResponse.status}`);

                        if (groupsResponse.ok) {
                            const allGroups = await groupsResponse.json();

                            // Filter groups to only those assigned (if overrides exist)
                            const groups = assignedGroupIds.size > 0
                                ? allGroups.filter(group => assignedGroupIds.has(group.id))
                                : allGroups;

                            console.log(`✅ Found ${groups.length} assigned groups (out of ${allGroups.length} total in category)`);

                            // Create group mapping: user_id -> group info
                            const userGroupMap = {};

                            for (const group of groups) {
                                console.log(`  📦 Group: ${group.name} (ID: ${group.id})`);

                                // Fetch members for each group
                                const membersResponse = await fetch(
                                    `${process.env.CANVAS_BASE_URL}/api/v1/groups/${group.id}/users`,
                                    {
                                        headers: {
                                            'Authorization': `Bearer ${token}`
                                        }
                                    }
                                );

                                if (membersResponse.ok) {
                                    const members = await membersResponse.json();
                                    console.log(`    👥 Members in ${group.name}: ${members.length}`);
                                    for (const member of members) {
                                        userGroupMap[member.id] = {
                                            name: group.name,
                                            id: group.id
                                        };
                                    }
                                }

                                // Initialize group in result (even if no submissions yet)
                                groupedSubmissions[group.name] = [];
                            }

                            // Group submissions by user's group
                            for (const submission of submissions) {
                                const userId = submission.user_id;
                                const groupInfo = userGroupMap[userId];
                                const groupName = groupInfo ? groupInfo.name : "No Group";

                                if (!groupedSubmissions[groupName]) {
                                    groupedSubmissions[groupName] = [];
                                }

                                groupedSubmissions[groupName].push({
                                    id: submission.id,
                                    user_id: submission.user_id,
                                    assignment_id: submission.assignment_id,
                                    score: submission.score,
                                    grade: submission.grade,
                                    submitted_at: submission.submitted_at,
                                    workflow_state: submission.workflow_state,
                                    user: submission.user,
                                    rubricAssessment: submission.rubric_assessment || {},
                                    comments: submission.submission_comments || []
                                });
                            }
                        } else {
                            const errorText = await groupsResponse.text();
                            console.log('⚠️  Groups endpoint failed:', errorText);
                            groupedSubmissions["No Group"] = submissions.map(submission => ({
                                id: submission.id,
                                user_id: submission.user_id,
                                assignment_id: submission.assignment_id,
                                score: submission.score,
                                grade: submission.grade,
                                submitted_at: submission.submitted_at,
                                workflow_state: submission.workflow_state,
                                user: submission.user,
                                rubricAssessment: submission.rubric_assessment || {},
                                comments: submission.submission_comments || []
                            }));
                        }
                    } else {
                        console.log('⚠️  Assignment has no group_category_id, treating all as "No Group"');
                        groupedSubmissions["No Group"] = submissions.map(submission => ({
                            id: submission.id,
                            user_id: submission.user_id,
                            assignment_id: submission.assignment_id,
                            score: submission.score,
                            grade: submission.grade,
                            submitted_at: submission.submitted_at,
                            workflow_state: submission.workflow_state,
                            user: submission.user,
                            rubricAssessment: submission.rubric_assessment || {},
                            comments: submission.submission_comments || []
                        }));
                    }
                } else {
                    console.log('⚠️  Failed to fetch assignment details, grouping all as "No Group"');
                    groupedSubmissions["No Group"] = submissions.map(submission => ({
                        id: submission.id,
                        user_id: submission.user_id,
                        assignment_id: submission.assignment_id,
                        score: submission.score,
                        grade: submission.grade,
                        submitted_at: submission.submitted_at,
                        workflow_state: submission.workflow_state,
                        user: submission.user,
                        rubricAssessment: submission.rubric_assessment || {},
                        comments: submission.submission_comments || []
                    }));
                }

                // Remove "No Group" if it's empty
                if (groupedSubmissions["No Group"] && groupedSubmissions["No Group"].length === 0) {
                    delete groupedSubmissions["No Group"];
                }

                console.log(`✅ Returning submissions grouped by ${Object.keys(groupedSubmissions).length} groups`);

                res.json({
                    success: true,
                    message: 'Submissions fetched successfully',
                    data: groupedSubmissions
                });
            } catch (error) {
                console.error('Error fetching submissions:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // PUT grade to submission (submit to Canvas)
        router.put('/api/courses/:course_id/assignments/:assignment_id/submissions/:submission_id', async (req, res) => {
            try {
                console.log(`📤 Submitting grade for submission ${req.params.submission_id}`);

                // Auto-authenticate if needed
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
                        console.log('🔐 Auto-authenticated for grade submission');
                    } catch (error) {
                        console.log('⚠️  Auto-authentication failed:', error.message);
                    }
                }

                if (!req.session.user) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required'
                    });
                }

                const token = this.authService.decryptToken(req.session.tokens.access_token);

                // Get the grade data from request body
                const gradeData = req.body;
                console.log('📝 Received grade data from frontend:', JSON.stringify(gradeData, null, 2));

                // Fetch the Canvas rubric to get the correct criterion IDs
                const assignmentResponse = await fetch(
                    `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}?include[]=rubric`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                if (!assignmentResponse.ok) {
                    throw new Error('Failed to fetch assignment rubric from Canvas');
                }

                const assignment = await assignmentResponse.json();
                const canvasRubric = assignment.rubric;

                // Transform rubric_assessment to use Canvas criterion IDs
                let transformedAssessment = {};
                if (gradeData.rubric_assessment && canvasRubric) {
                    // Create mapping from Canvas criterion description to Canvas ID
                    const canvasCriterionMap = {};
                    canvasRubric.forEach(criterion => {
                        canvasCriterionMap[criterion.description] = criterion.id;
                    });

                    // Get our local rubric to map keys to descriptions
                    const mapping = await this.db.get(`
                        SELECT rubric_id FROM assignment_rubrics
                        WHERE assignment_id = ? AND course_id = ?
                    `, [req.params.assignment_id, req.params.course_id]);

                    if (mapping) {
                        const localRubric = await this.db.getRubricTemplate(mapping.rubric_id);
                        console.log('🔍 Local rubric criteria IDs/keys:', localRubric.criteria.map(c => ({ id: c.id, key: c.key, desc: c.description })));
                        console.log('🔍 Incoming assessment keys:', Object.keys(gradeData.rubric_assessment));

                        // Transform each assessment entry
                        for (const [localKey, assessment] of Object.entries(gradeData.rubric_assessment)) {
                            console.log(`🔍 Processing localKey: "${localKey}"`);
                            // Find criterion by local key (try key field first, fallback to id)
                            const criterion = localRubric.criteria.find(c => (c.key || c.id) === localKey);
                            console.log(`🔍 Found criterion:`, criterion ? { id: criterion.id, key: criterion.key, desc: criterion.description } : 'NOT FOUND');
                            if (criterion) {
                                const canvasId = canvasCriterionMap[criterion.description];
                                console.log(`🔍 Canvas ID for "${criterion.description}": ${canvasId}`);
                                if (canvasId) {
                                    transformedAssessment[canvasId] = assessment;
                                }
                            }
                        }
                        console.log('🔍 Final transformed assessment:', transformedAssessment);
                    }
                }

                // Calculate total score from rubric assessment
                let totalScore = 0;
                if (gradeData.rubric_assessment) {
                    Object.values(gradeData.rubric_assessment).forEach(assessment => {
                        if (assessment.points && !isNaN(assessment.points)) {
                            totalScore += Number(assessment.points);
                        }
                    });
                }

                // Prepare Canvas submission data
                const canvasSubmissionData = {
                    rubric_assessment: transformedAssessment
                };

                // Add total score if we have one
                if (totalScore > 0) {
                    canvasSubmissionData.submission = {
                        posted_grade: totalScore
                    };
                }

                // Add comments if they exist
                const comments = [];
                if (gradeData.individual_comment?.text_comment) {
                    comments.push({
                        text_comment: gradeData.individual_comment.text_comment,
                        group_comment: false
                    });
                }
                if (gradeData.group_comment?.text_comment) {
                    comments.push({
                        text_comment: gradeData.group_comment.text_comment,
                        group_comment: true
                    });
                }

                if (comments.length > 0) {
                    if (!canvasSubmissionData.submission) {
                        canvasSubmissionData.submission = {};
                    }
                    canvasSubmissionData.comment = comments[0]; // Canvas accepts one comment per submission
                }

                console.log('📝 Transformed grade data for Canvas:', JSON.stringify(canvasSubmissionData, null, 2));

                const response = await fetch(
                    `${process.env.CANVAS_BASE_URL}/api/v1/courses/${req.params.course_id}/assignments/${req.params.assignment_id}/submissions/${req.params.submission_id}`,
                    {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(canvasSubmissionData)
                    }
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    console.log('❌ Canvas API error:', response.status, errorText);
                    throw new Error(`Canvas API error: ${response.status} - ${errorText}`);
                }

                const result = await response.json();
                console.log('✅ Grade submitted successfully');

                res.json({
                    success: true,
                    message: 'Grade submitted successfully',
                    data: result
                });
            } catch (error) {
                console.error('Error submitting grade:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ========================
        // TEMPLATE ENDPOINTS
        // ========================

        // GET all templates
        router.get('/api/templates', async (req, res) => {
            try {
                const templates = await this.db.all('SELECT * FROM templates ORDER BY last_used DESC, created_at DESC');

                // Parse JSON fields
                const parsedTemplates = templates.map(template => ({
                    id: template.id,
                    key: template.key,
                    title: template.title,
                    description: template.description || '',
                    points: template.points || 0,
                    criteria: JSON.parse(template.criteria_json || '[]'),
                    tags: JSON.parse(template.tags_json || '[]'),
                    quickStart: !!template.quick_start,
                    saved: !!template.saved,
                    createdAt: template.created_at,
                    lastUsed: template.last_used || template.created_at,
                    usageCount: template.usage_count || 0
                }));

                res.json({
                    success: true,
                    message: 'Templates fetched successfully!',
                    data: parsedTemplates
                });
            } catch (error) {
                console.error('Error fetching templates:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // POST create template
        router.post('/api/templates', async (req, res) => {
            try {
                console.log('📝 CREATE template request:', req.body);

                const templateData = req.body;
                const now = new Date().toISOString();

                // Check if template with same key already exists
                const existing = await this.db.get('SELECT id FROM templates WHERE key = ?', [templateData.key]);

                if (existing) {
                    return res.status(409).json({
                        success: false,
                        error: 'Template with this key already exists'
                    });
                }

                // Insert template (always set saved=true when successfully saved to database)
                const result = await this.db.run(`
                    INSERT INTO templates
                    (key, title, description, points, criteria_json, tags_json, quick_start, saved, created_at, last_used, usage_count, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    templateData.key,
                    templateData.title,
                    templateData.description || '',
                    templateData.points || 0,
                    JSON.stringify(templateData.criteria || []),
                    JSON.stringify(templateData.tags || []),
                    templateData.quickStart ? 1 : 0,
                    1,  // Always set saved=true when persisted to database
                    now,
                    templateData.lastUsed || now,
                    templateData.usageCount || 0,
                    req.session.user?.id || 'anonymous'
                ]);

                console.log(`✅ Created template: ${templateData.title} (${result.lastID})`);

                res.json({
                    success: true,
                    message: 'Template created successfully!',
                    data: { id: result.lastID, ...templateData }
                });
            } catch (error) {
                console.error('Error creating template:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // PUT update template
        router.put('/api/templates', async (req, res) => {
            try {
                console.log('📝 UPDATE template request:', req.body);

                const templateData = req.body;

                // Find template by key
                const existing = await this.db.get('SELECT id FROM templates WHERE key = ?', [templateData.key]);

                if (!existing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Template not found'
                    });
                }

                // Update template (always set saved=true when successfully saved to database)
                await this.db.run(`
                    UPDATE templates
                    SET title = ?,
                        description = ?,
                        points = ?,
                        criteria_json = ?,
                        tags_json = ?,
                        quick_start = ?,
                        saved = ?,
                        last_used = ?,
                        usage_count = ?
                    WHERE key = ?
                `, [
                    templateData.title,
                    templateData.description || '',
                    templateData.points || 0,
                    JSON.stringify(templateData.criteria || []),
                    JSON.stringify(templateData.tags || []),
                    templateData.quickStart ? 1 : 0,
                    1,  // Always set saved=true when persisted to database
                    templateData.lastUsed || new Date().toISOString(),
                    templateData.usageCount || 0,
                    templateData.key
                ]);

                console.log(`✅ Updated template: ${templateData.title}`);

                res.json({
                    success: true,
                    message: 'Template updated successfully!',
                    data: templateData
                });
            } catch (error) {
                console.error('Error updating template:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // DELETE template
        router.delete('/api/templates', async (req, res) => {
            try {
                console.log('🗑️ DELETE template request:', req.body);

                const templateKey = req.body.key;

                if (!templateKey) {
                    return res.status(400).json({
                        success: false,
                        error: 'Template key is required'
                    });
                }

                const result = await this.db.run('DELETE FROM templates WHERE key = ?', [templateKey]);

                if (result.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'Template not found'
                    });
                }

                console.log(`✅ Deleted template with key: ${templateKey}`);

                res.json({
                    success: true,
                    message: 'Template deleted successfully!'
                });
            } catch (error) {
                console.error('Error deleting template:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ========================
        // TAG ENDPOINTS
        // ========================

        // GET all tags
        router.get('/api/tags', async (req, res) => {
            try {
                const tags = await this.db.all('SELECT * FROM tags ORDER BY usage_count DESC, name ASC');

                // Format tags
                const parsedTags = tags.map(tag => ({
                    key: tag.key,
                    name: tag.name,
                    color: tag.color || '#808080',
                    description: tag.description || '',
                    createdAt: tag.created_at,
                    lastUsed: tag.last_used,
                    usageCount: tag.usage_count || 0
                }));

                res.json({
                    success: true,
                    message: 'Tags fetched successfully!',
                    data: parsedTags
                });
            } catch (error) {
                console.error('Error fetching tags:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // POST create tag
        router.post('/api/tags', async (req, res) => {
            try {
                console.log('📝 CREATE tag request:', req.body);

                const tagData = req.body;
                const now = new Date().toISOString();

                // Check if tag with same key already exists
                const existing = await this.db.get('SELECT id FROM tags WHERE key = ?', [tagData.key]);

                if (existing) {
                    return res.status(409).json({
                        success: false,
                        error: 'Tag with this key already exists'
                    });
                }

                // Insert tag
                const result = await this.db.run(`
                    INSERT INTO tags
                    (key, name, color, description, created_at, last_used, usage_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    tagData.key,
                    tagData.name,
                    tagData.color || '#808080',
                    tagData.description || '',
                    now,
                    tagData.lastUsed || null,
                    tagData.usageCount || 0
                ]);

                console.log(`✅ Created tag: ${tagData.name} (${result.lastID})`);

                res.json({
                    success: true,
                    message: 'Tag created successfully!',
                    data: { id: result.lastID, ...tagData }
                });
            } catch (error) {
                console.error('Error creating tag:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // DELETE tag
        router.delete('/api/tags', async (req, res) => {
            try {
                console.log('🗑️ DELETE tag request:', req.body);

                const tagKey = req.body.key;

                if (!tagKey) {
                    return res.status(400).json({
                        success: false,
                        error: 'Tag key is required'
                    });
                }

                const result = await this.db.run('DELETE FROM tags WHERE key = ?', [tagKey]);

                if (result.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'Tag not found'
                    });
                }

                console.log(`✅ Deleted tag with key: ${tagKey}`);

                res.json({
                    success: true,
                    message: 'Tag deleted successfully!'
                });
            } catch (error) {
                console.error('Error deleting tag:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
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
                        cookies: req.session.canvasCookies || {},
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

        /* DUPLICATE ENDPOINT - COMMENTED OUT
        // Canvas browser-based login endpoint
        this.app.post('/api/user/canvas-login', async (req, res) => {
            try {
                const { spawn } = require('child_process');

                // Determine correct Python script path for Electron vs development
                const isElectron = process.env.ELECTRON_MODE === 'true';
                const pythonScriptPath = isElectron
                    ? path.join(process.resourcesPath || __dirname, 'python', 'canvas_login.py')
                    : path.join(__dirname, '..', 'python', 'canvas_login.py');

                console.log('🐍 Python script path:', pythonScriptPath);

                // Check if Python script exists
                const fs = require('fs');
                if (!fs.existsSync(pythonScriptPath)) {
                    console.error('❌ Python script not found at:', pythonScriptPath);
                    return res.status(500).json({
                        success: false,
                        message: 'Python script not found',
                        error: `Script path: ${pythonScriptPath}`,
                        debug: {
                            resourcesPath: process.resourcesPath,
                            isElectron: isElectron,
                            __dirname: __dirname
                        }
                    });
                }

                console.log('✅ Python script found, spawning process...');

                // Find Python executable - try multiple common locations
                const { execSync } = require('child_process');
                let pythonCmd = 'python';
                try {
                    // Use 'where' on Windows to find Python
                    const pythonPath = execSync('where python', { encoding: 'utf8' }).split('\n')[0].trim();
                    console.log('🐍 Found Python at:', pythonPath);
                    pythonCmd = pythonPath;
                } catch (err) {
                    console.log('⚠️  Could not find Python in PATH, using default "python" command');
                }

                // On Windows, use 'start' command to launch Python in a new window
                // This allows the Qt GUI to display properly
                const isWindows = process.platform === 'win32';

                let pythonProcess;
                if (isWindows) {
                    // Use Windows 'start' command to launch in new process with GUI access
                    // /B = don't create new window for start command itself
                    // /WAIT = wait for the application to terminate
                    pythonProcess = spawn('cmd.exe', ['/c', 'start', '/B', '/WAIT', pythonCmd, pythonScriptPath], {
                        shell: false,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                } else {
                    pythonProcess = spawn(pythonCmd, [pythonScriptPath], {
                        shell: false,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                }
                console.log('🚀 Python process spawned with PID:', pythonProcess.pid);

                // Set a timeout to kill hung processes (60 seconds)
                const processTimeout = setTimeout(() => {
                    console.error('⏱️  Python process timeout - killing process');
                    pythonProcess.kill();
                }, 60000);

                let stdout = '';
                let stderr = '';

                // Collect stdout
                pythonProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                // Collect stderr
                pythonProcess.stderr.on('data', (data) => {
                    const errorMsg = data.toString();
                    stderr += errorMsg;
                    console.error('🐍 Python stderr:', errorMsg);
                });

                // Handle process completion
                pythonProcess.on('close', (code) => {
                    clearTimeout(processTimeout); // Clear the timeout
                    console.log(`🐍 Python process exited with code: ${code}`);
                    console.log('🐍 stdout:', stdout);
                    console.log('🐍 stderr:', stderr);

                    if (code === 0) {
                        try {
                            // Parse the JSON output from Python
                            const result = JSON.parse(stdout);

                            if (result.success && result.cookies) {
                                // Store cookies in session for future requests
                                req.session.canvasCookies = result.cookies;

                                res.json({
                                    success: true,
                                    data: { authenticated: true },
                                    message: 'Canvas login successful'
                                });
                            } else {
                                res.status(500).json({
                                    success: false,
                                    message: 'Canvas login failed',
                                    error: result.error || 'Unknown error'
                                });
                            }
                        } catch (parseError) {
                            res.status(500).json({
                                success: false,
                                message: 'Failed to parse login response',
                                error: String(parseError)
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        waited += pollInterval;
                    }

                    // Timeout - user didn't complete login in time
                    console.error('⏱️  Timeout waiting for Canvas login');
                    return res.status(408).json({
                        success: false,
                        message: 'Canvas login timeout',
                        error: 'Login window did not complete within 120 seconds'
                    });
                };

                // Start polling for the file
                checkFile().catch(error => {
                    console.error('❌ Error in file polling:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Canvas login failed',
                        error: String(error)
                    });
                });

            } catch (error) {
                console.error('❌ Canvas login endpoint error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Canvas login failed',
                    error: String(error)
                });
            }
        });
        */

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