#!/usr/bin/env python3
"""
Direct Run Script - For testing only
This shows the proper way to run Streamlit
"""

import subprocess
import sys
import os

def run_streamlit():
    """Run Streamlit with proper command"""
    try:
        print("🚀 Starting Streamlit with proper command...")
        print("📱 Access your app at: http://localhost:8501")
        print("🌍 For external access: http://your-server-ip:8501")
        print("")
        print("✅ Use Ctrl+C to stop the application")
        print("")
        
        # Run streamlit with proper command
        cmd = [
            sys.executable, "-m", "streamlit", "run", "main.py",
            "--server.port", "8501",
            "--server.address", "0.0.0.0",
            "--server.headless", "true"
        ]
        
        subprocess.run(cmd)
        
    except KeyboardInterrupt:
        print("\n🛑 Application stopped by user")
    except Exception as e:
        print(f"❌ Error running Streamlit: {e}")

if __name__ == "__main__":
    run_streamlit()
