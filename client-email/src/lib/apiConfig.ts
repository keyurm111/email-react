// Dynamic API URL based on current location
export const getApiBaseUrl = () => {
  // Priority 1: Environment variable (highest priority)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Priority 2: Check if we're in production (not localhost)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.startsWith('192.168.');
    
    if (isProduction) {
      // Production: Use hardcoded production API URL
      return 'http://31.97.239.75:7027/api';
    }
    
    // Development: Use same host but different port
    const protocol = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : '';
    // In development, API is on port 7027, frontend on 7026
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:7027/api';
    }
    return `${protocol}//${hostname}${port}/api`;
  }

  // Fallback for SSR or unknown environment
  return 'http://127.0.0.1:7027/api';
};

// Tracker URL shares the same host as the API
export const getTrackerUrl = () => {
  // Priority 1: Environment variable (highest priority)
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }

  // Priority 2: Use same base URL as API (which handles production correctly)
  return `${getBaseUrl()}/tracker`;
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = () => {
  return getApiBaseUrl().replace('/api', '');
};

export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
export const TRACKER_URL = getTrackerUrl();
