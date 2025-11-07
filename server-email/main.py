import streamlit as st
from auth_ui import get_current_user_id
import pandas as pd
import time
import os
import datetime
import threading
import uuid
import requests
import urllib.parse
from email_sender import send_email, check_sender_health, validate_app_password, test_smtp_connection
from mongo_utils import get_smtp_senders, upsert_smtp_sender, delete_smtp_sender
from mongo_utils import load_json, save_json, initialize_database
from auth_ui import show_auth_interface, get_current_user_id, require_auth

def ensure_campaign_stats(campaign):
    """Ensure campaign has stats field with default values"""
    if 'stats' not in campaign:
        campaign['stats'] = {
            'total_leads': 0,
            'total_sent': 0,
            'total_failed': 0
        }
    return campaign

def save_user_data(collection_name, data):
    """Helper function to save data with current user ID"""
    return save_json(collection_name, data, current_user_id)

def keep_alive_ping():
    """Keep the app alive by pinging itself every 5 minutes"""
    while True:
        try:
            # Get the app URL from environment variable (set by Render)
            app_url = os.getenv('RENDER_APP_URL')
            if app_url:
                response = requests.get(f"{app_url}/", timeout=10)
                if response.status_code == 200:
                    print(f"✅ Keep-alive ping successful: {datetime.datetime.now()}")
                else:
                    print(f"⚠️ Keep-alive ping returned status {response.status_code}")
            else:
                print("⚠️ RENDER_APP_URL not set, skipping keep-alive ping")
        except Exception as e:
            print(f"❌ Keep-alive ping failed: {e}")
        
        # Wait 5 minutes (300 seconds)
        time.sleep(300)

def start_keep_alive():
    """Start the keep-alive thread"""
    keep_alive_thread = threading.Thread(target=keep_alive_ping, daemon=True)
    keep_alive_thread.start()
    print("🔄 Keep-alive thread started")

def generate_tracking_code(campaign_name):
    """Generate HTML tracking code for a specific campaign using campaign name as UID"""
    # Use environment variable for tracker URL, fallback to localhost for development
    tracker_url = os.getenv('TRACKER_URL', 'http://31.97.239.75:3399')
    
    # URL encode the campaign name to handle special characters
    import urllib.parse
    encoded_campaign_name = urllib.parse.quote(campaign_name)
    
    tracking_code = f'''<!-- 📧 Email Tracking Code for Campaign: {campaign_name} -->
<!-- Copy this code into your HTML email template -->

<!-- 🔍 Open Tracking Pixel (Hidden) -->
<img src="{tracker_url}/track/open?email={{email}}&uid={encoded_campaign_name}&name={{name}}&instagram={{instagram}}" 
     width="1" height="1" style="display:none;" alt="Tracking Pixel" />

<!-- 🔗 Click Tracking Links (Replace {{original_url}} with your actual URLs) -->
<!-- Example: -->
<a href="{tracker_url}/track/click?email={{email}}&uid={encoded_campaign_name}&redirect={{original_url}}&name={{name}}&instagram={{instagram}}">
    Your Link Text
</a>

<!-- 📊 How to use: -->
<!-- 1. Replace {{email}} with the recipient's email -->
<!-- 2. Replace {{name}} with the recipient's name -->
<!-- 3. Replace {{instagram}} with the recipient's Instagram handle -->
<!-- 4. Replace {{original_url}} with the actual URL you want to redirect to -->
<!-- 5. The system will automatically track opens and clicks -->
<!-- 6. View tracking data in the Tracker page -->
<!-- 7. Campaign name: {campaign_name} -->'''
    
    return tracking_code

def migrate_existing_campaigns(user_id=None):
    """Add tracking code to existing campaigns that don't have it"""
    # If no user_id provided, try to get it from session state or skip migration
    if user_id is None:
        try:
            user_id = get_current_user_id()
        except:
            # If we can't get user_id, skip migration for now
            return False
    
    campaigns = load_json(CAMPAIGNS_FILE, {}, user_id)
    updated = False
    
    for campaign_id, campaign in campaigns.items():
        if 'tracking_code' not in campaign:
            campaign['tracking_code'] = generate_tracking_code(campaign['name'])
            updated = True
    
    if updated:
        save_user_data(CAMPAIGNS_FILE, campaigns)
        return True
    return False

# MongoDB collection names
SENDER_FILE = "senders"
HISTORY_FILE = "sent_log"
CONFIG_FILE = "config"
CAMPAIGNS_FILE = "campaigns"

st.set_page_config(page_title="Bulk Email Automation", layout="wide")
st.title("📧 Bulk Email Automation System")

# Initialize MongoDB database
if 'db_initialized' not in st.session_state:
    try:
        if initialize_database():
            st.session_state.db_initialized = True
            # Attempt to migrate existing JSON data
            try:
                from mongo_utils import migrate_from_json
                migrate_from_json()
            except ImportError:
                # migrate_from_json function not available, skip migration
                pass
            
            # Sync existing files to MongoDB collections
            from mongo_utils import sync_files_to_mongodb
            sync_files_to_mongodb()
            
            # Migrate existing campaigns to include tracking code
            # This will be called after authentication
        else:
            st.error("❌ Failed to connect to MongoDB. Please check your connection.")
            st.error("Make sure MongoDB is running and your .env file has the correct MONGO_URI")
            st.stop()
    except Exception as e:
        st.error(f"❌ Database initialization failed: {e}")
        st.error("Please check your MongoDB connection and .env configuration")
        st.stop()

# Check authentication first
if not show_auth_interface():
    st.stop()

# Get current user ID
current_user_id = get_current_user_id()

# Migrate existing campaigns to include tracking code (now that we have user_id)
migrate_existing_campaigns(current_user_id)

# Multiple file processing logic
def process_multiple_files(files, file_type, campaign_id, user_id):
    """Process multiple uploaded files"""
    if not files:
        return []
    
    processed_files = []
    for i, file in enumerate(files):
        try:
            if file_type == "csv":
                df = pd.read_csv(file)
                filename = f"leads_{campaign_id}_{i+1}.csv"
                csv_content = df.to_csv(index=False).encode('utf-8')
                
                lead_data = {
                    "filename": filename,
                    "file_path": None,
                    "file_size": len(csv_content),
                    "file_date": datetime.datetime.now(),
                    "campaign_id": campaign_id,
                    "file_type": "csv",
                    "upload_date": datetime.datetime.now(),
                    "user_id": user_id
                }
                
                from mongo_utils import save_lead_file
                result = save_lead_file(lead_data, csv_content, user_id)
                if result:
                    processed_files.append({
                        'filename': filename,
                        'rows': len(df),
                        'type': 'csv'
                    })
                    
            elif file_type == "html":
                html_content = file.read()
                filename = f"template_{campaign_id}_{i+1}.html"
                
                template_data = {
                    "filename": filename,
                    "file_path": None,
                    "file_size": len(html_content),
                    "file_date": datetime.datetime.now(),
                    "campaign_id": campaign_id,
                    "file_type": "html",
                    "upload_date": datetime.datetime.now(),
                    "user_id": user_id
                }
                
                from mongo_utils import save_template_file
                result = save_template_file(template_data, html_content, user_id)
                if result:
                    processed_files.append({
                        'filename': filename,
                        'size': len(html_content),
                        'type': 'html'
                    })
                    
        except Exception as e:
            st.error(f"Error processing {file.name}: {e}")
    
    return processed_files



# Helper function for safe campaign data access
def safe_campaign_get(campaign, key, default=None):
    """Safely get a value from campaign dictionary with error handling"""
    if not campaign or not isinstance(campaign, dict):
        return default
    return campaign.get(key, default)

# Initialize session state
if 'campaign_running' not in st.session_state:
    st.session_state.campaign_running = False
if 'current_campaign_id' not in st.session_state:
    st.session_state.current_campaign_id = None
if 'show_campaign_details' not in st.session_state:
    st.session_state.show_campaign_details = None

# Sidebar for navigation
st.sidebar.title("🎯 Navigation")
page = st.sidebar.selectbox(
    "Choose a section:",
    ["🏠 Dashboard", "📧 Manage Senders", "📋 Manage Campaigns", "🎯 Active Campaign", "📊 Analytics", "📈 Tracker", "📋 Requirements", "👤 Profile", "📚 Resources"]
)

# Load data from MongoDB (user-specific)
senders = load_json(SENDER_FILE, [], current_user_id)
# Merge in custom SMTP senders for selection/display
try:
    _smtp_senders = get_smtp_senders(current_user_id) or []
    # Avoid duplicates by email; prefer custom SMTP config if both exist
    existing_emails = {s['email'] for s in senders}
    merged = []
    for s in senders:
        merged.append(s)
    for s in _smtp_senders:
        if s.get('email') not in existing_emails:
            merged.append(s)
    senders = merged
except Exception:
    pass
campaigns = load_json(CAMPAIGNS_FILE, {}, current_user_id)

# Ensure all campaigns have stats
for campaign_id, campaign in campaigns.items():
    campaigns[campaign_id] = ensure_campaign_stats(campaign)

# Clean up invalid session state references
if st.session_state.get('show_campaign_details') and st.session_state.show_campaign_details not in campaigns:
    st.session_state.show_campaign_details = None

if st.session_state.get('current_campaign_id') and st.session_state.current_campaign_id not in campaigns:
    st.session_state.current_campaign_id = None
    st.session_state.campaign_running = False

# Sync campaign status from database to session state
if st.session_state.get('current_campaign_id') and st.session_state.current_campaign_id in campaigns:
    current_campaign = campaigns[st.session_state.current_campaign_id]
    if current_campaign.get('status') == 'running' and not st.session_state.get('campaign_running', False):
        st.session_state.campaign_running = True
    elif current_campaign.get('status') != 'running' and st.session_state.get('campaign_running', False):
        st.session_state.campaign_running = False

# Dashboard Page
if page == "🏠 Dashboard":
    st.header("🏠 Dashboard")
    
    # App password information
    with st.expander("💡 Important: App Password Information", expanded=False):
        st.markdown("""
        **Gmail App Passwords:**
        - ✅ **Spaces are allowed** in app passwords and will be preserved
        - ✅ Use Gmail app passwords (not your regular Gmail password)
        - ✅ Enable 2-factor authentication first to generate app passwords
        - ✅ App passwords are typically 16 characters long
        - ❌ Don't use your regular Gmail password
        
        **How to get an App Password:**
        1. Go to your Google Account settings
        2. Enable 2-factor authentication
        3. Go to Security → App passwords
        4. Generate a new app password for "Mail"
        5. Copy the 16-character password (spaces included)
        """)
    
    # Quick stats
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Total Senders", len(senders))
    
    with col2:
        st.metric("Total Campaigns", len(campaigns))
    
    with col3:
        active_campaigns = sum(1 for c in campaigns.values() if c.get('status') == 'running')
        st.metric("Active Campaigns", active_campaigns)
    
    with col4:
        total_sent = sum(c.get('stats', {}).get('total_sent', 0) for c in campaigns.values())
        st.metric("Total Emails Sent", total_sent)
    
    # Quick actions
    st.subheader("⚡ Quick Actions")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        if st.button("➕ Add New Sender", use_container_width=True):
            st.session_state.show_add_sender = True
            st.rerun()
    
    with col2:
        if st.button("📋 Create New Campaign", use_container_width=True):
            st.session_state.show_create_campaign = True
            st.rerun()
    
    with col3:
        if st.button("📤 Send Test Email", use_container_width=True):
            st.session_state.show_test_email = True
            st.rerun()
    
    # Quick access to resources
    st.subheader("📚 Quick Access")
    col1, col2 = st.columns(2)
    
    with col1:
        if st.button("📊 View Lead Files", use_container_width=True):
            st.session_state.show_resources_leads = True
            st.rerun()
    
    with col2:
        if st.button("📝 View Templates", use_container_width=True):
            st.session_state.show_resources_templates = True
            st.rerun()
    
    # Recent activity
    st.subheader("📈 Recent Activity")
    
    if campaigns:
        for campaign_id, campaign in list(campaigns.items())[-3:]:  # Show last 3 campaigns
            with st.container():
                col1, col2, col3 = st.columns([3, 1, 1])
                
                with col1:
                    st.write(f"**{campaign.get('name', 'Unnamed Campaign')}**")
                    st.write(f"Status: {campaign.get('status', 'draft').title()}")
                    total_leads = campaign.get('stats', {}).get('total_leads', 0)
                    total_sent = campaign.get('stats', {}).get('total_sent', 0)
                    if total_leads > 0:
                        progress = total_sent / total_leads
                        st.progress(progress)
                        st.write(f"Progress: {total_sent}/{total_leads} sent")
                
                with col2:
                    if st.button("▶️ Start", key=f"quick_start_{campaign_id}"):
                        if len(campaign['selected_senders']) == 0:
                            st.error("No senders selected!")
                        elif not (campaign.get('leads_data') or campaign.get('leads_file')):
                            st.error("No leads uploaded!")
                        elif not (campaign.get('template_data') or campaign.get('template_file')):
                            st.error("No template uploaded!")
                        else:
                            st.session_state.current_campaign_id = campaign_id
                            st.session_state.campaign_running = True
                            campaigns[campaign_id]['status'] = 'running'
                            save_user_data(CAMPAIGNS_FILE, campaigns)
                            st.rerun()
                
                with col3:
                    if st.button("⚙️ Manage", key=f"quick_manage_{campaign_id}"):
                        st.session_state.show_campaign_details = campaign_id
                        st.rerun()
    else:
        st.info("No campaigns yet. Create your first campaign!")

