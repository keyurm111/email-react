"""
Flask REST API Server for Bulk Email Automation System
Connects HTML/CSS/JS frontend with Python backend
"""

from flask import Flask, request, jsonify, has_request_context
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
import os
from dotenv import load_dotenv
from datetime import datetime, date
import uuid
from bson import ObjectId
import threading
import time
import urllib.parse
import re

# Import existing backend modules
from mongo_utils import (
    get_database, load_json, save_json, initialize_database,
    get_lead_files, get_template_files,
    get_lead_file_content, get_template_file_content,
    log_email_sent,
    get_smtp_senders, upsert_smtp_sender, delete_smtp_sender
)
from email_sender import (
    send_email, check_sender_health, validate_app_password,
    test_smtp_connection, send_batch_emails
)
from tracking_utils import inject_tracking_pixel, remove_tracking_pixel
from tracker_routes import tracker_bp
import re
import hashlib
import pandas as pd
import io

# Load environment variables
load_dotenv()

# Tracker URL configuration
def get_tracker_url():
    """Get tracker URL for open/click tracking endpoints."""
    # If environment variable is explicitly set, use it
    tracker_url = os.getenv('TRACKER_URL')
    if tracker_url:
        return tracker_url.rstrip('/')

    if has_request_context():
        forwarded_host = request.headers.get('X-Forwarded-Host')
        forwarded_proto = request.headers.get('X-Forwarded-Proto')
        forwarded_port = request.headers.get('X-Forwarded-Port')

        if forwarded_host:
            scheme = forwarded_proto or request.scheme
            host_with_port = forwarded_host
            if forwarded_port and ':' not in forwarded_host:
                host_with_port = f'{forwarded_host}:{forwarded_port}'
            return f'{scheme}://{host_with_port}/tracker'

        return f'{request.scheme}://{request.host}/tracker'

    production_host = os.getenv('PRODUCTION_HOST')
    if production_host:
        scheme = os.getenv('PRODUCTION_SCHEME', 'https')
        port = os.getenv('PRODUCTION_PORT')
        if port:
            return f'{scheme}://{production_host}:{port}/tracker'
        return f'{scheme}://{production_host}/tracker'

    return 'http://127.0.0.1:7027/tracker'


def normalize_tracker_urls(html_content: str) -> str:
    """Ensure tracking URLs always use the correct host and path."""
    if not html_content:
        return html_content

    tracker_url = get_tracker_url()
    replacements = [
        'http://127.0.0.1:7027/tracker',
        'https://127.0.0.1:7027/tracker',
        'http://localhost:7027/tracker',
        'https://localhost:7027/tracker',
        'http://127.0.0.1:3003',
        'https://127.0.0.1:3003',
        'http://localhost:3003',
        'https://localhost:3003',
    ]

    normalized = html_content
    for old in replacements:
        normalized = normalized.replace(old, tracker_url)

    normalized = re.sub(r'/track/(open|click)\?', r'/tracker/track/\1?', normalized)

    return normalized

# Custom JSON provider to handle MongoDB ObjectId
class MongoJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        return super().default(obj)

# Initialize Flask app
app = Flask(__name__)
app.json = MongoJSONProvider(app)
CORS(app)  # Enable CORS for frontend
app.register_blueprint(tracker_bp)

# MongoDB collection names
SENDER_FILE = "senders"
SMTP_SENDERS_COLLECTION = "smtp_senders"
CAMPAIGNS_FILE = "campaigns"
USERS_FILE = "users"
HISTORY_FILE = "sent_log"
REQUIREMENTS_FILE = "requirements"

# Initialize database
initialize_database()

# Background worker control
worker_running = False
worker_thread = None

# Queue for immediate campaign processing
immediate_process_queue = []
process_lock = threading.Lock()

# Live logs storage (in-memory for real-time display)
campaign_logs = {}  # {campaign_id: [list of log entries]}
logs_lock = threading.Lock()

def add_log(campaign_id, level, message, details=None):
    """Add a log entry for a campaign"""
    global campaign_logs
    with logs_lock:
        if campaign_id not in campaign_logs:
            campaign_logs[campaign_id] = []
        
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'level': level,  # 'info', 'success', 'error', 'warning'
            'message': message,
            'details': details
        }
        
        campaign_logs[campaign_id].append(log_entry)
        
        # Keep only last 1000 logs per campaign
        if len(campaign_logs[campaign_id]) > 1000:
            campaign_logs[campaign_id] = campaign_logs[campaign_id][-1000:]
        
        # Also print to console
        print(f"[LOG {level.upper()}] {message}")

def get_campaign_logs(campaign_id, limit=100):
    """Get recent logs for a campaign"""
    global campaign_logs
    with logs_lock:
        if campaign_id not in campaign_logs:
            return []
        return campaign_logs[campaign_id][-limit:]

# ============================================
# HELPER FUNCTIONS
# ============================================

def clean_mongo_doc(doc):
    """Recursively remove MongoDB ObjectIds from documents"""
    if isinstance(doc, dict):
        return {k: clean_mongo_doc(v) for k, v in doc.items() if k != '_id'}
    elif isinstance(doc, list):
        return [clean_mongo_doc(item) for item in doc]
    elif isinstance(doc, ObjectId):
        return str(doc)
    else:
        return doc

def get_user_id_from_header():
    """Extract user ID from X-User-ID header"""
    return request.headers.get('X-User-ID')

def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def ensure_campaign_stats(campaign):
    """Ensure campaign has stats field with default values"""
    if 'stats' not in campaign:
        campaign['stats'] = {
            'total_leads': 0,
            'total_sent': 0,
            'total_failed': 0
        }
    return campaign

def generate_tracking_code(campaign_name):
    """Generate HTML tracking code for a campaign"""
    tracker_url = get_tracker_url()
    import urllib.parse
    encoded_campaign_name = urllib.parse.quote(campaign_name)
    
    tracking_code = f'''<!-- 📧 Email Tracking Code for Campaign: {campaign_name} -->
<!-- Copy this code into your HTML email template -->

<!-- 🔍 Open Tracking Pixel (Hidden) -->
<img src="{tracker_url}/track/open?email={{{{Emails}}}}&uid={encoded_campaign_name}&name={{{{Name}}}}&instagram={{{{Social Medias}}}}" 
     width="1" height="1" style="display:none;" alt="Tracking Pixel" />

<!-- 🔗 Click Tracking Links (Replace {{{{original_url}}}} with your actual URLs) -->
<!-- Example: -->
<a href="{tracker_url}/track/click?email={{{{Emails}}}}&uid={encoded_campaign_name}&redirect={{{{original_url}}}}&name={{{{Name}}}}&instagram={{{{Social Medias}}}}">
    Your Link Text
</a>

<!-- 📊 How to use: -->
<!-- 1. Replace {{{{Emails}}}} with the recipient's email (from CSV column "Emails") -->
<!-- 2. Replace {{{{Name}}}} with the recipient's name (from CSV column "Name") -->
<!-- 3. Replace {{{{Social Medias}}}} with the recipient's social media (from CSV column "Social Medias") -->
<!-- 4. Replace {{{{original_url}}}} with the actual URL you want to redirect to -->
<!-- 5. The system will automatically track opens and clicks -->
<!-- 6. View tracking data in the Tracker page -->
<!-- 7. Campaign name: {campaign_name} -->'''
    
    return tracking_code

