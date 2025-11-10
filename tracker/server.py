#!/usr/bin/env python3
"""
Email Tracker - Python Flask Version
A sophisticated email tracking service with open and click tracking capabilities, powered by MongoDB.
"""

from flask import Flask, request, send_file, jsonify, redirect
from flask_cors import CORS
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import os
from datetime import datetime
from dotenv import load_dotenv
import logging
import requests
import threading
import time

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# MongoDB connection
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/email_tracker')
DB_NAME = 'email_tracker'
COLLECTION_NAME = 'email_tracking'

# Bulk email automation database connection
BULK_EMAIL_DB_NAME = os.getenv('DB_NAME', 'bulk_email_automation')
CAMPAIGNS_COLLECTION = 'campaigns'

# Global database connection
db = None
client = None

def keep_alive_ping():
    """Keep the tracker app alive by pinging itself every 5 minutes"""
    while True:
        try:
            # Get the app URL from environment variable (set by Render)
            app_url = os.getenv('RENDER_APP_URL')
            if app_url:
                response = requests.get(f"{app_url}/health", timeout=10)
                if response.status_code == 200:
                    logger.info(f"✅ Tracker keep-alive ping successful: {datetime.now()}")
                else:
                    logger.warning(f"⚠️ Tracker keep-alive ping returned status {response.status_code}")
            else:
                logger.warning("⚠️ RENDER_APP_URL not set, skipping keep-alive ping")
        except Exception as e:
            logger.error(f"❌ Tracker keep-alive ping failed: {e}")
        
        # Wait 5 minutes (300 seconds)
        time.sleep(300)

def start_keep_alive():
    """Start the keep-alive thread"""
    keep_alive_thread = threading.Thread(target=keep_alive_ping, daemon=True)
    keep_alive_thread.start()
    logger.info("🔄 Tracker keep-alive thread started")

def connect_to_mongodb():
    """Connect to MongoDB with error handling"""
    global db, client
    
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        db = client[DB_NAME]
        
        # Create collection if it doesn't exist
        if COLLECTION_NAME not in db.list_collection_names():
            db.create_collection(COLLECTION_NAME)
        
        # Create indexes for better performance
        db[COLLECTION_NAME].create_index([("email", 1), ("type", 1)])
        db[COLLECTION_NAME].create_index([("campaign_name", 1), ("type", 1)])
        db[COLLECTION_NAME].create_index([("email", 1), ("campaign_name", 1), ("type", 1)])
        db[COLLECTION_NAME].create_index([("timestamp", -1)])
        
        logger.info("✅ Connected to MongoDB successfully")
        logger.info("✅ MongoDB collection and indexes created")
        return True
        
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"❌ MongoDB connection failed: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Unexpected error connecting to MongoDB: {e}")
        return False

# Initialize MongoDB connection
if not connect_to_mongodb():
    logger.error("❌ Failed to connect to MongoDB. Exiting.")
    exit(1)