# Manage Senders Page
elif page == "📧 Manage Senders":
    st.header("📧 Manage Sender Emails")
    
    # Add new Gmail sender
    with st.expander("➕ Add New Sender", expanded=False):
        with st.form("add_sender_form"):
            col1, col2 = st.columns(2)
            with col1:
                sender_email = st.text_input("Sender Email")
            with col2:
                sender_name = st.text_input("Sender Name", placeholder="e.g., John Doe, Company Name", help="This will appear as the sender name in emails")
            
            sender_pass = st.text_input("App Password", type="password", help="Enter your Gmail app password. Spaces are allowed and will be preserved.")
            st.info("💡 **App Password Tips:**\n- Use Gmail app passwords (not your regular password)\n- Spaces in app passwords are allowed and should be preserved\n- Enable 2-factor authentication first to generate app passwords")
            
            if st.form_submit_button("Add Sender"):
                if sender_email and sender_pass:
                    # Validate app password
                    is_valid, validation_msg = validate_app_password(sender_pass)
                    if not is_valid:
                        st.error(f"❌ {validation_msg}")
                        st.stop()
                    
                    if any(sender['email'] == sender_email for sender in senders):
                        st.error(f"Email {sender_email} already exists!")
                    else:
                        # Use provided name or default to email if not provided
                        display_name = sender_name.strip() if sender_name and sender_name.strip() else sender_email
                        senders.append({
                            "email": sender_email, 
                            "password": sender_pass,
                            "name": display_name
                        })
                        save_user_data(SENDER_FILE, senders)
                        st.success(f"✅ Added {sender_email} ({display_name})")
                        st.rerun()
                else:
                    st.error("Please enter both email and password")

    # Add Custom SMTP Sender
    with st.expander("➕ Add Custom SMTP Sender", expanded=False):
        with st.form("add_custom_smtp_form"):
            col1, col2 = st.columns(2)
            with col1:
                smtp_email = st.text_input("Sender Email", key="smtp_email")
                smtp_host = st.text_input("SMTP Host", placeholder="smtp.hostinger.com")
                smtp_user = st.text_input("SMTP Username", placeholder="user@example.com")
                use_tls = st.checkbox("Use TLS", value=True)
            with col2:
                smtp_name = st.text_input("Sender Name", placeholder="e.g., Sales")
                smtp_port = st.number_input("SMTP Port", min_value=1, max_value=65535, value=587)
                smtp_password = st.text_input("SMTP Password", type="password")
                use_ssl = st.checkbox("Use SSL", value=False)

            colt1, colt2 = st.columns(2)
            with colt1:
                test_click = st.form_submit_button("🔍 Test Connection")
            with colt2:
                add_click = st.form_submit_button("💾 Save Sender")

            if test_click:
                if smtp_host and smtp_port and smtp_user and smtp_password:
                    ok = test_smtp_connection(smtp_host, int(smtp_port), smtp_user, smtp_password, use_tls=use_tls, use_ssl=use_ssl)
                    if ok:
                        st.success("✅ Connection successful")
                    else:
                        st.error("❌ Connection failed. Check credentials and ports.")
                else:
                    st.error("Please fill host, port, username and password to test.")

            if add_click:
                if smtp_email and smtp_host and smtp_port and smtp_user and smtp_password:
                    data = {
                        "email": smtp_email,
                        "name": smtp_name.strip() if smtp_name and smtp_name.strip() else smtp_email,
                        "smtp_host": smtp_host,
                        "smtp_port": int(smtp_port),
                        "smtp_user": smtp_user,
                        "smtp_password": smtp_password,
                        "use_tls": bool(use_tls),
                        "use_ssl": bool(use_ssl)
                    }
                    if upsert_smtp_sender(data, user_id=current_user_id):
                        st.success(f"✅ Saved custom SMTP sender {smtp_email}")
                        st.rerun()
                    else:
                        st.error("❌ Failed to save SMTP sender")
                else:
                    st.error("Please complete all required fields")
    
    # Display senders (both Gmail and custom SMTP)
    if senders:
        st.subheader("📧 Your Sender Emails")
        
        for i, sender in enumerate(senders):
            with st.container():
                st.markdown("---")
                col1, col2, col3, col4 = st.columns([3, 1, 1, 1])
                
                with col1:
                    # Show sender name and email
                    sender_name = sender.get('name', sender['email'])
                    password_info = ""
                    if 'password' in sender and isinstance(sender.get('password'), str) and ' ' in sender['password']:
                        password_info = " (contains spaces)"
                    st.write(f"**{sender_name}**")
                    st.write(f"📧 {sender['email']}{password_info}")
                
                with col2:
                    if st.button("🔍 Test", key=f"test_{i}"):
                        if 'smtp_host' in sender:
                            ok = test_smtp_connection(
                                sender.get('smtp_host'),
                                int(sender.get('smtp_port', 587)),
                                sender.get('smtp_user', sender.get('email')),
                                sender.get('smtp_password', ''),
                                use_tls=bool(sender.get('use_tls', True)),
                                use_ssl=bool(sender.get('use_ssl', False))
                            )
                            if ok:
                                st.success("✅ Healthy")
                            else:
                                st.error("❌ Issues")
                        else:
                            if check_sender_health(sender['email'], sender.get('password', '')):
                                st.success("✅ Healthy")
                            else:
                                st.error("❌ Issues")
                
                with col3:
                    if st.button("✏️ Edit", key=f"edit_{i}"):
                        st.session_state.editing_sender = i
                        st.rerun()
                
                with col4:
                    if 'smtp_host' in sender:
                        if st.button("🗑️ Delete", key=f"delete_{i}"):
                            # Delete custom SMTP sender from DB
                            if delete_smtp_sender(sender['email'], user_id=current_user_id):
                                st.success(f"✅ Deleted {sender['email']}")
                                st.rerun()
                            else:
                                st.error("❌ Failed to delete sender")
                    else:
                        if st.button("🗑️ Delete", key=f"delete_{i}"):
                            senders.pop(i)
                            save_user_data(SENDER_FILE, senders)
                            st.success(f"✅ Deleted {sender['email']}")
                            st.rerun()
                
                # Edit mode
                if st.session_state.get('editing_sender') == i:
                    with st.form(key=f"edit_sender_{i}"):
                        if 'smtp_host' in sender:
                            col1, col2 = st.columns(2)
                            with col1:
                                new_email = st.text_input("Email", value=sender['email'])
                                new_name = st.text_input("Sender Name", value=sender.get('name', sender['email']))
                                new_smtp_host = st.text_input("SMTP Host", value=sender.get('smtp_host', ''))
                                new_smtp_user = st.text_input("SMTP Username", value=sender.get('smtp_user', sender.get('email')))
                                new_use_tls = st.checkbox("Use TLS", value=bool(sender.get('use_tls', True)), key=f"tls_{i}")
                            with col2:
                                new_smtp_port = st.number_input("SMTP Port", min_value=1, max_value=65535, value=int(sender.get('smtp_port', 587)), key=f"port_{i}")
                                new_smtp_password = st.text_input("SMTP Password", type="password", value=sender.get('smtp_password', ''), key=f"pwd_{i}")
                                new_use_ssl = st.checkbox("Use SSL", value=bool(sender.get('use_ssl', False)), key=f"ssl_{i}")

                            colb1, colb2, colb3 = st.columns(3)
                            with colb1:
                                if st.form_submit_button("🔍 Test"):
                                    ok = test_smtp_connection(new_smtp_host, int(new_smtp_port), new_smtp_user, new_smtp_password, use_tls=new_use_tls, use_ssl=new_use_ssl)
                                    if ok:
                                        st.success("✅ Connection successful")
                                    else:
                                        st.error("❌ Connection failed")
                            with colb2:
                                if st.form_submit_button("💾 Save"):
                                    data = {
                                        "email": new_email,
                                        "name": new_name.strip() if new_name and new_name.strip() else new_email,
                                        "smtp_host": new_smtp_host,
                                        "smtp_port": int(new_smtp_port),
                                        "smtp_user": new_smtp_user,
                                        "smtp_password": new_smtp_password,
                                        "use_tls": bool(new_use_tls),
                                        "use_ssl": bool(new_use_ssl)
                                    }
                                    if upsert_smtp_sender(data, user_id=current_user_id):
                                        st.success("✅ Updated sender")
                                        st.session_state.editing_sender = None
                                        st.rerun()
                                    else:
                                        st.error("❌ Failed to update")
                            with colb3:
                                if st.form_submit_button("❌ Cancel"):
                                    st.session_state.editing_sender = None
                                    st.rerun()
                        else:
                            col1, col2 = st.columns(2)
                            with col1:
                                new_email = st.text_input("Email", value=sender['email'])
                            with col2:
                                current_name = sender.get('name', sender['email'])
                                new_name = st.text_input("Sender Name", value=current_name, placeholder="e.g., John Doe, Company Name", help="This will appear as the sender name in emails")
                            
                            new_password = st.text_input("App Password", type="password", value=sender['password'], help="Enter your Gmail app password. Spaces are allowed and will be preserved.")
                            st.info("💡 **App Password Tips:**\n- Use Gmail app passwords (not your regular password)\n- Spaces in app passwords are allowed and should be preserved\n- Enable 2-factor authentication first to generate app passwords")
                            
                            col1, col2 = st.columns(2)
                            with col1:
                                if st.form_submit_button("💾 Save"):
                                    is_valid, validation_msg = validate_app_password(new_password)
                                    if not is_valid:
                                        st.error(f"❌ {validation_msg}")
                                        st.stop()
                                    display_name = new_name.strip() if new_name and new_name.strip() else new_email
                                    senders[i]['email'] = new_email
                                    senders[i]['password'] = new_password
                                    senders[i]['name'] = display_name
                                    save_user_data(SENDER_FILE, senders)
                                    st.success(f"✅ Updated {new_email} ({display_name})")
                                    st.session_state.editing_sender = None
                                    st.rerun()
                            with col2:
                                if st.form_submit_button("❌ Cancel"):
                                    st.session_state.editing_sender = None
                                    st.rerun()
    else:
        st.info("No senders added yet. Add your first sender email above.")

# Manage Campaigns Page
elif page == "📋 Manage Campaigns":
    st.header("📋 Manage Campaigns")
    
    # Create new campaign
    with st.expander("➕ Create New Campaign", expanded=False):
        with st.form("create_campaign_form"):
            campaign_name = st.text_input("Campaign Name", placeholder="e.g., Q4 Newsletter")
            campaign_description = st.text_area("Description", placeholder="Describe your campaign...")
            
            if st.form_submit_button("Create Campaign"):
                if campaign_name:
                    campaign_id = str(uuid.uuid4())
                    
                    # Generate tracking code for this campaign
                    tracking_code = generate_tracking_code(campaign_name)
                    
                    campaign_data = {
                        "id": campaign_id,
                        "name": campaign_name,
                        "description": campaign_description,
                        "created_at": datetime.datetime.now().isoformat(),
                        "status": "draft",
                        "selected_senders": [],
                        "leads_file": None,
                        "template_file": None,
                        "subject_line": "",
                        "daily_limit": 120,
                        "delay": 30,
                        "schedule_enabled": False,
                        "schedule_time": "10:00",
                        "scheduled_date": None,
                        "stats": {"total_sent": 0, "total_failed": 0, "total_leads": 0},
                        "tracking_code": tracking_code
                    }
                    campaigns[campaign_id] = campaign_data
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    st.success(f"✅ Campaign '{campaign_name}' created!")
                    st.rerun()
                else:
                    st.error("Please enter campaign name")
    
    # Display campaigns
    if campaigns:
        st.subheader("📋 Your Campaigns")
        
        for campaign_id, campaign in campaigns.items():
            with st.container():
                st.markdown("---")
                
                # Campaign header
                col1, col2, col3, col4 = st.columns([3, 1, 1, 1])
                
                with col1:
                    st.write(f"**{campaign.get('name', 'Unnamed Campaign')}**")
                    if campaign.get('description'):
                        st.write(f"*{campaign['description']}*")
                    
                    # Status and progress
                    status_color = {"draft": "⚪", "running": "🟢", "paused": "🟡", "completed": "🔵"}
                    campaign_status = safe_campaign_get(campaign, 'status', 'draft')
                    st.write(f"{status_color.get(campaign_status, '⚪')} {campaign_status.title()}")
                    
                    # Show scheduling info
                    if campaign.get('schedule_enabled'):
                        st.write(f"📅 Daily: {campaign['schedule_time']}")
                    elif campaign.get('scheduled_date'):
                        scheduled_datetime = datetime.datetime.strptime(f"{campaign['scheduled_date']} {campaign['schedule_time']}", "%Y-%m-%d %H:%M")
                        st.write(f"📅 Scheduled: {scheduled_datetime.strftime('%b %d, %I:%M %p')}")
                    else:
                        st.write("🚀 Ready to start")
                    
                    total_leads = campaign.get('stats', {}).get('total_leads', 0)
                    total_sent = campaign.get('stats', {}).get('total_sent', 0)
                    if total_leads > 0:
                        progress = total_sent / total_leads
                        st.progress(progress)
                        st.write(f"📊 {total_sent}/{total_leads} sent")
                
                with col2:
                    if st.button("⚙️ Setup", key=f"setup_{campaign_id}"):
                        st.session_state.show_campaign_details = campaign_id
                        st.rerun()
                
                with col3:
                    if st.button("▶️ Start", key=f"start_{campaign_id}"):
                        if len(campaign['selected_senders']) == 0:
                            st.error("No senders selected!")
                        elif not (campaign.get('leads_data') or campaign.get('leads_file')):
                            st.error("No leads uploaded!")
                        elif not (campaign.get('template_data') or campaign.get('template_file')):
                            st.error("No template uploaded!")
                        else:
                            st.session_state.current_campaign_id = campaign_id
                            st.session_state.campaign_running = True
                            campaigns[campaign_id]['status'] = 'running'
                            save_user_data(CAMPAIGNS_FILE, campaigns)
                            st.rerun()
                
                with col4:
                    if st.button("🗑️ Delete", key=f"delete_{campaign_id}"):
                        del campaigns[campaign_id]
                        save_user_data(CAMPAIGNS_FILE, campaigns)
                        campaign_name = safe_campaign_get(campaign, 'name', 'Unnamed Campaign')
                        st.success(f"✅ Campaign '{campaign_name}' deleted")
                        st.rerun()
    else:
        st.info("No campaigns yet. Create your first campaign above!")

