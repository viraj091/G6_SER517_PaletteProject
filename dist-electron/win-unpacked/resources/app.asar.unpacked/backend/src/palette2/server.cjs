#!/usr/bin/env node

// Palette 2.0 Server Startup
require('dotenv').config();
const PaletteApp = require('./app-setup.cjs');

async function startServer() {
    const app = new PaletteApp();

    try {
        await app.initialize();
        await app.start();

        // Graceful shutdown handling
        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM, shutting down gracefully...');
            await app.shutdown();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('Received SIGINT, shutting down gracefully...');
            await app.shutdown();
            process.exit(0);
        });

        process.on('uncaughtException', async (error) => {
            console.error('Uncaught exception:', error);
            await app.shutdown();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
            await app.shutdown();
            process.exit(1);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();