"""
Tracking pixel injection utilities for bulk email automation
"""

import re
from typing import Optional

def inject_tracking_pixel(html_content: str, tracker_server: str, campaign_name: str) -> str:
    """
    Inject tracking pixel into HTML template
    
    Args:
        html_content (str): Original HTML content
        tracker_server (str): Tracker server URL (default: "http://31.97.239.75:3399")
        campaign_name (str): Campaign name for UID parameter
    
    Returns:
        str: HTML content with tracking pixel injected
    """
    if not html_content or not tracker_server or not campaign_name:
        return html_content
    
    # Clean tracker server URL (remove trailing slash)
    tracker_server = tracker_server.rstrip('/')
    
    # URL encode campaign name to handle special characters (like Streamlit)
    import urllib.parse
    encoded_campaign_name = urllib.parse.quote(campaign_name)
    
    # Create tracking pixel HTML (using placeholders that match CSV column names)
    # The personalization code checks for: 'Emails' or 'Email' or 'email', 'Name' or 'name', etc.
    # Use uppercase 'Emails' as primary (matches most CSV files), but also support lowercase
    # The pixel will be personalized with actual column names from CSV during email sending
    tracking_pixel = f'''<img src="{tracker_server}/track/open?email={{{{Emails}}}}&uid={campaign_name}&name={{{{Name}}}}&instagram={{{{Instagram}}}}" width="1" height="1" style="display:none;" alt="Tracking Pixel" />'''
    
    # Check if tracking pixel already exists
    if 'track/open?email=' in html_content:
        # Replace existing tracking pixel
        pattern = r'<img[^>]*track/open\?email=[^>]*width="1"[^>]*alt="Tracking Pixel"[^>]*/?>'
        html_content = re.sub(pattern, tracking_pixel, html_content, flags=re.IGNORECASE)
    else:
        # Inject tracking pixel before closing body tag
        if '</body>' in html_content:
            html_content = html_content.replace('</body>', f'{tracking_pixel}\n</body>')
        else:
            # If no body tag, append at the end
            html_content += f'\n{tracking_pixel}'
    
    return html_content

def remove_tracking_pixel(html_content: str) -> str:
    """
    Remove tracking pixel from HTML content
    
    Args:
        html_content (str): HTML content that may contain tracking pixel
    
    Returns:
        str: HTML content with tracking pixel removed
    """
    if not html_content:
        return html_content
    
    # Remove tracking pixel using regex
    pattern = r'<img[^>]*track/open\?email=[^>]*width="1"[^>]*alt="Tracking Pixel"[^>]*/?>'
    html_content = re.sub(pattern, '', html_content, flags=re.IGNORECASE)
    
    return html_content

def get_tracking_pixel_info(html_content: str) -> Optional[dict]:
    """
    Extract tracking pixel information from HTML content
    
    Args:
        html_content (str): HTML content that may contain tracking pixel
    
    Returns:
        dict or None: Tracking pixel info if found
    """
    if not html_content:
        return None
    
    # Find tracking pixel
    pattern = r'<img[^>]*src="([^"]*track/open\?[^"]*)"[^>]*width="1"[^>]*alt="Tracking Pixel"[^>]*/?>'
    match = re.search(pattern, html_content, re.IGNORECASE)
    
    if match:
        src_url = match.group(1)
        # Extract server URL
        server_match = re.match(r'(https?://[^/]+)', src_url)
        server_url = server_match.group(1) if server_match else None
        
        return {
            'server_url': server_url,
            'full_url': src_url,
            'exists': True
        }
    
    return {'exists': False}

def validate_tracker_server(server_url: str) -> tuple[bool, str]:
    """
    Validate tracker server URL format
    
    Args:
        server_url (str): Tracker server URL to validate
    
    Returns:
        tuple: (is_valid: bool, message: str)
    """
    if not server_url:
        return False, "Tracker server URL cannot be empty"
    
    # Remove trailing slash
    server_url = server_url.rstrip('/')
    
    # Check if it starts with http:// or https://
    if not (server_url.startswith('http://') or server_url.startswith('https://')):
        return False, "Tracker server URL must start with http:// or https://"
    
    # Check if it has a valid format
    import re
    url_pattern = r'^https?://[a-zA-Z0-9.-]+(:\d+)?/?$'
    if not re.match(url_pattern, server_url):
        return False, "Invalid tracker server URL format"
    
    return True, "Valid tracker server URL"
