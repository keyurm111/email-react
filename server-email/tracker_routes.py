import base64
import logging
from datetime import datetime
from io import BytesIO

from flask import Blueprint, jsonify, redirect, request, send_file

from mongo_utils import CAMPAIGNS_COLLECTION, get_database

logger = logging.getLogger(__name__)

TRACKING_COLLECTION = 'email_tracking'

PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMBgQh1X6sAAAAASUVORK5CYII='
PIXEL_BYTES = base64.b64decode(PIXEL_BASE64)

tracker_bp = Blueprint('tracker', __name__, url_prefix='/tracker')

_indexes_initialized = False


def _get_tracking_collection():
    """Return the MongoDB collection used for tracking data."""
    global _indexes_initialized
    db = get_database()
    if db is None:
        logger.error("Unable to connect to MongoDB for tracking")
        return None

    collection = db[TRACKING_COLLECTION]
    if not _indexes_initialized:
        try:
            collection.create_index([('email', 1), ('campaign_name', 1), ('type', 1)], background=True)
            collection.create_index([('timestamp', -1)], background=True)
        except Exception as exc:  # pragma: no cover - index creation failure is non-critical
            logger.warning("Tracker index creation skipped: %s", exc)
        _indexes_initialized = True
    return collection


def _tracking_pixel_response():
    """Return the 1x1 tracking pixel image."""
    buffer = BytesIO(PIXEL_BYTES)
    buffer.seek(0)
    return send_file(buffer, mimetype='image/png')


def _get_user_campaign_names(user_id: str):
    """Fetch campaign names belonging to a specific user."""
    db = get_database()
    if db is None:
        logger.error("Unable to connect to MongoDB for user campaign lookup")
        return []

    campaigns_collection = db[CAMPAIGNS_COLLECTION]
    user_campaigns = campaigns_collection.find({'user_id': user_id}, {'name': 1, '_id': 0})
    return [campaign.get('name') for campaign in user_campaigns if campaign.get('name')]


@tracker_bp.route('/track/open')
def track_open():
    """Track email opens by serving a 1x1 pixel."""
    email = request.args.get('email')
    campaign_name = request.args.get('uid')
    name = request.args.get('name', '')
    instagram = request.args.get('instagram', '')

    if not email or not campaign_name:
        logger.warning("Tracking open missing email or campaign parameters")
        return _tracking_pixel_response()

    collection = _get_tracking_collection()
    if collection is None:
        return _tracking_pixel_response()

    now = datetime.utcnow()
    try:
        existing_record = collection.find_one({
            'email': email,
            'campaign_name': campaign_name,
            'type': 'open'
        })

        if existing_record:
            collection.update_one(
                {'_id': existing_record['_id']},
                {
                    '$set': {
                        'last_opened': now.isoformat(),
                        'ip': request.remote_addr,
                        'user_agent': request.headers.get('User-Agent', '')
                    },
                    '$inc': {'open_count': 1}
                }
            )
        else:
            collection.insert_one({
                'type': 'open',
                'email': email,
                'name': name,
                'instagram': instagram,
                'uid': campaign_name,
                'campaign_name': campaign_name,
                'open_count': 1,
                'last_opened': now.isoformat(),
                'time': now.strftime('%H:%M:%S'),
                'date': now.strftime('%Y-%m-%d'),
                'ip': request.remote_addr,
                'user_agent': request.headers.get('User-Agent', ''),
                'timestamp': now.isoformat()
            })
    except Exception as exc:
        logger.error("Failed to track open for %s (%s): %s", email, campaign_name, exc)

    return _tracking_pixel_response()