# Campaign Setup/Management
if st.session_state.get('show_campaign_details'):
    campaign_id = st.session_state.show_campaign_details
    
    # Check if campaign exists
    if campaign_id not in campaigns:
        st.error(f"❌ Campaign not found. It may have been deleted.")
        st.session_state.show_campaign_details = None
        st.rerun()
    
    campaign = campaigns[campaign_id]
    
    campaign_name = safe_campaign_get(campaign, 'name', 'Unnamed Campaign')
    st.header(f"⚙️ Setup Campaign: {campaign_name}")
    
    # Setup progress indicator
    setup_steps = [
        ("📧 Select Senders", len(campaign['selected_senders']) > 0),
        ("📊 Upload Leads", campaign.get('leads_file') is not None),
        ("📝 Upload Template", campaign.get('template_file') is not None),
        ("⚙️ Configure Settings", campaign.get('subject_line') != "")
    ]
    
    st.write("**Setup Progress:**")
    for step, completed in setup_steps:
        status = "✅" if completed else "⭕"
        st.write(f"{status} {step}")
    
    # Setup sections
    tab1, tab2, tab3, tab4 = st.tabs(["📧 Senders", "📊 Leads", "📝 Template", "⚙️ Settings"])
    
    with tab1:
        st.write("**Select Sender Emails for this Campaign:**")
        
        # Available senders
        available_senders = [s for s in senders if s['email'] not in campaign['selected_senders']]
        selected_senders = [s for s in senders if s['email'] in campaign['selected_senders']]
        
        if available_senders:
            st.write("**Available Senders:**")
            for sender in available_senders:
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.write(f"📧 {sender['email']}")
                with col2:
                    if st.button("➕ Add", key=f"add_{sender['email']}"):
                        campaign['selected_senders'].append(sender['email'])
                        save_user_data(CAMPAIGNS_FILE, campaigns)
                        st.success(f"✅ Added {sender['email']}")
                        st.rerun()
        
        if selected_senders:
            st.write("**Selected Senders:**")
            for sender in selected_senders:
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.write(f"✅ {sender['email']}")
                with col2:
                    if st.button("➖ Remove", key=f"remove_{sender['email']}"):
                        campaign['selected_senders'].remove(sender['email'])
                        save_user_data(CAMPAIGNS_FILE, campaigns)
                        st.success(f"✅ Removed {sender['email']}")
                        st.rerun()
        
        if not selected_senders:
            st.info("No senders selected yet. Add senders from the available list above.")
    
    with tab2:
        st.write("**Upload Leads for this Campaign:**")
        
        if not campaign.get('leads_file'):
            # Option to use existing lead file
            use_existing_leads = st.checkbox("Use existing lead file", key=f"use_existing_leads_{campaign_id}")
            
            if use_existing_leads:
                # Show existing lead files from MongoDB
                from mongo_utils import get_lead_files
                existing_leads = [lead['filename'] for lead in get_lead_files(current_user_id)]
                
                if existing_leads:
                    selected_leads = st.selectbox("Select existing lead file", existing_leads, key=f"select_existing_leads_{campaign_id}")
                    
                    if st.button("✅ Use Selected Leads"):
                        campaign['leads_file'] = selected_leads
                        
                        # Load leads from MongoDB
                        from mongo_utils import get_lead_file_content
                        import io
                        
                        lead_content = get_lead_file_content(selected_leads, current_user_id)
                        if lead_content:
                            df_leads = pd.read_csv(io.BytesIO(lead_content))
                            if 'stats' not in campaign:
                                campaign['stats'] = {}
                            campaign['stats']['total_leads'] = len(df_leads)
                            save_user_data(CAMPAIGNS_FILE, campaigns)
                            
                            st.success(f"✅ Using existing leads: {len(df_leads)} leads")
                            st.dataframe(df_leads.head())
                            st.rerun()
                        else:
                            st.error("❌ Selected lead file not found in MongoDB")
                else:
                    st.warning("No existing lead files found. Please upload a new one.")
                    use_existing_leads = False
            
            if not use_existing_leads:
                leads_files = st.file_uploader("Upload CSV files with email addresses", type=["csv"], accept_multiple_files=True)
                
                if leads_files:
                    # Process the first uploaded file
                    leads_file = leads_files[0]
                    df_leads = pd.read_csv(leads_file)
                    
                    # Store leads data directly in campaign
                    campaign['leads_data'] = df_leads.to_csv(index=False)
                    campaign['leads_file'] = f"leads_{campaign_id}.csv"
                    
                    if 'stats' not in campaign:
                        campaign['stats'] = {}
                    campaign['stats']['total_leads'] = len(df_leads)
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    
                    st.success(f"✅ Uploaded {len(df_leads)} leads to campaign")
                    st.dataframe(df_leads.head())
        else:
            # Load leads from campaign data
            import io
            
            if 'leads_data' in campaign and campaign['leads_data']:
                # New format: leads stored directly in campaign
                df_leads = pd.read_csv(io.StringIO(campaign['leads_data']))
                st.success(f"✅ {len(df_leads)} leads uploaded")
                st.dataframe(df_leads.head())
            else:
                # Fallback: try to load from MongoDB (for old campaigns)
                from mongo_utils import get_lead_file_content
                lead_content = get_lead_file_content(campaign['leads_file'], current_user_id)
                if lead_content:
                    df_leads = pd.read_csv(io.BytesIO(lead_content))
                    st.success(f"✅ {len(df_leads)} leads uploaded")
                    st.dataframe(df_leads.head())
                else:
                    st.error("❌ Lead data not found in campaign or MongoDB")
                campaign['leads_file'] = None
                if 'stats' not in campaign:
                    campaign['stats'] = {}
                campaign['stats']['total_leads'] = 0
                save_user_data(CAMPAIGNS_FILE, campaigns)
            
            if st.button("🗑️ Remove Leads"):
                campaign['leads_file'] = None
                if 'stats' not in campaign:
                    campaign['stats'] = {}
                campaign['stats']['total_leads'] = 0
                save_user_data(CAMPAIGNS_FILE, campaigns)
                st.success("✅ Leads removed")
                st.rerun()
    
    with tab3:
        st.write("**Upload Email Template for this Campaign:**")
        
        if not campaign.get('template_file'):
            # Option to use existing template
            use_existing_template = st.checkbox("Use existing template", key=f"use_existing_template_{campaign_id}")
            
            if use_existing_template:
                # Show existing templates from MongoDB
                from mongo_utils import get_template_files
                existing_templates = [template['filename'] for template in get_template_files(current_user_id)]
                
                if existing_templates:
                    selected_template = st.selectbox("Select existing template", existing_templates, key=f"select_existing_template_{campaign_id}")
                    
                    if st.button("✅ Use Selected Template"):
                        campaign['template_file'] = selected_template
                        save_user_data(CAMPAIGNS_FILE, campaigns)
                        
                        # Show template preview
                        from mongo_utils import get_template_file_content
                        template_content = get_template_file_content(campaign['template_file'], current_user_id)
                        if template_content:
                            # Handle template content (could be string or bytes)
                            if isinstance(template_content, bytes):
                                template_text = template_content.decode('utf-8')
                            else:
                                template_text = template_content
                            
                            # Automatically inject tracking pixel (silent)
                            from tracking_utils import inject_tracking_pixel
                            tracker_server = "http://31.97.239.75:3399"
                            template_text = inject_tracking_pixel(template_text, tracker_server, campaign['name'])
                            campaign['template_data'] = template_text  # Update campaign with tracking pixel
                            save_user_data(CAMPAIGNS_FILE, campaigns)
                            
                            st.success("✅ Using existing template")
                            st.code(template_text[:500] + "..." if len(template_text) > 500 else template_text, language="html")
                        else:
                            st.error("❌ Template not found in MongoDB")
                        st.rerun()
                        st.rerun()
                else:
                    st.warning("No existing templates found. Please upload a new one.")
                    use_existing_template = False
            
            if not use_existing_template:
                template_files = st.file_uploader("Upload HTML templates", type=["html"], accept_multiple_files=True)
                
                if template_files:
                    # Process the first uploaded file
                    template_file = template_files[0]
                    template = template_file.read().decode("utf-8")
                    
                    # Automatically inject tracking pixel (silent)
                    from tracking_utils import inject_tracking_pixel
                    tracker_server = "http://31.97.239.75:3399"
                    template = inject_tracking_pixel(template, tracker_server, campaign['name'])
                    
                    # Store template data directly in campaign
                    campaign['template_data'] = template
                    campaign['template_file'] = f"template_{campaign_id}.html"
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    
                    st.success("✅ Template uploaded to campaign")
        else:
            st.success("✅ Template uploaded")
            
            if 'template_data' in campaign and campaign['template_data']:
                # New format: template stored directly in campaign
                template_text = campaign['template_data']
                st.code(template_text[:500] + "..." if len(template_text) > 500 else template_text, language="html")
            else:
                # Fallback: try to load from MongoDB (for old campaigns)
                from mongo_utils import get_template_file_content
                template_content = get_template_file_content(campaign['template_file'], current_user_id)
                if template_content:
                    # Handle template content (could be string or bytes)
                    if isinstance(template_content, bytes):
                        template_text = template_content.decode('utf-8')
                    else:
                        template_text = template_content
                    st.code(template_text[:500] + "..." if len(template_text) > 500 else template_text, language="html")
                else:
                    st.error("❌ Template data not found in campaign or MongoDB")
            
            if st.button("🗑️ Remove Template"):
                campaign['template_file'] = None
                campaign['template_data'] = None
                save_user_data(CAMPAIGNS_FILE, campaigns)
                st.success("✅ Template removed")
                st.rerun()
    
    with tab4:
        st.write("**Campaign Settings:**")
        
        # Campaign start options (outside form for immediate response)
        st.write("**Campaign Start Options:**")
        start_option = st.radio(
            "Choose when to start:",
            ["Start Immediately", "Start Immediately + Daily Schedule", "Schedule for Specific Date", "Daily Schedule"],
            index=0 if not campaign.get('schedule_enabled') and not campaign.get('scheduled_date') and not campaign.get('start_immediate_daily') else (1 if campaign.get('start_immediate_daily') else (2 if campaign.get('scheduled_date') else 3)),
            key=f"start_option_{campaign_id}"
        )
        
        # Show scheduling inputs based on selection
        if start_option == "Start Immediately":
            campaign['schedule_enabled'] = False
            campaign['scheduled_date'] = None
            campaign['start_immediate_daily'] = False
            campaign['schedule_time'] = "10:00"
            st.info("🚀 Campaign will start immediately when launched")
        
        elif start_option == "Start Immediately + Daily Schedule":
            campaign['schedule_enabled'] = False
            campaign['scheduled_date'] = None
            campaign['start_immediate_daily'] = True
            daily_time = st.time_input(
                "Daily start time (for upcoming days)",
                value=datetime.datetime.strptime(campaign.get('schedule_time', '10:00'), "%H:%M").time(),
                key=f"immediate_daily_time_{campaign_id}"
            )
            campaign['schedule_time'] = daily_time.strftime("%H:%M")
            st.info(f"🚀 Campaign will start immediately today, then run daily at {daily_time.strftime('%I:%M %p')} starting tomorrow")
        
        elif start_option == "Schedule for Specific Date":
            campaign['schedule_enabled'] = False
            campaign['start_immediate_daily'] = False
            selected_date = st.date_input(
                "Select start date",
                value=datetime.datetime.strptime(campaign.get('scheduled_date', datetime.date.today().isoformat()), "%Y-%m-%d").date() if campaign.get('scheduled_date') else datetime.date.today(),
                key=f"date_{campaign_id}"
            )
            selected_time = st.time_input(
                "Select start time",
                value=datetime.datetime.strptime(campaign.get('schedule_time', '10:00'), "%H:%M").time(),
                key=f"time_{campaign_id}"
            )
            campaign['scheduled_date'] = selected_date.isoformat()
            campaign['schedule_time'] = selected_time.strftime("%H:%M")
            st.info(f"📅 Campaign scheduled for {selected_date.strftime('%B %d, %Y')} at {selected_time.strftime('%I:%M %p')}")
        
        elif start_option == "Daily Schedule":
            campaign['schedule_enabled'] = True
            campaign['scheduled_date'] = None
            campaign['start_immediate_daily'] = False
            daily_time = st.time_input(
                "Daily start time",
                value=datetime.datetime.strptime(campaign.get('schedule_time', '10:00'), "%H:%M").time(),
                key=f"daily_time_{campaign_id}"
            )
            campaign['schedule_time'] = daily_time.strftime("%H:%M")
            st.info(f"📅 Campaign will run daily at {daily_time.strftime('%I:%M %p')}")
        
        # Other settings in form
        with st.form("campaign_settings"):
            campaign['subject_line'] = st.text_input("Email Subject Line", value=campaign.get('subject_line', ''))
            campaign['daily_limit'] = st.number_input("Daily Limit (emails per account)", value=campaign.get('daily_limit', 120), min_value=1, max_value=500)
            campaign['delay'] = st.selectbox("Delay between emails (seconds)", [15, 30, 60, 120], index=[15, 30, 60, 120].index(campaign.get('delay', 30)))
            
            if st.form_submit_button("💾 Save Settings"):
                save_user_data(CAMPAIGNS_FILE, campaigns)
                st.success("✅ Settings saved!")
    
    # Tracking is now automatic - no manual setup needed
    
    # Close setup
    if st.button("❌ Close Setup"):
        st.session_state.show_campaign_details = None
        st.rerun()

