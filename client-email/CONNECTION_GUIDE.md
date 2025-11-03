# Backend Connection Guide

## Prerequisites

1. **Backend API Server** - Must be running on `http://localhost:5000`
2. **Tracker Server** (Optional) - Should run on `http://localhost:3003` for email tracking

## Starting the Backend

### 1. Start the API Server

```bash
cd Bulk-email-automation-
python3 run_api_server.py
```

The API server will start on `http://localhost:5000` with the following endpoints:
- Base URL: `http://localhost:5000/api`
- CORS is enabled for frontend connections

### 2. Start the Tracker Server (Optional)

```bash
cd tracker
python run.py
```

The tracker server will start on `http://localhost:3003`

## Starting the React Frontend

```bash
cd frontend-react
npm run dev
```

The frontend will start on `http://localhost:5173` (or the next available port)

## Configuration

### Environment Variables

The frontend uses the following environment variables (with defaults):

- `VITE_API_BASE_URL` - Default: `http://localhost:5000/api`
- `VITE_TRACKER_URL` - Default: `http://localhost:3003`

### Create `.env` file (optional)

Create a `.env` file in `frontend-react/` directory:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_TRACKER_URL=http://localhost:3003
```

## Vite Proxy Configuration

The `vite.config.ts` includes proxy settings for development:
- `/api` → `http://localhost:5000`
- `/tracker` → `http://localhost:3003`

This means you can also use relative URLs in development.

## API Authentication

The frontend automatically includes the `X-User-ID` header with API requests using the logged-in user's ID from localStorage.

## Connection Testing

1. Open the React app in your browser
2. Check the browser console for connection logs:
   - `🔗 API Configuration:` - Shows the configured API URLs
   - `🌐 GET/POST` - Shows each API request
   - `✅ Response:` - Shows successful responses
   - `❌ API Error:` - Shows any connection errors

## Troubleshooting

### "Cannot connect to backend server"

1. Ensure the API server is running:
   ```bash
   cd Bulk-email-automation-
   python3 run_api_server.py
   ```

2. Check if the server is listening on port 5000:
   ```bash
   lsof -i :5000
   ```

3. Verify CORS is enabled in the API server (it should be by default)

### "Tracker server not running"

This is expected if you haven't started the tracker server. The app will still work, but tracking features will be disabled. Start the tracker:

```bash
cd tracker
python run.py
```

### CORS Issues

If you see CORS errors:
1. Verify `CORS(app)` is enabled in `api_server.py`
2. Check that the API server is running on the expected port
3. Clear browser cache and reload

### Port Already in Use

If port 5000 is already in use:
1. Kill the process using port 5000:
   ```bash
   lsof -ti:5000 | xargs kill -9
   ```
2. Or change the API port in the environment and update the frontend `.env` file

## Production Deployment

For production, update the environment variables:

```env
VITE_API_BASE_URL=https://your-api-domain.com/api
VITE_TRACKER_URL=https://your-tracker-domain.com
```

Then build the frontend:

```bash
npm run build
```

The built files will be in the `dist/` directory.