@app.route('/track/open')
def track_open():
    """1️⃣ Serve tracking pixel — with open_count logic"""
    try:
        email = request.args.get('email')
        campaign_name = request.args.get('uid')  # Now using campaign name as UID
        name = request.args.get('name', '')
        instagram = request.args.get('instagram', '')
        
        logger.info(f"🔍 Tracking open request - Email: {email}, Campaign: {campaign_name}, Name: {name}")
        
        if not email or not campaign_name:
            logger.warning("Missing email or campaign name parameters")
            return send_file('pixel.png', mimetype='image/png')
        
        # Verify MongoDB connection is still alive
        try:
            client.admin.command('ping')
            logger.info("✅ MongoDB connection verified")
        except Exception as e:
            logger.error(f"❌ MongoDB connection lost: {e}")
            # Try to reconnect
            if not connect_to_mongodb():
                logger.error("❌ Failed to reconnect to MongoDB")
                return send_file('pixel.png', mimetype='image/png')
        
        # Check if there's already an open record for this email and campaign
        try:
            existing_record = db[COLLECTION_NAME].find_one({
                'email': email,
                'campaign_name': campaign_name,
                'type': 'open'
            })
            
            if existing_record:
                logger.info(f"🔄 Found existing record for {email}, updating...")
                # Exists — increment open_count & update last_opened
                result = db[COLLECTION_NAME].update_one(
                    {'_id': existing_record['_id']},
                    {
                        '$set': {
                            'open_count': existing_record['open_count'] + 1,
                            'last_opened': datetime.now().isoformat(),
                            'ip': request.remote_addr,
                            'user_agent': request.headers.get('User-Agent', '')
                        }
                    }
                )
                
                if result.modified_count > 0:
                    logger.info(f"✅ Updated open_count for {email} (new count: {existing_record['open_count'] + 1})")
                else:
                    logger.error(f"❌ Update failed for {email}")
            else:
                logger.info(f"📝 No existing record for {email}, inserting new one...")
                # No row yet — insert new row
                now = datetime.now()
                new_record = {
                    'type': 'open',
                    'email': email,
                    'name': name,
                    'uid': campaign_name,  # Campaign name as UID
                    'instagram': instagram,
                    'campaign_name': campaign_name,
                    'open_count': 1,
                    'last_opened': now.isoformat(),
                    'time': now.strftime('%H:%M:%S'),
                    'date': now.strftime('%Y-%m-%d'),
                    'ip': request.remote_addr,
                    'user_agent': request.headers.get('User-Agent', ''),
                    'timestamp': now.isoformat()
                }
                
                logger.info(f"📝 Inserting record: {new_record}")
                result = db[COLLECTION_NAME].insert_one(new_record)
                
                if result.inserted_id:
                    logger.info(f"✅ Successfully inserted open tracking for {email} with ID: {result.inserted_id}")
                else:
                    logger.error(f"❌ Insert failed for {email}")
                    
        except Exception as db_error:
            logger.error(f"❌ Database operation failed: {db_error}")
            logger.error(f"❌ Error details: {type(db_error).__name__}: {str(db_error)}")
        
        return send_file('pixel.png', mimetype='image/png')
        
    except Exception as e:
        logger.error(f"❌ General error in track_open: {e}")
        logger.error(f"❌ Error type: {type(e).__name__}")
        logger.error(f"❌ Error details: {str(e)}")
        return send_file('pixel.png', mimetype='image/png')

@app.route('/track/click')
def track_click():
    """2️⃣ Click tracking + redirect (logs every click as new row)"""
    try:
        email = request.args.get('email')
        campaign_name = request.args.get('uid')  # Now using campaign name as UID
        redirect_url = request.args.get('redirect')
        name = request.args.get('name', '')
        instagram = request.args.get('instagram', '')
        
        logger.info(f"🔍 Tracking click request - Email: {email}, Campaign: {campaign_name}, Redirect: {redirect_url}")
        
        if not email or not campaign_name or not redirect_url:
            logger.warning("Missing email, campaign name, or redirect parameters")
            return redirect('https://example.com')
        
        # Verify MongoDB connection is still alive
        try:
            client.admin.command('ping')
            logger.info("✅ MongoDB connection verified")
        except Exception as e:
            logger.error(f"❌ MongoDB connection lost: {e}")
            # Try to reconnect
            if not connect_to_mongodb():
                logger.error("❌ Failed to reconnect to MongoDB")
                return redirect(redirect_url)
        
        try:
            now = datetime.now()
            new_record = {
                'type': 'click',
                'email': email,
                'name': name,
                'uid': campaign_name,  # Campaign name as UID
                'instagram': instagram,
                'campaign_name': campaign_name,
                'time': now.strftime('%H:%M:%S'),
                'date': now.strftime('%Y-%m-%d'),
                'ip': request.remote_addr,
                'user_agent': request.headers.get('User-Agent', ''),
                'redirect_url': redirect_url,
                'timestamp': now.isoformat()
            }
            
            logger.info(f"📝 Inserting click record: {new_record}")
            result = db[COLLECTION_NAME].insert_one(new_record)
            
            if result.inserted_id:
                logger.info(f"✅ Successfully logged click for {email} with ID: {result.inserted_id}")
            else:
                logger.error(f"❌ Click logging failed for {email}")
                
        except Exception as db_error:
            logger.error(f"❌ Database operation failed: {db_error}")
            logger.error(f"❌ Error details: {type(db_error).__name__}: {str(db_error)}")
        
        return redirect(redirect_url)
        
    except Exception as e:
        logger.error(f"❌ Error in track_click: {e}")
        logger.error(f"❌ Error type: {type(e).__name__}")
        logger.error(f"❌ Error details: {str(e)}")
        # Fallback redirect
        return redirect('https://example.com')