# Active Campaign Page
elif page == "🎯 Active Campaign":
    st.header("🎯 Active Campaign")
    
    if st.session_state.get('current_campaign_id') and st.session_state.get('campaign_running', False):
        current_campaign_id = st.session_state.current_campaign_id
        
        # Check if campaign exists
        if current_campaign_id not in campaigns:
            st.error(f"❌ Active campaign not found. It may have been deleted.")
            st.session_state.current_campaign_id = None
            st.session_state.campaign_running = False
            st.rerun()
        
        current_campaign = campaigns[current_campaign_id]
        
        # Campaign info
        st.info(f"**Active Campaign:** {current_campaign.get('name', 'Unknown Campaign')}")
        subject_line = current_campaign.get('subject_line', 'No subject set')
        st.write(f"📧 Subject: {subject_line}")
        
        selected_senders = current_campaign.get('selected_senders', [])
        if selected_senders:
            st.write(f"📧 Senders: {', '.join(selected_senders)}")
        else:
            st.write("📧 Senders: No senders selected")
        
        delay = current_campaign.get('delay', 30)
        daily_limit = current_campaign.get('daily_limit', 120)
        st.write(f"⏱️ Delay: {delay}s | 📊 Daily Limit: {daily_limit}")
        
        # Show scheduling info
        schedule_time = current_campaign.get('schedule_time', '10:00')
        if current_campaign.get('schedule_enabled'):
            st.write(f"📅 Daily Schedule: {schedule_time}")
        elif current_campaign.get('start_immediate_daily'):
            st.write(f"🚀 Started immediately + Daily at {schedule_time}")
        elif current_campaign.get('scheduled_date'):
            try:
                scheduled_datetime = datetime.datetime.strptime(f"{current_campaign['scheduled_date']} {schedule_time}", "%Y-%m-%d %H:%M")
                st.write(f"📅 Scheduled for: {scheduled_datetime.strftime('%B %d, %Y at %I:%M %p')}")
            except (ValueError, KeyError):
                st.write("📅 Scheduled: Invalid date format")
        else:
            st.write("🚀 Ready to start immediately")
        
        # Controls
        col1, col2, col3 = st.columns(3)
        
        with col1:
            if st.button("⏸️ Pause Campaign", use_container_width=True):
                st.session_state.campaign_running = False
                campaigns[current_campaign_id]['status'] = 'paused'
                save_user_data(CAMPAIGNS_FILE, campaigns)
                st.success("⏸️ Campaign paused")
                st.rerun()
        
        with col2:
            if st.button("🔄 Reset Campaign", use_container_width=True):
                history = load_json(HISTORY_FILE,  {}, current_user_id)
                if current_campaign_id not in history:
                    history[current_campaign_id] = {}
                history[current_campaign_id]["sent"] = []
                history[current_campaign_id]["failed"] = []
                history[current_campaign_id]["processing"] = []
                history[current_campaign_id]["processing_timestamps"] = {}
                history[current_campaign_id]["daily_sent_tracking"] = {}
                save_user_data(HISTORY_FILE, history)
                
                campaigns[current_campaign_id]['stats']['total_sent'] = 0
                campaigns[current_campaign_id]['stats']['total_failed'] = 0
                save_user_data(CAMPAIGNS_FILE, campaigns)
                st.success("🔄 Campaign reset - all emails marked as unsent")
                st.rerun()
        
        with col3:
            if st.button("📊 View Analytics", use_container_width=True):
                st.session_state.show_analytics = True
                st.rerun()
        
        # Campaign execution
        if (current_campaign.get('leads_data') or current_campaign.get('leads_file')) and (current_campaign.get('template_data') or current_campaign.get('template_file')):
            st.subheader("📊 Campaign Progress")
            
            # Load campaign data
            history = load_json(HISTORY_FILE,  {}, current_user_id)
            if current_campaign_id not in history:
                history[current_campaign_id] = {}
            campaign_history = history[current_campaign_id]
            
            # Load leads from campaign data
            import io
            
            if 'leads_data' in current_campaign and current_campaign['leads_data']:
                # New format: leads stored directly in campaign
                df = pd.read_csv(io.StringIO(current_campaign['leads_data']))
            else:
                # Fallback: try to load from MongoDB (for old campaigns)
                from mongo_utils import get_lead_file_content
                lead_content = get_lead_file_content(current_campaign['leads_file'], current_user_id)
                if not lead_content:
                    st.error(f"❌ Lead data not found in campaign or MongoDB!")
                    st.stop()
                df = pd.read_csv(io.BytesIO(lead_content))
            
            # Enhanced deduplication system
            sent_emails = set(campaign_history.get("sent", []))
            failed_emails = set(campaign_history.get("failed", []))
            processing_emails = set(campaign_history.get("processing", []))
            
            # Remove any emails from processing that are older than 1 hour
            if "processing_timestamps" in campaign_history:
                current_time = datetime.datetime.now()
                valid_processing = {}
                for email, timestamp_str in campaign_history["processing_timestamps"].items():
                    try:
                        timestamp = datetime.datetime.fromisoformat(timestamp_str)
                        if (current_time - timestamp).total_seconds() < 3600:
                            valid_processing[email] = timestamp_str
                        else:
                            if email in processing_emails:
                                processing_emails.remove(email)
                    except:
                        pass
                campaign_history["processing_timestamps"] = valid_processing
            
            # Create comprehensive blacklist
            blacklisted_emails = sent_emails | failed_emails | processing_emails
            
            # Load template from campaign data
            if 'template_data' in current_campaign and current_campaign['template_data']:
                # New format: template stored directly in campaign
                html_template = current_campaign['template_data']
            else:
                # Fallback: try to load from MongoDB (for old campaigns)
                from mongo_utils import get_template_file_content
                template_content = get_template_file_content(current_campaign['template_file'], current_user_id)
                if not template_content:
                    st.error(f"❌ Template data not found in campaign or MongoDB!")
                    st.stop()
                
                # Handle template content (could be string or bytes)
                if isinstance(template_content, bytes):
                    html_template = template_content.decode('utf-8')
                else:
                    html_template = template_content
            
            limit = current_campaign.get("daily_limit", 120)
            delay_sec = int(current_campaign.get("delay", 30))
            subject_line = current_campaign.get("subject_line", "Your Subject Here")
            
            # Calculate progress with proper daily tracking
            total_leads = len(df)
            sent_count = len(sent_emails)
            failed_count = len(failed_emails)
            processing_count = len(processing_emails)
            remaining = total_leads - len(blacklisted_emails)
            
            # Calculate daily sent based on today's date
            today = datetime.date.today().isoformat()
            if "daily_sent_tracking" not in campaign_history:
                campaign_history["daily_sent_tracking"] = {}
            
            # Reset daily count if it's a new day
            if today not in campaign_history["daily_sent_tracking"]:
                campaign_history["daily_sent_tracking"][today] = 0
            
            daily_sent = campaign_history["daily_sent_tracking"][today]
            
            # Progress display
            col1, col2 = st.columns(2)
            
            with col1:
                progress = min(sent_count / total_leads, 1.0) if total_leads > 0 else 0
                st.progress(progress)
                st.write(f"📊 Progress: {sent_count}/{total_leads} emails sent ({progress:.1%})")
                st.write(f"📅 Today's sent: {daily_sent}/{limit}")
            
            with col2:
                st.write(f"📋 Remaining: {remaining} emails")
                st.write(f"❌ Failed: {failed_count} | ⏳ Processing: {processing_count}")
            
            # Campaign execution logic based on scheduling
            should_send = False
            current_datetime = datetime.datetime.now()
            
            # Check if campaign should run based on scheduling
            if current_campaign.get('schedule_enabled'):
                # Daily schedule
                current_time = current_datetime.time()
                try:
                    schedule_time = datetime.datetime.strptime(current_campaign.get('schedule_time', '10:00'), "%H:%M").time()
                except ValueError:
                    schedule_time = datetime.datetime.strptime('10:00', "%H:%M").time()
                
                if current_time >= schedule_time:
                    if daily_sent < limit:
                        should_send = True
                        st.info(f"⏰ Daily schedule triggered - starting batch...")
                    else:
                        st.info(f"📊 Daily limit already reached ({daily_sent}/{limit}). Waiting for tomorrow.")
                else:
                    next_run = datetime.datetime.combine(datetime.date.today(), schedule_time)
                    time_until = next_run - current_datetime
                    st.info(f"⏰ Next daily run: {next_run.strftime('%I:%M %p, %B %d')}")
                    if daily_sent >= limit:
                        st.info(f"📊 Daily limit reached ({daily_sent}/{limit}). Will continue tomorrow.")
            
            elif current_campaign.get('start_immediate_daily'):
                # Start immediately + daily schedule
                current_time = current_datetime.time()
                try:
                    schedule_time = datetime.datetime.strptime(current_campaign.get('schedule_time', '10:00'), "%H:%M").time()
                except ValueError:
                    schedule_time = datetime.datetime.strptime('10:00', "%H:%M").time()
                
                # Check if this is the first run today (no emails sent yet)
                if daily_sent == 0:
                    should_send = True
                    st.info("🚀 Starting campaign immediately (first run today)...")
                elif current_time >= schedule_time:
                    if daily_sent < limit:
                        should_send = True
                        st.info(f"⏰ Daily schedule triggered - starting batch...")
                    else:
                        st.info(f"📊 Daily limit already reached ({daily_sent}/{limit}). Waiting for tomorrow.")
                else:
                    next_run = datetime.datetime.combine(datetime.date.today(), schedule_time)
                    time_until = next_run - current_datetime
                    st.info(f"⏰ Next daily run: {next_run.strftime('%I:%M %p, %B %d')}")
                    if daily_sent >= limit:
                        st.info(f"📊 Daily limit reached ({daily_sent}/{limit}). Will continue tomorrow.")
            
            elif current_campaign.get('scheduled_date'):
                # Specific date schedule
                try:
                    scheduled_datetime = datetime.datetime.strptime(f"{current_campaign['scheduled_date']} {current_campaign.get('schedule_time', '10:00')}", "%Y-%m-%d %H:%M")
                except ValueError:
                    st.error("Invalid scheduled date format")
                    should_send = False
                
                if current_datetime >= scheduled_datetime:
                    should_send = True
                    st.info(f"⏰ Scheduled time reached - starting campaign...")
                    # Clear scheduled date after first run
                    campaigns[current_campaign_id]['scheduled_date'] = None
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                else:
                    time_until = scheduled_datetime - current_datetime
                    st.info(f"⏰ Scheduled for: {scheduled_datetime.strftime('%B %d, %Y at %I:%M %p')}")
                    st.info(f"⏰ Time remaining: {time_until.days}d {time_until.seconds//3600}h {(time_until.seconds%3600)//60}m")
            
            else:
                # Start immediately
                should_send = True
                st.info("🚀 Starting campaign immediately...")
                st.write(f"Debug: should_send = {should_send}, daily_sent = {daily_sent}, limit = {limit}")
            
            # Execute campaign if conditions are met
            if should_send:
                st.info("🚀 Executing campaign...")
                campaign_senders = current_campaign.get('selected_senders', [])
                selected_senders = [s for s in senders if s['email'] in campaign_senders]
                
                if not selected_senders:
                    st.error("❌ No valid senders found for this campaign!")
                    st.stop()
                
                batch_sent = 0
                
                # Find the next emails to send (skip already sent/failed emails)
                st.write(f"Debug: Processing {len(df)} leads, daily_sent: {daily_sent}, limit: {limit}")
                
                # Get unprocessed emails
                unprocessed_emails = []
                for idx, row in df.iterrows():
                    email = row['Emails']
                    if email not in blacklisted_emails:
                        unprocessed_emails.append((idx, row))
                
                # Process emails in batches
                batch_size = len(selected_senders)  # One email per sender per batch
                total_batches = (len(unprocessed_emails) + batch_size - 1) // batch_size
                
                # Show batch configuration
                st.info(f"📊 Batch Configuration: {batch_size} emails per batch (one per sender), {delay_sec}s pause between batches")
                st.info(f"🚀 Processing {len(unprocessed_emails)} emails in {total_batches} batches of {batch_size} emails each")
                
                for batch_num in range(total_batches):
                    # Check daily limit
                    if daily_sent + batch_sent >= limit:
                        st.info(f"📊 Daily limit reached ({limit} emails). Stopping for today.")
                        break
                    
                    # Get batch of emails
                    start_idx = batch_num * batch_size
                    end_idx = min(start_idx + batch_size, len(unprocessed_emails))
                    batch_emails = unprocessed_emails[start_idx:end_idx]
                    
                    if not batch_emails:
                        break
                    
                    st.write(f"📦 Processing batch {batch_num + 1}/{total_batches} ({len(batch_emails)} emails)")
                    
                    # Prepare batch data
                    batch_recipients = []
                    batch_personalized_templates = {}
                    batch_sender_names = {}
                    
                    for idx, row in batch_emails:
                        email = row['Emails']
                        
                        # Mark as processing
                        processing_emails.add(email)
                        if "processing_timestamps" not in campaign_history:
                            campaign_history["processing_timestamps"] = {}
                        campaign_history["processing_timestamps"][email] = datetime.datetime.now().isoformat()
                        
                        # Personalize template for this specific recipient
                        personalized_template = html_template
                        for column in row.index:
                            placeholder = f"{{{{{column}}}}}"
                            if placeholder in personalized_template:
                                personalized_template = personalized_template.replace(placeholder, str(row[column]))
                        
                        batch_recipients.append(email)
                        batch_personalized_templates[email] = personalized_template
                        
                        # Add sender name if available
                        if 'Name' in row.index:
                            batch_sender_names[email] = str(row['Name'])
                    
                    # Send batch using threading
                    from email_sender import send_batch_emails
                    
                    st.write(f"🚀 Sending batch of {len(batch_recipients)} emails simultaneously...")
                    batch_results = send_batch_emails(
                        selected_senders, 
                        batch_recipients, 
                        subject_line, 
                        html_template,  # Fallback template
                        batch_sender_names,
                        current_campaign.get('name', 'Unknown Campaign'),
                        current_campaign_id,
                        get_current_user_id(),
                        batch_personalized_templates  # Pass personalized templates
                    )
                    
                    # Process results
                    for email in batch_recipients:
                        processing_emails.discard(email)
                        if "processing_timestamps" in campaign_history and email in campaign_history["processing_timestamps"]:
                            del campaign_history["processing_timestamps"][email]
                    
                    # Update status based on results
                    for email in batch_results['sent']:
                        sent_emails.add(email)
                        batch_sent += 1
                        campaign_history["daily_sent_tracking"][today] += 1
                        st.success(f"✅ Sent to {email}")
                    
                    for email in batch_results['failed']:
                        failed_emails.add(email)
                        st.error(f"❌ Failed to send to {email}")
                    
                    # Update history
                    campaign_history.update({
                        "sent": list(sent_emails),
                        "failed": list(failed_emails),
                        "processing": list(processing_emails)
                    })
                    save_user_data(HISTORY_FILE, history)
                    
                    # Update campaign stats
                    campaigns[current_campaign_id]['stats']['total_sent'] = len(sent_emails)
                    campaigns[current_campaign_id]['stats']['total_failed'] = len(failed_emails)
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    
                    # Pause between batches (except for the last batch)
                    if batch_num < total_batches - 1:
                        st.write(f"⏸️ Pausing for {delay_sec} seconds before next batch...")
                        time.sleep(delay_sec)
                
                if batch_sent > 0:
                    st.success(f"🎉 Batch complete. Sent {batch_sent} emails today.")
                    st.info(f"📊 Daily progress: {daily_sent + batch_sent}/{limit} emails sent today")
                else:
                    st.info("📊 No new emails sent (daily limit reached or all emails processed)")
            else:
                # Show why campaign is not executing
                if current_campaign.get('schedule_enabled'):
                    current_time = datetime.datetime.now().time()
                    try:
                        schedule_time = datetime.datetime.strptime(current_campaign.get('schedule_time', '10:00'), "%H:%M").time()
                    except ValueError:
                        schedule_time = datetime.datetime.strptime('10:00', "%H:%M").time()
                    
                    if current_time < schedule_time:
                        next_run = datetime.datetime.combine(datetime.date.today(), schedule_time)
                        st.info(f"⏰ Waiting for scheduled time: {next_run.strftime('%I:%M %p')}")
                    elif daily_sent >= limit:
                        st.info(f"📊 Daily limit reached ({daily_sent}/{limit}). Will continue tomorrow.")
                    else:
                        st.info("⏰ Daily schedule not yet triggered")
                elif current_campaign.get('start_immediate_daily'):
                    if daily_sent == 0:
                        st.info("🚀 Campaign should start immediately...")
                    elif daily_sent >= limit:
                        st.info(f"📊 Daily limit reached ({daily_sent}/{limit}). Will continue tomorrow.")
                    else:
                        current_time = datetime.datetime.now().time()
                        try:
                            schedule_time = datetime.datetime.strptime(current_campaign.get('schedule_time', '10:00'), "%H:%M").time()
                        except ValueError:
                            schedule_time = datetime.datetime.strptime('10:00', "%H:%M").time()
                        
                        if current_time < schedule_time:
                            next_run = datetime.datetime.combine(datetime.date.today(), schedule_time)
                            st.info(f"⏰ Waiting for daily schedule: {next_run.strftime('%I:%M %p')}")
                        else:
                            st.info("⏰ Daily schedule not yet triggered")
                elif current_campaign.get('scheduled_date'):
                    try:
                        scheduled_datetime = datetime.datetime.strptime(f"{current_campaign['scheduled_date']} {current_campaign.get('schedule_time', '10:00')}", "%Y-%m-%d %H:%M")
                        if datetime.datetime.now() < scheduled_datetime:
                            time_until = scheduled_datetime - datetime.datetime.now()
                            st.info(f"⏰ Waiting for scheduled time: {scheduled_datetime.strftime('%B %d, %Y at %I:%M %p')}")
                        else:
                            st.info("⏰ Scheduled time reached but campaign not executing")
                    except (ValueError, KeyError):
                        st.info("⏰ Invalid scheduled date format")
                else:
                    st.info("🚀 Campaign should start immediately...")
    else:
        st.info("📋 No active campaign. Go to 'Manage Campaigns' to start a campaign.")

