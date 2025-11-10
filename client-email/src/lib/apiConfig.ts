// Dynamic API URL based on current location
export const getApiBaseUrl = () => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // Default to production backend
  return 'http://31.97.239.75:7027/api';
};

// Dynamic Tracker URL based on current location
export const getTrackerUrl = () => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }

  // Default to production tracker
  return 'http://31.97.239.75:3399';
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = () => {
  return getApiBaseUrl().replace('/api', '');
};

export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
export const TRACKER_URL = getTrackerUrl();
