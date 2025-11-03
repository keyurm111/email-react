# Bulk Email Automation - React Frontend

This is the React + TypeScript + Tailwind CSS frontend for the Bulk Email Automation system, converted from the original HTML/JavaScript frontend.

## Tech Stack

- **React 19** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Font Awesome** for icons

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Backend API Server

**Important**: The backend must be running before starting the frontend!

```bash
cd ../Bulk-email-automation-
python3 run_api_server.py
```

The API server runs on `http://localhost:5000`

### 3. (Optional) Start Tracker Server

For email tracking functionality:

```bash
cd ../tracker
python run.py
```

The tracker runs on `http://localhost:3003`

### 4. Start Frontend Development Server

```bash
npm run dev
```

The app will open at `http://localhost:5173`

## Configuration

### Environment Variables

## Environment Configuration

### Local Development

Create a `.env.local` file in the project root (for local development):

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_TRACKER_URL=http://localhost:3003
```

### Production

For production builds, create a `.env.production.local` file:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_TRACKER_URL=http://31.97.239.75:3399
```

### Automatic Configuration

The app automatically uses:
- **Local Tracker**: `http://localhost:3003` when running in development mode
- **Production Tracker**: `http://31.97.239.75:3399` when building for production
- **Environment Variable Override**: If `VITE_TRACKER_URL` is set in `.env` files, it takes priority

The frontend will automatically connect to:
- **API Server**: `http://localhost:5000/api`
- **Tracker Server**: 
  - Local: `http://localhost:3003` (development)
  - Production: `http://31.97.239.75:3399` (production build)

## Project Structure

```
src/
├── components/          # Reusable components
│   ├── Layout.tsx      # Main layout with sidebar
│   ├── Toast.tsx       # Toast notifications
│   └── CampaignSetupModal.tsx
├── contexts/           # React contexts
│   └── AuthContext.tsx # Authentication context
├── hooks/              # Custom React hooks
│   └── useToast.tsx    # Toast notification hook
├── pages/              # Page components
│   ├── Login.tsx       # Authentication
│   ├── Dashboard.tsx   # Dashboard
│   ├── Senders.tsx     # Sender management
│   ├── Campaigns.tsx   # Campaign management
│   ├── ActiveCampaign.tsx # Active campaign monitoring
│   ├── Tracker.tsx     # Email tracking
│   ├── Analytics.tsx   # Analytics (placeholder)
│   ├── Resources.tsx   # Resources (placeholder)
│   ├── Requirements.tsx # Requirements (placeholder)
│   └── Profile.tsx     # User profile
├── services/           # API services
│   └── api.ts          # API client functions
├── types/              # TypeScript type definitions
│   └── index.ts        # Shared types
├── utils/              # Utility functions
│   ├── storage.ts      # LocalStorage helpers
│   └── helpers.ts      # General helpers
├── App.tsx             # Main app component with routing
├── main.tsx            # App entry point
└── index.css           # Global styles with Tailwind
```

## Features

- ✅ Authentication (Login/Register)
- ✅ Dashboard with stats and recent campaigns
- ✅ Sender management (Gmail & SMTP)
- ✅ Campaign creation and management
- ✅ Campaign setup with multi-step wizard
- ✅ Active campaign monitoring with live logs
- ✅ Email tracking and analytics
- ✅ Protected routes
- ✅ Responsive sidebar navigation
- ✅ Toast notifications
- ✅ TypeScript type safety
- ✅ Tailwind CSS styling

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## API Connection

The frontend connects to:
- **Main API**: `http://localhost:5000/api` (Flask backend)
- **Tracker API**: `http://localhost:3003` (Tracker service)

All API requests include the `X-User-ID` header for authentication.

See [CONNECTION_GUIDE.md](./CONNECTION_GUIDE.md) for detailed connection instructions.

## Development Notes

- All API calls go through the centralized API client in `src/services/api.ts`
- Authentication state is managed via `AuthContext`
- Toast notifications use the `useToast` hook
- Type definitions are in `src/types/index.ts`
- The Layout component handles sidebar and header for all protected pages

## Troubleshooting

### Backend Connection Issues

1. **Cannot connect to backend**
   - Ensure the API server is running: `cd Bulk-email-automation- && python3 run_api_server.py`
   - Check the browser console for detailed error messages
   - Verify the API server is on port 5000

2. **CORS Errors**
   - CORS is enabled by default in the API server
   - If issues persist, check `api_server.py` for CORS configuration

3. **Authentication Issues**
   - Check browser localStorage for user data
   - Verify the API server is returning the correct user structure

### Build Issues

1. **TypeScript Errors**
   - Run `npm run build` to see all TypeScript errors
   - Fix any type mismatches in the code

2. **Tailwind Not Working**
   - Ensure Tailwind v3 is installed (not v4)
   - Check `tailwind.config.js` and `postcss.config.js`

## Production Build

```bash
npm run build
```

The production build will be in the `dist/` directory.

For deployment, update the environment variables to point to your production API servers.
