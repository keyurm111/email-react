import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import time
import re

def send_email(sender_email, sender_password, recipient_email, subject, html_content, sender_name=None, campaign_name=None, campaign_id=None, user_id=None):
    """
    Send email using Gmail SMTP
    
    Args:
        sender_email (str): Gmail address
        sender_password (str): Gmail app password
        recipient_email (str): Recipient email address
        subject (str): Email subject
        html_content (str): HTML content of the email
        sender_name (str): Display name for sender
        campaign_name (str): Campaign name for logging
        campaign_id (str): Campaign ID for logging
        user_id (str): User ID for logging
    
    Returns:
        tuple: (success: bool, message: str)
    """
    try:
        # Use provided sender name or default to email
        display_name = sender_name if sender_name else sender_email
        
        # Create message
        msg = MIMEMultipart('alternative')
        msg['From'] = f"{display_name} <{sender_email}>"
        msg['To'] = recipient_email
        msg['Subject'] = subject
        
        # Add HTML content
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)
        
        # Create SMTP session
        context = ssl.create_default_context()
        
        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls(context=context)
            server.login(sender_email, sender_password)
            
            # Send email
            text = msg.as_string()
            server.sendmail(sender_email, recipient_email, text)
            
        # Log successful email send
        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'sent', user_id=user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log successful email: {log_error}")
        
        return True, "Email sent successfully"
        
    except smtplib.SMTPAuthenticationError as e:
        error_msg = "Authentication failed. Check your email and app password."
        # Log failed email send
        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'failed', error_msg, user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log failed email: {log_error}")
        return False, error_msg
    except smtplib.SMTPRecipientsRefused as e:
        error_msg = "Recipient email address is invalid."
        # Log failed email send
        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'failed', error_msg, user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log failed email: {log_error}")
        return False, error_msg
    except smtplib.SMTPException as e:
        # Parse SMTP error codes for better error messages
        error_str = str(e)
        if '554' in error_str and 'Disabled by user' in error_str:
            error_msg = "Email sending disabled in hosting panel (hPanel). Please enable email sending for this account in your hosting control panel."
        elif '554' in error_str:
            error_msg = f"SMTP error (554): Email rejected by server. Check your sender account settings. Original: {error_str}"
        elif '550' in error_str:
            error_msg = f"SMTP error (550): Mailbox unavailable or quota exceeded. Original: {error_str}"
        elif '535' in error_str or 'Authentication' in error_str:
            error_msg = "SMTP authentication failed. Check your email and password/app password."
        else:
            error_msg = f"SMTP error: {error_str}"
        
        # Log failed email send
        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'failed', error_msg, user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log failed email: {log_error}")
        return False, error_msg
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        # Log failed email send
        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'failed', error_msg, user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log failed email: {log_error}")
        return False, error_msg

def send_email_dynamic(smtp_host, smtp_port, smtp_user, smtp_password, sender_email, recipient_email, subject, html_content, use_tls=True, use_ssl=False, sender_name=None, campaign_name=None, campaign_id=None, user_id=None):
    """
    Send email using dynamic SMTP settings (supports TLS/SSL).
    """
    try:
        display_name = sender_name if sender_name else sender_email

        msg = MIMEMultipart('alternative')
        msg['From'] = f"{display_name} <{sender_email}>"
        msg['To'] = recipient_email
        msg['Subject'] = subject

        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)

        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
                server.login(smtp_user, smtp_password)
                server.sendmail(sender_email, recipient_email, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                if use_tls:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                server.login(smtp_user, smtp_password)
                server.sendmail(sender_email, recipient_email, msg.as_string())

        if campaign_name and campaign_id:
            try:
                from mongo_utils import log_email_sent
                log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'sent', user_id=user_id)
            except Exception as log_error:
                print(f"Warning: Failed to log successful email: {log_error}")

        return True, "Email sent successfully"
    except smtplib.SMTPAuthenticationError:
        error_msg = "Authentication failed. Verify SMTP credentials."
    except smtplib.SMTPRecipientsRefused:
        error_msg = "Recipient email address is invalid."
    except smtplib.SMTPException as e:
        # Parse SMTP error codes for better error messages
        error_str = str(e)
        if '554' in error_str and 'Disabled by user' in error_str:
            error_msg = "Email sending disabled in hosting panel (hPanel). Please enable email sending for this account in your hosting control panel."
        elif '554' in error_str:
            error_msg = f"SMTP error (554): Email rejected by server. Check your sender account settings. Original: {error_str}"
        elif '550' in error_str:
            error_msg = f"SMTP error (550): Mailbox unavailable or quota exceeded. Original: {error_str}"
        elif '535' in error_str or 'Authentication' in error_str:
            error_msg = "SMTP authentication failed. Check your email and password/app password."
        else:
            error_msg = f"SMTP error: {error_str}"
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"

    if campaign_name and campaign_id:
        try:
            from mongo_utils import log_email_sent
            log_email_sent(campaign_name, campaign_id, recipient_email, sender_email, subject, 'failed', error_msg, user_id)
        except Exception as log_error:
            print(f"Warning: Failed to log failed email: {log_error}")
    return False, error_msg

