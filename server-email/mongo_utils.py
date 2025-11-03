import os
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# MongoDB connection
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME', 'bulk_email_automation')

# Collections
SENDERS_COLLECTION = 'senders'
SMTP_SENDERS_COLLECTION = 'smtp_senders'
CAMPAIGNS_COLLECTION = 'campaigns'
HISTORY_COLLECTION = 'sent_log'
EMAIL_LOGS_COLLECTION = 'email_logs'
CONFIG_COLLECTION = 'config'
LEADS_COLLECTION = 'leads'
TEMPLATES_COLLECTION = 'templates'
USERS_COLLECTION = 'users'

def get_database():
    """Get MongoDB database connection"""
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        db = client[DB_NAME]
        return db
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        print(f"Failed to connect to MongoDB: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error connecting to MongoDB: {e}")
        return None

def load_json(collection_name, default=None, user_id=None):
    """
    Load data from MongoDB collection (maintaining compatibility with old JSON interface)
    If user_id is provided, only load data for that specific user
    """
    try:
        db = get_database()
        if db is None:
            return default if default is not None else []
        
        collection = db[collection_name]
        
        # Build query filter
        query_filter = {}
        if user_id and collection_name != USERS_COLLECTION:
            query_filter['user_id'] = user_id
        
        if collection_name == SENDERS_COLLECTION:
            # Return list of senders
            return list(collection.find(query_filter, {'_id': 0}))
        elif collection_name == CAMPAIGNS_COLLECTION:
            # Return campaigns as dict with campaign_id as key
            campaigns = {}
            for doc in collection.find(query_filter, {'_id': 0}):
                if 'id' in doc:
                    campaigns[doc['id']] = doc
            return campaigns
        elif collection_name == HISTORY_COLLECTION:
            # Return sent_log structure
            sent_log = collection.find_one(query_filter, {'_id': 0})
            return sent_log if sent_log else {}
        elif collection_name == EMAIL_LOGS_COLLECTION:
            # Return list of email logs
            return list(collection.find(query_filter, {'_id': 0}).sort('timestamp', -1).limit(1000))
        elif collection_name == CONFIG_COLLECTION:
            # Return config as dict
            config = collection.find_one(query_filter, {'_id': 0})
            return config if config else {}
        else:
            # Generic collection handling
            return list(collection.find(query_filter, {'_id': 0}))
            
    except Exception as e:
        print(f"Error loading from MongoDB collection {collection_name}: {e}")
        return default if default is not None else []

def save_json(collection_name, data, user_id=None):
    """
    Save data to MongoDB collection (maintaining compatibility with old JSON interface)
    If user_id is provided, add user_id to all documents and only update user's data
    """
    try:
        db = get_database()
        if db is None:
            print("Failed to connect to MongoDB")
            return False
        
        collection = db[collection_name]
        
        # Build query filter for user-specific data
        query_filter = {}
        if user_id and collection_name != USERS_COLLECTION:
            query_filter['user_id'] = user_id
        
        if collection_name == SENDERS_COLLECTION:
            # Clear existing senders for this user and insert new ones
            collection.delete_many(query_filter)
            if data:
                # Add user_id to each sender
                for sender in data:
                    sender['user_id'] = user_id
                collection.insert_many(data)
        elif collection_name == CAMPAIGNS_COLLECTION:
            # Update campaigns individually
            collection.delete_many(query_filter)
            if data:
                for campaign_id, campaign_data in data.items():
                    campaign_data['user_id'] = user_id
                    collection.insert_one(campaign_data)
        elif collection_name == HISTORY_COLLECTION:
            # Update sent_log
            collection.delete_many(query_filter)
            if data:
                data['user_id'] = user_id
                collection.insert_one(data)
        elif collection_name == EMAIL_LOGS_COLLECTION:
            # Append to email logs
            if isinstance(data, list):
                # Add user_id to each log entry
                for log_entry in data:
                    log_entry['user_id'] = user_id
                collection.insert_many(data)
            else:
                data['user_id'] = user_id
                collection.insert_one(data)
        elif collection_name == CONFIG_COLLECTION:
            # Update config
            collection.delete_many(query_filter)
            if data:
                data['user_id'] = user_id
                collection.insert_one(data)
        else:
            # Generic collection handling
            collection.delete_many(query_filter)
            if data:
                if isinstance(data, list):
                    # Add user_id to each item
                    for item in data:
                        item['user_id'] = user_id
                    collection.insert_many(data)
                else:
                    data['user_id'] = user_id
                    collection.insert_one(data)
        
        return True
        
    except Exception as e:
        print(f"Error saving to MongoDB collection {collection_name}: {e}")
        return False