@tracker_bp.route('/track/click')
def track_click():
    """Track link clicks and redirect to the original URL."""
    email = request.args.get('email')
    campaign_name = request.args.get('uid')
    redirect_url = request.args.get('redirect')
    name = request.args.get('name', '')
    instagram = request.args.get('instagram', '')

    if not email or not campaign_name or not redirect_url:
        logger.warning("Tracking click missing parameters, redirecting to fallback")
        return redirect(redirect_url or 'https://example.com')

    collection = _get_tracking_collection()
    if collection is None:
        return redirect(redirect_url)

    now = datetime.utcnow()
    try:
        collection.insert_one({
            'type': 'click',
            'email': email,
            'name': name,
            'instagram': instagram,
            'uid': campaign_name,
            'campaign_name': campaign_name,
            'redirect_url': redirect_url,
            'time': now.strftime('%H:%M:%S'),
            'date': now.strftime('%Y-%m-%d'),
            'ip': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', ''),
            'timestamp': now.isoformat()
        })
    except Exception as exc:
        logger.error("Failed to track click for %s (%s): %s", email, campaign_name, exc)

    return redirect(redirect_url)


@tracker_bp.route('/campaigns')
def get_campaigns():
    """Return aggregated tracking data for all campaigns."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    campaigns = []
    for campaign_name in collection.distinct('campaign_name'):
        if not campaign_name:
            continue

        opens = list(collection.find({'campaign_name': campaign_name, 'type': 'open'}, {'_id': 0}))
        clicks = list(collection.find({'campaign_name': campaign_name, 'type': 'click'}, {'_id': 0}))

        total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
        unique_emails = len({open_record.get('email') for open_record in opens if open_record.get('email')})

        campaigns.append({
            'campaign_name': campaign_name,
            'total_opens': total_opens,
            'unique_opens': len(opens),
            'total_clicks': len(clicks),
            'unique_emails': unique_emails,
            'open_rate': round((len(opens) / unique_emails * 100) if unique_emails else 0, 2),
            'click_rate': round((len(clicks) / unique_emails * 100) if unique_emails else 0, 2),
            'opens': opens,
            'clicks': clicks
        })

    return jsonify({
        'campaigns': campaigns,
        'total_campaigns': len(campaigns),
        'success': True
    })


@tracker_bp.route('/campaign/<campaign_name>')
def get_campaign_details(campaign_name):
    """Return detailed tracking data for a specific campaign."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    opens = list(collection.find({'campaign_name': campaign_name, 'type': 'open'}, {'_id': 0}).sort('timestamp', -1))
    clicks = list(collection.find({'campaign_name': campaign_name, 'type': 'click'}, {'_id': 0}).sort('timestamp', -1))

    total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
    unique_emails = len({open_record.get('email') for open_record in opens if open_record.get('email')})

    url_stats = {}
    for click in clicks:
        url = click.get('redirect_url', 'Unknown')
        url_stats[url] = url_stats.get(url, 0) + 1

    return jsonify({
        'campaign_name': campaign_name,
        'total_opens': total_opens,
        'unique_opens': len(opens),
        'total_clicks': len(clicks),
        'unique_emails': unique_emails,
        'open_rate': round((len(opens) / unique_emails * 100) if unique_emails else 0, 2),
        'click_rate': round((len(clicks) / unique_emails * 100) if unique_emails else 0, 2),
        'url_stats': url_stats,
        'opens': opens,
        'clicks': clicks,
        'success': True
    })


@tracker_bp.route('/table')
def get_table():
    """Return all tracking records in table format."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    records = list(collection.find({'type': 'open'}, {
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

    return jsonify({
        'data': records,
        'count': len(records),
        'success': True
    })


@tracker_bp.route('/table/<campaign_name>')
def get_campaign_table(campaign_name):
    """Return table data for a specific campaign."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    records = list(collection.find({
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

    return jsonify({
        'campaign_name': campaign_name,
        'data': records,
        'count': len(records),
        'success': True
    })


