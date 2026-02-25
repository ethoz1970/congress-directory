#!/bin/bash

# WhoIsOurGov — Local Development Startup Script
# Starts both the backend (FastAPI) and frontend (Next.js) servers
# Uses local JSON data for fast startup (no Firestore round-trips)

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
    wait 2>/dev/null
    echo "All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM

# --- Check prerequisites ---

# Check for Python venv
if [ ! -f "$BACKEND_DIR/venv/bin/python" ]; then
    echo "Python venv not found. Creating it..."
    python3 -m venv "$BACKEND_DIR/venv"
    echo "Installing backend dependencies..."
    "$BACKEND_DIR/venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

# Check for firebase credentials
if [ ! -f "$BACKEND_DIR/firebase-credentials.json" ]; then
    echo "ERROR: firebase-credentials.json not found in backend/"
    echo "Place your Firebase service account credentials there and try again."
    exit 1
fi

# Check for node_modules
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "node_modules not found. Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
fi

# --- Export local data if missing ---

if [ ! -f "$BACKEND_DIR/local_data/legislators.json" ]; then
    echo "Local data not found. Exporting from Firestore (one-time)..."
    (
        cd "$BACKEND_DIR" && \
        source venv/bin/activate && \
        python export_local_data.py
    )
    echo ""
fi

# --- Start backend (local data mode) ---

echo "Starting backend (FastAPI) on http://localhost:8002 [LOCAL DATA MODE]..."
(
    cd "$BACKEND_DIR" && \
    source venv/bin/activate && \
    USE_LOCAL_DATA=true YOUTUBE_API_KEY="${YOUTUBE_API_KEY:-}" python -m uvicorn main:app --reload --host 0.0.0.0 --port 8002
) &
BACKEND_PID=$!

# Wait a moment for the backend to start
sleep 2

# --- Start frontend ---

echo "Starting frontend (Next.js) on http://localhost:3000 ..."
(
    cd "$FRONTEND_DIR" && \
    npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "  WhoIsOurGov is running locally"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8002 (local data)"
echo "  Press Ctrl+C to stop both services"
echo "========================================="
echo ""
echo "  To refresh local data from Firestore:"
echo "  cd backend && source venv/bin/activate && python export_local_data.py"
echo ""

# Wait for either process to exit
wait
