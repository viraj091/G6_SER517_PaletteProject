// Canvas OAuth Authentication Service
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const SQLiteStore = require('connect-sqlite3')(session);

class CanvasAuthService {
    constructor(config, dbManager) {
        this.config = {
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectUri,
            canvasBaseUrl: config.canvasBaseUrl,
            sessionSecret: config.sessionSecret || crypto.randomBytes(32).toString('hex')
        };
        
        this.db = dbManager;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Session configuration with SQLite store
        this.app.use(session({
            store: new SQLiteStore({
                db: 'sessions.db',
                dir: './data'
            }),
            secret: this.config.sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            }
        }));

        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
    }

    setupRoutes() {
        // OAuth initiation
        this.app.get('/auth/canvas', (req, res) => {
            const state = crypto.randomBytes(32).toString('hex');
            req.session.oauth_state = state;

            const authUrl = this.buildAuthUrl(state);
            res.redirect(authUrl);
        });

        // OAuth callback
        this.app.get('/auth/canvas/callback', async (req, res) => {
            try {
                const { code, state } = req.query;

                // Verify state parameter
                if (!state || state !== req.session.oauth_state) {
                    throw new Error('Invalid state parameter');
                }

                // Exchange code for tokens
                const tokens = await this.exchangeCodeForTokens(code);
                
                // Get user info
                const userInfo = await this.getUserInfo(tokens.access_token);

                // Store in session
                req.session.user = {
                    id: userInfo.id,
                    name: userInfo.name,
                    email: userInfo.email,
                    canvas_id: userInfo.id
                };

                req.session.tokens = {
                    access_token: this.encryptToken(tokens.access_token),
                    refresh_token: this.encryptToken(tokens.refresh_token),
                    expires_at: Date.now() + (tokens.expires_in * 1000)
                };

                // Store user settings
                await this.storeUserSettings(userInfo);

                res.redirect('/dashboard?login=success');

            } catch (error) {
                console.error('OAuth callback error:', error.message);
                res.redirect('/login?error=' + encodeURIComponent(error.message));
            }
        });

        // Logout
        this.app.post('/auth/logout', (req, res) => {
            req.session.destroy(err => {
                if (err) {
                    console.error('Logout error:', err);
                    return res.status(500).json({ error: 'Logout failed' });
                }
                res.json({ success: true });
            });
        });

        // Get current user
        this.app.get('/auth/user', (req, res) => {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            res.json(req.session.user);
        });

        // Refresh token
        this.app.post('/auth/refresh', async (req, res) => {
            try {
                if (!req.session.tokens || !req.session.tokens.refresh_token) {
                    throw new Error('No refresh token available');
                }

                const refreshToken = this.decryptToken(req.session.tokens.refresh_token);
                const newTokens = await this.refreshAccessToken(refreshToken);

                req.session.tokens = {
                    access_token: this.encryptToken(newTokens.access_token),
                    refresh_token: this.encryptToken(newTokens.refresh_token || refreshToken),
                    expires_at: Date.now() + (newTokens.expires_in * 1000)
                };

                res.json({ success: true });

            } catch (error) {
                console.error('Token refresh error:', error.message);
                res.status(401).json({ error: 'Token refresh failed' });
            }
        });
    }

    buildAuthUrl(state) {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            response_type: 'code',
            redirect_uri: this.config.redirectUri,
            scope: [
                'url:GET|/api/v1/courses',
                'url:GET|/api/v1/courses/:course_id/assignments',
                'url:GET|/api/v1/courses/:course_id/rubrics',
                'url:POST|/api/v1/courses/:course_id/rubrics',
                'url:PUT|/api/v1/courses/:course_id/rubrics/:id',
                'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
                'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
                'url:GET|/api/v1/users/self'
            ].join(' '),
            state: state
        });

        return `${this.config.canvasBaseUrl}/login/oauth2/auth?${params.toString()}`;
    }

    async exchangeCodeForTokens(code) {
        try {
            const response = await axios.post(`${this.config.canvasBaseUrl}/login/oauth2/token`, {
                grant_type: 'authorization_code',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                code: code,
                redirect_uri: this.config.redirectUri
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data;

        } catch (error) {
            console.error('Token exchange failed:', error.response?.data || error.message);
            throw new Error('Failed to exchange authorization code for tokens');
        }
    }

    async refreshAccessToken(refreshToken) {
        try {
            const response = await axios.post(`${this.config.canvasBaseUrl}/login/oauth2/token`, {
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data;

        } catch (error) {
            console.error('Token refresh failed:', error.response?.data || error.message);
            throw new Error('Failed to refresh access token');
        }
    }

    async getUserInfo(accessToken) {
        try {
            const response = await axios.get(`${this.config.canvasBaseUrl}/api/v1/users/self`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            return response.data;

        } catch (error) {
            console.error('Failed to get user info:', error.response?.data || error.message);
            throw new Error('Failed to retrieve user information');
        }
    }

    async storeUserSettings(userInfo) {
        try {
            await this.db.run(`
                INSERT OR REPLACE INTO user_settings 
                (id, user_id, setting_key, setting_value, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                userInfo.id.toString(),
                'canvas_user_info',
                JSON.stringify(userInfo),
                new Date().toISOString()
            ]);

        } catch (error) {
            console.error('Failed to store user settings:', error.message);
        }
    }

    // Middleware for protecting routes
    requireAuth(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Check if token is expired
        if (req.session.tokens && req.session.tokens.expires_at < Date.now()) {
            return res.status(401).json({ error: 'Token expired', refresh_required: true });
        }

        next();
    }

    // Middleware for getting valid access token
    async getValidAccessToken(req, res, next) {
        try {
            if (!req.session.tokens) {
                throw new Error('No tokens available');
            }

            // Check if token needs refresh
            const fiveMinutes = 5 * 60 * 1000;
            if (req.session.tokens.expires_at - Date.now() < fiveMinutes) {
                console.log('Access token expiring soon, refreshing...');
                
                const refreshToken = this.decryptToken(req.session.tokens.refresh_token);
                const newTokens = await this.refreshAccessToken(refreshToken);

                req.session.tokens = {
                    access_token: this.encryptToken(newTokens.access_token),
                    refresh_token: this.encryptToken(newTokens.refresh_token || refreshToken),
                    expires_at: Date.now() + (newTokens.expires_in * 1000)
                };
            }

            req.accessToken = this.decryptToken(req.session.tokens.access_token);
            next();

        } catch (error) {
            console.error('Token validation failed:', error.message);
            res.status(401).json({ error: 'Invalid or expired token' });
        }
    }

    // Token encryption for secure storage
    encryptToken(token) {
        const cipher = crypto.createCipher('aes-256-cbc', this.config.sessionSecret);
        let encrypted = cipher.update(token, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decryptToken(encryptedToken) {
        const decipher = crypto.createDecipher('aes-256-cbc', this.config.sessionSecret);
        let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // Get courses for authenticated user
    async getUserCourses(accessToken) {
        try {
            const response = await axios.get(`${this.config.canvasBaseUrl}/api/v1/courses`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    enrollment_type: 'teacher',
                    enrollment_state: 'active',
                    state: ['available', 'completed']
                }
            });

            return response.data;

        } catch (error) {
            console.error('Failed to get user courses:', error.response?.data || error.message);
            throw new Error('Failed to retrieve courses');
        }
    }

    // Validate Canvas API connection
    async validateConnection(accessToken) {
        try {
            await this.getUserInfo(accessToken);
            return { valid: true };
        } catch (error) {
            return { 
                valid: false, 
                error: error.message 
            };
        }
    }

    // Session management
    async getActiveSessions() {
        // This would require implementing session storage queries
        // For now, return basic info
        return {
            store: 'SQLite',
            location: './data/sessions.db'
        };
    }

    async revokeAllSessions(userId) {
        try {
            // This would clear all sessions for a specific user
            // Implementation depends on session store structure
            console.log(`Revoking all sessions for user ${userId}`);
            return { success: true };
        } catch (error) {
            console.error('Failed to revoke sessions:', error.message);
            throw error;
        }
    }

    // OAuth app registration helper
    static generateOAuthConfig(canvasUrl, appName) {
        return {
            name: appName,
            redirect_uris: [
                'http://localhost:5173/auth/canvas/callback',
                'https://yourdomain.com/auth/canvas/callback'
            ],
            scopes: [
                'url:GET|/api/v1/courses',
                'url:GET|/api/v1/courses/:course_id/assignments',
                'url:GET|/api/v1/courses/:course_id/rubrics',
                'url:POST|/api/v1/courses/:course_id/rubrics',
                'url:PUT|/api/v1/courses/:course_id/rubrics/:id',
                'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
                'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
                'url:GET|/api/v1/users/self'
            ],
            registration_url: `${canvasUrl}/accounts/self/developer_keys`
        };
    }

    // Development mode - bypass OAuth for testing
    enableDevMode(testUser) {
        if (process.env.NODE_ENV !== 'development') {
            throw new Error('Dev mode only available in development environment');
        }

        this.app.post('/auth/dev-login', (req, res) => {
            req.session.user = testUser;
            req.session.tokens = {
                access_token: this.encryptToken('dev-token'),
                refresh_token: this.encryptToken('dev-refresh'),
                expires_at: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            };

            res.json({ success: true, user: testUser });
        });

        console.log('Development authentication mode enabled');
    }

    start(port = 3001) {
        this.app.listen(port, () => {
            console.log(`Canvas Auth Service running on port ${port}`);
            console.log(`OAuth redirect URI: ${this.config.redirectUri}`);
        });
    }
}

module.exports = CanvasAuthService;