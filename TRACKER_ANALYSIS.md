# 📊 Tracker System - Complete Analysis

## Overview
The tracker system tracks email opens and link clicks, stores data in MongoDB, and displays analytics in the React frontend.

---

## 🔄 Complete Flow Diagram

```
1. Email Sent with Tracking Pixel
   ↓
2. Recipient Opens Email → Browser Loads Pixel
   ↓
3. GET /tracker/track/open?email=...&uid=...&name=...&instagram=...
   ↓
4. Backend Stores/Updates Record in MongoDB
   ↓
5. Frontend Fetches Data via API
   ↓
6. Data Displayed in Tracker Page
```

---

## 💾 Data Storage (MongoDB)

### Collection: `email_tracking`

### 1. **Open Tracking** (`/tracker/track/open`)

**Storage Logic:**
- **Upsert Pattern**: If record exists → Update; If not → Insert
- **Query**: `{ email, campaign_name, type: 'open' }`
- **Update**: Increments `open_count`, updates `last_opened`, `ip`, `user_agent`
- **Insert**: Creates new record with `open_count: 1`

**Document Structure:**
```javascript
{
  type: 'open',
  email: 'user@example.com',
  name: 'John Doe',
  instagram: '@johndoe',
  uid: 'campaign-name',           // Same as campaign_name
  campaign_name: 'campaign-name',
  open_count: 1,                   // Incremented on each open
  last_opened: '2025-11-15T10:30:00.000Z',
  time: '10:30:00',               // Formatted time
  date: '2025-11-15',              // Formatted date
  ip: '66.249.84.35',
  user_agent: 'Mozilla/5.0...',
  timestamp: '2025-11-15T10:30:00.000Z'  // ISO format
}
```

**Key Points:**
- ✅ **Deduplication**: Same email + campaign = one record (updated, not duplicated)
- ✅ **Open Count**: Tracks how many times email was opened
- ✅ **Last Opened**: Always updated to most recent open time

### 2. **Click Tracking** (`/tracker/track/click`)

**Storage Logic:**
- **Always Insert**: Every click creates a new record (no deduplication)
- **Redirect**: After storing, redirects to original URL

**Document Structure:**
```javascript
{
  type: 'click',
  email: 'user@example.com',
  name: 'John Doe',
  instagram: '@johndoe',
  uid: 'campaign-name',
  campaign_name: 'campaign-name',
  redirect_url: 'https://example.com/page',
  time: '10:35:00',
  date: '2025-11-15',
  ip: '66.249.84.35',
  user_agent: 'Mozilla/5.0...',
  timestamp: '2025-11-15T10:35:00.000Z'
}
```

**Key Points:**
- ✅ **Multiple Records**: Same email can have multiple click records
- ✅ **Click History**: Tracks all clicks, not just unique clicks
- ✅ **URL Tracking**: Stores which URL was clicked

### 3. **MongoDB Indexes**

**Indexes Created:**
1. `{ email: 1, campaign_name: 1, type: 1 }` - Fast lookups for upsert
2. `{ timestamp: -1 }` - Fast sorting by time (descending)

**Location:** `tracker_routes.py` lines 32-34

---

## 📡 Data Fetching (Backend API Endpoints)

### 1. **Get User Campaigns** (`GET /tracker/user/campaigns`)

**Purpose:** Get aggregated tracking data for all campaigns belonging to a user

**Flow:**
1. Extract `X-User-ID` header
2. Get user's campaign names from `campaigns` collection
3. Filter tracking data by those campaign names
4. Aggregate opens and clicks per campaign

**Response:**
```json
{
  "success": true,
  "campaigns": [
    {
      "campaign_name": "demo",
      "total_opens": 15,           // Sum of all open_count values
      "unique_opens": 10,           // Count of unique open records
      "total_clicks": 5,            // Count of click records
      "unique_emails": 10,          // Count of unique emails
      "open_rate": 100.0,           // (unique_opens / unique_emails) * 100
      "click_rate": 50.0,           // (total_clicks / unique_emails) * 100
      "opens": [...],               // Array of open records
      "clicks": [...]               // Array of click records
    }
  ],
  "total_campaigns": 1
}
```