def test_smtp_connection(host, port, user, password, use_tls=True, use_ssl=False):
    try:
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                server.login(user, password)
        else:
            with smtplib.SMTP(host, port) as server:
                if use_tls:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                server.login(user, password)
        return True
    except Exception as e:
        print(f"SMTP test failed: {e}")
        return False

def check_sender_health(sender_email, sender_password):
    """
    Check if sender credentials are working
    
    Args:
        sender_email (str): Gmail address
        sender_password (str): Gmail app password
    
    Returns:
        tuple: (is_healthy: bool, message: str)
    """
    try:
        # Create SMTP session
        context = ssl.create_default_context()
        
        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls(context=context)
            server.login(sender_email, sender_password)
            
        return True, "Sender credentials are valid"
        
    except smtplib.SMTPAuthenticationError:
        return False, "Authentication failed. Check your email and app password."
    except smtplib.SMTPException as e:
        return False, f"SMTP error: {str(e)}"
    except Exception as e:
        return False, f"Unexpected error: {str(e)}"

def validate_app_password(password):
    """
    Validate Gmail app password format
    
    Args:
        password (str): App password to validate
    
    Returns:
        tuple: (is_valid: bool, message: str)
    """
    if not password:
        return False, "Password cannot be empty"
    
    # Remove spaces for validation
    clean_password = password.replace(" ", "")
    
    # Check if it's 16 characters (standard Gmail app password length)
    if len(clean_password) != 16:
        return False, "Gmail app password should be 16 characters long"
    
    # Check if it contains only alphanumeric characters
    if not re.match(r'^[a-zA-Z0-9]+$', clean_password):
        return False, "Gmail app password should contain only letters and numbers"
    
    return True, "App password format is valid"

def send_bulk_email(senders, recipients, subject, html_content, delay=30, daily_limit=120):
    """
    Send bulk emails with rate limiting
    
    Args:
        senders (list): List of sender dictionaries with email, password, name
        recipients (list): List of recipient email addresses
        subject (str): Email subject
        html_content (str): HTML content of the email
        delay (int): Delay between emails in seconds
        daily_limit (int): Maximum emails to send per day
    
    Returns:
        dict: Results with sent, failed, and error details
    """
    results = {
        'sent': [],
        'failed': [],
        'errors': [],
        'total_sent': 0,
        'total_failed': 0
    }
    
    if not senders:
        results['errors'].append("No senders configured")
        return results
    
    if not recipients:
        results['errors'].append("No recipients provided")
        return results
    
    # Rotate through senders
    sender_index = 0
    emails_sent_today = 0
    
    for i, recipient in enumerate(recipients):
        if emails_sent_today >= daily_limit:
            results['errors'].append(f"Daily limit of {daily_limit} emails reached")
            break
        
        # Get current sender
        sender = senders[sender_index % len(senders)]
        
        # Send email (supports custom SMTP when provided)
        if 'smtp_host' in sender:
            success, message = send_email_dynamic(
                sender.get('smtp_host'),
                int(sender.get('smtp_port', 587)),
                sender.get('smtp_user', sender.get('email')),
                sender.get('smtp_password', sender.get('password')),
                sender.get('email'),
                recipient,
                subject,
                html_content,
                use_tls=bool(sender.get('use_tls', True)),
                use_ssl=bool(sender.get('use_ssl', False)),
                sender_name=sender.get('name', 'Bulk Email System')
            )
        else:
            success, message = send_email(
                sender['email'],
                sender['password'],
                recipient,
                subject,
                html_content,
                sender.get('name', 'Bulk Email System')
            )
        
        if success:
            results['sent'].append(recipient)
            results['total_sent'] += 1
            emails_sent_today += 1
        else:
            results['failed'].append(recipient)
            results['errors'].append(f"Failed to send to {recipient}: {message}")
            results['total_failed'] += 1
        
        # Rotate to next sender
        sender_index += 1
        
        # Add delay between emails (except for the last one)
        if i < len(recipients) - 1:
            time.sleep(delay)
    
    return results