# ============================================
# AUTHENTICATION ENDPOINTS
# ============================================

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.json
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        
        if not username or not email or not password:
            return jsonify({'success': False, 'message': 'All fields required'}), 400
        
        # Get database connection
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        users_collection = db[USERS_FILE]
        
        # Check if user exists
        if users_collection.find_one({'email': email}):
            return jsonify({'success': False, 'message': 'Email already registered'}), 400
        
        # Create user
        user_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        user_doc = {
            'user_id': user_id,
            'username': username,
            'email': email,
            'password': hash_password(password),
            'created_at': created_at,
            'is_active': True
        }
        
        users_collection.insert_one(user_doc)
        
        return jsonify({
            'success': True,
            'user': {
                'user_id': user_id,
                'username': username,
                'email': email,
                'created_at': created_at
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login user"""
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'success': False, 'message': 'Email and password required'}), 400
        
        # Get user from MongoDB directly
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        users_collection = db[USERS_FILE]
        user = users_collection.find_one({'email': email})
        
        if not user:
            return jsonify({'success': False, 'message': 'Invalid credentials'}), 401
        
        # Verify password
        if user['password'] != hash_password(password):
            return jsonify({'success': False, 'message': 'Invalid credentials'}), 401
        
        # Generate user_id if not exists (for backward compatibility)
        if 'user_id' not in user:
            user_id = str(uuid.uuid4())
            users_collection.update_one(
                {'email': email},
                {'$set': {'user_id': user_id}}
            )
        else:
            user_id = user['user_id']
        
        return jsonify({
            'success': True,
            'user': {
                'user_id': user_id,
                'username': user.get('username', email.split('@')[0]),
                'email': user['email'],
                'created_at': user.get('created_at', datetime.now().isoformat())
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# SENDER ENDPOINTS
# ============================================

@app.route('/api/senders', methods=['GET'])
def get_senders():
    """Get all senders for current user"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        # Get Gmail senders from MongoDB
        gmail_senders = list(db[SENDER_FILE].find({'user_id': user_id}, {'_id': 0}))
        for sender in gmail_senders:
            sender['type'] = 'gmail'
        
        # Get SMTP senders from MongoDB
        smtp_senders = list(db[SMTP_SENDERS_COLLECTION].find({'user_id': user_id}, {'_id': 0}))
        for sender in smtp_senders:
            sender['type'] = 'smtp'
        
        # Combine both types
        all_senders = gmail_senders + smtp_senders
        
        # Clean any MongoDB ObjectIds before returning
        clean_senders = clean_mongo_doc(all_senders)
        
        return jsonify({'success': True, 'senders': clean_senders})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/gmail', methods=['POST'])
def add_gmail_sender():
    """Add Gmail sender"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        data = request.json
        email = data.get('email')
        password = data.get('password')
        name = data.get('name', email)
        
        if not email or not password:
            return jsonify({'success': False, 'message': 'Email and password required'}), 400
        
        # Validate app password
        is_valid, validation_msg = validate_app_password(password)
        if not is_valid:
            return jsonify({'success': False, 'message': validation_msg}), 400
        
        # Get existing senders
        senders = load_json(SENDER_FILE, [], user_id)
        
        # Check if already exists
        if any(s['email'] == email for s in senders):
            return jsonify({'success': False, 'message': 'Sender already exists'}), 400
        
        # Add sender
        senders.append({
            'email': email,
            'password': password,
            'name': name,
            'type': 'gmail'
        })
        
        save_json(SENDER_FILE, senders, user_id)
        
        return jsonify({'success': True, 'message': 'Gmail sender added'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/smtp', methods=['POST'])
def add_smtp_sender():
    """Add custom SMTP sender"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        data = request.json
        
        sender_data = {
            'email': data.get('email'),
            'name': data.get('name', data.get('email')),
            'smtp_host': data.get('smtp_host'),
            'smtp_port': int(data.get('smtp_port', 587)),
            'smtp_user': data.get('smtp_user'),
            'smtp_password': data.get('smtp_password'),
            'use_tls': data.get('use_tls', True),
            'use_ssl': data.get('use_ssl', False),
            'type': 'smtp'
        }
        
        if upsert_smtp_sender(sender_data, user_id):
            return jsonify({'success': True, 'message': 'SMTP sender added'})
        else:
            return jsonify({'success': False, 'message': 'Failed to add sender'}), 500
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/<email>', methods=['PUT'])
def update_sender(email):
    """Update sender"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        data = request.json
        sender_type = data.get('type', 'gmail')
        
        if sender_type == 'smtp':
            # Update SMTP sender
            sender_data = {
                'email': data.get('email', email),
                'name': data.get('name'),
                'smtp_host': data.get('smtp_host'),
                'smtp_port': int(data.get('smtp_port', 587)),
                'smtp_user': data.get('smtp_user'),
                'smtp_password': data.get('smtp_password'),
                'use_tls': data.get('use_tls', True),
                'use_ssl': data.get('use_ssl', False),
                'type': 'smtp'
            }
            
            if upsert_smtp_sender(sender_data, user_id):
                return jsonify({'success': True, 'message': 'Sender updated'})
            else:
                return jsonify({'success': False, 'message': 'Failed to update'}), 500
        else:
            # Update Gmail sender
            senders = load_json(SENDER_FILE, [], user_id)
            
            for sender in senders:
                if sender['email'] == email:
                    sender['email'] = data.get('email', email)
                    sender['password'] = data.get('password', sender['password'])
                    sender['name'] = data.get('name', sender.get('name', email))
                    break
            
            save_json(SENDER_FILE, senders, user_id)
            return jsonify({'success': True, 'message': 'Sender updated'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/<email>', methods=['DELETE'])
def delete_sender_endpoint(email):
    """Delete sender"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Try to delete from SMTP senders first
        if delete_smtp_sender(email, user_id):
            return jsonify({'success': True, 'message': 'Sender deleted'})
        
        # If not SMTP, delete from Gmail senders
        senders = load_json(SENDER_FILE, [], user_id)
        senders = [s for s in senders if s['email'] != email]
        save_json(SENDER_FILE, senders, user_id)
        
        return jsonify({'success': True, 'message': 'Sender deleted'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/<email>/test', methods=['POST'])
def test_sender_endpoint(email):
    """Test sender health"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Get all senders
        gmail_senders = load_json(SENDER_FILE, [], user_id)
        smtp_senders = get_smtp_senders(user_id)
        all_senders = gmail_senders + smtp_senders
        
        sender = next((s for s in all_senders if s['email'] == email), None)
        
        if not sender:
            return jsonify({'success': False, 'message': 'Sender not found'}), 404
        
        # Test based on type
        if sender.get('smtp_host'):
            # SMTP sender
            healthy = test_smtp_connection(
                sender['smtp_host'],
                sender.get('smtp_port', 587),
                sender.get('smtp_user', email),
                sender.get('smtp_password', ''),
                use_tls=sender.get('use_tls', True),
                use_ssl=sender.get('use_ssl', False)
            )
        else:
            # Gmail sender
            healthy = check_sender_health(email, sender.get('password', ''))
        
        return jsonify({
            'success': True,
            'healthy': healthy,
            'message': 'Healthy' if healthy else 'Issues detected'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/senders/smtp/test', methods=['POST'])
def test_smtp_connection_endpoint():
    """Test SMTP connection"""
    try:
        data = request.json
        
        healthy = test_smtp_connection(
            data.get('smtp_host'),
            int(data.get('smtp_port', 587)),
            data.get('smtp_user'),
            data.get('smtp_password'),
            use_tls=data.get('use_tls', True),
            use_ssl=data.get('use_ssl', False)
        )
        
        return jsonify({
            'success': True,
            'healthy': healthy,
            'message': 'Connection successful' if healthy else 'Connection failed'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# CAMPAIGN ENDPOINTS
# ============================================

@app.route('/api/campaigns', methods=['GET'])
def get_campaigns():
    """Get all campaigns for current user"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        # Get campaigns from MongoDB
        campaigns_list = list(db[CAMPAIGNS_FILE].find({'user_id': user_id}, {'_id': 0}))
        
        # Ensure all campaigns have stats and clean ObjectIds
        for campaign in campaigns_list:
            campaign = ensure_campaign_stats(campaign)
        
        # Clean any MongoDB ObjectIds before returning
        clean_campaigns = clean_mongo_doc(campaigns_list)
        
        return jsonify({
            'success': True,
            'campaigns': clean_campaigns
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>', methods=['GET'])
def get_campaign(campaign_id):
    """Get specific campaign"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        campaign = db[CAMPAIGNS_FILE].find_one({'id': campaign_id, 'user_id': user_id}, {'_id': 0})
        
        if not campaign:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        campaign = ensure_campaign_stats(campaign)
        
        # Clean any MongoDB ObjectIds before returning
        clean_campaign = clean_mongo_doc(campaign)
        
        return jsonify({'success': True, 'campaign': clean_campaign})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns', methods=['POST'])
def create_campaign():
    """Create new campaign"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        data = request.json
        name = data.get('name')
        description = data.get('description', '')
        
        if not name:
            return jsonify({'success': False, 'message': 'Campaign name required'}), 400
        
        db = get_database()
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        campaign_id = str(uuid.uuid4())
        tracking_code = generate_tracking_code(name)
        
        campaign_data = {
            'id': campaign_id,
            'name': name,
            'description': description,
            'created_at': datetime.now().isoformat(),
            'status': 'draft',
            'selected_senders': [],
            'leads_file': None,
            'template_file': None,
            'subject_line': '',
            'daily_limit': 120,
            'delay': 30,
            'schedule_enabled': False,
            'schedule_time': '10:00',
            'scheduled_date': None,
            'stats': {'total_sent': 0, 'total_failed': 0, 'total_leads': 0},
            'tracking_code': tracking_code,
            'user_id': user_id
        }
        
        db[CAMPAIGNS_FILE].insert_one(campaign_data.copy())
        del campaign_data['user_id']  # Don't send user_id back to frontend
        
        return jsonify({'success': True, 'campaign': campaign_data})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>', methods=['PUT'])
def update_campaign(campaign_id):
    """Update campaign (using Streamlit's load_json/save_json pattern)"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Load all campaigns for this user (Streamlit pattern)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        data = request.json
        campaign = campaigns[campaign_id]
        
        # Update fields
        if 'name' in data:
            campaign['name'] = data['name']
        if 'description' in data:
            campaign['description'] = data['description']
        if 'selected_senders' in data:
            campaign['selected_senders'] = data['selected_senders']
        if 'subject_line' in data:
            campaign['subject_line'] = data['subject_line']
        if 'daily_limit' in data:
            campaign['daily_limit'] = int(data['daily_limit'])
        if 'delay' in data:
            campaign['delay'] = int(data['delay'])
        if 'schedule_enabled' in data:
            campaign['schedule_enabled'] = data['schedule_enabled']
        if 'schedule_time' in data:
            campaign['schedule_time'] = data['schedule_time']
        if 'scheduled_date' in data:
            campaign['scheduled_date'] = data['scheduled_date']
        if 'start_immediate_daily' in data:
            campaign['start_immediate_daily'] = data['start_immediate_daily']
        if 'status' in data:
            campaign['status'] = data['status']
        if 'leads_file' in data:
            campaign['leads_file'] = data['leads_file']
        if 'leads_data' in data:
            campaign['leads_data'] = data['leads_data']
        if 'template_file' in data:
            campaign['template_file'] = data['template_file']
        if 'template_data' in data:
            campaign['template_data'] = data['template_data']
        
        # Handle stats updates
        if 'stats.total_leads' in data:
            if 'stats' not in campaign:
                campaign['stats'] = {}
            campaign['stats']['total_leads'] = data['stats.total_leads']
        
        # Save all campaigns back (Streamlit pattern)
        save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        # Clean any MongoDB ObjectIds before returning
        clean_campaign = clean_mongo_doc(campaign)
        
        return jsonify({'success': True, 'campaign': clean_campaign})
        
    except Exception as e:
        print(f"Error updating campaign: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>', methods=['DELETE'])
def delete_campaign(campaign_id):
    """Delete campaign (using Streamlit's load_json/save_json pattern)"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Load all campaigns for this user (Streamlit pattern)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        # Delete the campaign
        del campaigns[campaign_id]
        
        # Save all campaigns back (Streamlit pattern)
        save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error deleting campaign: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/start', methods=['POST'])
def start_campaign(campaign_id):
    """Start campaign and trigger immediate email sending"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Load all campaigns for this user (Streamlit pattern)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        # Update status
        campaigns[campaign_id]['status'] = 'running'
        
        # Save all campaigns back (Streamlit pattern)
        save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        # Trigger immediate processing in background thread
        campaign = campaigns[campaign_id]
        campaign_name = campaign.get('name', campaign_id)
        
        def process_immediately():
            """Process campaign immediately in background - bypasses scheduling checks"""
            try:
                print("=" * 60)
                print(f"🚀 IMMEDIATE PROCESSING TRIGGERED for campaign: {campaign_name} (ID: {campaign_id})")
                print("=" * 60)
                time.sleep(2)  # Small delay to ensure DB is updated
                
                # Reload campaign to get fresh data
                fresh_campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
                if campaign_id not in fresh_campaigns:
                    print(f"❌ Campaign {campaign_id} not found after reload")
                    return
                
                fresh_campaign = fresh_campaigns[campaign_id]
                
                # Verify campaign is still set to 'running'
                if fresh_campaign.get('status') != 'running':
                    print(f"⚠️  Campaign {campaign_name} status is '{fresh_campaign.get('status')}', not 'running'. Skipping immediate processing.")
                    return
                
                # Verify campaign has required data
                if not fresh_campaign.get('leads_data') and not fresh_campaign.get('leads_file'):
                    print(f"❌ Campaign {campaign_name} has no leads data/file")
                    return
                
                if not fresh_campaign.get('template_data') and not fresh_campaign.get('template_file'):
                    print(f"❌ Campaign {campaign_name} has no template data/file")
                    return
                
                if not fresh_campaign.get('selected_senders'):
                    print(f"❌ Campaign {campaign_name} has no selected senders")
                    return
                
                # Initialize history for new campaign (if needed)
                history = load_json(HISTORY_FILE, {}, user_id)
                if campaign_id not in history:
                    print(f"📝 Initializing history for new campaign: {campaign_name}")
                    history[campaign_id] = {
                        'sent': [],
                        'failed': [],
                        'processing': [],
                        'processing_timestamps': {},
                        'daily_sent_tracking': {}
                    }
                    save_json(HISTORY_FILE, history, user_id)
                
                # Force processing by temporarily bypassing schedule check
                # Create a copy with schedule overrides for immediate processing
                temp_campaign = fresh_campaign.copy()
                temp_campaign['schedule_enabled'] = False
                temp_campaign['scheduled_date'] = None
                
                print(f"📧 Starting email processing for: {campaign_name}")
                print(f"   Leads: {bool(fresh_campaign.get('leads_data')) or bool(fresh_campaign.get('leads_file'))}")
                print(f"   Template: {bool(fresh_campaign.get('template_data')) or bool(fresh_campaign.get('template_file'))}")
                print(f"   Senders: {len(fresh_campaign.get('selected_senders', []))}")
                process_campaign_emails(campaign_id, temp_campaign, user_id, force_immediate=True)
                print(f"✅ Immediate processing completed for: {campaign_name}")
                print("=" * 60)
            except Exception as e:
                print(f"❌ Error in immediate processing for campaign {campaign_name}: {e}")
                import traceback
                traceback.print_exc()
                
                # Log error to campaign logs
                try:
                    add_log(campaign_id, 'error', f'❌ Error in immediate processing: {str(e)}')
                except:
                    pass
        
        # Start processing in background thread (non-blocking)
        process_thread = threading.Thread(target=process_immediately, daemon=True)
        process_thread.start()
        
        print(f"✅ Campaign {campaign_name} started - immediate processing thread launched")
        
        return jsonify({'success': True, 'message': 'Campaign started and emails are being sent'})
        
    except Exception as e:
        print(f"Error starting campaign: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/pause', methods=['POST'])
def pause_campaign(campaign_id):
    """Pause campaign (using Streamlit's load_json/save_json pattern)"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Load all campaigns for this user (Streamlit pattern)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        # Update status
        campaigns[campaign_id]['status'] = 'paused'
        
        # Save all campaigns back (Streamlit pattern)
        save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error pausing campaign: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/reset', methods=['POST'])
def reset_campaign(campaign_id):
    """Reset campaign"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Reset history
        history = load_json(HISTORY_FILE, {}, user_id)
        if campaign_id in history:
            history[campaign_id] = {
                'sent': [],
                'failed': [],
                'processing': [],
                'processing_timestamps': {},
                'daily_sent_tracking': {}
            }
            save_json(HISTORY_FILE, history, user_id)
        
        # Reset stats
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        if campaign_id in campaigns:
            campaigns[campaign_id]['stats'] = {
                'total_sent': 0,
                'total_failed': 0,
                'total_leads': campaigns[campaign_id]['stats'].get('total_leads', 0)
            }
            save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# FILE UPLOAD ENDPOINTS
# ============================================

@app.route('/api/campaigns/<campaign_id>/leads', methods=['POST'])
def upload_leads(campaign_id):
    """Upload lead file for campaign (EXACTLY like Streamlit)"""
    import sys
    try:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"LEAD UPLOAD STARTED - Campaign ID: {campaign_id}", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        
        user_id = get_user_id_from_header()
        print(f"✓ User ID: {user_id}", file=sys.stderr)
        
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        if 'file' not in request.files:
            print("✗ No file in request", file=sys.stderr)
            return jsonify({'success': False, 'message': 'No file provided'}), 400
        
        file = request.files['file']
        print(f"✓ File received: {file.filename}", file=sys.stderr)
        
        if file.filename == '':
            print("✗ Empty filename", file=sys.stderr)
            return jsonify({'success': False, 'message': 'No file selected'}), 400
        
        # Read file content
        file_content = file.read()
        print(f"✓ File content read: {len(file_content)} bytes", file=sys.stderr)
        
        # Parse CSV to count leads and get preview (like Streamlit)
        df = pd.read_csv(io.BytesIO(file_content))
        lead_count = len(df)
        print(f"✓ CSV parsed: {lead_count} leads", file=sys.stderr)
        print(f"  Columns: {list(df.columns)}", file=sys.stderr)
        
        # Get preview (first 5 rows as CSV string)
        preview_df = df.head(5)
        preview_csv = preview_df.to_csv(index=False)
        print(f"✓ Preview generated", file=sys.stderr)
        
        # Load all campaigns (Streamlit pattern)
        print(f"Loading campaigns for user: {user_id}", file=sys.stderr)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        print(f"✓ Campaigns loaded: {len(campaigns)} campaigns", file=sys.stderr)
        print(f"  Campaign IDs: {list(campaigns.keys())}", file=sys.stderr)
        
        if campaign_id not in campaigns:
            print(f"✗ Campaign {campaign_id} not found in campaigns", file=sys.stderr)
            return jsonify({'success': False, 'message': f'Campaign not found. Available: {list(campaigns.keys())}'}), 404
        
        print(f"✓ Campaign found", file=sys.stderr)
        
        # Store leads data DIRECTLY in campaign (EXACTLY like Streamlit - lines 850-857)
        campaigns[campaign_id]['leads_data'] = df.to_csv(index=False)  # Store CSV as string
        campaigns[campaign_id]['leads_file'] = f"leads_{campaign_id}.csv"
        print(f"✓ Leads data stored in campaign", file=sys.stderr)
        
        # Update stats
        if 'stats' not in campaigns[campaign_id]:
            campaigns[campaign_id]['stats'] = {}
        campaigns[campaign_id]['stats']['total_leads'] = lead_count
        print(f"✓ Stats updated: total_leads = {lead_count}", file=sys.stderr)
        
        # Save all campaigns (Streamlit pattern)
        print(f"Saving campaigns to MongoDB...", file=sys.stderr)
        result = save_json(CAMPAIGNS_FILE, campaigns, user_id)
        print(f"✓ Campaigns saved: {result}", file=sys.stderr)
        
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"LEAD UPLOAD COMPLETED SUCCESSFULLY", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        
        return jsonify({
            'success': True, 
            'filename': f"leads_{campaign_id}.csv",
            'count': lead_count,
            'preview': preview_csv,
            'leads_data': df.to_csv(index=False)
        })
        
    except Exception as e:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"✗✗✗ ERROR UPLOADING LEADS ✗✗✗", file=sys.stderr)
        print(f"Error: {str(e)}", file=sys.stderr)
        print(f"Error Type: {type(e).__name__}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/template', methods=['POST'])
def upload_template(campaign_id):
    """Upload template file for campaign (EXACTLY like Streamlit)"""
    import sys
    try:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"TEMPLATE UPLOAD STARTED - Campaign ID: {campaign_id}", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        
        user_id = get_user_id_from_header()
        print(f"✓ User ID: {user_id}", file=sys.stderr)
        
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        if 'file' not in request.files:
            print("✗ No file in request", file=sys.stderr)
            return jsonify({'success': False, 'message': 'No file provided'}), 400
        
        file = request.files['file']
        print(f"✓ File received: {file.filename}", file=sys.stderr)
        
        if file.filename == '':
            print("✗ Empty filename", file=sys.stderr)
            return jsonify({'success': False, 'message': 'No file selected'}), 400
        
        # Read file content
        file_content = file.read()
        print(f"✓ File content read: {len(file_content)} bytes", file=sys.stderr)
        
        template_text = file_content.decode('utf-8')
        print(f"✓ Template decoded to UTF-8", file=sys.stderr)
        
        # Load all campaigns (Streamlit pattern)
        print(f"Loading campaigns for user: {user_id}", file=sys.stderr)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        print(f"✓ Campaigns loaded: {len(campaigns)} campaigns", file=sys.stderr)
        print(f"  Campaign IDs: {list(campaigns.keys())}", file=sys.stderr)
        
        if campaign_id not in campaigns:
            print(f"✗ Campaign {campaign_id} not found in campaigns", file=sys.stderr)
            return jsonify({'success': False, 'message': f'Campaign not found. Available: {list(campaigns.keys())}'}), 404
        
        print(f"✓ Campaign found", file=sys.stderr)
        
        campaign_name = campaigns[campaign_id].get('name', 'Unknown Campaign')
        print(f"  Campaign name: {campaign_name}", file=sys.stderr)
        
        # Auto-inject tracking pixel (EXACTLY like Streamlit - lines 949-952)
        tracker_server = get_tracker_url()
        print(f"Injecting tracking pixel (tracker: {tracker_server})...", file=sys.stderr)
        template_with_tracking = inject_tracking_pixel(template_text, tracker_server, campaign_name)
        template_with_tracking = normalize_tracker_urls(template_with_tracking)
        print(f"✓ Tracking pixel injected", file=sys.stderr)
        
        # Verify tracking pixel was injected
        if 'track/open?email=' in template_with_tracking:
            print(f"✓✓✓ VERIFIED: Tracking pixel found in template", file=sys.stderr)
        else:
            print(f"⚠️  WARNING: Tracking pixel not found in injected template!", file=sys.stderr)
        
        # Store template data DIRECTLY in campaign (EXACTLY like Streamlit - lines 954-957)
        campaigns[campaign_id]['template_data'] = template_with_tracking
        campaigns[campaign_id]['template_file'] = f"template_{campaign_id}.html"
        print(f"✓ Template data stored in campaign", file=sys.stderr)
        
        # Save all campaigns (Streamlit pattern)
        print(f"Saving campaigns to MongoDB...", file=sys.stderr)
        result = save_json(CAMPAIGNS_FILE, campaigns, user_id)
        print(f"✓ Campaigns saved: {result}", file=sys.stderr)
        
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"TEMPLATE UPLOAD COMPLETED SUCCESSFULLY", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        
        return jsonify({
            'success': True, 
            'filename': f"template_{campaign_id}.html",
            'template_data': template_with_tracking,
            'preview': template_with_tracking[:500] + '...' if len(template_with_tracking) > 500 else template_with_tracking
        })
        
    except Exception as e:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"✗✗✗ ERROR UPLOADING TEMPLATE ✗✗✗", file=sys.stderr)
        print(f"Error: {str(e)}", file=sys.stderr)
        print(f"Error Type: {type(e).__name__}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/template/inject-tracking', methods=['POST'])
def inject_tracking_endpoint(campaign_id):
    """Auto-inject tracking pixel into template (using Streamlit pattern)"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Load all campaigns (Streamlit pattern)
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        campaign = campaigns[campaign_id]
        
        # Check if template exists
        if not campaign.get('template_data') and not campaign.get('template_file'):
            return jsonify({'success': False, 'message': 'No template uploaded'}), 400
        
        # Get template content
        template_content = campaign.get('template_data')
        
        # If no template_data, try loading from file (fallback for old campaigns)
        if not template_content and campaign.get('template_file'):
            template_content = get_template_file_content(campaign['template_file'], user_id)
            if isinstance(template_content, bytes):
                template_content = template_content.decode('utf-8')
        
        if not template_content:
            return jsonify({'success': False, 'message': 'Template content not found'}), 400
        
        # Inject tracking pixel
        tracker_url = get_tracker_url()
        updated_template = inject_tracking_pixel(template_content, campaign['name'], tracker_url)
        updated_template = normalize_tracker_urls(updated_template)
        
        # Store updated template DIRECTLY in campaign (Streamlit pattern)
        campaign['template_data'] = updated_template
        
        # Save all campaigns
        save_json(CAMPAIGNS_FILE, campaigns, user_id)
        
        return jsonify({'success': True, 'message': 'Tracking pixel injected'})
        
    except Exception as e:
        print(f"Error injecting tracking: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/leads', methods=['GET'])
def get_leads():
    """Get all lead files for current user"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        lead_files = get_lead_files(user_id)
        
        # Clean any MongoDB ObjectIds before returning
        clean_leads = clean_mongo_doc(lead_files)
        
        return jsonify({'success': True, 'leads': clean_leads})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/templates', methods=['GET'])
def get_templates():
    """Get all template files for current user"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        template_files = get_template_files(user_id)
        
        # Clean any MongoDB ObjectIds before returning
        clean_templates = clean_mongo_doc(template_files)
        
        return jsonify({'success': True, 'templates': clean_templates})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# ANALYTICS ENDPOINTS
# ============================================

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    """Get overall analytics"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        total_sent = sum(c.get('stats', {}).get('total_sent', 0) for c in campaigns.values())
        total_failed = sum(c.get('stats', {}).get('total_failed', 0) for c in campaigns.values())
        total_leads = sum(c.get('stats', {}).get('total_leads', 0) for c in campaigns.values())
        
        return jsonify({
            'success': True,
            'stats': {
                'total_sent': total_sent,
                'total_failed': total_failed,
                'total_leads': total_leads,
                'total_campaigns': len(campaigns)
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/analytics/campaigns/<campaign_id>', methods=['GET'])
def get_campaign_analytics(campaign_id):
    """Get campaign-specific analytics"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        campaign = campaigns[campaign_id]
        
        return jsonify({
            'success': True,
            'stats': campaign.get('stats', {})
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/analytics/logs', methods=['GET'])
def get_email_logs_endpoint():
    """Get email logs from MongoDB"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        campaign_id = request.args.get('campaign_id')
        limit = int(request.args.get('limit', 100))
        
        # Get logs from MongoDB
        from mongo_utils import get_recent_email_logs
        logs = get_recent_email_logs(user_id=user_id, limit=limit)
        
        # Filter by campaign if specified
        if campaign_id:
            logs = [log for log in logs if log.get('campaign_id') == campaign_id]
        
        return jsonify({'success': True, 'logs': clean_mongo_doc(logs)})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/campaigns/<campaign_id>/logs', methods=['GET'])
def get_campaign_live_logs(campaign_id):
    """Get real-time live logs for a campaign"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        # Verify campaign belongs to user
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        limit = int(request.args.get('limit', 100))
        logs = get_campaign_logs(campaign_id, limit)
        
        return jsonify({'success': True, 'logs': logs})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# BACKGROUND EMAIL WORKER
# ============================================

def process_running_campaigns():
    """Background worker that processes running campaigns and sends emails"""
    global worker_running
    
    print("=" * 60)
    print("📧 Email worker started - checking for running campaigns...")
    print("=" * 60)
    
    while worker_running:
        try:
            # Get all users from database
            db = get_database()
            if db is None:
                print("⚠️  MongoDB not connected, retrying in 10s...")
                time.sleep(10)
                continue
            
            users_collection = db[USERS_FILE]
            all_users = list(users_collection.find({}, {'user_id': 1, '_id': 0}))
            
            if not all_users:
                print("ℹ️  No users found, waiting...")
                time.sleep(30)
                continue
            
            running_campaigns_found = 0
            
            for user_doc in all_users:
                user_id = user_doc.get('user_id')
                if not user_id:
                    continue
                
                try:
                    # Load campaigns for this user
                    campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
                    
                    if not campaigns:
                        continue
                    
                    print(f"  📦 Found {len(campaigns)} campaigns for user {user_id}")
                    
                    for campaign_id, campaign in campaigns.items():
                        campaign_status = campaign.get('status', 'draft')
                        campaign_name = campaign.get('name', campaign_id)
                        
                        if campaign_status != 'running':
                            print(f"  ⏸️  Campaign {campaign_name} status: {campaign_status} (skipping)")
                            continue
                        
                        running_campaigns_found += 1
                        print(f"🔄 Found running campaign: {campaign_name} (ID: {campaign_id})")
                        
                        # Reload campaign from DB to get latest data (in case it was updated)
                        try:
                            fresh_campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
                            if campaign_id in fresh_campaigns:
                                fresh_campaign = fresh_campaigns[campaign_id]
                                # Only process if still running
                                if fresh_campaign.get('status') == 'running':
                                    print(f"   ✓ Campaign still running, processing...")
                                    process_campaign_emails(campaign_id, fresh_campaign, user_id)
                                else:
                                    print(f"   ⏸️  Campaign status changed to '{fresh_campaign.get('status')}', skipping")
                            else:
                                print(f"   ❌ Campaign not found in fresh data, skipping")
                        except Exception as e:
                            print(f"   ❌ Error reloading campaign: {e}, using cached data")
                            process_campaign_emails(campaign_id, campaign, user_id)
                        
                except Exception as e:
                    print(f"❌ Error processing campaigns for user {user_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            if running_campaigns_found == 0:
                print("ℹ️  No running campaigns found, checking again in 10s...")
            
            # Sleep for 10 seconds before next check (faster response)
            time.sleep(10)
            
        except Exception as e:
            print(f"❌ Error in email worker: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(30)

def process_campaign_emails(campaign_id, campaign, user_id, force_immediate=False):
    """Process and send emails for a running campaign"""
    try:
        # Reload campaign to get fresh status (in case it was paused)
        fresh_campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        if campaign_id not in fresh_campaigns:
            print(f"  ❌ Campaign {campaign_id} not found")
            return
        
        fresh_campaign_status = fresh_campaigns[campaign_id].get('status')
        if fresh_campaign_status != 'running':
            print(f"  ⏸️  Campaign {campaign_id} status is '{fresh_campaign_status}', not 'running'. Stopping processing.")
            add_log(campaign_id, 'warning', f'Campaign paused or stopped. Status: {fresh_campaign_status}')
            return
        
        # Update campaign with fresh data
        campaign = fresh_campaigns[campaign_id]
        campaign_name = campaign.get('name', campaign_id)
        print(f"  📋 Processing campaign: {campaign_name} (force_immediate={force_immediate})")
        
        # Check if campaign has required data
        if not campaign.get('leads_data') and not campaign.get('leads_file'):
            msg = f'Campaign {campaign_name} has no leads data'
            print(f"  ⚠️  {msg}")
            add_log(campaign_id, 'error', msg)
            return
        
        if not campaign.get('template_data') and not campaign.get('template_file'):
            msg = f'Campaign {campaign_name} has no template data'
            print(f"  ⚠️  {msg}")
            add_log(campaign_id, 'error', msg)
            return
        
        if not campaign.get('selected_senders'):
            msg = f'Campaign {campaign_name} has no selected senders'
            print(f"  ⚠️  {msg}")
            add_log(campaign_id, 'error', msg)
            return
        
        # Load history - ensure it's initialized for new campaigns
        history = load_json(HISTORY_FILE, {}, user_id)
        if campaign_id not in history:
            print(f"  📝 Initializing history for campaign {campaign_name} (ID: {campaign_id})")
            history[campaign_id] = {
                'sent': [],
                'failed': [],
                'processing': [],
                'processing_timestamps': {},
                'daily_sent_tracking': {}
            }
            save_json(HISTORY_FILE, history, user_id)
        
        campaign_history = history[campaign_id]
        
        # Ensure daily_sent_tracking structure exists
        if 'daily_sent_tracking' not in campaign_history:
            campaign_history['daily_sent_tracking'] = {}
            save_json(HISTORY_FILE, history, user_id)
        
        # Check scheduling - force immediate if requested (from start button)
        if force_immediate:
            print(f"  🚀 FORCE IMMEDIATE: Processing campaign {campaign_name} immediately (bypassing schedule)")
            should_process = True
        else:
            should_process = should_process_campaign_now(campaign, campaign_history)
            
            # Override: If campaign just started and has no strict schedule, process immediately
            if not should_process:
                # Check if it's just a time-based schedule (not strict schedule_enabled)
                if not campaign.get('schedule_enabled') and not campaign.get('scheduled_date'):
                    # If just schedule_time exists but schedule_enabled is false, process immediately
                    should_process = True
                    print(f"  🚀 Overriding schedule check - processing campaign {campaign_name} immediately")
        
        if not should_process:
            schedule_reason = ""
            if campaign.get('schedule_enabled'):
                schedule_reason = f"waiting for schedule time {campaign.get('schedule_time', '10:00')}"
            elif campaign.get('scheduled_date'):
                schedule_reason = f"waiting for scheduled date {campaign.get('scheduled_date')}"
            print(f"  ⏰ Campaign {campaign_name} {schedule_reason}, skipping for now")
            return
        
        print(f"  ✓ Campaign {campaign_name} ready to process now")
        
        # Load leads
        if campaign.get('leads_data'):
            df = pd.read_csv(io.StringIO(campaign['leads_data']))
        else:
            from mongo_utils import get_lead_file_content
            lead_content = get_lead_file_content(campaign['leads_file'], user_id)
            if not lead_content:
                return
            df = pd.read_csv(io.BytesIO(lead_content))
        
        # Load template
        if campaign.get('template_data'):
            html_template = campaign['template_data']
        else:
            from mongo_utils import get_template_file_content
            template_content = get_template_file_content(campaign['template_file'], user_id)
            if not template_content:
                return
            if isinstance(template_content, bytes):
                html_template = template_content.decode('utf-8')
            else:
                html_template = template_content
        
        # Get senders
        senders = load_json(SENDER_FILE, [], user_id)
        smtp_senders = get_smtp_senders(user_id)
        all_senders = senders + smtp_senders
        
        selected_senders = [s for s in all_senders if s.get('email') in campaign.get('selected_senders', [])]
        
        if not selected_senders:
            print(f"  ⚠️  No matching senders found for campaign {campaign_name}")
            print(f"  Selected senders in campaign: {campaign.get('selected_senders', [])}")
            print(f"  Available senders: {[s.get('email') for s in all_senders]}")
            return
        
        print(f"  ✓ Found {len(selected_senders)} senders for campaign {campaign_name}")
        
        # Get unprocessed emails
        sent_emails = set(campaign_history.get('sent', []))
        failed_emails = set(campaign_history.get('failed', []))
        processing_emails = set(campaign_history.get('processing', []))
        
        # Clean old processing emails (older than 1 hour)
        if 'processing_timestamps' in campaign_history:
            current_time = datetime.now()
            valid_processing = {}
            for email, timestamp_str in campaign_history['processing_timestamps'].items():
                try:
                    timestamp = datetime.fromisoformat(timestamp_str)
                    if (current_time - timestamp).total_seconds() < 3600:
                        valid_processing[email] = timestamp_str
                    else:
                        processing_emails.discard(email)
                except:
                    pass
            campaign_history['processing_timestamps'] = valid_processing
        
        blacklisted_emails = sent_emails | failed_emails | processing_emails
        
        # Check daily limit
        today = date.today().isoformat()
        if 'daily_sent_tracking' not in campaign_history:
            campaign_history['daily_sent_tracking'] = {}
        if today not in campaign_history['daily_sent_tracking']:
            campaign_history['daily_sent_tracking'][today] = 0
        
        daily_sent = campaign_history['daily_sent_tracking'][today]
        daily_limit = campaign.get('daily_limit', 120)
        
        if daily_sent >= daily_limit:
            msg = f'Daily limit reached for {campaign_name}: {daily_sent}/{daily_limit}'
            print(f"  📊 {msg}")
            add_log(campaign_id, 'warning', msg)
            return  # Daily limit reached
        
        print(f"  📊 Daily progress for {campaign_name}: {daily_sent}/{daily_limit} emails sent today")
        
        # Get unprocessed emails (normalize emails for comparison)
        unprocessed_emails = []
        blacklisted_lower = {e.lower().strip() for e in blacklisted_emails if e}
        for idx, row in df.iterrows():
            email = row.get('Emails') or row.get('Email') or row.get('email')
            if email and email.strip():
                email_normalized = email.strip().lower()
                if email_normalized not in blacklisted_lower:
                    unprocessed_emails.append((idx, row))
        
        if not unprocessed_emails:
            msg = f'✅ All emails processed for campaign {campaign_name}. Campaign completed!'
            print(f"  {msg}")
            add_log(campaign_id, 'success', msg, {'status': 'campaign_completed', 'reason': 'all_emails_processed'})
            
            # Update campaign status to 'completed'
            campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in campaigns:
                campaigns[campaign_id]['status'] = 'completed'
                save_json(CAMPAIGNS_FILE, campaigns, user_id)
                print(f"  ✅ Updated campaign status to 'completed' for campaign {campaign_id}")
                print(f"  ✅ Verification: Campaign status is now: {campaigns[campaign_id].get('status')}")
            
            return  # All emails processed
        
        print(f"  📧 Found {len(unprocessed_emails)} unprocessed emails for campaign {campaign_name}")
        
        # Process emails in batches (EXACTLY like Streamlit - lines 1346-1354)
        batch_size = len(selected_senders)  # One email per sender per batch (EXACTLY like Streamlit)
        delay_sec = campaign.get('delay', 30)
        total_batches = (len(unprocessed_emails) + batch_size - 1) // batch_size
        
        print(f"  📊 Batch Configuration: {batch_size} emails per batch (one per sender), {delay_sec}s pause between batches")
        print(f"  🚀 Processing {len(unprocessed_emails)} emails in {total_batches} batches of {batch_size} emails each")
        add_log(campaign_id, 'info', f'🚀 Starting to send {len(unprocessed_emails)} emails in {total_batches} batches')
        
        batch_sent = 0
        
        for batch_num in range(total_batches):
            # Check campaign status - stop if paused
            fresh_campaigns_check = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in fresh_campaigns_check:
                current_status = fresh_campaigns_check[campaign_id].get('status')
                if current_status != 'running':
                    msg = f'⏸️  Campaign {campaign_name} was paused. Stopping email processing.'
                    print(f"  {msg}")
                    add_log(campaign_id, 'warning', msg)
                    break
            
            # Check daily limit (EXACTLY like Streamlit - lines 1354-1358)
            if daily_sent + batch_sent >= daily_limit:
                msg = f'Daily limit reached ({daily_limit} emails). Stopping for today.'
                print(f"  📊 {msg}")
                add_log(campaign_id, 'warning', msg)
                break
            
            # Get batch of emails (EXACTLY like Streamlit - lines 1360-1366)
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, len(unprocessed_emails))
            batch_emails = unprocessed_emails[start_idx:end_idx]
            
            if not batch_emails:
                break
            
            print(f"  📦 Processing batch {batch_num + 1}/{total_batches} ({len(batch_emails)} emails)")
            
            # Prepare batch
            batch_recipients = []
            batch_personalized_templates = {}
            batch_sender_names = {}
            
            for idx, row in batch_emails:
                # Get email (EXACTLY like Streamlit - line 1376: email = row['Emails'])
                email = row.get('Emails') or row.get('Email') or row.get('email')
                if not email:
                    continue
                
                # Mark as processing (EXACTLY like Streamlit - lines 1378-1382)
                processing_emails.add(email)
                if 'processing_timestamps' not in campaign_history:
                    campaign_history['processing_timestamps'] = {}
                campaign_history['processing_timestamps'][email] = datetime.now().isoformat()
                
                # Personalize template for this specific recipient (EXACTLY like Streamlit - lines 1384-1389)
                # Enhanced to handle multiple column name variations for tracking
                personalized_template = html_template
                
                # First, collect all column values
                column_values = {}
                for column in row.index:
                    column_value = str(row[column]) if pd.notna(row[column]) else ''
                    column_values[column.lower()] = column_value
                
                # Replace all placeholders
                for column in row.index:
                    column_value = column_values[column.lower()]
                    
                    # Replace exact column name placeholder
                    placeholder = f"{{{{{column}}}}}"
                    if placeholder in personalized_template:
                        personalized_template = personalized_template.replace(placeholder, column_value)
                    
                    # Also handle common variations for tracking pixel placeholders
                    # This ensures tracking works even if CSV uses different column names
                    column_lower = column.lower()
                    
                    # Email variations: Emails, Email, email
                    if column_lower in ['emails', 'email']:
                        for email_placeholder in ['{{{{Emails}}}}', '{{{{Email}}}}', '{{{{email}}}}']:
                            if email_placeholder in personalized_template:
                                # URL encode email for tracking URL
                                encoded_email = urllib.parse.quote(column_value)
                                personalized_template = personalized_template.replace(email_placeholder, encoded_email)
                    
                    # Name variations: Name, name
                    if column_lower == 'name':
                        for name_placeholder in ['{{{{Name}}}}', '{{{{name}}}}']:
                            if name_placeholder in personalized_template:
                                # URL encode name for tracking URL
                                encoded_name = urllib.parse.quote(column_value)
                                personalized_template = personalized_template.replace(name_placeholder, encoded_name)
                    
                    # Instagram/Social Medias variations: Instagram, instagram, Social Medias, social medias
                    if column_lower in ['instagram', 'social medias', 'socialmedias']:
                        for insta_placeholder in ['{{{{Instagram}}}}', '{{{{instagram}}}}', '{{{{Social Medias}}}}', '{{{{social medias}}}}', '{{{{SocialMedias}}}}']:
                            if insta_placeholder in personalized_template:
                                # URL encode instagram/social medias for tracking URL
                                encoded_instagram = urllib.parse.quote(column_value)
                                personalized_template = personalized_template.replace(insta_placeholder, encoded_instagram)
                
                # Replace any remaining tracking placeholders with empty strings (fallback)
                # This ensures tracking URLs are valid even if CSV doesn't have Name/Instagram columns
                remaining_placeholders = {
                    '{{{{Emails}}}}': urllib.parse.quote(email),
                    '{{{{Email}}}}': urllib.parse.quote(email),
                    '{{{{email}}}}': urllib.parse.quote(email),
                    '{{{{Name}}}}': '',
                    '{{{{name}}}}': '',
                    '{{{{Instagram}}}}': '',
                    '{{{{instagram}}}}': '',
                    '{{{{Social Medias}}}}': '',
                    '{{{{social medias}}}}': '',
                    '{{{{SocialMedias}}}}': ''
                }
                for placeholder, default_value in remaining_placeholders.items():
                    if placeholder in personalized_template:
                        personalized_template = personalized_template.replace(placeholder, default_value)
                
                # Debug: Verify tracking pixel is personalized (only log first email to avoid spam)
                if idx == 0 and 'track/open?email=' in personalized_template:
                    # Extract tracking URL to verify
                    track_match = re.search(r'track/open\?email=([^&"\'<>]+)', personalized_template)
                    if track_match:
                        track_url = track_match.group(1)
                        print(f"  ✅ Tracking pixel personalized for {email}: email={track_url[:50]}...")
                    else:
                        print(f"  ⚠️  WARNING: Tracking pixel found but URL format unexpected for {email}")
                
                personalized_template = normalize_tracker_urls(personalized_template)

                batch_recipients.append(email)
                batch_personalized_templates[email] = personalized_template
                
                # Add sender name if available (EXACTLY like Streamlit - lines 1394-1396)
                name_col = None
                for col in row.index:
                    if col.lower() == 'name':
                        name_col = col
                        break
                if name_col:
                    batch_sender_names[email] = str(row[name_col])
            
            # Send batch (EXACTLY like Streamlit - lines 1401-1412)
            subject_line = campaign.get('subject_line', 'Your Subject Here')
            campaign_name = campaign.get('name', 'Unknown Campaign')
            
            print(f"  🚀 Sending batch {batch_num + 1} of {len(batch_recipients)} emails simultaneously for campaign {campaign_name}...")
            
            batch_results = send_batch_emails(
                selected_senders, 
                batch_recipients, 
                subject_line, 
                html_template,  # Fallback template (EXACTLY like Streamlit)
                batch_sender_names,
                campaign_name,
                campaign_id,
                user_id,
                batch_personalized_templates  # Pass personalized templates (EXACTLY like Streamlit)
            )
            
            # Process results (EXACTLY like Streamlit - lines 1414-1437)
            for email in batch_recipients:
                processing_emails.discard(email)
                if 'processing_timestamps' in campaign_history and email in campaign_history['processing_timestamps']:
                    del campaign_history['processing_timestamps'][email]
            
            # Update status based on results (EXACTLY like Streamlit - lines 1420-1429)
            batch_sent_count = 0
            batch_failed_count = 0
            
            for email in batch_results['sent']:
                sent_emails.add(email)
                batch_sent += 1
                batch_sent_count += 1
                campaign_history['daily_sent_tracking'][today] += 1
                daily_sent += 1  # Update local counter
                print(f"    ✅ Sent to {email}")
            
            for email in batch_results['failed']:
                failed_emails.add(email)
                batch_failed_count += 1
                # Try to find the specific error message for this email
                error_msg = 'Unknown error'
                if 'errors' in batch_results:
                    for err in batch_results['errors']:
                        if email in err:
                            error_msg = err
                            break
                print(f"    ❌ FAILED to send to {email}: {error_msg}")
                add_log(campaign_id, 'error', f'❌ Failed to send to {email}: {error_msg}')
            
            # Log batch completion summary
            add_log(campaign_id, 'success', f'✅ Batch {batch_num + 1}/{total_batches} completed: {batch_sent_count} sent, {batch_failed_count} failed')
            
            # Update history (EXACTLY like Streamlit - lines 1431-1437)
            campaign_history.update({
                'sent': list(sent_emails),
                'failed': list(failed_emails),
                'processing': list(processing_emails)
            })
            save_json(HISTORY_FILE, history, user_id)
            
            # Update campaign stats (EXACTLY like Streamlit - lines 1439-1442)
            campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in campaigns:
                if 'stats' not in campaigns[campaign_id]:
                    campaigns[campaign_id]['stats'] = {}
                campaigns[campaign_id]['stats']['total_sent'] = len(sent_emails)
                campaigns[campaign_id]['stats']['total_failed'] = len(failed_emails)
                save_json(CAMPAIGNS_FILE, campaigns, user_id)
            
            # Check if all emails are now processed after this batch
            total_valid_emails = 0
            for idx, row in df.iterrows():
                email = row.get('Emails') or row.get('Email') or row.get('email')
                if email and email.strip():
                    total_valid_emails += 1
            
            sent_normalized = {e.lower().strip() for e in sent_emails if e}
            failed_normalized = {e.lower().strip() for e in failed_emails if e}
            processed_total = len(sent_normalized) + len(failed_normalized)
            remaining_after_batch = total_valid_emails - processed_total
            
            print(f"  📊 After batch {batch_num + 1}: Total valid emails: {total_valid_emails}, Processed: {processed_total}, Remaining: {remaining_after_batch}")
            
            if remaining_after_batch <= 0:
                print(f"  ✅ All emails processed after batch {batch_num + 1}! Updating status to 'completed'")
                campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
                if campaign_id in campaigns:
                    campaigns[campaign_id]['status'] = 'completed'
                    save_json(CAMPAIGNS_FILE, campaigns, user_id)
                    print(f"  ✅ Campaign status updated to 'completed' (processed: {processed_total}/{total_valid_emails}, remaining: {remaining_after_batch})")
            
            # Reload daily_sent after updating (to get fresh count)
            daily_sent = campaign_history['daily_sent_tracking'][today]
            
            # Check campaign status again before delay - stop if paused
            fresh_campaigns_check = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in fresh_campaigns_check:
                current_status = fresh_campaigns_check[campaign_id].get('status')
                if current_status != 'running':
                    msg = f'⏸️  Campaign {campaign_name} was paused. Stopping email processing.'
                    print(f"  {msg}")
                    add_log(campaign_id, 'warning', msg)
                    break
            
            # Pause between batches (EXACTLY like Streamlit - lines 1444-1447)
            if batch_num < total_batches - 1:
                print(f"  ⏸️  Pausing for {delay_sec} seconds before next batch...")
                # Check status periodically during delay to break immediately if paused
                for _ in range(delay_sec):
                    time.sleep(1)
                    # Check every second if campaign was paused
                    fresh_check = load_json(CAMPAIGNS_FILE, {}, user_id)
                    if campaign_id in fresh_check:
                        current_status = fresh_check[campaign_id].get('status')
                        if current_status != 'running':
                            msg = f'⏸️  Campaign {campaign_name} was paused during delay. Stopping immediately.'
                            print(f"  {msg}")
                            add_log(campaign_id, 'warning', msg)
                            return  # Exit the function entirely
        
        # Check completion status and add final log
        daily_sent = campaign_history['daily_sent_tracking'][today]
        
        # Reload history to get latest counts after batch processing
        history = load_json(HISTORY_FILE, {}, user_id)
        if campaign_id in history:
            campaign_history = history[campaign_id]
            sent_emails = set(campaign_history.get('sent', []))
            failed_emails = set(campaign_history.get('failed', []))
            processing_emails = set(campaign_history.get('processing', []))
        
        # Normalize email addresses for accurate comparison
        sent_emails_normalized = {e.lower().strip() for e in sent_emails if e}
        failed_emails_normalized = {e.lower().strip() for e in failed_emails if e}
        
        # Get all valid emails from CSV (not empty) and normalize
        valid_emails_in_csv = set()
        for idx, row in df.iterrows():
            email = row.get('Emails') or row.get('Email') or row.get('email')
            if email and email.strip():
                valid_emails_in_csv.add(email.strip().lower())
        
        # Calculate remaining unprocessed emails correctly
        processed_count = len(sent_emails_normalized) + len(failed_emails_normalized)
        remaining_emails = len(valid_emails_in_csv) - processed_count
        
        print(f"  📊 Completion Check: Total valid emails in CSV: {len(valid_emails_in_csv)}, Processed: {processed_count} (sent: {len(sent_emails_normalized)}, failed: {len(failed_emails_normalized)}), Remaining: {remaining_emails}")
        
        if daily_sent >= daily_limit:
            msg = f'⏸️ Daily limit reached! Sent {daily_sent}/{daily_limit} emails today. Campaign paused until tomorrow.'
            print(f"  {msg}")
            add_log(campaign_id, 'warning', msg, {'status': 'daily_limit_reached', 'daily_sent': daily_sent, 'daily_limit': daily_limit})
            
            # Update campaign status to 'paused' when daily limit is reached
            campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in campaigns and campaigns[campaign_id].get('status') == 'running':
                campaigns[campaign_id]['status'] = 'paused'
                save_json(CAMPAIGNS_FILE, campaigns, user_id)
                print(f"  ✅ Updated campaign status to 'paused' (daily limit reached)")
        elif remaining_emails <= 0:
            msg = f'🎉 Campaign completed! Total sent: {len(sent_emails)}, Failed: {len(failed_emails)}, Remaining: {remaining_emails}'
            print(f"  {msg}")
            add_log(campaign_id, 'success', msg, {'status': 'campaign_completed', 'total_sent': len(sent_emails), 'total_failed': len(failed_emails)})
            
            # Update campaign status to 'completed'
            campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
            if campaign_id in campaigns:
                campaigns[campaign_id]['status'] = 'completed'
                save_json(CAMPAIGNS_FILE, campaigns, user_id)
                print(f"  ✅ Updated campaign status to 'completed' for campaign {campaign_id}")
                print(f"  ✅ Campaign status is now: {campaigns[campaign_id]['status']}")
        elif batch_sent > 0:
            msg = f'📊 Progress update: Sent {batch_sent} emails in this cycle. Daily total: {daily_sent}/{daily_limit}. Remaining: {max(0, remaining_emails)}'
            print(f"  {msg}")
            add_log(campaign_id, 'info', msg)
        else:
            msg = f'📊 No new emails sent (daily limit reached or all emails processed)'
            print(f"  {msg}")
            add_log(campaign_id, 'info', msg)
        
    except Exception as e:
        print(f"  ❌ Error processing campaign {campaign_id}: {e}")
        import traceback
        traceback.print_exc()

def should_process_campaign_now(campaign, campaign_history):
    """Check if campaign should be processed based on scheduling"""
    current_datetime = datetime.now()
    current_time = current_datetime.time()
    
    # If campaign was just started (status is 'running'), prioritize immediate processing
    # unless there's a strict schedule
    
    # Check daily schedule (strict - only process at scheduled time)
    if campaign.get('schedule_enabled'):
        try:
            schedule_time = datetime.strptime(campaign.get('schedule_time', '10:00'), "%H:%M").time()
        except:
            schedule_time = datetime.strptime('10:00', "%H:%M").time()
        
        # Allow processing if current time is at or past schedule time
        if current_time >= schedule_time:
            # Check if already processed today
            today = date.today().isoformat()
            daily_sent = campaign_history.get('daily_sent_tracking', {}).get(today, 0)
            if daily_sent >= campaign.get('daily_limit', 120):
                return False
            return True
        else:
            # Before schedule time - but if no emails sent today, allow processing
            today = date.today().isoformat()
            daily_sent = campaign_history.get('daily_sent_tracking', {}).get(today, 0)
            if daily_sent == 0:
                # No emails sent today yet - allow immediate start even before schedule
                return True
            return False
    
    # Check start immediate + daily
    elif campaign.get('start_immediate_daily'):
        today = date.today().isoformat()
        daily_sent = campaign_history.get('daily_sent_tracking', {}).get(today, 0)
        
        if daily_sent == 0:
            return True  # First run today - always process
        
        try:
            schedule_time = datetime.strptime(campaign.get('schedule_time', '10:00'), "%H:%M").time()
        except:
            schedule_time = datetime.strptime('10:00', "%H:%M").time()
        
        if current_time >= schedule_time:
            if daily_sent < campaign.get('daily_limit', 120):
                return True
        
        return False
    
    # Check scheduled date
    elif campaign.get('scheduled_date'):
        try:
            scheduled_datetime = datetime.strptime(
                f"{campaign['scheduled_date']} {campaign.get('schedule_time', '10:00')}",
                "%Y-%m-%d %H:%M"
            )
        except:
            return False
        
        if current_datetime >= scheduled_datetime:
            return True
        return False
    
    # Start immediately (default) - no schedule restrictions
    else:
        return True

def start_email_worker():
    """Start the background email worker thread"""
    global worker_running, worker_thread
    
    if worker_running:
        print("⚠️  Email worker already running")
        return
    
    worker_running = True
    worker_thread = threading.Thread(target=process_running_campaigns, daemon=True)
    worker_thread.start()
    print("=" * 60)
    print("✅ Background email worker started successfully")
    print("=" * 60)

def stop_email_worker():
    """Stop the background email worker thread"""
    global worker_running
    
    worker_running = False
    if worker_thread:
        worker_thread.join(timeout=5)
    print("⏹️ Background email worker stopped")

# ============================================
# MANUAL TRIGGER ENDPOINT (for testing)
# ============================================

@app.route('/api/campaigns/<campaign_id>/process', methods=['POST'])
def manual_process_campaign(campaign_id):
    """Manually trigger email processing for a campaign (for testing/debugging)"""
    try:
        user_id = get_user_id_from_header()
        if not user_id:
            return jsonify({'success': False, 'message': 'User ID required'}), 401
        
        campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
        
        if campaign_id not in campaigns:
            return jsonify({'success': False, 'message': 'Campaign not found'}), 404
        
        campaign = campaigns[campaign_id]
        
        if campaign.get('status') != 'running':
            return jsonify({'success': False, 'message': 'Campaign is not running'}), 400
        
        # Process immediately in background
        def process_now():
            try:
                print(f"🔧 MANUAL TRIGGER: Processing campaign {campaign.get('name', campaign_id)}")
                process_campaign_emails(campaign_id, campaign, user_id, force_immediate=True)
            except Exception as e:
                print(f"Error in manual processing: {e}")
                import traceback
                traceback.print_exc()
        
        thread = threading.Thread(target=process_now, daemon=True)
        thread.start()
        
        return jsonify({'success': True, 'message': 'Manual processing triggered'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ============================================
# HEALTH CHECK
# ============================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test MongoDB connection
        db = get_database()
        db.command('ping')
        
        return jsonify({
            'success': True,
            'status': 'healthy',
            'database': 'connected'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'status': 'unhealthy',
            'error': str(e)
        }), 500

# ============================================
# RUN SERVER
# ============================================

if __name__ == '__main__':
    port = int(os.getenv('API_PORT', 7027))
    debug = os.getenv('DEBUG', 'False').lower() == 'true'
    tracker_url = get_tracker_url()
    
    print(f"🚀 Starting API Server on http://localhost:{port}")
    print(f"📊 Debug mode: {debug}")
    print(f"🔗 CORS enabled for frontend")
    print(f"📡 Tracker URL: {tracker_url}")
    print(f"💾 MongoDB connection: {os.getenv('MONGO_URI', 'Not configured')}")
    
    # Start background email worker
    start_email_worker()
    
    app.run(host='0.0.0.0', port=port, debug=debug)