@tracker_bp.route('/user/campaigns')
def get_user_campaigns():
    """Return tracking analytics filtered by user campaigns."""
    user_id = request.headers.get('X-User-ID')
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required in X-User-ID header'}), 401

    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    campaign_names = _get_user_campaign_names(user_id)
    if not campaign_names:
        return jsonify({'campaigns': [], 'total_campaigns': 0, 'success': True})

    tracked_campaigns = collection.distinct('campaign_name', {'campaign_name': {'$in': campaign_names}})

    campaign_data = []
    for campaign_name in tracked_campaigns:
        opens = list(collection.find({'campaign_name': campaign_name, 'type': 'open'}, {'_id': 0}))
        clicks = list(collection.find({'campaign_name': campaign_name, 'type': 'click'}, {'_id': 0}))

        total_opens = sum(open_record.get('open_count', 1) for open_record in opens)
        unique_emails = len({open_record.get('email') for open_record in opens if open_record.get('email')})

        campaign_data.append({
            'campaign_name': campaign_name,
            'total_opens': total_opens,
            'unique_opens': len(opens),
            'total_clicks': len(clicks),
            'unique_emails': unique_emails,
            'open_rate': round((len(opens) / unique_emails * 100) if unique_emails else 0, 2),
            'click_rate': round((len(clicks) / unique_emails * 100) if unique_emails else 0, 2),
            'opens': opens,
            'clicks': clicks
        })

    return jsonify({
        'campaigns': campaign_data,
        'total_campaigns': len(campaign_data),
        'success': True
    })


@tracker_bp.route('/user/table')
def get_user_table():
    """Return tracking records filtered by user campaigns."""
    user_id = request.headers.get('X-User-ID')
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required in X-User-ID header'}), 401

    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'success': False, 'error': 'Database unavailable'}), 500

    campaign_names = _get_user_campaign_names(user_id)
    if not campaign_names:
        return jsonify({'data': [], 'count': 0, 'success': True})

    campaign_filter = request.args.get('campaign')
    query = {'type': 'open', 'campaign_name': {'$in': campaign_names}}
    if campaign_filter:
        if campaign_filter not in campaign_names:
            return jsonify({'data': [], 'count': 0, 'success': True, 'message': 'Campaign not found for user'})
        query['campaign_name'] = campaign_filter

    records = list(collection.find(query, {
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

    table_data = [{
        'email': record.get('email', ''),
        'name': record.get('name', ''),
        'uid': record.get('uid', record.get('campaign_name', '')),
        'instagram': record.get('instagram', ''),
        'time': record.get('time', ''),
        'date': record.get('date', ''),
        'open_count': record.get('open_count', 0),
        'last_open': record.get('last_opened', '')
    } for record in records]

    return jsonify({
        'data': table_data,
        'count': len(table_data),
        'success': True
    })


@tracker_bp.route('/health')
def tracker_health():
    """Health endpoint for tracker services."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'status': 'unhealthy', 'database': 'disconnected'}), 500

    document_count = collection.count_documents({})
    return jsonify({
        'status': 'healthy',
        'database': 'connected',
        'collection': TRACKING_COLLECTION,
        'total_records': document_count,
        'timestamp': datetime.utcnow().isoformat()
    })


@tracker_bp.route('/debug')
def tracker_debug():
    """Debug endpoint with additional information."""
    collection = _get_tracking_collection()
    if collection is None:
        return jsonify({'status': 'error', 'error': 'database unavailable'}), 500

    try:
        total_records = collection.count_documents({})
        sample_records = list(collection.find({}, {'_id': 0}).limit(5))
        campaign_names = collection.distinct('campaign_name')
        emails = collection.distinct('email')

        return jsonify({
            'status': 'connected',
            'database': TRACKING_COLLECTION,
            'total_records': total_records,
            'distinct_campaigns': campaign_names,
            'distinct_emails': emails,
            'sample_records': sample_records,
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as exc:
        return jsonify({
            'status': 'error',
            'error': str(exc),
            'error_type': type(exc).__name__,
            'timestamp': datetime.utcnow().isoformat()
        }), 500