def send_batch_emails(senders, recipients_batch, subject, html_content, sender_names=None, campaign_name=None, campaign_id=None, user_id=None, personalized_templates=None):
    """
    Send a batch of emails simultaneously (one per sender)
    
    Args:
        senders (list): List of sender dictionaries with email, password, name
        recipients_batch (list): List of recipient email addresses for this batch
        subject (str): Email subject
        html_content (str): HTML content of the email (fallback if personalized_templates not provided)
        sender_names (dict): Optional dict mapping recipient emails to sender names
        campaign_name (str): Campaign name for logging
        campaign_id (str): Campaign ID for logging
        user_id (str): User ID for logging
        personalized_templates (dict): Optional dict mapping recipient emails to personalized HTML content
    
    Returns:
        dict: Results with sent, failed, and error details
    """
    import threading
    import time
    
    results = {
        'sent': [],
        'failed': [],
        'errors': [],
        'total_sent': 0,
        'total_failed': 0
    }
    
    if not senders:
        results['errors'].append("No senders configured")
        return results
    
    if not recipients_batch:
        return results
    
    # Limit batch size to number of senders
    batch_size = min(len(recipients_batch), len(senders))
    batch_recipients = recipients_batch[:batch_size]
    
    # Thread results storage
    thread_results = []
    threads = []
    
    def send_single_email(sender, recipient, index):
        """Send a single email in a thread"""
        try:
            sender_email = sender.get('email', 'unknown')
            print(f"      📤 Sending email to {recipient} via {sender_email}...")
            
            # Use personalized template for this recipient if available
            if personalized_templates and recipient in personalized_templates:
                personalized_content = personalized_templates[recipient]
            else:
                # Fallback to general template with sender name personalization
                personalized_content = html_content
                if sender_names and recipient in sender_names:
                    sender_name = sender_names[recipient]
                    personalized_content = html_content.replace('{{sender_name}}', sender_name)
            
            if 'smtp_host' in sender:
                success, message = send_email_dynamic(
                    sender.get('smtp_host'),
                    int(sender.get('smtp_port', 587)),
                    sender.get('smtp_user', sender.get('email')),
                    sender.get('smtp_password', sender.get('password')),
                    sender.get('email'),
                    recipient,
                    subject,
                    personalized_content,
                    use_tls=bool(sender.get('use_tls', True)),
                    use_ssl=bool(sender.get('use_ssl', False)),
                    sender_name=sender.get('name'),
                    campaign_name=campaign_name,
                    campaign_id=campaign_id,
                    user_id=user_id
                )
            else:
                success, message = send_email(
                    sender['email'],
                    sender['password'],
                    recipient,
                    subject,
                    personalized_content,
                    sender.get('name'),
                    campaign_name,
                    campaign_id,
                    user_id
                )
            
            if success:
                print(f"      ✅ Successfully sent to {recipient} via {sender_email}")
            else:
                print(f"      ❌❌❌ FAILED to send to {recipient} via {sender_email}")
                print(f"         📋 Error Message: {message}")
                # Print full traceback for debugging
                import traceback
                print(f"         📋 Full Error Details:")
                traceback.print_exc()
            
            thread_results.append({
                'recipient': recipient,
                'success': success,
                'message': message,
                'sender': sender['email'],
                'index': index
            })
        except Exception as e:
            print(f"      ❌❌❌ EXCEPTION sending to {recipient} via {sender.get('email', 'unknown')}")
            print(f"         📋 Exception: {str(e)}")
            # Print full traceback for debugging
            import traceback
            print(f"         📋 Full Exception Details:")
            traceback.print_exc()
            thread_results.append({
                'recipient': recipient,
                'success': False,
                'message': str(e),
                'sender': sender.get('email', 'unknown'),
                'index': index
            })
    
    # Start all threads simultaneously (EXACTLY like Streamlit)
    print(f"    🚀 Starting {len(batch_recipients)} email threads simultaneously...")
    for i, recipient in enumerate(batch_recipients):
        sender = senders[i % len(senders)]
        thread = threading.Thread(
            target=send_single_email,
            args=(sender, recipient, i)
        )
        threads.append(thread)
        thread.start()
    
    # Wait for all threads to complete
    print(f"    ⏳ Waiting for all {len(threads)} threads to complete...")
    for thread in threads:
        thread.join()
    print(f"    ✓ All threads completed")
    
    # Process results (sort by index to maintain order)
    thread_results.sort(key=lambda x: x['index'])
    
    for result in thread_results:
        if result['success']:
            results['sent'].append(result['recipient'])
            results['total_sent'] += 1
        else:
            results['failed'].append(result['recipient'])
            error_detail = f"Failed to send to {result['recipient']} via {result['sender']}: {result['message']}"
            results['errors'].append(error_detail)
            results['total_failed'] += 1
            print(f"    📋 Result for {result['recipient']}: FAILED - {result['message']}")
    
    if results['total_failed'] > 0:
        print(f"    ⚠️  BATCH SUMMARY: {results['total_sent']} sent, {results['total_failed']} failed")
        print(f"    ⚠️  Failed emails: {', '.join(results['failed'])}")
        for err in results['errors']:
            print(f"       - {err}")
    
    return results

def test_email_connection(sender_email, sender_password):
    """
    Test email connection by sending a test email to the sender
    
    Args:
        sender_email (str): Gmail address
        sender_password (str): Gmail app password
    
    Returns:
        tuple: (success: bool, message: str)
    """
    try:
        # Send test email to self
        test_subject = "Test Email - Bulk Email System"
        test_content = """
        <html>
        <body>
            <h2>Test Email</h2>
            <p>This is a test email from the Bulk Email System.</p>
            <p>If you received this email, your configuration is working correctly!</p>
        </body>
        </html>
        """
        
        success, message = send_email(
            sender_email,
            sender_password,
            sender_email,  # Send to self
            test_subject,
            test_content,
            "Bulk Email System Test"
        )
        
        if success:
            return True, "Test email sent successfully to yourself"
        else:
            return False, f"Test email failed: {message}"
            
    except Exception as e:
        return False, f"Test email error: {str(e)}"
