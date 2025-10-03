# Palette :art:

[![Build Checks](https://github.com/jwsmith24/palette/actions/workflows/ci-checks.yml/badge.svg)](https://github.com/jwsmith24/palette/actions/workflows/ci-checks.yml)
![Docker](https://img.shields.io/badge/Docker-Compatible-blue)
![Node.js](https://img.shields.io/badge/Node.js-v18+-green)

An interactive rubric builder and grading assistant tool to improve the group project grading experience on Canvas.

## Table of Contents

- [Requirements](#requirements)
  - [Docker](#docker)
  - [Canvas API Token](#canvas-api-token)
    - [Generating a personal token:](#generating-a-personal-token)
    - [Using your Canvas token with Palette:](#using-your-canvas-token-with-palette)
- [Startup Instructions - Easy](#startup-instructions---easy)
  - [Update and Run](#update-and-run)
  - [Run](#run)

- [Startup Instructions - Advanced](#startup-instructions---advanced)
  - [Option 1: Running with Docker](#option-1-running-with-docker)
  - [Option 2: Running without Docker](#option-2-running-without-docker)
- [Shutting Down](#shutting-down)
  - [Stopping Containers](#stopping-containers)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)

---

## 🚀 Palette 2.0 Setup Guide (Latest Update)

### Quick Start for Team Members

Follow these steps to pull the latest changes and run Palette 2.0 with the new backend integration:

#### Step 1: Pull Latest Changes from GitHub

```bash
# Navigate to your palette project directory
cd palette

# Pull the latest changes from main branch
git pull origin main

# Verify you have the latest commit
git log --oneline -1
# Should show: "Merge remote changes and resolve conflicts" or newer
```

#### Step 2: Set Up Environment Variables

Create a `.env` file in the project root with your Canvas personal access token:

```bash
# Create .env file (use copy command on Windows)
copy .env.example .env

# Or manually create .env file and add:
CANVAS_PERSONAL_TOKEN=your_canvas_token_here
CANVAS_BASE_URL=https://canvas.asu.edu
PORT=3000
SESSION_SECRET=your_secret_key_here
```

**To get your Canvas token:**

1. Go to Canvas → Account → Settings
2. Scroll to "Approved Integrations"
3. Click "+ New Access Token"
4. Copy the token and paste it in `.env`

#### Step 3: Install Dependencies

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

#### Step 4: Run Palette 2.0

**Option A: Run Both Servers Separately (Recommended for Development)**

Open two terminal windows:

**Terminal 1 - Backend Server:**

```bash
npm run dev:palette2
```

You should see:

```
🎨 Palette 2.0 running on http://localhost:3000
🔧 Development authentication enabled
```

**Terminal 2 - Frontend Server:**

```bash
cd frontend
npm run dev
```

You should see:

```
➜  Local:   http://localhost:5173/
```

**Option B: Quick Start (if available)**

```bash
npm run dev
```

#### Step 5: Verify Everything Works

1. Open your browser and go to: **http://localhost:5173**
2. The application should load without authentication errors
3. Navigate to course selection - you should see your courses load automatically
4. Select a course - assignments should load without errors

### ✅ What's New in Palette 2.0

- ✅ **Auto-authentication**: Automatic Canvas token authentication from environment variables
- ✅ **New API Endpoints**:
  - `/api/courses` - Fetch all courses
  - `/api/courses/:id/assignments` - Fetch course assignments
- ✅ **Vite Proxy Configuration**: Seamless frontend-backend communication
- ✅ **Session Management**: Persistent authentication across requests
- ✅ **Backend Services**: Canvas sync, database manager, grading service, rubric manager

### 🔧 Troubleshooting

**Problem: "Authentication required" error**

- Solution: Make sure your `.env` file contains a valid `CANVAS_PERSONAL_TOKEN`
- Verify the token hasn't expired in Canvas settings

**Problem: "Failed to get assignments" error**

- Solution: Ensure backend server is running on port 3000
- Check that frontend proxy is configured (already done in vite.config.ts)

**Problem: Port already in use**

- Solution: Kill existing processes:
  - **Windows**: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`
  - **Mac/Linux**: `lsof -ti:3000 | xargs kill -9`

**Problem: Dependencies not installing**

- Solution: Delete `node_modules` and `package-lock.json`, then run `npm install` again

**Problem: Database errors**

- Solution: The database files are included. If issues persist, delete `data/*.db` files and restart the backend

### 📁 Project Structure

```
palette/
├── src/
│   ├── app-setup.js              # Main Express app configuration
│   ├── server.js                 # Server entry point
│   └── services/
│       ├── authentication_service.js  # Canvas OAuth & auth
│       ├── canvas_sync_service.js     # Canvas API sync
│       ├── database_manager.js        # SQLite database
│       ├── grading_service.js         # Grading logic
│       └── rubric-manager.js          # Rubric management
├── frontend/                      # React + Vite frontend
├── data/                          # SQLite databases
├── .env                           # Environment variables (create this!)
└── package.json                   # Dependencies
```

### 🎯 Backend API Endpoints

- `GET /api/courses` - Get all Canvas courses
- `GET /api/courses/:id/assignments` - Get course assignments
- `GET /api/user/settings` - Get user settings
- `POST /auth/token` - Authenticate with personal token
- `GET /health` - Health check endpoint

All API endpoints support auto-authentication via environment token!

---

## Requirements

### Docker

Palette runs in a Docker container, providing the necessary Node environment. Make sure you have the following
installed:

- **Docker**: [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose**: [Install Docker Compose](https://docs.docker.com/compose/install/)

Check your installations with:

```bash
docker --version
docker-compose --version
```

### Canvas API Token

A token is required to interact with the Canvas API.

#### Generating a personal token:

- Sign in to Canvas
- On the left sidebar menu click the account widget
- Click `Settings`
- Scroll down to `Approved Integrations`
- Select `+ New Access Token`
- Label your token by filling in the `Purpose` field
- Set an expiration date and/or time as desired, leave blank for no expiration.
- Copy the full token before refreshing the page.

#### Using your Canvas token with Palette:

- In the top right of the application, click on the gray circle to open a drop-down menu
- Select `Settings`
- Paste your full Canvas API token into the `Token Input` field
- Select `Update Settings`
- Navigate to the `Builder` tab if you want to create or edit rubrics or the `Grading` tab to grade assignment
  submissions.
- Select your target course and assignment.
- Have a blast!

> [!IMPORTANT]
> Your account must be authorized as a teacher or grader in order to perform most actions. Students can do certain
> actions via the API but Palette does not support those at this time.

---

## Startup Instructions - Easy

Two scripts have been provided to update and run the application without worrying about Docker commands.

### Update and Run

From the project root, run `./update.sh` to pull the latest content from GitHub, shutdown any running instances of
the application in Docker, rebuild the container with the latest changes, and start the container.

> [!IMPORTANT]
> Run this script if there's a new update to pull. If the application has any errors, try running this first as
> Docker caching sometimes causes issues.

### Run

When you just want to run the application, this is the fastest method.

Run `./start.sh` from the project root to start the container and run Palette.

> [!IMPORTANT]
> If the application has any errors, try running `update.sh` first as Docker caching can sometimes cause issues.

###

## Startup Instructions - Advanced

### Option 1: Running with Docker

1. Clone the repository and navigate to the root folder:

   ```bash
   git clone <repository-url>
   cd palette
   ```

2. Run one of the following commands to start the services:

   ```bash
   docker-compose up        # Attached mode
   docker-compose up -d     # Detached mode
   ```

   This will build and start the container on any OS.

3. **Stopping the Containers**
   - Use `CTRL + C` if in attached mode or `docker-compose down` if detached.

### Option 2: Running without Docker

If you have [Node.js](https://nodejs.org/en) (version 18+) installed:

1. After cloning the repo, run:

   ```bash
   npm install && npm run dev
   ```

---

## Shutting Down

### Stopping Containers

- To stop services and remove containers:

  ```bash
  docker-compose down
  ```

- **Removing Volumes and Images**  
  For a complete cleanup:

  ```bash
  docker-compose down --volumes --rmi all
  ```

- **Optional:**  
  To remove unused resources:
  ```bash
  docker system prune --all --volumes
  ```

---

## Usage

Once up and running, you can interact with the application on http://localhost:5173.

---

## Troubleshooting

1. **Permissions Issues**  
   Ensure Docker is running, and check that your user is in the `docker` group. For persistent issues, run with `sudo`.

2. **Checking Logs**

   ```bash
   docker-compose logs
   ```

3. **Rebuild Containers**  
   After changes:

   ```bash
   docker-compose up --build
   ```

4. **Network Issues**  
   Verify port `5173` is free.

---
