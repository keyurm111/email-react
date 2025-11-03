#!/bin/bash

echo "🚀 Starting Bulk Email Automation System"
echo "=========================================="
echo ""

# Check if API server is running
if ! lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  API server is not running on port 5000"
    echo "📡 Starting API server..."
    cd ../Bulk-email-automation-
    python3 run_api_server.py &
    API_PID=$!
    echo "✅ API server started (PID: $API_PID)"
    echo ""
    sleep 3
else
    echo "✅ API server is already running on port 5000"
    echo ""
fi

# Check if Tracker server is running (optional)
if ! lsof -Pi :3003 -sTCP:LISTEN -t >/dev/null ; then
    echo "ℹ️  Tracker server is not running (optional)"
    echo "   Start it manually with: cd tracker && python run.py"
    echo ""
else
    echo "✅ Tracker server is running on port 3003"
    echo ""
fi

echo "🌐 Starting React frontend..."
echo "   Frontend will open at http://localhost:5173"
echo ""
echo "📝 Press Ctrl+C to stop all servers"
echo ""

npm run dev

