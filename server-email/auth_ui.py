import streamlit as st
import hashlib
import uuid
from mongo_utils import get_database, USERS_COLLECTION

def get_current_user_id():
    """Get the current user ID from session state"""
    if 'user_id' not in st.session_state:
        return None
    return st.session_state.user_id

def show_auth_interface():
    """Show authentication interface and return True if user is authenticated"""
    # Ensure users collection exists
    ensure_users_collection()
    
    if 'user_id' not in st.session_state or st.session_state.user_id is None:
        return show_login_register()
    return True

def ensure_users_collection():
    """Ensure the users collection exists and is properly indexed"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed. Please check your MongoDB connection.")
            return False
        
        collection = db[USERS_COLLECTION]
        
        # Create index on email for faster lookups
        try:
            collection.create_index("email", unique=True)
        except Exception:
            pass  # Index might already exist
        
        return True
    except Exception as e:
        st.error(f"❌ Error ensuring users collection: {e}")
        return False

def show_login_register():
    """Show login/register interface"""
    st.title("🔐 Authentication Required")
    
    # Debug section
    with st.expander("🔧 Debug Database Connection", expanded=False):
        if st.button("Check Database Connection"):
            debug_database_connection()
        
        st.subheader("Reset Password (Debug)")
        with st.form("reset_password_form"):
            reset_email = st.text_input("Email to reset", placeholder="user@example.com")
            reset_password = st.text_input("New Password", type="password")
            if st.form_submit_button("Reset Password"):
                if reset_email and reset_password:
                    reset_user_password(reset_email, reset_password)
                else:
                    st.error("Please enter both email and new password")
        
        st.subheader("Quick Login (Debug)")
        if st.button("Login as test@example.com"):
            # Direct login for testing
            try:
                db = get_database()
                if db:
                    collection = db[USERS_COLLECTION]
                    user = collection.find_one({"email": "test@example.com"})
                    if user:
                        st.session_state.user_id = str(user['_id'])
                        st.session_state.username = user.get('username', 'test@example.com')
                        st.session_state.email = 'test@example.com'
                        st.success("✅ Logged in as test@example.com")
                        st.rerun()
                    else:
                        st.error("❌ Test user not found")
            except Exception as e:
                st.error(f"❌ Quick login failed: {e}")
        
        st.subheader("Migrate All Data to Current User")
        if st.button("Assign All Senders & Campaigns to Me"):
            try:
                from mongo_utils import get_database
                db = get_database()
                if db:
                    # Get current user ID
                    current_user_id = get_current_user_id()
                    if current_user_id:
                        # Update all senders
                        senders_result = db['senders'].update_many(
                            {},
                            {"$set": {"user_id": current_user_id}}
                        )
                        
                        # Update all campaigns
                        campaigns_result = db['campaigns'].update_many(
                            {},
                            {"$set": {"user_id": current_user_id}}
                        )
                        
                        st.success(f"✅ Migrated {senders_result.modified_count} senders and {campaigns_result.modified_count} campaigns to your account!")
                        st.rerun()
                    else:
                        st.error("❌ Please login first")
                else:
                    st.error("❌ Database connection failed")
            except Exception as e:
                st.error(f"❌ Migration failed: {e}")
    
    tab1, tab2 = st.tabs(["Login", "Register"])
    
    with tab1:
        st.subheader("Login")
        
        
        with st.form("login_form"):
            email = st.text_input("Email", placeholder="test@example.com")
            password = st.text_input("Password", type="password", placeholder="password123")
            
            if st.form_submit_button("Login"):
                if email and password:
                    if authenticate_user(email, password):
                        st.success("✅ Login successful!")
                        st.rerun()
                    else:
                        st.error("❌ Invalid email or password")
                        st.error("Try using the test accounts above or use the Quick Login button")
                else:
                    st.error("Please enter both email and password")
    
    with tab2:
        st.subheader("Register")
        with st.form("register_form"):
            username = st.text_input("Username", placeholder="your_username")
            email = st.text_input("Email", placeholder="your@email.com")
            password = st.text_input("Password", type="password")
            confirm_password = st.text_input("Confirm Password", type="password")
            
            if st.form_submit_button("Register"):
                if username and email and password and confirm_password:
                    if password != confirm_password:
                        st.error("❌ Passwords don't match")
                    elif register_user(username, email, password):
                        st.success("✅ Registration successful! Please login.")
                    else:
                        st.error("❌ Registration failed. Email might already exist.")
                else:
                    st.error("Please fill in all fields")
    
    return False

def authenticate_user(email, password):
    """Authenticate user with email and password"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed. Please check your MongoDB connection.")
            return False
        
        collection = db[USERS_COLLECTION]
        
        # First, check if user exists by email
        user = collection.find_one({"email": email})
        if not user:
            st.error("❌ User not found. Please check your email or register first.")
            return False
        
        # Hash the password with our current method
        hashed_password = hash_password(password)
        
        # Check if password matches (current format)
        if user.get('password') == hashed_password:
            # Set user in session state
            st.session_state.user_id = str(user['_id'])
            st.session_state.username = user.get('username', email)
            st.session_state.email = email
            return True
        
        # If current format doesn't work, try to update the password to new format
        # This handles users created with old password format
        st.warning("⚠️ Updating password format...")
        try:
            # Update user with new password format
            result = collection.update_one(
                {"email": email},
                {"$set": {"password": hashed_password}}
            )
            
            if result.modified_count > 0:
                # Set user in session state
                st.session_state.user_id = str(user['_id'])
                st.session_state.username = user.get('username', email)
                st.session_state.email = email
                st.success("✅ Password updated successfully!")
                return True
            else:
                st.error("❌ Invalid password. Please check your password.")
                return False
        except Exception as update_error:
            st.error("❌ Invalid password. Please check your password.")
            print(f"Password update error: {update_error}")
            return False
        
    except Exception as e:
        st.error(f"❌ Authentication error: {e}")
        print(f"Error authenticating user: {e}")
        return False

