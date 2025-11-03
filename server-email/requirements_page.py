import streamlit as st
import datetime
from mongo_utils import get_database
from auth_ui import show_auth_interface, get_current_user_id

# Collections
REQUIREMENTS_COLLECTION = 'requirements'

def show_requirements_page():
    """Show the requirements management page"""
    if not show_auth_interface():
        st.stop()
    
    user_id = get_current_user_id()
    if not user_id:
        st.error("❌ User not authenticated")
        st.stop()
    
    st.title("📋 Campaign Requirements Management")
    st.markdown("---")
    
    # Tabs for different views
    tab1, tab2 = st.tabs(["📨 Submitted Requirements", "📊 Analytics"])
    
    with tab1:
        show_requirements_list(user_id)
    
    with tab2:
        show_requirements_analytics(user_id)

def show_requirements_list(user_id):
    """Show list of submitted requirements"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return
        
        collection = db[REQUIREMENTS_COLLECTION]
        
        # Get all requirements for the current user
        requirements = list(collection.find(
            {"user_id": user_id}, 
            {"_id": 0}
        ).sort("submitted_at", -1))
        
        if not requirements:
            st.info("📝 No requirements submitted yet from the analytics panel")
            st.markdown("""
            **How it works:**
            1. Users submit requirements through the Analytics Panel
            2. Requirements appear here for review and processing
            3. You can update the status and manage campaigns from here
            """)
            return
        
        st.subheader(f"📋 Requirements ({len(requirements)})")
        
        # Filter by status
        status_filter = st.selectbox(
            "Filter by status:",
            ["All", "pending", "approved", "processing", "completed", "rejected"],
            index=0
        )
        
        filtered_requirements = requirements
        if status_filter != "All":
            filtered_requirements = [r for r in requirements if r.get('status', 'pending') == status_filter]
        
        # Display requirements
        for idx, req in enumerate(filtered_requirements):
            with st.expander(f"📝 Requirement #{req.get('id', idx+1)} - {req.get('status', 'pending').upper()}", expanded=False):
                col1, col2 = st.columns([2, 1])
                
                with col1:
                    st.markdown("**📝 Requirement Query:**")
                    st.text_area("", value=req.get('requirement_query', ''), height=100, disabled=True, key=f"query_{idx}")
                    
                    st.markdown("**📧 Subject Line:**")
                    st.text_input("", value=req.get('subject_line', ''), disabled=True, key=f"subject_{idx}")
                    
                    st.markdown("**👥 Sender Emails:**")
                    for i, email in enumerate(req.get('sender_emails', [])):
                        st.text_input(f"Sender {i+1}:", value=email, disabled=True, key=f"email_{idx}_{i}")
                    
                    st.markdown("**🔑 App Passwords:**")
                    for i, password in enumerate(req.get('app_passwords', [])):
                        st.text_input(f"Password {i+1}:", value=password, disabled=True, type="password", key=f"password_{idx}_{i}")
                        # Show password button
                        if st.button(f"👁️ Show Password {i+1}", key=f"show_pass_{idx}_{i}"):
                            st.session_state[f"reveal_pass_{idx}_{i}"] = not st.session_state.get(f"reveal_pass_{idx}_{i}", False)
                        
                        if st.session_state.get(f"reveal_pass_{idx}_{i}", False):
                            st.text_input(f"Revealed Password {i+1}:", value=password, disabled=True, key=f"revealed_password_{idx}_{i}")
                    
                    if req.get('html_template'):
                        st.markdown("**🎨 HTML Template:**")
                        if st.button(f"👁️ View Template", key=f"view_template_{idx}"):
                            st.session_state[f"show_template_{idx}"] = not st.session_state.get(f"show_template_{idx}", False)
                        
                        if st.session_state.get(f"show_template_{idx}", False):
                            st.code(req.get('html_template', ''), language='html')
                
                with col2:
                    st.markdown("**📊 Status:**")
                    current_status = req.get('status', 'pending')
                    new_status = st.selectbox(
                        "Update status:",
                        ["pending", "approved", "processing", "completed", "rejected"],
                        index=["pending", "approved", "processing", "completed", "rejected"].index(current_status),
                        key=f"status_{idx}"
                    )
                    
                    if st.button(f"Update Status", key=f"update_{idx}"):
                        update_requirement_status(req.get('id'), new_status, user_id)
                        st.rerun()
                    
                    st.markdown("**📅 Submitted:**")
                    submitted_at = req.get('submitted_at', '')
                    if submitted_at:
                        try:
                            dt = datetime.datetime.fromisoformat(submitted_at.replace('Z', '+00:00'))
                            st.write(dt.strftime('%Y-%m-%d %H:%M'))
                        except:
                            st.write(submitted_at)
                    
                    if req.get('processed_at'):
                        st.markdown("**⚡ Processed:**")
                        try:
                            dt = datetime.datetime.fromisoformat(req.get('processed_at', '').replace('Z', '+00:00'))
                            st.write(dt.strftime('%Y-%m-%d %H:%M'))
                        except:
                            st.write(req.get('processed_at', ''))
                    
                    # Action buttons
                    if current_status == 'approved' and new_status == 'approved':
                        if st.button(f"🚀 Create Campaign", key=f"create_{idx}"):
                            create_campaign_from_requirement(req, user_id)
                            st.success("✅ Campaign created successfully!")
                    
                    if st.button(f"🗑️ Delete", key=f"delete_{idx}", type="secondary"):
                        delete_requirement(req.get('id'), user_id)
                        st.rerun()
        
    except Exception as e:
        st.error(f"❌ Error loading requirements: {e}")

def show_requirements_analytics(user_id):
    """Show analytics for requirements"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return
        
        collection = db[REQUIREMENTS_COLLECTION]
        
        # Get analytics data
        requirements = list(collection.find({"user_id": user_id}, {"_id": 0}))
        
        if not requirements:
            st.info("📊 No data available for analytics")
            return
        
        # Status distribution
        status_counts = {}
        for req in requirements:
            status = req.get('status', 'pending')
            status_counts[status] = status_counts.get(status, 0) + 1
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.metric("📝 Total Requirements", len(requirements))
        
        with col2:
            pending_count = status_counts.get('pending', 0)
            st.metric("⏳ Pending", pending_count)
        
        with col3:
            completed_count = status_counts.get('completed', 0)
            st.metric("✅ Completed", completed_count)
        
        # Status breakdown
        st.subheader("📊 Status Distribution")
        for status, count in status_counts.items():
            percentage = (count / len(requirements)) * 100
            st.write(f"**{status.title()}:** {count} ({percentage:.1f}%)")
        
        # Recent activity
        st.subheader("🕒 Recent Activity")
        recent_requirements = sorted(requirements, key=lambda x: x.get('submitted_at', ''), reverse=True)[:5]
        
        for req in recent_requirements:
            submitted_at = req.get('submitted_at', '')
            status = req.get('status', 'pending')
            
            try:
                dt = datetime.datetime.fromisoformat(submitted_at.replace('Z', '+00:00'))
                time_str = dt.strftime('%Y-%m-%d %H:%M')
            except:
                time_str = submitted_at
            
            st.write(f"• **{status.title()}** - {time_str}")
        
    except Exception as e:
        st.error(f"❌ Error loading analytics: {e}")