def initialize_database():
    """Initialize MongoDB database with default collections and indexes"""
    try:
        db = get_database()
        if db is None:
            return False
        
        # Create collections if they don't exist
        collections = [
            SENDERS_COLLECTION,
            SMTP_SENDERS_COLLECTION,
            CAMPAIGNS_COLLECTION,
            HISTORY_COLLECTION,
            EMAIL_LOGS_COLLECTION,
            CONFIG_COLLECTION,
            LEADS_COLLECTION,
            TEMPLATES_COLLECTION,
            USERS_COLLECTION
        ]
        
        for collection_name in collections:
            if collection_name not in db.list_collection_names():
                db.create_collection(collection_name)
        
        # Create indexes for better performance (with error handling)
        try:
            db[EMAIL_LOGS_COLLECTION].create_index([("timestamp", -1)])
        except Exception:
            pass  # Index might already exist
        
        try:
            db[CAMPAIGNS_COLLECTION].create_index([("id", 1)])
        except Exception:
            pass  # Index might already exist
        
        try:
            db[SENDERS_COLLECTION].create_index([("email", 1)])
        except Exception:
            pass  # Index might already exist

        try:
            db[SMTP_SENDERS_COLLECTION].create_index([("email", 1)])
        except Exception:
            pass  # Index might already exist
        
        try:
            db[LEADS_COLLECTION].create_index([("campaign_id", 1)])
        except Exception:
            pass  # Index might already exist
        
        try:
            db[TEMPLATES_COLLECTION].create_index([("campaign_id", 1)])
        except Exception:
            pass  # Index might already exist
        
        # Create user_id indexes for better performance
        try:
            db[SENDERS_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass
        
        try:
            db[SMTP_SENDERS_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass

        try:
            db[CAMPAIGNS_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass
        
        try:
            db[EMAIL_LOGS_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass
        
        try:
            db[LEADS_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass
        
        try:
            db[TEMPLATES_COLLECTION].create_index([("user_id", 1)])
        except Exception:
            pass
        
        try:
            db[USERS_COLLECTION].create_index([("username", 1)], unique=True)
        except Exception:
            pass
        
        try:
            db[USERS_COLLECTION].create_index([("email", 1)], unique=True)
        except Exception:
            pass
        
        # Initialize default config if empty
        if db[CONFIG_COLLECTION].count_documents({}) == 0:
            default_config = {
                "limit": 120,
                "delay": 15,
                "schedule_enabled": False,
                "schedule_time": None
            }
            db[CONFIG_COLLECTION].insert_one(default_config)
        
        print("MongoDB database initialized successfully")
        return True
        
    except Exception as e:
        print(f"Error initializing MongoDB database: {e}")
        return False

def save_lead_file(lead_data, file_content=None, user_id=None):
    """Save lead file metadata and content to MongoDB"""
    try:
        db = get_database()
        if db is None:
            return False
        
        collection = db[LEADS_COLLECTION]
        
        # Prepare the document with file content if provided
        document = lead_data.copy()
        if file_content is not None:
            document["file_content"] = file_content
            document["file_size"] = len(file_content)
        
        # Add user_id if provided
        if user_id:
            document["user_id"] = user_id
        
        # Check if lead file already exists (with user_id filter)
        query_filter = {"filename": lead_data["filename"]}
        if user_id:
            query_filter["user_id"] = user_id
            
        existing = collection.find_one(query_filter)
        if existing:
            # Update existing record
            collection.update_one(
                query_filter,
                {"$set": document}
            )
        else:
            # Insert new record
            collection.insert_one(document)
        
        return True
        
    except Exception as e:
        print(f"Error saving lead file to MongoDB: {e}")
        return False

def save_template_file(template_data, file_content=None, user_id=None):
    """Save template file metadata and content to MongoDB"""
    try:
        db = get_database()
        if db is None:
            return False
        
        collection = db[TEMPLATES_COLLECTION]
        
        # Prepare the document with file content if provided
        document = template_data.copy()
        if file_content is not None:
            document["file_content"] = file_content
            document["file_size"] = len(file_content)
        
        # Add user_id if provided
        if user_id:
            document["user_id"] = user_id
        
        # Check if template already exists (with user_id filter)
        query_filter = {"filename": template_data["filename"]}
        if user_id:
            query_filter["user_id"] = user_id
            
        existing = collection.find_one(query_filter)
        if existing:
            # Update existing record
            collection.update_one(
                query_filter,
                {"$set": document}
            )
        else:
            # Insert new record
            collection.insert_one(document)
        
        return True
        
    except Exception as e:
        print(f"Error saving template to MongoDB: {e}")
        return False

def get_lead_files(user_id=None):
    """Get all lead files from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return []
        
        collection = db[LEADS_COLLECTION]
        
        # Build query filter
        query_filter = {}
        if user_id:
            query_filter['user_id'] = user_id
            
        return list(collection.find(query_filter, {'_id': 0}))
        
    except Exception as e:
        print(f"Error getting lead files from MongoDB: {e}")
        return []

def get_template_files(user_id=None):
    """Get all template files from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return []
        
        collection = db[TEMPLATES_COLLECTION]
        
        # Build query filter
        query_filter = {}
        if user_id:
            query_filter['user_id'] = user_id
            
        return list(collection.find(query_filter, {'_id': 0}))
        
    except Exception as e:
        print(f"Error getting templates from MongoDB: {e}")
        return []

def get_lead_file_content(filename, user_id=None):
    """Get lead file content from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return None
        
        collection = db[LEADS_COLLECTION]
        # Search by filename and user_id if provided
        query = {"filename": filename}
        if user_id:
            query["user_id"] = user_id
        
        lead = collection.find_one(query, {'_id': 0})
        return lead.get("file_content") if lead else None
        
    except Exception as e:
        print(f"Error getting lead file content from MongoDB: {e}")
        return None

def get_template_file_content(filename, user_id=None):
    """Get template file content from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return None
        
        collection = db[TEMPLATES_COLLECTION]
        # Search by filename and user_id if provided
        query = {"filename": filename}
        if user_id:
            query["user_id"] = user_id
        
        template = collection.find_one(query, {'_id': 0})
        return template.get("file_content") if template else None
        
    except Exception as e:
        print(f"Error getting template content from MongoDB: {e}")
        return None

def delete_lead_file(filename):
    """Delete lead file from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return False
        
        collection = db[LEADS_COLLECTION]
        result = collection.delete_one({"filename": filename})
        return result.deleted_count > 0
        
    except Exception as e:
        print(f"Error deleting lead file from MongoDB: {e}")
        return False

def delete_template_file(filename):
    """Delete template file from MongoDB"""
    try:
        db = get_database()
        if db is None:
            return False
        
        collection = db[TEMPLATES_COLLECTION]
        result = collection.delete_one({"filename": filename})
        return result.deleted_count > 0
        
    except Exception as e:
        print(f"Error deleting template from MongoDB: {e}")
        return False

def sync_files_to_mongodb():
    """Sync existing files from file system to MongoDB collections with content"""
    try:
        import os
        import datetime
        
        # Sync lead files
        if os.path.exists("uploads"):
            for file in os.listdir("uploads"):
                if file.endswith('.csv') and file.startswith('leads_'):
                    file_path = os.path.join("uploads", file)
                    file_size = os.path.getsize(file_path)
                    file_date = datetime.datetime.fromtimestamp(os.path.getmtime(file_path))
                    
                    # Extract campaign ID from filename
                    campaign_id = file.replace('leads_', '').replace('.csv', '')
                    
                    # Read file content
                    try:
                        with open(file_path, 'rb') as f:
                            file_content = f.read()
                    except Exception as e:
                        print(f"Error reading file {file}: {e}")
                        file_content = None
                    
                    lead_data = {
                        "filename": file,
                        "file_path": None,  # No more file path needed
                        "file_size": file_size,
                        "file_date": file_date,
                        "campaign_id": campaign_id,
                        "file_type": "csv",
                        "upload_date": datetime.datetime.now()
                    }
                    
                    save_lead_file(lead_data, file_content)
        
        # Sync template files
        if os.path.exists("templates"):
            for file in os.listdir("templates"):
                if file.endswith('.html') and file.startswith('template_'):
                    file_path = os.path.join("templates", file)
                    file_size = os.path.getsize(file_path)
                    file_date = datetime.datetime.fromtimestamp(os.path.getmtime(file_path))
                    
                    # Extract campaign ID from filename
                    campaign_id = file.replace('template_', '').replace('.html', '')
                    
                    # Read file content
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            file_content = f.read()
                    except Exception as e:
                        print(f"Error reading file {file}: {e}")
                        file_content = None
                    
                    template_data = {
                        "filename": file,
                        "file_path": None,  # No more file path needed
                        "file_type": "html",
                        "file_size": file_size,
                        "file_date": file_date,
                        "campaign_id": campaign_id,
                        "upload_date": datetime.datetime.now()
                    }
                    
                    save_template_file(template_data, file_content)
        
        print("Files synced to MongoDB with content successfully")
        return True
        
    except Exception as e:
        print(f"Error syncing files to MongoDB: {e}")
        return False

def log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, status, error_message=None, user_id=None):
    """Log an individual email send attempt to the email_logs collection"""
    try:
        db = get_database()
        if db is None:
            print("Failed to connect to MongoDB for email logging")
            return False
        
        collection = db[EMAIL_LOGS_COLLECTION]
        
        log_entry = {
            "id": f"{campaign_id}_{recipient_email}_{datetime.datetime.now().timestamp()}",
            "campaign_id": campaign_id,
            "campaign_name": campaign_name,
            "recipient_email": recipient_email,
            "sender_email": sender_email,
            "subject": subject,
            "status": status,  # 'sent', 'failed', 'pending'
            "timestamp": datetime.datetime.now().isoformat(),
            "error_message": error_message,
            "user_id": user_id
        }
        
        collection.insert_one(log_entry)
        return True
        
    except Exception as e:
        print(f"Error logging email to MongoDB: {e}")
        return False

def get_email_logs_by_campaign(campaign_name, user_id=None, limit=100):
    """Get email logs for a specific campaign"""
    try:
        db = get_database()
        if db is None:
            return []
        
        collection = db[EMAIL_LOGS_COLLECTION]
        
        query_filter = {"campaign_name": campaign_name}
        if user_id:
            query_filter["user_id"] = user_id
        
        return list(collection.find(query_filter, {'_id': 0}).sort('timestamp', -1).limit(limit))
        
    except Exception as e:
        print(f"Error getting email logs from MongoDB: {e}")
        return []

def get_recent_email_logs(user_id=None, limit=100):
    """Get recent email logs across all campaigns"""
    try:
        db = get_database()
        if db is None:
            return []
        
        collection = db[EMAIL_LOGS_COLLECTION]
        
        query_filter = {}
        if user_id:
            query_filter["user_id"] = user_id
        
        return list(collection.find(query_filter, {'_id': 0}).sort('timestamp', -1).limit(limit))
        
    except Exception as e:
        print(f"Error getting recent email logs from MongoDB: {e}")
        return []

def migrate_from_json():
    """Migrate existing JSON data to MongoDB (if JSON files exist)"""
    try:
        import json
        import os
        
        # Check if JSON files exist
        json_files = {
            'senders.json': SENDERS_COLLECTION,
            'campaigns.json': CAMPAIGNS_COLLECTION,
            'sent_log.json': HISTORY_COLLECTION,
            'email_logs.json': EMAIL_LOGS_COLLECTION,
            'config.json': CONFIG_COLLECTION
        }
        
        migrated = False
        for json_file, collection_name in json_files.items():
            if os.path.exists(json_file):
                try:
                    with open(json_file, 'r') as f:
                        data = json.load(f)
                    
                    if data:
                        save_json(collection_name, data)
                        print(f"Migrated {json_file} to MongoDB collection {collection_name}")
                        migrated = True
                        
                        # Backup the original JSON file
                        backup_file = f"{json_file}.backup"
                        os.rename(json_file, backup_file)
                        print(f"Backed up {json_file} to {backup_file}")
                        
                except Exception as e:
                    print(f"Error migrating {json_file}: {e}")
        
        if migrated:
            print("JSON to MongoDB migration completed")
        else:
            print("No JSON files found to migrate")
            
        return migrated
        
    except Exception as e:
        print(f"Error during migration: {e}")
        return False

def upsert_smtp_sender(sender_data, user_id=None):
    """Create or update a custom SMTP sender in MongoDB.

    Expected fields in sender_data:
      email, smtp_host, smtp_port, smtp_user, smtp_password, use_tls, use_ssl, name(optional)
    """
    try:
        db = get_database()
        if db is None:
            return False

        collection = db[SMTP_SENDERS_COLLECTION]

        query = {"email": sender_data.get("email")}
        if user_id:
            query["user_id"] = user_id

        data = sender_data.copy()
        if user_id:
            data["user_id"] = user_id

        collection.update_one(query, {"$set": data}, upsert=True)
        return True
    except Exception as e:
        print(f"Error upserting SMTP sender: {e}")
        return False

def get_smtp_senders(user_id=None):
    """Return list of SMTP sender documents for a user (or all if None)."""
    try:
        db = get_database()
        if db is None:
            return []

        collection = db[SMTP_SENDERS_COLLECTION]
        query = {}
        if user_id:
            query["user_id"] = user_id
        return list(collection.find(query, {"_id": 0}))
    except Exception as e:
        print(f"Error getting SMTP senders: {e}")
        return []

def get_smtp_sender_by_email(email, user_id=None):
    """Fetch a single SMTP sender config by email and optional user_id."""
    try:
        db = get_database()
        if db is None:
            return None
        collection = db[SMTP_SENDERS_COLLECTION]
        query = {"email": email}
        if user_id:
            query["user_id"] = user_id
        doc = collection.find_one(query, {"_id": 0})
        return doc
    except Exception as e:
        print(f"Error getting SMTP sender by email: {e}")
        return None

def delete_smtp_sender(email, user_id=None):
    """Delete a custom SMTP sender by email (scoped to user if provided)."""
    try:
        db = get_database()
        if db is None:
            return False
        collection = db[SMTP_SENDERS_COLLECTION]
        query = {"email": email}
        if user_id:
            query["user_id"] = user_id
        result = collection.delete_one(query)
        return result.deleted_count > 0
    except Exception as e:
        print(f"Error deleting SMTP sender: {e}")
        return False