# Tracker Page
elif page == "📈 Tracker":
    st.header("📈 Email Tracking Analytics")
    
    if not campaigns:
        st.info("📋 No campaigns yet. Create a campaign first to get tracking code!")
    else:
        # Campaign selection
        st.subheader("🎯 Select Campaign")
        
        # Get available campaigns from system (user-specific)
        campaign_names = {campaign['name']: campaign_id for campaign_id, campaign in campaigns.items()}
        
        # Also check for tracking data that might not have corresponding campaigns (user-specific)
        try:
            import pymongo
            from pymongo import MongoClient
            tracker_uri = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
            tracker_client = MongoClient(tracker_uri, serverSelectionTimeoutMS=5000)
            tracker_db = tracker_client['email_tracker']
            tracker_collection = tracker_db['email_tracking']
            
            # Get campaign names from tracking data (all tracking data)
            all_tracking_campaign_names = tracker_collection.distinct('campaign_name')
            
            # Filter to only show campaigns that belong to current user
            user_campaign_names = [campaigns[cid].get('name', '') for cid in campaigns.keys()]
            tracking_campaign_names = [name for name in all_tracking_campaign_names if name in user_campaign_names]
            
            # Add tracking-only campaigns to the dropdown (only for current user)
            for track_name in tracking_campaign_names:
                if track_name and track_name not in [campaigns[cid].get('name', '') for cid in campaigns.keys()]:
                    campaign_names[f"📊 Tracking Data: {track_name}"] = track_name
            
            tracker_client.close()
        except:
            pass
        
        if campaign_names:
            selected_campaign_name = st.selectbox(
                "Choose Campaign:",
                options=list(campaign_names.keys()),
                help="Select a campaign to view its tracking code and analytics. Campaigns starting with 📊 are from tracking data only."
            )
        else:
            st.warning("No campaigns available. Create a campaign first!")
            selected_campaign_name = None
        
        if selected_campaign_name:
            selected_campaign_id = campaign_names[selected_campaign_name]
            
            # Handle tracking-only campaigns (not in campaigns dict)
            if selected_campaign_id in campaigns:
                selected_campaign = campaigns[selected_campaign_id]
            else:
                # This is a tracking-only campaign
                selected_campaign = {
                    'name': f"Tracking Data: {selected_campaign_id[:8]}...",
                    'id': selected_campaign_id,
                    'stats': {'total_leads': 0, 'total_sent': 0, 'total_failed': 0},
                    'leads_file': None
                }
            
            st.info(f"📊 Viewing data for: **{selected_campaign_name}**")
            
            # Create tabs for different views
            tab1, tab2, tab3, tab4 = st.tabs(["📋 Tracking Code", "📊 Analytics", "📈 Real-time Data", "📋 Campaign Table"])
            
            with tab1:
                st.subheader("📋 Your Tracking Code")
                st.markdown("""
                **🎯 How to use this tracking code:**
                1. Copy the code below
                2. Paste it into your HTML email template
                3. Replace `{{email}}` with the recipient's email
                4. Replace `{{original_url}}` with your actual URLs
                5. The system will automatically track opens and clicks
                """)
                
                # Display tracking code
                if 'tracking_code' in selected_campaign:
                    st.code(selected_campaign['tracking_code'], language='html')
                    
                    # Copy button
                    st.button("📋 Copy Code", key=f"copy_{selected_campaign_id}")
                    st.success("✅ Code copied to clipboard!")
                else:
                    # Generate tracking code for existing campaigns
                    tracking_code = generate_tracking_code(selected_campaign['name'])
                    selected_campaign['tracking_code'] = tracking_code
                    campaigns[selected_campaign_id] = selected_campaign
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    
                    st.code(tracking_code, language='html')
                    st.success("✅ Generated tracking code for this campaign!")
                
                # Campaign info
                st.subheader("📊 Campaign Information")
                col1, col2, col3 = st.columns(3)
                with col1:
                    st.metric("Total Leads", selected_campaign.get('stats', {}).get('total_leads', 0))
                with col2:
                    st.metric("Emails Sent", selected_campaign.get('stats', {}).get('total_sent', 0))
                with col3:
                    st.metric("Emails Failed", selected_campaign.get('stats', {}).get('total_failed', 0))
            
            with tab2:
                st.subheader("📊 Tracking Analytics")
                
                # Try to connect to tracker database
                try:
                    import pymongo
                    from pymongo import MongoClient
                    
                    # Connect to tracker database
                    tracker_uri = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
                    tracker_client = MongoClient(tracker_uri, serverSelectionTimeoutMS=5000)
                    tracker_db = tracker_client['email_tracker']
                    tracker_collection = tracker_db['email_tracking']
                    
                    # Test connection
                    tracker_client.admin.command('ping')
                    
                    # Get the actual campaign name for this campaign
                    if selected_campaign_id in campaigns:
                        actual_campaign_name = campaigns[selected_campaign_id]['name']
                    else:
                        # This is a tracking-only campaign, use the ID as the name
                        actual_campaign_name = selected_campaign_id
                    
                    # Get tracking data for this campaign using campaign name
                    # (Only campaigns belonging to current user are shown, so this is safe)
                    campaign_tracking = list(tracker_collection.find(
                        {'campaign_name': actual_campaign_name}, 
                        {'_id': 0}
                    ).sort('timestamp', -1))
                    
                    if campaign_tracking:
                        # Separate open and click events
                        open_events = [event for event in campaign_tracking if event['type'] == 'open']
                        click_events = [event for event in campaign_tracking if event['type'] == 'click']
                        
                        # Summary metrics
                        col1, col2, col3, col4 = st.columns(4)
                        with col1:
                            st.metric("Total Opens", len(open_events))
                        with col2:
                            st.metric("Total Clicks", len(click_events))
                        with col3:
                            unique_opens = len(set(event['email'] for event in open_events))
                            st.metric("Unique Opens", unique_opens)
                        with col4:
                            unique_clicks = len(set(event['email'] for event in click_events))
                            st.metric("Unique Clicks", unique_clicks)
                        
                        # Simple Tracking Table
                        if open_events:
                            st.subheader("📊 Email Opens")
                            tracking_table = []
                            for event in open_events:
                                tracking_table.append({
                                    'Email': event.get('email', 'N/A'),
                                    'Name': event.get('name', 'N/A'),
                                    'Instagram': event.get('instagram', 'N/A'),
                                    'Time': event.get('time', 'N/A'),
                                    'Date': event.get('date', 'N/A'),
                                    'Open Count': event.get('open_count', 1),
                                    'Last Open': event.get('last_opened', 'N/A')
                                })
                            
                            if tracking_table:
                                tracking_df = pd.DataFrame(tracking_table)
                                st.dataframe(tracking_df, use_container_width=True)
                                
                                # Download tracking data
                                csv_data = tracking_df.to_csv(index=False)
                                st.download_button(
                                    label="📥 Download Tracking Data (CSV)",
                                    data=csv_data,
                                    file_name=f"{actual_campaign_name}_tracking.csv",
                                    mime="text/csv"
                                )
                        
                        # Click tracking section
                        if click_events:
                            st.subheader("🔗 Link Clicks")
                            click_df = []
                            for event in click_events:
                                click_df.append({
                                    'Email': event.get('email', 'N/A'),
                                    'Name': event.get('name', 'N/A'),
                                    'Instagram': event.get('instagram', 'N/A'),
                                    'Time': event.get('time', 'N/A'),
                                    'Date': event.get('date', 'N/A'),
                                    'Clicked URL': event.get('redirect_url', 'N/A')
                                })
                            
                            click_df = pd.DataFrame(click_df)
                            st.dataframe(click_df, use_container_width=True)
                            
                            # Download click data
                            csv_click_data = click_df.to_csv(index=False)
                            st.download_button(
                                label="📥 Download Click Data (CSV)",
                                data=csv_click_data,
                                file_name=f"{actual_campaign_name}_clicks.csv",
                                mime="text/csv"
                            )
                        

                    
                    else:
                        st.info("📊 No tracking data found for this campaign.")
                        

                        
                except Exception as e:
                    st.error(f"❌ Error connecting to tracker database: {e}")
                    st.info("💡 Make sure your tracker server is running on port 3003")
            
            with tab3:
                st.subheader("📈 Recent Activity")
                
                if st.button("🔄 Refresh Data"):
                    st.rerun()
                
                try:
                    if 'campaign_tracking' in locals() and campaign_tracking:
                        recent_events = campaign_tracking[:5]  # Show last 5 events
                        
                        for event in recent_events:
                            timestamp = event.get('timestamp', 'N/A')
                            email = event.get('email', 'N/A')
                            
                            if event['type'] == 'open':
                                count = event.get('open_count', 1)
                                st.info(f"📧 {email} opened email ({count} time(s))")
                            elif event['type'] == 'click':
                                url = event.get('redirect_url', 'N/A')
                                st.success(f"🔗 {email} clicked: {url}")
                    else:
                        st.info("📊 No recent activity to display")
                except:
                    st.info("📊 No tracking data available yet")
            
            with tab4:
                st.subheader("📋 Tracking Table")
                
                # Try to fetch data from the new table API endpoint
                try:
                    import requests
                    import urllib.parse
                    
                    # Get the actual campaign name for this campaign
                    if selected_campaign_id in campaigns:
                        actual_campaign_name = campaigns[selected_campaign_id]['name']
                    else:
                        # This is a tracking-only campaign, use the ID as the name
                        actual_campaign_name = selected_campaign_id
                    
                    # Encode campaign name for URL
                    encoded_campaign_name = urllib.parse.quote(actual_campaign_name)
                    
                    # Fetch data from tracker API
                    # (Only campaigns belonging to current user are shown, so this is safe)
                    response = requests.get(f"http://localhost:3003/table/{encoded_campaign_name}", timeout=5)
                    
                    if response.status_code == 200:
                        data = response.json()
                        
                        if data.get('success') and data.get('data'):
                            tracking_data = data['data']
                            
                            # Create DataFrame with the exact columns requested
                            table_data = []
                            for record in tracking_data:
                                table_data.append({
                                    'Email': record.get('email', 'N/A'),
                                    'Name': record.get('name', 'N/A'),
                                    'UID': record.get('uid', 'N/A'),
                                    'Instagram': record.get('instagram', 'N/A'),
                                    'Time': record.get('time', 'N/A'),
                                    'Date': record.get('date', 'N/A'),
                                    'Open Count': record.get('open_count', 0),
                                    'Last Open': record.get('last_open', 'N/A')
                                })
                            
                            if table_data:
                                df = pd.DataFrame(table_data)
                                
                                # Display the table
                                st.dataframe(
                                    df,
                                    use_container_width=True,
                                    column_config={
                                        "Email": st.column_config.TextColumn("📧 Email", width="large"),
                                        "Name": st.column_config.TextColumn("👤 Name", width="medium"),
                                        "UID": st.column_config.TextColumn("🆔 UID", width="medium"),
                                        "Instagram": st.column_config.TextColumn("📱 Instagram", width="medium"),
                                        "Time": st.column_config.TextColumn("🕐 Time", width="small"),
                                        "Date": st.column_config.TextColumn("📅 Date", width="small"),
                                        "Open Count": st.column_config.NumberColumn("🔢 Opens", width="small"),
                                        "Last Open": st.column_config.TextColumn("🕕 Last Open", width="medium")
                                    }
                                )
                                
                                # Download button
                                csv_data = df.to_csv(index=False)
                                st.download_button(
                                    label="📥 Download Campaign Table (CSV)",
                                    data=csv_data,
                                    file_name=f"{actual_campaign_name}_campaign_table.csv",
                                    mime="text/csv"
                                )
                                
                                st.success(f"✅ Found {len(table_data)} tracking records for campaign: {actual_campaign_name}")
                            else:
                                st.info("📊 No tracking data found for this campaign yet")
                        else:
                            st.info("📊 No tracking data available for this campaign")
                    else:
                        st.warning(f"⚠️ Could not connect to tracker API (Status: {response.status_code})")
                        
                except requests.exceptions.ConnectionError:
                    st.error("❌ Could not connect to tracker server. Make sure it's running on port 3003")
                except Exception as e:
                    st.error(f"❌ Error fetching campaign table data: {e}")
                    st.info("💡 Make sure your tracker server is running and accessible")

