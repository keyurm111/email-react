# 📧 Email Tracker - Python Flask

A sophisticated email tracking service with open and click tracking capabilities, powered by **Python Flask** and **MongoDB**.

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- MongoDB (local or Atlas)
- pip

### Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
MONGO_URI=mongodb://localhost:27017/email_tracker
PORT=3003

# Start server
python run.py      # Development (auto-reload)
python server.py   # Production
```

## 🔌 API Endpoints

- `GET /track/open?email=<email>&uid=<uid>` - Open tracking
- `GET /track/click?email=<email>&uid=<uid>&redirect=<url>` - Click tracking  
- `GET /logs` - Analytics data
- `GET /health` - Health check
- `GET /` - Service info

## 📧 Email Integration

```html
<!-- Open tracking pixel -->
<img src="https://your-tracker.com/track/open?email={{email}}&uid={{campaign_id}}" 
     width="1" height="1" style="display:none;" />

<!-- Click tracking link -->
<a href="https://your-tracker.com/track/click?email={{email}}&uid={{campaign_id}}&redirect={{original_url}}">
  Click here
</a>
```

## 🗄️ MongoDB Schema

```javascript
{
  "_id": ObjectId,
  "type": "open" | "click",
  "email": String,
  "uid": String,
  "open_count": Number,        // Only for open events
  "last_opened": String,       // Only for open events
  "ip": String,
  "user_agent": String,
  "redirect_url": String,      // Only for click events
  "timestamp": String
}
```

## 🔧 Configuration

```bash
# .env file
MONGO_URI=mongodb://localhost:27017/email_tracker
PORT=3000
```

## 🧪 Testing

```bash
# Test endpoints
curl "http://localhost:3003/track/open?email=test@example.com&uid=TEST123"
curl "http://localhost:3003/track/click?email=test@example.com&uid=TEST123&redirect=https://example.com"
curl http://localhost:3003/logs
curl http://localhost:3003/health
```

---

**Happy Email Tracking! 📧🐍✨**
