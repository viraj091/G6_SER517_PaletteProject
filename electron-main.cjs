const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

// Handle Squirrel events on Windows (installer)
if (process.platform === 'win32') {
  const setupEvents = require('./setupEvents');
  if (setupEvents.handleSquirrelEvent(app)) {
    return;
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the app - wait for the backend to be ready
  const checkBackendAndLoad = async () => {
    const http = require('http');
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    const checkBackend = () => {
      return new Promise((resolve) => {
        http.get('http://localhost:3000/health', (res) => {
          resolve(res.statusCode === 200);
        }).on('error', () => {
          resolve(false);
        });
      });
    };

    while (attempts < maxAttempts) {
      console.log(`Checking backend... attempt ${attempts + 1}/${maxAttempts}`);
      const isReady = await checkBackend();
      if (isReady) {
        console.log('Backend is ready! Loading app...');
        mainWindow.loadURL('http://localhost:3000');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    console.error('Backend failed to start after 30 seconds');
    mainWindow.loadURL('data:text/html,<h1>Error: Backend failed to start</h1>');
  };

  checkBackendAndLoad();

  // Open DevTools to debug issues
  mainWindow.webContents.openDevTools();

  // Log when page loads
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBackend() {
  const isDev = process.env.NODE_ENV === 'development';
  const backendPath = isDev
    ? path.join(__dirname, 'backend/src/palette2/server.cjs')
    : path.join(process.resourcesPath, 'app.asar.unpacked/backend/src/palette2/server.cjs');

  console.log('Starting backend server...');
  console.log('Backend path:', backendPath);
  console.log('Resources path:', process.resourcesPath);
  console.log('Is Development:', isDev);

  // Start the backend server
  backendProcess = spawn('node', [backendPath], {
    env: {
      ...process.env,
      ELECTRON_MODE: 'true',
      PORT: '3000',
    },
    stdio: 'inherit',
  });

  backendProcess.on('error', (error) => {
    console.error('Failed to start backend:', error);
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

// This method will be called when Electron has finished initialization
app.on('ready', () => {
  startBackend();
  createWindow();
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // Kill backend process before quitting
  if (backendProcess) {
    console.log('Stopping backend server on window close...');
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      try {
        execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
      } catch (error) {
        console.error('Error killing backend process:', error);
      }
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }

  // On macOS, applications stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when dock icon is clicked and no windows are open
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up backend process when app quits (additional safety)
app.on('before-quit', () => {
  if (backendProcess) {
    console.log('Stopping backend server before quit...');
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      try {
        execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
      } catch (error) {
        console.error('Error killing backend process:', error);
      }
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