**Code Location:** `tracker_routes.py` lines 285-326

### 2. **Get Campaign Details** (`GET /tracker/campaign/<campaign_name>`)

**Purpose:** Get detailed tracking data for a specific campaign

**Response:**
```json
{
  "campaign_name": "demo",
  "total_opens": 15,
  "unique_opens": 10,
  "total_clicks": 5,
  "unique_emails": 10,
  "open_rate": 100.0,
  "click_rate": 50.0,
  "url_stats": {                    // Click statistics by URL
    "https://example.com": 3,
    "https://other.com": 2
  },
  "opens": [...],                   // Sorted by timestamp (newest first)
  "clicks": [...],                  // Sorted by timestamp (newest first)
  "success": true
}
```

**Code Location:** `tracker_routes.py` lines 194-224

### 3. **Get User Table** (`GET /tracker/user/table?campaign=<name>`)

**Purpose:** Get table data for user's campaigns (filtered by campaign if specified)

**Query Parameters:**
- `campaign` (optional): Filter by specific campaign name

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "email": "user@example.com",
      "name": "John Doe",
      "uid": "demo",
      "instagram": "@johndoe",
      "time": "10:30:00",
      "date": "2025-11-15",
      "open_count": 3,
      "last_open": "2025-11-15T10:30:00.000Z"
    }
  ],
  "count": 10
}
```

**Key Points:**
- ✅ Only returns `type: 'open'` records
- ✅ Sorted by `timestamp` descending (newest first)
- ✅ Filters by user's campaigns only
- ✅ Can filter by specific campaign name

**Code Location:** `tracker_routes.py` lines 329-379

### 4. **Get Campaign Table** (`GET /tracker/table/<campaign_name>`)

**Purpose:** Get table data for a specific campaign (no user filtering)

**Response:** Same structure as `/user/table` but for specific campaign

**Code Location:** `tracker_routes.py` lines 254-282

---

## 🖥️ Data Display (Frontend - React)

### 1. **Component: `Tracker.tsx`**

### 2. **Data Loading Flow**

**Initial Load (`loadData`):**
```typescript
1. Load campaigns from /api/campaigns
2. Load tracker data from /tracker/user/campaigns
3. Set campaigns and trackerData state
```

**Campaign Selection (`loadCampaignData`):**
```typescript
1. When campaign selected:
   - Fetch analytics: GET /tracker/campaign/<name>
   - Fetch table: GET /tracker/user/table?campaign=<name>
