// Dynamic API URL based on current location
export const getApiBaseUrl = () => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // Auto-detect based on current location
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';
  
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    // Local development - use localhost server
    return `${protocol}//127.0.0.1:7027/api`;
  } else if (currentHost === '31.97.239.75') {
    // Production frontend - use production backend
    return `${protocol}//31.97.239.75:7027/api`;
  } else {
    // Fallback for other scenarios
    return `${protocol}//31.97.239.75:7027/api`;
  }
};

// Dynamic Tracker URL based on current location
export const getTrackerUrl = () => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }
  
  // Auto-detect based on current location
  const currentHost = window.location.hostname;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';
  
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    // Local development - use localhost tracker
    return `${protocol}//localhost:3003`;
  } else if (currentHost === '31.97.239.75') {
    // Production frontend - use production tracker
    return `${protocol}//31.97.239.75:3399`;
  } else {
    // Fallback for other scenarios
    return `${protocol}//31.97.239.75:3399`;
  }
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = () => {
  return getApiBaseUrl().replace('/api', '');
};

export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
export const TRACKER_URL = getTrackerUrl();
