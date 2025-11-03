#!/usr/bin/env python3
"""
Run Flask API Server
Simple script to start the API server with proper configuration
"""

import os
import sys

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == '__main__':
    # Import and run the API server
    from api_server import app, start_email_worker
    
    port = int(os.getenv('API_PORT', 5000))
    debug = os.getenv('DEBUG', 'False').lower() == 'true'
    
    print("=" * 60)
    print("🚀 Bulk Email Automation - API Server")
    print("=" * 60)
    print(f"📡 Server: http://localhost:{port}")
    print(f"📊 Debug Mode: {debug}")
    print(f"🔗 CORS: Enabled for frontend")
    print(f"💾 MongoDB: {os.getenv('MONGO_URI', 'Not configured')}")
    print("=" * 60)
    print("\n✅ Server is starting...\n")
    
    # Start background email worker
    start_email_worker()
    
    app.run(host='0.0.0.0', port=port, debug=debug)

