/**
 * API Configuration
 * Dynamic URL detection based on current location
 */

// Dynamic API URL based on current location
export const getApiBaseUrl = (): string => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // Auto-detect based on current location
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';

  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    // Local development - use localhost server
    return `${protocol}//localhost:5000/api`;
  } else if (currentHost === 'akdmtask.onrender.com') {
    // Production frontend - use production backend
    return 'https://akdm-task.onrender.com/api';
  } else if (currentHost === '192.168.29.8' && currentPort === '8080') {
    // Network frontend on port 8080 - connect to backend on port 5000
    return `${protocol}//192.168.29.8:5000/api`;
  } else if (currentHost === '192.168.9.23') {
    // Specific network IP for the live server - use HTTPS for backend
    return `${protocol}//192.168.9.23:8443/api`;
  } else if (currentHost === '103.108.205.162' && currentPort === '33998') {
    // New map website frontend - connect to its backend
    return 'https://103.108.205.162:33999/api';
  } else if (currentHost === '192.168.29.8') {
    // Network IP without specific port - default to backend port 5000
    return `${protocol}//192.168.29.8:5000/api`;
  } else {
    // Fallback for other scenarios, like different private IPs
    return `${protocol}//${currentHost}:8443/api`;
  }
};

// Dynamic Tracker URL based on current location
export const getTrackerUrl = (): string => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }

  // Auto-detect based on current location
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';

  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    // Local development - use localhost tracker
    return `${protocol}//localhost:3003`;
  } else if (currentHost === 'akdmtask.onrender.com') {
    // Production frontend - use production tracker
    return 'http://31.97.239.75:3399';
  } else if (currentHost === '192.168.29.8' && currentPort === '8080') {
    // Network frontend on port 8080 - connect to tracker on port 3003
    return `${protocol}//192.168.29.8:3003`;
  } else if (currentHost === '192.168.9.23') {
    // Specific network IP - use production tracker
    return 'http://31.97.239.75:3399';
  } else if (currentHost === '103.108.205.162' && currentPort === '33998') {
    // New map website frontend - use production tracker
    return 'http://31.97.239.75:3399';
  } else if (currentHost === '192.168.29.8') {
    // Network IP without specific port - default to local tracker port 3003
    return `${protocol}//192.168.29.8:3003`;
  } else {
    // Fallback for other scenarios - use production tracker
    return 'http://31.97.239.75:3399';
  }
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = (): string => {
  return getApiBaseUrl().replace('/api', '');
};

// Export constants
export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
export const TRACKER_URL = getTrackerUrl();

// Log API configuration on load (development only)
if (import.meta.env.DEV) {
  console.log('🔗 API Configuration:', {
    API_BASE_URL,
    TRACKER_URL,
    BASE_URL,
    currentHost: window.location.hostname,
    currentPort: window.location.port,
    protocol: window.location.protocol,
  });
}