def update_requirement_status(req_id, new_status, user_id):
    """Update the status of a requirement"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return False
        
        collection = db[REQUIREMENTS_COLLECTION]
        
        update_data = {
            "status": new_status
        }
        
        if new_status in ['processing', 'completed']:
            update_data["processed_at"] = datetime.datetime.now().isoformat()
        
        result = collection.update_one(
            {"id": req_id, "user_id": user_id},
            {"$set": update_data}
        )
        
        if result.modified_count > 0:
            st.success(f"✅ Status updated to {new_status}")
            return True
        else:
            st.error("❌ Failed to update status")
            return False
        
    except Exception as e:
        st.error(f"❌ Error updating status: {e}")
        return False

def create_campaign_from_requirement(requirement, user_id):
    """Create a campaign from an approved requirement"""
    try:
        from mongo_utils import save_json, CAMPAIGNS_COLLECTION
        import uuid
        
        # Generate campaign ID
        campaign_id = str(uuid.uuid4())[:8]
        
        # Create campaign data
        campaign_data = {
            "id": campaign_id,
            "name": f"Campaign from Requirement {requirement.get('id', '')}",
            "subject": requirement.get('subject_line', ''),
            "template": requirement.get('html_template', ''),
            "selected_senders": requirement.get('sender_emails', []),
            "status": "ready",
            "created_at": datetime.datetime.now().isoformat(),
            "created_from_requirement": True,
            "requirement_id": requirement.get('id'),
            "user_id": user_id
        }
        
        # Save campaign
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return False
        
        campaigns_collection = db[CAMPAIGNS_COLLECTION]
        campaigns_collection.insert_one(campaign_data)
        
        # Update requirement status
        update_requirement_status(requirement.get('id'), 'processing', user_id)
        
        return True
        
    except Exception as e:
        st.error(f"❌ Error creating campaign: {e}")
        return False

def delete_requirement(req_id, user_id):
    """Delete a requirement"""
    try:
        db = get_database()
        if db is None:
            st.error("❌ Database connection failed")
            return False
        
        collection = db[REQUIREMENTS_COLLECTION]
        
        result = collection.delete_one({"id": req_id, "user_id": user_id})
        
        if result.deleted_count > 0:
            st.success("✅ Requirement deleted successfully")
            return True
        else:
            st.error("❌ Failed to delete requirement")
            return False
        
    except Exception as e:
        st.error(f"❌ Error deleting requirement: {e}")
        return False

if __name__ == "__main__":
    show_requirements_page()
