// Dynamic API URL based on current location
export const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${protocol}//${hostname}${port}/api`;
  }

  // Fallback for SSR or unknown environment
  return 'http://127.0.0.1:7027/api';
};

// Tracker URL shares the same host as the API
export const getTrackerUrl = () => {
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }

  return `${getBaseUrl()}/tracker`;
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = () => {
  return getApiBaseUrl().replace('/api', '');
};

export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
export const TRACKER_URL = getTrackerUrl();