@app.route('/logs')
def get_logs():
    """3️⃣ Optional: view logs"""
    try:
        # Get all records sorted by timestamp (newest first)
        data = list(db[COLLECTION_NAME].find({}, {'_id': 0}).sort('timestamp', -1))
        
        return jsonify({
            'count': len(data),
            'data': data,
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving logs: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/campaigns')
def get_campaigns():
    """📊 Get all campaigns with their tracking data"""
    try:
        # Get distinct campaign names
        campaigns = db[COLLECTION_NAME].distinct('campaign_name')
        
        campaign_data = []
        for campaign_name in campaigns:
            if not campaign_name:  # Skip empty campaign names
                continue
                
            # Get opens for this campaign
            opens = list(db[COLLECTION_NAME].find({
                'campaign_name': campaign_name,
                'type': 'open'
            }, {'_id': 0}))
            
            # Get clicks for this campaign
            clicks = list(db[COLLECTION_NAME].find({
                'campaign_name': campaign_name,
                'type': 'click'
            }, {'_id': 0}))
            
            # Calculate stats
            total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
            unique_opens = len(opens)
            total_clicks = len(clicks)
            unique_emails = len(set(open_record['email'] for open_record in opens))
            
            campaign_data.append({
                'campaign_name': campaign_name,
                'total_opens': total_opens,
                'unique_opens': unique_opens,
                'total_clicks': total_clicks,
                'unique_emails': unique_emails,
                'open_rate': round((unique_opens / unique_emails * 100) if unique_emails > 0 else 0, 2),
                'click_rate': round((total_clicks / unique_emails * 100) if unique_emails > 0 else 0, 2),
                'opens': opens,
                'clicks': clicks
            })
        
        return jsonify({
            'campaigns': campaign_data,
            'total_campaigns': len(campaign_data),
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving campaigns: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/campaign/<campaign_name>')
def get_campaign_details(campaign_name):
    """📊 Get detailed tracking data for a specific campaign"""
    try:
        # Get opens for this campaign
        opens = list(db[COLLECTION_NAME].find({
            'campaign_name': campaign_name,
            'type': 'open'
        }, {'_id': 0}).sort('timestamp', -1))
        
        # Get clicks for this campaign
        clicks = list(db[COLLECTION_NAME].find({
            'campaign_name': campaign_name,
            'type': 'click'
        }, {'_id': 0}).sort('timestamp', -1))
        
        # Calculate stats
        total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
        unique_opens = len(opens)
        total_clicks = len(clicks)
        unique_emails = len(set(open_record['email'] for open_record in opens))
        
        # Get click-through rates by URL
        url_stats = {}
        for click in clicks:
            url = click.get('redirect_url', 'Unknown')
            if url not in url_stats:
                url_stats[url] = 0
            url_stats[url] += 1
        
        return jsonify({
            'campaign_name': campaign_name,
            'total_opens': total_opens,
            'unique_opens': unique_opens,
            'total_clicks': total_clicks,
            'unique_emails': unique_emails,
            'open_rate': round((unique_opens / unique_emails * 100) if unique_emails > 0 else 0, 2),
            'click_rate': round((total_clicks / unique_emails * 100) if unique_emails > 0 else 0, 2),
            'url_stats': url_stats,
            'opens': opens,
            'clicks': clicks,
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving campaign details: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/table')
def get_table_data():
    """📋 Get tracking data in table format with all requested fields"""
    try:
        # Get all open tracking records with the required fields
        records = list(db[COLLECTION_NAME].find({
            'type': 'open'
        }, {
            '_id': 0,
            'email': 1,
            'name': 1,
            'uid': 1,
            'instagram': 1,
            'time': 1,
            'date': 1,
            'open_count': 1,
            'last_opened': 1,
            'campaign_name': 1
        }).sort('timestamp', -1))
        
        # Format the data for table display
        table_data = []
        for record in records:
            table_data.append({
                'email': record.get('email', ''),
                'name': record.get('name', ''),
                'uid': record.get('uid', record.get('campaign_name', '')),
                'instagram': record.get('instagram', ''),
                'time': record.get('time', ''),
                'date': record.get('date', ''),
                'open_count': record.get('open_count', 0),
                'last_open': record.get('last_opened', '')
            })
        
        return jsonify({
            'data': table_data,
            'count': len(table_data),
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving table data: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/table/<campaign_name>')
def get_campaign_table_data(campaign_name):
    """📋 Get tracking data in table format for a specific campaign"""
    try:
        # Get open tracking records for specific campaign
        records = list(db[COLLECTION_NAME].find({
            'type': 'open',
            'campaign_name': campaign_name
        }, {
            '_id': 0,
            'email': 1,
            'name': 1,
            'uid': 1,
            'instagram': 1,
            'time': 1,
            'date': 1,
            'open_count': 1,
            'last_opened': 1,
            'campaign_name': 1
        }).sort('timestamp', -1))
        
        # Format the data for table display
        table_data = []
        for record in records:
            table_data.append({
                'email': record.get('email', ''),
                'name': record.get('name', ''),
                'uid': record.get('uid', record.get('campaign_name', '')),
                'instagram': record.get('instagram', ''),
                'time': record.get('time', ''),
                'date': record.get('date', ''),
                'open_count': record.get('open_count', 0),
                'last_open': record.get('last_opened', '')
            })
        
        return jsonify({
            'campaign_name': campaign_name,
            'data': table_data,
            'count': len(table_data),
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving campaign table data: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/health')
def health_check():
    """Health check endpoint"""
    try:
        # Test MongoDB connection
        client.admin.command('ping')
        
        # Test database operations
        test_collection = db[COLLECTION_NAME]
        test_count = test_collection.count_documents({})
        
        return jsonify({
            'status': 'healthy',
            'database': 'connected',
            'collection': COLLECTION_NAME,
            'total_records': test_count,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e),
            'error_type': type(e).__name__,
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/')
def index():
    """Root endpoint with basic info"""
    return jsonify({
        'service': 'Email Tracker - Python Version',
        'version': '1.0.0',
        'endpoints': {
            'open_tracking': '/track/open?email=<email>&uid=<campaign_name>&name=<name>&instagram=<instagram>',
            'click_tracking': '/track/click?email=<email>&uid=<campaign_name>&redirect=<url>&name=<name>&instagram=<instagram>',
            'analytics': '/logs',
            'campaigns': '/campaigns',
            'campaign_details': '/campaign/<campaign_name>',
            'table_data': '/table',
            'campaign_table': '/table/<campaign_name>',
            'user_campaigns': '/user/campaigns (requires X-User-ID header)',
            'user_table': '/user/table?campaign=<campaign_name> (requires X-User-ID header)',
            'health': '/health',
            'debug': '/debug'
        },
        'database': 'MongoDB',
        'status': 'running'
    })

@app.route('/debug')
def debug_info():
    """Debug endpoint to check database status"""
    try:
        # Test MongoDB connection
        client.admin.command('ping')
        
        # Get collection info
        collection = db[COLLECTION_NAME]
        total_records = collection.count_documents({})
        
        # Get sample records
        sample_records = list(collection.find({}, {'_id': 0}).limit(5))
        
        # Get distinct campaign names and emails
        campaign_names = collection.distinct('campaign_name')
        emails = collection.distinct('email')
        
        return jsonify({
            'status': 'connected',
            'database': DB_NAME,
            'collection': COLLECTION_NAME,
            'total_records': total_records,
            'distinct_campaigns': campaign_names,
            'distinct_emails': emails,
            'sample_records': sample_records,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'timestamp': datetime.now().isoformat()
        }), 500

def get_user_campaigns(user_id):
    """Get campaign names for a specific user from bulk email automation database"""
    try:
        # Connect to bulk email automation database
        bulk_email_db = client[BULK_EMAIL_DB_NAME]
        campaigns_collection = bulk_email_db[CAMPAIGNS_COLLECTION]
        
        # Get user's campaigns
        user_campaigns = list(campaigns_collection.find({'user_id': user_id}, {'name': 1, '_id': 0}))
        campaign_names = [campaign['name'] for campaign in user_campaigns]
        
        logger.info(f"User {user_id} has campaigns: {campaign_names}")
        return campaign_names
        
    except Exception as e:
        logger.error(f"Error getting user campaigns: {e}")
        return []

@app.route('/user/campaigns')
def get_user_campaigns_analytics():
    """📊 Get campaigns with tracking data filtered by user"""
    try:
        user_id = request.headers.get('X-User-ID')
        if not user_id:
            return jsonify({
                'error': 'User ID required in X-User-ID header',
                'success': False
            }), 401
        
        # Get user's campaign names
        user_campaign_names = get_user_campaigns(user_id)
        if not user_campaign_names:
            return jsonify({
                'campaigns': [],
                'total_campaigns': 0,
                'success': True,
                'message': 'No campaigns found for user'
            })
        
        # Get distinct campaign names from tracking data for user's campaigns only
        tracked_campaigns = db[COLLECTION_NAME].distinct('campaign_name', {'campaign_name': {'$in': user_campaign_names}})
        
        campaign_data = []
        for campaign_name in tracked_campaigns:
            if not campaign_name:  # Skip empty campaign names
                continue
                
            # Get opens for this campaign
            opens = list(db[COLLECTION_NAME].find({
                'campaign_name': campaign_name,
                'type': 'open'
            }, {'_id': 0}))
            
            # Get clicks for this campaign
            clicks = list(db[COLLECTION_NAME].find({
                'campaign_name': campaign_name,
                'type': 'click'
            }, {'_id': 0}))
            
            # Calculate stats
            total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
            unique_opens = len(opens)
            total_clicks = len(clicks)
            unique_emails = len(set(open_record['email'] for open_record in opens))
            
            campaign_data.append({
                'campaign_name': campaign_name,
                'total_opens': total_opens,
                'unique_opens': unique_opens,
                'total_clicks': total_clicks,
                'unique_emails': unique_emails,
                'open_rate': round((unique_opens / unique_emails * 100) if unique_emails > 0 else 0, 2),
                'click_rate': round((total_clicks / unique_emails * 100) if unique_emails > 0 else 0, 2),
                'opens': opens,
                'clicks': clicks
            })
        
        return jsonify({
            'campaigns': campaign_data,
            'total_campaigns': len(campaign_data),
            'user_id': user_id,
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving user campaigns: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

@app.route('/user/table')
def get_user_table_data():
    """📋 Get tracking data in table format filtered by user's campaigns"""
    try:
        user_id = request.headers.get('X-User-ID')
        if not user_id:
            return jsonify({
                'error': 'User ID required in X-User-ID header',
                'success': False
            }), 401
        
        campaign_name = request.args.get('campaign')
        
        # Get user's campaign names
        user_campaign_names = get_user_campaigns(user_id)
        if not user_campaign_names:
            return jsonify({
                'data': [],
                'count': 0,
                'success': True,
                'message': 'No campaigns found for user'
            })
        
        # Build query filter for user's campaigns only
        query_filter = {
            'type': 'open',
            'campaign_name': {'$in': user_campaign_names}
        }
        
        if campaign_name:
            # Additional filter for specific campaign (must be user's campaign)
            if campaign_name in user_campaign_names:
                query_filter['campaign_name'] = campaign_name
            else:
                return jsonify({
                    'data': [],
                    'count': 0,
                    'success': True,
                    'message': f'Campaign {campaign_name} not found or not accessible by user'
                })
        
        # Get tracking records
        records = list(db[COLLECTION_NAME].find(query_filter, {
            '_id': 0,
            'email': 1,
            'name': 1,
            'uid': 1,
            'instagram': 1,
            'time': 1,
            'date': 1,
            'open_count': 1,
            'last_opened': 1,
            'campaign_name': 1
        }).sort('timestamp', -1))
        
        # Format the data for table display
        table_data = []
        for record in records:
            table_data.append({
                'email': record.get('email', ''),
                'name': record.get('name', ''),
                'uid': record.get('uid', record.get('campaign_name', '')),
                'instagram': record.get('instagram', ''),
                'time': record.get('time', ''),
                'date': record.get('date', ''),
                'open_count': record.get('open_count', 0),
                'last_open': record.get('last_opened', '')
            })
        
        return jsonify({
            'data': table_data,
            'count': len(table_data),
            'user_id': user_id,
            'campaign_filter': campaign_name,
            'success': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error retrieving user table data: {e}")
        return jsonify({
            'error': str(e),
            'success': False
        })

if __name__ == '__main__':
    # Start keep-alive thread for Render deployment
    start_keep_alive()
    
    # Configure port and host for Render
    port = int(os.getenv('PORT', 3003))
    host = '0.0.0.0'
    debug = os.getenv('NODE_ENV') != 'production'
    
    logger.info(f"🚀 Tracker running on {host}:{port}")
    logger.info(f"🔧 Debug mode: {debug}")
    logger.info(f"🌐 Render URL: {os.getenv('RENDER_APP_URL', 'Not set')}")
    
    app.run(host=host, port=port, debug=debug)
