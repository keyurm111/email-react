#!/usr/bin/env python3
"""
Simple startup script for Email Tracker
Run with: python run.py
"""

from server import app

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3003, debug=True)