2. Map table data to events format
3. Update trackerData and events state
```

**Code Location:** `Tracker.tsx` lines 47-101

### 3. **Data Transformation**

**Opens Data:**
```typescript
// From trackerData.opens or events
opensData = [
  {
    email: 'user@example.com',
    event_type: 'open',
    timestamp: '2025-11-15T10:30:00.000Z',
    campaign: 'demo',
    name: 'John Doe',
    instagram: '@johndoe',
    uid: 'demo',
    open_count: 3,
    last_open: '2025-11-15T10:30:00.000Z'
  }
]
```

**Clicks Data:**
```typescript
// From trackerData.clicks or events
clicksData = [
  {
    email: 'user@example.com',
    event_type: 'click',
    timestamp: '2025-11-15T10:35:00.000Z',
    campaign: 'demo',
    name: 'John Doe',
    instagram: '@johndoe',
    link_url: 'https://example.com'
  }
]
```

**Code Location:** `Tracker.tsx` lines 151-175

### 4. **Display Tabs**

#### **Tab 1: Tracking Code** (`activeTab === 'code'`)
- Shows tracking code for selected campaign
- Displays campaign stats (total leads, sent, failed)

#### **Tab 2: Analytics** (`activeTab === 'analytics'`)
- **Summary Metrics:**
  - Total Opens
  - Total Clicks
  - Unique Opens
  - Unique Clicks
- **Email Opens Table:**
  - Columns: Email, Name, Instagram, Time, Date, Open Count, Last Open
  - Download CSV button
- **Link Clicks Table:**
  - Columns: Email, Name, Instagram, Time, Date, Clicked URL
  - Download CSV button

#### **Tab 3: Real-time Data** (`activeTab === 'realtime'`)
- Shows last 5 events (opens and clicks)
- Refresh button to reload data
- Color-coded: Blue for opens, Green for clicks

#### **Tab 4: Campaign Table** (`activeTab === 'table'`)
- Full table view of all tracking records
- Columns: Email, Name, UID, Instagram, Time, Date, Opens, Last Open
- Download CSV button

**Code Location:** `Tracker.tsx` lines 300-643

### 5. **API Service Calls**

**Location:** `api.ts` lines 247-323

**Functions:**
1. `getTrackerCampaigns()` → `GET /tracker/user/campaigns`
2. `getTrackerCampaignData(campaignName)` → `GET /tracker/campaign/<name>`
3. `getTrackerTable(campaignName?)` → `GET /tracker/user/table?campaign=<name>`

**Headers:**
- All requests include `X-User-ID` header for user filtering

---

## 🔍 Key Insights & Issues

### ✅ **What Works Well:**

1. **Deduplication for Opens**: Uses upsert pattern to prevent duplicate records
2. **Open Count Tracking**: Tracks how many times each email was opened
3. **User Filtering**: Only shows data for campaigns belonging to logged-in user
4. **Multiple Views**: Analytics, Real-time, and Table views for different use cases

### ⚠️ **Potential Issues:**

1. **Click Deduplication**: Clicks are NOT deduplicated (every click = new record)
   - **Impact**: If user clicks same link 10 times, creates 10 records
   - **Solution**: Could add upsert logic for clicks if needed

2. **Campaign Name Matching**: Uses exact string match for `campaign_name`
   - **Impact**: Case-sensitive, must match exactly
   - **Solution**: Could normalize to lowercase for matching

3. **Missing User ID in Click Tracking**: Click tracking doesn't filter by user
   - **Impact**: All clicks visible to all users (if same campaign name)
   - **Solution**: Add user_id to click records and filter by user

4. **No Pagination**: Table endpoints return all records
   - **Impact**: Performance issues with large datasets
   - **Solution**: Add limit/offset parameters

### 🐛 **Current Bug (Fixed):**

**Issue:** Multiple `/tracker` segments in URL causing 404
- **Root Cause:** `normalize_tracker_urls()` was adding `/tracker` even when already present
- **Fix:** Added negative lookbehind regex to prevent duplicate segments
- **Status:** ✅ Fixed in `api_server.py` lines 95-100

---

## 📝 Summary

### **Storage:**
- Opens: Upsert (update existing or insert new)
- Clicks: Always insert (no deduplication)
- Collection: `email_tracking`
- Indexes: `(email, campaign_name, type)`, `(timestamp, -1)`

### **Fetching:**
- User-filtered endpoints: `/tracker/user/campaigns`, `/tracker/user/table`
- Campaign-specific: `/tracker/campaign/<name>`, `/tracker/table/<name>`
- All require `X-User-ID` header (except non-user endpoints)

### **Display:**
- 4 tabs: Code, Analytics, Real-time, Table
- Data transformed from MongoDB format to React-friendly format
- CSV download functionality
- Real-time refresh capability

---

## 🔧 Recommendations

1. **Add User ID to Click Records**: Store `user_id` in click records for proper filtering
2. **Add Pagination**: Implement limit/offset for table endpoints
3. **Add Date Range Filtering**: Allow filtering by date range
4. **Add Click Deduplication Option**: Option to deduplicate clicks per email+URL
5. **Add Export Functionality**: Export all tracking data (not just current view)