def register_user(username, email, password):
    """Register a new user"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed. Please check your MongoDB connection.")
            return False
        
        collection = db[USERS_COLLECTION]
        
        # Check if user already exists
        existing_user = collection.find_one({"email": email})
        if existing_user:
            st.error("❌ User with this email already exists. Please login instead.")
            return False
        
        # Hash the password
        hashed_password = hash_password(password)
        
        # Create new user
        import datetime
        user_data = {
            "username": username,
            "email": email,
            "password": hashed_password,
            "created_at": datetime.datetime.now().isoformat(),
            "is_active": True
        }
        
        result = collection.insert_one(user_data)
        
        if result.inserted_id:
            # Set user in session state
            st.session_state.user_id = str(result.inserted_id)
            st.session_state.username = username
            st.session_state.email = email
            return True
        
        st.error("❌ Failed to create user account.")
        return False
        
    except Exception as e:
        st.error(f"❌ Registration error: {e}")
        print(f"Error registering user: {e}")
        return False

def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def require_auth(func):
    """Decorator to require authentication for a function"""
    def wrapper(*args, **kwargs):
        if not show_auth_interface():
            st.stop()
        return func(*args, **kwargs)
    return wrapper

def show_user_profile():
    """Show user profile information"""
    st.subheader("👤 User Profile")
    
    if 'user_id' in st.session_state and st.session_state.user_id:
        col1, col2 = st.columns([2, 1])
        
        with col1:
            st.write(f"**Username:** {st.session_state.get('username', 'N/A')}")
            st.write(f"**Email:** {st.session_state.get('email', 'N/A')}")
            st.write(f"**User ID:** {st.session_state.user_id}")
        
        with col2:
            if st.button("🚪 Logout", use_container_width=True):
                # Clear session state
                for key in ['user_id', 'username', 'email']:
                    if key in st.session_state:
                        del st.session_state[key]
                st.success("✅ Logged out successfully!")
                st.rerun()
    else:
        st.error("❌ Not logged in")
        if st.button("🔐 Login"):
            st.session_state.show_login = True
            st.rerun()

def logout():
    """Logout the current user"""
    for key in ['user_id', 'username', 'email']:
        if key in st.session_state:
            del st.session_state[key]
    st.rerun()

def debug_database_connection():
    """Debug function to check database connection and users"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return False
        
        # Check if we're connected to the right database
        db_name = db.name
        st.info(f"✅ Connected to database: {db_name}")
        
        # List all collections
        collections = db.list_collection_names()
        st.info(f"📋 Available collections: {collections}")
        
        # Check users collection
        if USERS_COLLECTION in collections:
            users_collection = db[USERS_COLLECTION]
            user_count = users_collection.count_documents({})
            st.info(f"👥 Users in database: {user_count}")
            
            # Show users (without passwords)
            if user_count > 0:
                users = list(users_collection.find({}, {'password': 0, '_id': 0}))
                st.json(users)
        else:
            st.warning(f"⚠️ Users collection '{USERS_COLLECTION}' not found")
        
        return True
        
    except Exception as e:
        st.error(f"❌ Debug error: {e}")
        return False

def reset_user_password(email, new_password):
    """Reset a user's password (for debugging)"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return False
        
        collection = db[USERS_COLLECTION]
        
        # Hash the new password
        hashed_password = hash_password(new_password)
        
        # Update user password
        result = collection.update_one(
            {"email": email},
            {"$set": {"password": hashed_password}}
        )
        
        if result.modified_count > 0:
            st.success(f"✅ Password reset successfully for {email}")
            return True
        else:
            st.error(f"❌ User not found: {email}")
            return False
            
    except Exception as e:
        st.error(f"❌ Password reset error: {e}")
        return False