# Requirements Page
elif page == "📋 Requirements":
    from requirements_page import show_requirements_page
    show_requirements_page()

# Profile Page
elif page == "👤 Profile":
    from auth_ui import show_user_profile
    show_user_profile()

# Resources Page
elif page == "📚 Resources":
    st.header("📚 Resources Management")
    
    # Custom CSS for better button styling
    st.markdown("""
    <style>
    .stButton > button {
        border-radius: 8px;
        border: 1px solid #ddd;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-weight: 500;
        padding: 8px 16px;
        transition: all 0.3s ease;
    }
    .stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .stDownloadButton > button {
        border-radius: 8px;
        border: 1px solid #ddd;
        background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        color: white;
        font-weight: 500;
        padding: 8px 16px;
        transition: all 0.3s ease;
    }
    .stDownloadButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Check for orphaned files across all types
    orphaned_leads = []
    orphaned_templates = []
    
    # Files to exclude from orphaned detection (intentional default files)
    excluded_leads = {'leads.csv'}
    excluded_templates = {'text.html', 'user_template.html'}
    
    # Get files from MongoDB
    from mongo_utils import get_lead_files, get_template_files
    
    mongo_leads = get_lead_files(current_user_id)
    mongo_templates = get_template_files(current_user_id)
    
    # Check for orphaned files
    for lead in mongo_leads:
        if lead['campaign_id'] not in campaigns and lead['filename'] not in excluded_leads:
            orphaned_leads.append(lead['filename'])
    
    for template in mongo_templates:
        if template['campaign_id'] not in campaigns and template['filename'] not in excluded_templates:
            orphaned_templates.append(template['filename'])
    
    # Show cleanup options if there are orphaned files
    if orphaned_leads or orphaned_templates:
        st.warning(f"🚨 Found {len(orphaned_leads)} orphaned lead files and {len(orphaned_templates)} orphaned templates!")
        
        col1, col2, col3 = st.columns([2, 2, 1])
        with col1:
            if orphaned_leads:
                st.write(f"**Orphaned Lead Files:** {len(orphaned_leads)}")
                for file in orphaned_leads[:3]:  # Show first 3
                    st.write(f"• {file}")
                if len(orphaned_leads) > 3:
                    st.write(f"... and {len(orphaned_leads) - 3} more")
        
        with col2:
            if orphaned_templates:
                st.write(f"**Orphaned Templates:** {len(orphaned_templates)}")
                for file in orphaned_templates[:3]:  # Show first 3
                    st.write(f"• {file}")
                if len(orphaned_templates) > 3:
                    st.write(f"... and {len(orphaned_templates) - 3} more")
        
        with col3:
            if st.button("🧹 Clean All Orphaned Files", help="Remove all orphaned files at once"):
                cleaned_count = 0
                
                from mongo_utils import delete_lead_file, delete_template_file
                
                # Clean orphaned leads
                for file in orphaned_leads:
                    try:
                        # Remove from MongoDB only (no file system files)
                        delete_lead_file(file, current_user_id)
                        cleaned_count += 1
                    except Exception as e:
                        st.error(f"❌ Failed to remove {file}: {e}")
                
                # Clean orphaned templates
                for file in orphaned_templates:
                    try:
                        # Remove from MongoDB only (no file system files)
                        delete_template_file(file, current_user_id)
                        cleaned_count += 1
                    except Exception as e:
                        st.error(f"❌ Failed to remove {file}: {e}")
                
                if cleaned_count > 0:
                    st.success(f"✅ Cleaned up {cleaned_count} orphaned files!")
                    st.rerun()
        
        # Note about excluded files
        st.info("ℹ️ **Note:** Default files like `leads.csv`, `text.html`, and `user_template.html` are preserved and not considered orphaned.")
        
        st.markdown("---")
    
    # Create tabs for different resource types
    tab1, tab2, tab3 = st.tabs(["📊 Lead Files", "📝 Email Templates", "📋 Campaign Assets"])
    
    with tab1:
        st.subheader("📊 Lead Files")
        
        # Get all lead files from MongoDB
        from mongo_utils import get_lead_files
        
        mongo_leads = get_lead_files(current_user_id)
        lead_files = []
        
        for lead in mongo_leads:
            # Get campaign name if available
            campaign_name = "Unknown Campaign"
            if lead['campaign_id'] in campaigns:
                campaign_name = campaigns[lead['campaign_id']].get('name', 'Unknown Campaign')
            
            lead_files.append({
                'filename': lead['filename'],
                'path': lead['file_path'],
                'size': lead['file_size'],
                'date': lead['file_date'],
                'campaign_id': lead['campaign_id'],
                'campaign_name': campaign_name
            })
        
        # Filter out files with unknown campaigns (orphaned files)
        valid_lead_files = [f for f in lead_files if f['campaign_name'] != "Unknown Campaign"]
        orphaned_lead_files = [f for f in lead_files if f['campaign_name'] == "Unknown Campaign"]
        
        if valid_lead_files:
            # Sort by date (newest first)
            valid_lead_files.sort(key=lambda x: x['date'], reverse=True)
            
            st.write(f"**📊 Valid Lead Files:** {len(valid_lead_files)}")
            
            # Display valid lead files in a table
            for i, lead_file in enumerate(valid_lead_files):
                with st.container():
                    st.markdown("---")
                    col1, col2, col3, col4, col5 = st.columns([3, 2, 2, 2, 2])
                    
                    with col1:
                        st.write(f"**{lead_file['filename']}**")
                        st.write(f"Campaign: {lead_file['campaign_name']}")
                    
                    with col2:
                        st.write(f"📅 {lead_file['date'].strftime('%Y-%m-%d %H:%M')}")
                    
                    with col3:
                        size_mb = lead_file['size'] / (1024 * 1024)
                        st.write(f"📏 {size_mb:.2f} MB")
                    
                    with col4:
                        # Show sample data from MongoDB content
                        try:
                            from mongo_utils import get_lead_file_content
                            file_content = get_lead_file_content(lead_file['filename'], current_user_id)
                            if file_content:
                                # Convert bytes to string and parse CSV
                                import io
                                df_sample = pd.read_csv(io.BytesIO(file_content), nrows=3)
                                st.write(f"📊 {len(df_sample.columns)} columns")
                                st.write(f"📋 Sample rows: {len(df_sample)}")
                            else:
                                st.write("❌ No content found")
                        except Exception as e:
                            st.write("❌ Error reading content")
                    
                    with col5:
                        # Use download_button with MongoDB content
                        from mongo_utils import get_lead_file_content
                        file_content = get_lead_file_content(lead_file['filename'], current_user_id)
                        if file_content:
                            st.download_button(
                                label="📥 Download CSV",
                                data=file_content,
                                file_name=lead_file['filename'],
                                mime="text/csv",
                                use_container_width=True,
                                key=f"download_leads_{i}"
                            )
                        else:
                            st.error("❌ File content not found")
        
        # Show orphaned files section
        if orphaned_lead_files:
            st.markdown("---")
            st.subheader("🗑️ Orphaned Files (No Associated Campaign)")
            st.warning(f"Found {len(orphaned_lead_files)} lead files that are not associated with any campaign.")
            
            col1, col2 = st.columns([3, 1])
            with col1:
                st.write("**Orphaned Files:**")
                for orphaned_file in orphaned_lead_files:
                    st.write(f"• {orphaned_file['filename']} ({orphaned_file['date'].strftime('%Y-%m-%d')})")
            
            with col2:
                if st.button("🧹 Clean Up Orphaned Files", help="Remove all orphaned lead files"):
                    cleaned_count = 0
                    from mongo_utils import delete_lead_file
                    
                    for orphaned_file in orphaned_lead_files:
                        try:
                            # Remove from MongoDB only (no file system files)
                            delete_lead_file(orphaned_file['filename'], current_user_id)
                            cleaned_count += 1
                        except Exception as e:
                            st.error(f"❌ Failed to remove {orphaned_file['filename']}: {e}")
                    
                    if cleaned_count > 0:
                        st.success(f"✅ Cleaned up {cleaned_count} orphaned files!")
                        st.rerun()
        
        if not valid_lead_files and not orphaned_lead_files:
            st.info("📁 No lead files found. Upload lead files in campaigns to see them here.")
            
            # Bulk actions for valid files only
            if valid_lead_files:
                st.subheader("🔄 Bulk Actions")
                col1, col2 = st.columns(2)
                
                with col1:
                    if st.button("📊 Analyze Valid Files", help="Show statistics for valid lead files"):
                        total_rows = 0
                        total_columns = 0
                        file_stats = []
                        
                        for lead_file in valid_lead_files:
                            try:
                                from mongo_utils import get_lead_file_content
                                file_content = get_lead_file_content(lead_file['filename'], current_user_id)
                                if file_content:
                                    import io
                                    df = pd.read_csv(io.BytesIO(file_content))
                                    rows = len(df)
                                    cols = len(df.columns)
                                    total_rows += rows
                                    total_columns += cols
                                    
                                    file_stats.append({
                                        'file': lead_file['filename'],
                                        'rows': rows,
                                        'columns': cols,
                                        'size_mb': lead_file['size'] / (1024 * 1024)
                                    })
                                else:
                                    st.warning(f"No content found for {lead_file['filename']}")
                            except Exception as e:
                                st.error(f"Error reading {lead_file['filename']}: {e}")
                        
                        st.write(f"**📊 Valid Files Statistics:**")
                        st.write(f"- Total Valid Files: {len(valid_lead_files)}")
                        st.write(f"- Total Rows: {total_rows:,}")
                        st.write(f"- Total Columns: {total_columns}")
                        
                        # Show file statistics
                        if file_stats:
                            st.write("**📋 File Details:**")
                            for stat in file_stats:
                                st.write(f"- {stat['file']}: {stat['rows']:,} rows, {stat['columns']} columns, {stat['size_mb']:.2f} MB")
                
                with col2:
                    if st.button("📋 Export File List", help="Export list of valid lead files"):
                        file_list = []
                        for lead_file in valid_lead_files:
                            file_list.append({
                                'filename': lead_file['filename'],
                                'campaign': lead_file['campaign_name'],
                                'date': lead_file['date'].strftime('%Y-%m-%d %H:%M'),
                                'size_mb': round(lead_file['size'] / (1024 * 1024), 2)
                            })
                        
                        if file_list:
                            df_export = pd.DataFrame(file_list)
                            csv_data = df_export.to_csv(index=False)
                            st.download_button(
                                label="📥 Download File List",
                                data=csv_data,
                                file_name="valid_lead_files.csv",
                                mime="text/csv"
                            )
        else:
            st.info("📁 No lead files found. Upload lead files in campaigns to see them here.")
    
    with tab2:
        st.subheader("📝 Email Templates")
        
        # Get all template files from MongoDB
        from mongo_utils import get_template_files
        
        mongo_templates = get_template_files(current_user_id)
        template_files = []
        
        for template in mongo_templates:
            # Get campaign name if available
            campaign_name = "Unknown Campaign"
            if template['campaign_id'] in campaigns:
                campaign_name = campaigns[template['campaign_id']].get('name', 'Unknown Campaign')
            
            template_files.append({
                'filename': template['filename'],
                'path': template['file_path'],
                'size': template['file_size'],
                'date': template['file_date'],
                'campaign_id': template['campaign_id'],
                'campaign_name': campaign_name
            })
        
        # Filter out files with unknown campaigns (orphaned files)
        valid_template_files = [f for f in template_files if f['campaign_name'] != "Unknown Campaign"]
        orphaned_template_files = [f for f in template_files if f['campaign_name'] == "Unknown Campaign"]
        
        if valid_template_files:
            # Sort by date (newest first)
            valid_template_files.sort(key=lambda x: x['date'], reverse=True)
            
            st.write(f"**📝 Valid Templates:** {len(valid_template_files)}")
            
            # Display valid template files
            for i, template_file in enumerate(valid_template_files):
                with st.container():
                    st.markdown("---")
                    col1, col2, col3, col4, col5 = st.columns([3, 2, 2, 2, 2])
                    
                    with col1:
                        st.write(f"**{template_file['filename']}**")
                        st.write(f"Campaign: {template_file['campaign_name']}")
                    
                    with col2:
                        st.write(f"📅 {template_file['date'].strftime('%Y-%m-%d %H:%M')}")
                    
                    with col3:
                        size_kb = template_file['size'] / 1024
                        st.write(f"📏 {size_kb:.1f} KB")
                    
                    with col4:
                        # Show template preview from MongoDB content
                        try:
                            from mongo_utils import get_template_file_content
                            content = get_template_file_content(template_file['filename'], current_user_id)
                            if content:
                                preview = content[:100] + "..." if len(content) > 100 else content
                                st.write(f"📝 Preview: {preview}")
                            else:
                                st.write("❌ No content found")
                        except Exception as e:
                            st.write("❌ Error reading content")
                    
                    with col5:
                        # Stack buttons vertically for better layout
                        if st.button("👁️ Preview", key=f"preview_template_{i}", use_container_width=True):
                            try:
                                from mongo_utils import get_template_file_content
                                content = get_template_file_content(template_file['filename'], current_user_id)
                                if content:
                                    st.code(content, language="html")
                                else:
                                    st.error("Template content not found")
                            except Exception as e:
                                st.error(f"Error reading template: {e}")
                        
                        # Add some spacing between buttons
                        st.markdown("<div style='margin: 8px 0;'></div>", unsafe_allow_html=True)
                        
                        # Use download_button with MongoDB content
                        from mongo_utils import get_template_file_content
                        content = get_template_file_content(template_file['filename'], current_user_id)
                        if content:
                            st.download_button(
                                label="📥 Download HTML",
                                data=content,
                                file_name=template_file['filename'],
                                mime="text/html",
                                use_container_width=True,
                                key=f"download_template_{i}"
                            )
                        else:
                            st.error("❌ File content not found")
        
        # Show orphaned templates section
        if orphaned_template_files:
            st.markdown("---")
            st.subheader("🗑️ Orphaned Templates (No Associated Campaign)")
            st.warning(f"Found {len(orphaned_template_files)} template files that are not associated with any campaign.")
            
            col1, col2 = st.columns([3, 1])
            with col1:
                st.write("**Orphaned Templates:**")
                for orphaned_file in orphaned_template_files:
                    st.write(f"• {orphaned_file['filename']} ({orphaned_file['date'].strftime('%Y-%m-%d')})")
            
            with col2:
                if st.button("🧹 Clean Up Orphaned Templates", help="Remove all orphaned template files"):
                    cleaned_count = 0
                    from mongo_utils import delete_template_file
                    
                    for orphaned_file in orphaned_template_files:
                        try:
                            # Remove from MongoDB only (no file system files)
                            delete_template_file(orphaned_file['filename'], current_user_id)
                            cleaned_count += 1
                        except Exception as e:
                            st.error(f"❌ Failed to remove {orphaned_file['filename']}: {e}")
                    
                    if cleaned_count > 0:
                        st.success(f"✅ Cleaned up {cleaned_count} orphaned templates!")
                        st.rerun()
        
        # Template management for valid files only
        if valid_template_files:
            st.subheader("🔄 Template Management")
            col1, col2 = st.columns(2)
            
            with col1:
                if st.button("📊 Template Statistics", help="Show statistics for valid templates"):
                    total_size = sum(t['size'] for t in valid_template_files)
                    avg_size = total_size / len(valid_template_files) if valid_template_files else 0
                    
                    st.write(f"**📊 Valid Templates Statistics:**")
                    st.write(f"- Total Valid Templates: {len(valid_template_files)}")
                    st.write(f"- Total Size: {total_size / 1024:.1f} KB")
                    st.write(f"- Average Size: {avg_size / 1024:.1f} KB")
                    
                    # Show size distribution
                    small_templates = [t for t in valid_template_files if t['size'] < 1024]  # < 1KB
                    medium_templates = [t for t in valid_template_files if 1024 <= t['size'] < 10240]  # 1-10KB
                    large_templates = [t for t in valid_template_files if t['size'] >= 10240]  # >= 10KB
                    
                    st.write(f"- Small templates (<1KB): {len(small_templates)}")
                    st.write(f"- Medium templates (1-10KB): {len(medium_templates)}")
                    st.write(f"- Large templates (≥10KB): {len(large_templates)}")
            
            with col2:
                if st.button("📋 Export Template List", help="Export list of valid templates"):
                    template_list = []
                    for template_file in valid_template_files:
                        template_list.append({
                            'filename': template_file['filename'],
                            'campaign': template_file['campaign_name'],
                            'date': template_file['date'].strftime('%Y-%m-%d %H:%M'),
                            'size_kb': round(template_file['size'] / 1024, 1)
                        })
                    
                    if template_list:
                        df_export = pd.DataFrame(template_list)
                        csv_data = df_export.to_csv(index=False)
                        st.download_button(
                            label="📥 Download Template List",
                            data=csv_data,
                            file_name="valid_templates.csv",
                            mime="text/csv"
                        )
    
    with tab3:
        st.subheader("📋 Campaign Assets")
        
        # Show campaigns with their assets
        if campaigns:
            st.write(f"**Total Campaigns:** {len(campaigns)}")
            
            for campaign_id, campaign in campaigns.items():
                with st.container():
                    st.markdown("---")
                    col1, col2, col3 = st.columns([3, 2, 1])
                    
                    with col1:
                        st.write(f"**{campaign.get('name', 'Unnamed Campaign')}**")
                        if campaign.get('description'):
                            st.write(f"*{campaign['description']}*")
                        st.write(f"Status: {campaign.get('status', 'draft').title()}")
                    
                    with col2:
                        # Show assets
                        assets = []
                        if campaign.get('leads_file'):
                            assets.append(f"📊 Leads: {os.path.basename(campaign['leads_file'])}")
                        if campaign.get('template_file'):
                            assets.append(f"📝 Template: {os.path.basename(campaign['template_file'])}")
                        if campaign.get('selected_senders'):
                            assets.append(f"📧 Senders: {len(campaign['selected_senders'])}")
                        
                        if assets:
                            for asset in assets:
                                st.write(asset)
                        else:
                            st.write("⚠️ No assets configured")
                    
                    with col3:
                        if st.button("⚙️ Manage", key=f"manage_campaign_{campaign_id}"):
                            st.session_state.show_campaign_details = campaign_id
                            st.rerun()
        else:
            st.info("📋 No campaigns found. Create campaigns to see their assets here.")

# Analytics Page
elif page == "📊 Analytics":
    st.header("📊 Analytics")
    
    if campaigns:
        # Overall stats
        st.subheader("📈 Overall Statistics")
        
        col1, col2, col3, col4 = st.columns(4)
        
        total_sent = sum(c['stats']['total_sent'] for c in campaigns.values())
        total_failed = sum(c['stats']['total_failed'] for c in campaigns.values())
        total_leads = sum(c['stats']['total_leads'] for c in campaigns.values())
        success_rate = (total_sent / total_leads * 100) if total_leads > 0 else 0
        
        with col1:
            st.metric("Total Sent", total_sent)
        
        with col2:
            st.metric("Total Failed", total_failed)
        
        with col3:
            st.metric("Success Rate", f"{success_rate:.1f}%")
        
        with col4:
            st.metric("Total Campaigns", len(campaigns))
        
        # Campaign-specific analytics
        st.subheader("📊 Campaign Analytics")
        
        for campaign_id, campaign in campaigns.items():
            campaign_name = safe_campaign_get(campaign, 'name', 'Unnamed Campaign')
            campaign_status = safe_campaign_get(campaign, 'status', 'draft')
            with st.expander(f"{campaign_name} - {campaign_status.title()}"):
                history = load_json(HISTORY_FILE,  {}, current_user_id)
                campaign_history = history.get(campaign_id, {})
                
                sent_count = len(campaign_history.get("sent", []))
                failed_count = len(campaign_history.get("failed", []))
                total_leads = campaign.get('stats', {}).get('total_leads', 0)
                success_rate = (sent_count / total_leads * 100) if total_leads > 0 else 0
                
                col1, col2, col3, col4 = st.columns(4)
                
                with col1:
                    st.metric("Sent", sent_count)
                
                with col2:
                    st.metric("Failed", failed_count)
                
                with col3:
                    st.metric("Success Rate", f"{success_rate:.1f}%")
                
                with col4:
                    st.metric("Remaining", max(0, total_leads - sent_count - failed_count))
                
                # Recent activity
                if campaign_history.get("sent"):
                    st.write("**Recently Sent:**")
                    for email in campaign_history["sent"][-5:]:
                        st.write(f"  • {email}")
                
                if campaign_history.get("failed"):
                    st.write("**Recently Failed:**")
                    for email in campaign_history["failed"][-5:]:
                        st.write(f"  • {email}")
    else:
        st.info("No campaigns yet. Create campaigns to see analytics.")

# Test Email Section (if triggered from dashboard)
if st.session_state.get('show_test_email'):
    st.subheader("📤 Send Test Email")
    
    if not senders:
        st.error("❌ Please add sender emails first!")
    else:
        # Find a campaign with leads and template
        test_campaign = None
        for campaign_id, campaign in campaigns.items():
            if (campaign.get('leads_data') or campaign.get('leads_file')) and (campaign.get('template_data') or campaign.get('template_file')):
                # Check if data exists in campaign or MongoDB
                data_available = True
                if not campaign.get('leads_data') and campaign.get('leads_file'):
                    from mongo_utils import get_lead_file_content
                    if not get_lead_file_content(campaign['leads_file'], current_user_id):
                        data_available = False
                if not campaign.get('template_data') and campaign.get('template_file'):
                    from mongo_utils import get_template_file_content
                    if not get_template_file_content(campaign['template_file'], current_user_id):
                        data_available = False
                
                if data_available:
                    test_campaign = campaign
                    break
        
        if not test_campaign:
            st.error("❌ Please create a campaign with leads and template first!")
        else:
            st.info(f"📤 Testing with campaign: {test_campaign['name']}")
            
            if st.button("📤 Send Test Batch (5 emails)"):
                # Test email sending logic
                history = load_json(HISTORY_FILE,  {}, current_user_id)
                if test_campaign['id'] not in history:
                    history[test_campaign['id']] = {}
                campaign_history = history[test_campaign['id']]
                
                # Load leads from campaign data
                import io
                
                if 'leads_data' in test_campaign and test_campaign['leads_data']:
                    # New format: leads stored directly in campaign
                    df = pd.read_csv(io.StringIO(test_campaign['leads_data']))
                else:
                    # Fallback: try to load from MongoDB (for old campaigns)
                    from mongo_utils import get_lead_file_content
                    lead_content = get_lead_file_content(test_campaign['leads_file'], current_user_id)
                    if not lead_content:
                        st.error(f"❌ Lead data not found in campaign or MongoDB!")
                        st.stop()
                    df = pd.read_csv(io.BytesIO(lead_content))
                sent_emails = set(campaign_history.get("sent", []))
                failed_emails = set(campaign_history.get("failed", []))
                processing_emails = set(campaign_history.get("processing", []))
                blacklisted_emails = sent_emails | failed_emails | processing_emails
                
                # Initialize daily tracking for test
                today = datetime.date.today().isoformat()
                if "daily_sent_tracking" not in campaign_history:
                    campaign_history["daily_sent_tracking"] = {}
                if today not in campaign_history["daily_sent_tracking"]:
                    campaign_history["daily_sent_tracking"][today] = 0
                
                # Load template from campaign data
                if 'template_data' in test_campaign and test_campaign['template_data']:
                    # New format: template stored directly in campaign
                    html_template = test_campaign['template_data']
                else:
                    # Fallback: try to load from MongoDB (for old campaigns)
                    from mongo_utils import get_template_file_content
                    template_content = get_template_file_content(test_campaign['template_file'], current_user_id)
                    if not template_content:
                        st.error(f"❌ Template data not found in campaign or MongoDB!")
                        st.stop()
                    
                    # Handle template content (could be string or bytes)
                    if isinstance(template_content, bytes):
                        html_template = template_content.decode('utf-8')
                    else:
                        html_template = template_content
                selected_senders = [s for s in senders if s['email'] in test_campaign['selected_senders']]
                if not selected_senders:
                    selected_senders = senders
                
                total_sent = 0
                limit = 5
                
                # Process test emails in batches
                unprocessed_emails = []
                for idx, row in df.iterrows():
                    email = row['Emails']
                    if email not in blacklisted_emails:
                        unprocessed_emails.append((idx, row))
                
                # Process emails in batches
                batch_size = len(selected_senders)  # One email per sender per batch
                total_batches = (len(unprocessed_emails) + batch_size - 1) // batch_size
                
                # Show batch configuration
                st.info(f"📊 Test Batch Configuration: {batch_size} emails per batch (one per sender), 15s pause between batches")
                st.info(f"🚀 Processing {len(unprocessed_emails)} test emails in {total_batches} batches of {batch_size} emails each")
                
                for batch_num in range(total_batches):
                    if total_sent >= limit:
                        break
                    
                    # Get batch of emails
                    start_idx = batch_num * batch_size
                    end_idx = min(start_idx + batch_size, len(unprocessed_emails))
                    batch_emails = unprocessed_emails[start_idx:end_idx]
                    
                    if not batch_emails:
                        break
                    
                    st.write(f"📦 Processing test batch {batch_num + 1}/{total_batches} ({len(batch_emails)} emails)")
                    
                    # Prepare batch data
                    batch_recipients = []
                    batch_personalized_templates = {}
                    batch_sender_names = {}
                    
                    for idx, row in batch_emails:
                        email = row['Emails']
                        
                        # Mark as processing
                        processing_emails.add(email)
                        if "processing_timestamps" not in campaign_history:
                            campaign_history["processing_timestamps"] = {}
                        campaign_history["processing_timestamps"][email] = datetime.datetime.now().isoformat()
                        
                        # Personalize template for this specific recipient
                        personalized_template = html_template
                        for column in row.index:
                            placeholder = f"{{{{{column}}}}}"
                            if placeholder in personalized_template:
                                personalized_template = personalized_template.replace(placeholder, str(row[column]))
                        
                        batch_recipients.append(email)
                        batch_personalized_templates[email] = personalized_template
                        
                        # Add sender name if available
                        if 'Name' in row.index:
                            batch_sender_names[email] = str(row['Name'])
                    
                    # Send batch using threading
                    from email_sender import send_batch_emails
                    
                    st.write(f"🚀 Sending test batch of {len(batch_recipients)} emails simultaneously...")
                    batch_results = send_batch_emails(
                        selected_senders, 
                        batch_recipients, 
                        "Test Email", 
                        html_template,  # Fallback template
                        batch_sender_names,
                        f"Test - {test_campaign.get('name', 'Test Campaign')}",
                        f"test_{current_campaign_id}",
                        get_current_user_id(),
                        batch_personalized_templates  # Pass personalized templates
                    )
                    
                    # Process results
                    for email in batch_recipients:
                        processing_emails.discard(email)
                        if "processing_timestamps" in campaign_history and email in campaign_history["processing_timestamps"]:
                            del campaign_history["processing_timestamps"][email]
                    
                    # Update status based on results
                    for email in batch_results['sent']:
                        sent_emails.add(email)
                        total_sent += 1
                        st.success(f"✅ Sent to {email}")
                    
                    for email in batch_results['failed']:
                        failed_emails.add(email)
                        st.error(f"❌ Failed to send to {email}")
                    
                    # Update history
                    campaign_history.update({
                        "sent": list(sent_emails),
                        "failed": list(failed_emails),
                        "processing": list(processing_emails)
                    })
                    save_user_data(HISTORY_FILE, history)
                    
                    # Pause between batches (except for the last batch)
                    if batch_num < total_batches - 1:
                        st.write(f"⏸️ Pausing for 15 seconds before next batch...")
                        time.sleep(15)
                
                st.success(f"🎉 Test complete. Sent {total_sent} emails.")
    
    if st.button("❌ Close Test"):
        st.session_state.show_test_email = False
        st.rerun()

# Add New Sender Section (if triggered from dashboard)
if st.session_state.get('show_add_sender'):
    st.subheader("➕ Add New Sender")
    
    with st.form("quick_add_sender_form"):
        col1, col2 = st.columns(2)
        with col1:
            sender_email = st.text_input("Sender Email")
        with col2:
            sender_name = st.text_input("Sender Name", placeholder="e.g., John Doe, Company Name", help="This will appear as the sender name in emails")
        
        sender_pass = st.text_input("App Password", type="password", help="Enter your Gmail app password. Spaces are allowed and will be preserved.")
        st.info("💡 **App Password Tips:**\n- Use Gmail app passwords (not your regular password)\n- Spaces in app passwords are allowed and should be preserved\n- Enable 2-factor authentication first to generate app passwords")
        
        col1, col2 = st.columns(2)
        with col1:
            if st.form_submit_button("💾 Add Sender"):
                if sender_email and sender_pass:
                    # Validate app password
                    is_valid, validation_msg = validate_app_password(sender_pass)
                    if not is_valid:
                        st.error(f"❌ {validation_msg}")
                        st.stop()
                    
                    if any(sender['email'] == sender_email for sender in senders):
                        st.error(f"Email {sender_email} already exists!")
                    else:
                        # Use provided name or default to email if not provided
                        display_name = sender_name.strip() if sender_name and sender_name.strip() else sender_email
                        senders.append({
                            "email": sender_email, 
                            "password": sender_pass,
                            "name": display_name
                        })
                        save_user_data(SENDER_FILE, senders)
                        st.success(f"✅ Added {sender_email} ({display_name})")
                        st.session_state.show_add_sender = False
                        st.rerun()
                else:
                    st.error("Please enter both email and password")
        
        with col2:
            if st.form_submit_button("❌ Cancel"):
                st.session_state.show_add_sender = False
                st.rerun()

# Quick Access to Resources (if triggered from dashboard)
if st.session_state.get('show_resources_leads'):
    st.subheader("📊 Lead Files Overview")
    
    # Get all lead files from MongoDB
    from mongo_utils import get_lead_files
    
    lead_files = get_lead_files(current_user_id)
    
    if lead_files:
        lead_files.sort(key=lambda x: x['upload_date'], reverse=True)
        st.write(f"**Total Lead Files:** {len(lead_files)}")
        
        for lead_file in lead_files:
            with st.container():
                col1, col2, col3, col4 = st.columns([3, 2, 2, 1])
                
                with col1:
                    st.write(f"**{lead_file['filename']}**")
                    campaign_name = "Unknown Campaign"
                    if lead_file.get('campaign_id') in campaigns:
                        campaign_name = campaigns[lead_file['campaign_id']].get('name', 'Unknown Campaign')
                    st.write(f"Campaign: {campaign_name}")
                
                with col2:
                    upload_date = lead_file.get('upload_date', lead_file.get('file_date'))
                    if isinstance(upload_date, str):
                        upload_date = datetime.datetime.fromisoformat(upload_date)
                    st.write(f"📅 {upload_date.strftime('%Y-%m-%d %H:%M')}")
                
                with col3:
                    size_mb = lead_file.get('file_size', 0) / (1024 * 1024)
                    st.write(f"📏 {size_mb:.2f} MB")
                
                with col4:
                    if st.button("📥 Download", key=f"quick_download_leads_{lead_file['filename']}"):
                        from mongo_utils import get_lead_file_content
                        file_content = get_lead_file_content(lead_file['filename'], current_user_id)
                        if file_content:
                            st.download_button(
                                label="Download CSV",
                                data=file_content,
                                file_name=lead_file['filename'],
                                mime="text/csv"
                            )
                        else:
                            st.error("❌ File content not found in MongoDB")
    else:
        st.info("📁 No lead files found. Upload lead files in campaigns to see them here.")
    
    if st.button("❌ Close Lead Files View"):
        st.session_state.show_resources_leads = False
        st.rerun()

if st.session_state.get('show_resources_templates'):
    st.subheader("📝 Email Templates Overview")
    
    # Get all template files from MongoDB
    from mongo_utils import get_template_files
    
    template_files = get_template_files(current_user_id)
    
    if template_files:
        template_files.sort(key=lambda x: x['upload_date'], reverse=True)
        st.write(f"**Total Templates:** {len(template_files)}")
        
        for template_file in template_files:
            with st.container():
                col1, col2, col3, col4 = st.columns([3, 2, 2, 1])
                
                with col1:
                    st.write(f"**{template_file['filename']}**")
                    campaign_name = "Unknown Campaign"
                    if template_file.get('campaign_id') in campaigns:
                        campaign_name = campaigns[template_file['campaign_id']].get('name', 'Unknown Campaign')
                    st.write(f"Campaign: {campaign_name}")
                
                with col2:
                    upload_date = template_file.get('upload_date', template_file.get('file_date'))
                    if isinstance(upload_date, str):
                        upload_date = datetime.datetime.fromisoformat(upload_date)
                    st.write(f"📅 {upload_date.strftime('%Y-%m-%d %H:%M')}")
                
                with col3:
                    size_kb = template_file.get('file_size', 0) / 1024
                    st.write(f"📏 {size_kb:.1f} KB")
                
                with col4:
                    col4a, col4b = st.columns(2)
                    with col4a:
                        if st.button("👁️ Preview", key=f"quick_preview_template_{template_file['filename']}"):
                            try:
                                from mongo_utils import get_template_file_content
                                content = get_template_file_content(template_file['filename'], current_user_id)
                                if content:
                                    # Handle template content (could be string or bytes)
                                    if isinstance(content, bytes):
                                        template_text = content.decode('utf-8')
                                    else:
                                        template_text = content
                                    st.code(template_text, language="html")
                                else:
                                    st.error("❌ Template content not found in MongoDB")
                            except Exception as e:
                                st.error(f"Error reading template: {e}")
                    
                    with col4b:
                        if st.button("📥 Download", key=f"quick_download_template_{template_file['filename']}"):
                            from mongo_utils import get_template_file_content
                            file_content = get_template_file_content(template_file['filename'], current_user_id)
                            if file_content:
                                st.download_button(
                                    label="Download HTML",
                                    data=file_content,
                                    file_name=template_file['filename'],
                                    mime="text/html"
                                )
                            else:
                                st.error("❌ Template content not found in MongoDB")
    else:
        st.info("📝 No email templates found. Upload templates in campaigns to see them here.")
    
    if st.button("❌ Close Templates View"):
        st.session_state.show_resources_templates = False
        st.rerun()

# Create New Campaign Section (if triggered from dashboard)
if st.session_state.get('show_create_campaign'):
    st.subheader("📋 Create New Campaign")
    
    with st.form("quick_create_campaign_form"):
        campaign_name = st.text_input("Campaign Name", placeholder="e.g., Q4 Newsletter")
        campaign_description = st.text_area("Description", placeholder="Describe your campaign...")
        
        # Sender selection
        if senders:
            selected_senders = st.multiselect(
                "Select Sender Emails",
                [sender['email'] for sender in senders],
                default=[sender['email'] for sender in senders]
            )
        else:
            st.error("❌ Please add sender emails first!")
            selected_senders = []
        
        # File uploads with option to reuse existing files
        st.write("**📊 Lead File:**")
        use_existing_leads = st.checkbox("Use existing lead file", key="use_existing_leads_quick")
        
        if use_existing_leads:
            # Show existing lead files from MongoDB
            from mongo_utils import get_lead_files
            existing_leads = [lead['filename'] for lead in get_lead_files(current_user_id)]
            
            if existing_leads:
                selected_leads = st.selectbox("Select existing lead file", existing_leads, key="select_existing_leads")
                leads_file = None  # Will use existing file
            else:
                st.warning("No existing lead files found. Please upload a new one.")
                use_existing_leads = False
                leads_files = st.file_uploader("Upload Leads CSV", type=['csv'], accept_multiple_files=True)
        else:
            leads_files = st.file_uploader("Upload Leads CSV", type=['csv'], accept_multiple_files=True)
        
        st.write("**📝 Email Template:**")
        use_existing_template = st.checkbox("Use existing template", key="use_existing_template_quick")
        
        if use_existing_template:
            # Show existing templates from MongoDB
            from mongo_utils import get_template_files
            existing_templates = [template['filename'] for template in get_template_files(current_user_id)]
            
            if existing_templates:
                selected_template = st.selectbox("Select existing template", existing_templates, key="select_existing_template")
                template_file = None  # Will use existing file
            else:
                st.warning("No existing templates found. Please upload a new one.")
                use_existing_template = False
                template_files = st.file_uploader("Upload Email Templates", type=['html'], accept_multiple_files=True)
        else:
            template_files = st.file_uploader("Upload Email Templates", type=['html'], accept_multiple_files=True)
        
        # Tracking pixel will be automatically injected (silent)
        tracker_server = "http://31.97.239.75:3399"
        
        col1, col2 = st.columns(2)
        with col1:
            if st.form_submit_button("💾 Create Campaign"):
                if campaign_name and selected_senders:
                    # Handle file selection
                    leads_filename = None
                    template_filename = None
                    total_leads = 0
                    
                    # Generate campaign ID once at the beginning
                    campaign_id = str(uuid.uuid4())
                    
                    # Process lead file
                    leads_data = None
                    total_leads = 0
                    
                    if use_existing_leads and 'selected_leads' in locals():
                        # Use existing lead file from another campaign
                        from mongo_utils import get_lead_file_content
                        file_content = get_lead_file_content(selected_leads, current_user_id)
                        if file_content:
                            import io
                            df_leads = pd.read_csv(io.BytesIO(file_content))
                            total_leads = len(df_leads)
                            leads_data = df_leads.to_csv(index=False)
                        else:
                            st.error("Selected lead file not found in MongoDB!")
                            st.stop()
                    elif leads_files:
                        # Upload new lead file
                        leads_file = leads_files[0]  # Use first uploaded file
                        df_leads = pd.read_csv(leads_file)
                        total_leads = len(df_leads)
                        leads_data = df_leads.to_csv(index=False)
                    else:
                        st.error("Please select or upload a lead file!")
                        st.stop()
                    
                    # Process template file
                    template_data = None
                    
                    if use_existing_template and 'selected_template' in locals():
                        # Use existing template from another campaign
                        from mongo_utils import get_template_file_content
                        template_content = get_template_file_content(selected_template, current_user_id)
                        if template_content:
                            template_data = template_content
                            
                            # Automatically inject tracking pixel (silent)
                            from tracking_utils import inject_tracking_pixel
                            template_data = inject_tracking_pixel(template_data, tracker_server, campaign_name)
                        else:
                            st.error("Selected template file not found in MongoDB!")
                            st.stop()
                    elif template_files:
                        # Upload new template
                        template_file = template_files[0]  # Use first uploaded file
                        template_data = template_file.read().decode("utf-8")
                    else:
                        st.error("Please select or upload a template file!")
                        st.stop()
                    
                    # Automatically inject tracking pixel (silent)
                    from tracking_utils import inject_tracking_pixel
                    template_data = inject_tracking_pixel(template_data, tracker_server, campaign_name)
                    
                    # Create campaign
                    # Generate tracking code for this campaign
                    tracking_code = generate_tracking_code(campaign_name)
                    
                    campaigns[campaign_id] = {
                        'id': campaign_id,
                        'name': campaign_name,
                        'description': campaign_description,
                        'selected_senders': selected_senders,
                        'leads_data': leads_data,  # Store leads data directly in campaign
                        'template_data': template_data,  # Store template data directly in campaign
                        'leads_file': f"leads_{campaign_id}.csv",  # Keep filename for compatibility
                        'template_file': f"template_{campaign_id}.html",  # Keep filename for compatibility
                        'status': 'created',
                        'created_at': datetime.datetime.now().isoformat(),
                        'schedule_enabled': False,
                        'start_immediate_daily': False,
                        'scheduled_date': None,
                        'schedule_time': '10:00',
                        'stats': {
                            'total_leads': total_leads,
                            'total_sent': 0,
                            'total_failed': 0
                        },
                        'tracking_code': tracking_code
                    }
                    
                    save_user_data(CAMPAIGNS_FILE, campaigns)
                    st.success(f"✅ Campaign '{campaign_name}' created successfully!")
                    st.session_state.show_create_campaign = False
                    st.rerun()
                else:
                    st.error("Please enter campaign name and select senders!")
        
        with col2:
            if st.form_submit_button("❌ Cancel"):
                st.session_state.show_create_campaign = False
                st.rerun()

# Start keep-alive thread when the app starts
if __name__ == "__main__":
    # Start keep-alive thread for Render deployment
    start_keep_alive()
    
    # Configure Streamlit for Render
    port = int(os.getenv('PORT', 8501))
    host = '0.0.0.0'
    
    # Run Streamlit with Render configuration
    import subprocess
    import sys
    
    # Set Streamlit configuration for Render
    os.environ['STREAMLIT_SERVER_PORT'] = str(port)
    os.environ['STREAMLIT_SERVER_ADDRESS'] = host
    os.environ['STREAMLIT_SERVER_HEADLESS'] = 'true'
    os.environ['STREAMLIT_BROWSER_GATHER_USAGE_STATS'] = 'false'
    
    # Run Streamlit
    subprocess.run([
        sys.executable, '-m', 'streamlit', 'run', 
        'main.py', 
        '--server.port', str(port),
        '--server.address', host,
        '--server.headless', 'true',
        '--browser.gatherUsageStats', 'false'
    ])
