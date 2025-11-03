/**
 * API Configuration
 * Dynamic URL detection based on current location
 */

// Production tracker URL (fallback)
const PRODUCTION_TRACKER_URL = 'http://31.97.239.75:3399';

// Cache for tracker URL to avoid repeated connection tests
let cachedTrackerUrl: string | null = null;
let trackerUrlTested = false;

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

// Helper function to check if error is from browser extension
const isExtensionError = (error: any): boolean => {
  if (!error) return false;
  const message = error.message || error.toString() || '';
  return (
    message.includes('message channel closed') ||
    message.includes('asynchronous response') ||
    message.includes('Extension context invalidated') ||
    message.includes('runtime.lastError') ||
    error.name === 'AbortError'
  );
};

// Test tracker connection
const testTrackerConnection = async (url: string, timeout = 3000): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error: any) {
    // Silently handle extension errors and aborted requests
    if (isExtensionError(error)) {
      return false;
    }
    return false;
  }
};

// Dynamic Tracker URL with localhost fallback to production
export const getTrackerUrl = (): string => {
  // If environment variable is set, use it
  if (import.meta.env.VITE_TRACKER_URL) {
    return import.meta.env.VITE_TRACKER_URL;
  }

  // If we have a cached URL, return it
  if (cachedTrackerUrl) {
    return cachedTrackerUrl;
  }

  // Auto-detect based on current location
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';

  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    // Local development - try localhost tracker first, will fallback to production if not available
    return `${protocol}//localhost:3003`;
  } else if (currentHost === 'akdmtask.onrender.com') {
    // Production frontend - use production tracker
    return PRODUCTION_TRACKER_URL;
  } else if (currentHost === '192.168.29.8' && currentPort === '8080') {
    // Network frontend on port 8080 - try local tracker first
    return `${protocol}//192.168.29.8:3003`;
  } else if (currentHost === '192.168.9.23') {
    // Specific network IP - use production tracker
    return PRODUCTION_TRACKER_URL;
  } else if (currentHost === '103.108.205.162' && currentPort === '33998') {
    // New map website frontend - use production tracker
    return PRODUCTION_TRACKER_URL;
  } else if (currentHost === '192.168.29.8') {
    // Network IP without specific port - try local tracker first
    return `${protocol}//192.168.29.8:3003`;
  } else {
    // Fallback for other scenarios - use production tracker
    return PRODUCTION_TRACKER_URL;
  }
};

// Async function to get tracker URL with connection test and fallback
export const getTrackerUrlAsync = async (): Promise<string> => {
  // If environment variable is set, use it without testing
  if (import.meta.env.VITE_TRACKER_URL) {
    cachedTrackerUrl = import.meta.env.VITE_TRACKER_URL;
    return cachedTrackerUrl;
  }

  // If we already tested and have a cached URL, return it
  if (trackerUrlTested && cachedTrackerUrl) {
    return cachedTrackerUrl;
  }

  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'https:' : 'http:';

  // Check if we should try localhost tracker first
  const shouldTryLocalhost = 
    currentHost === 'localhost' || 
    currentHost === '127.0.0.1' ||
    (currentHost === '192.168.29.8' && currentPort === '8080') ||
    (currentHost === '192.168.29.8' && !currentPort);

  if (shouldTryLocalhost) {
    // Determine localhost tracker URL
    let localhostUrl: string;
    if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
      localhostUrl = `${protocol}//localhost:3003`;
    } else {
      localhostUrl = `${protocol}//192.168.29.8:3003`;
    }

    // Test localhost tracker connection
    const isLocalhostAvailable = await testTrackerConnection(localhostUrl);
    
    if (isLocalhostAvailable) {
      cachedTrackerUrl = localhostUrl;
      trackerUrlTested = true;
      if (import.meta.env.DEV) {
        console.log('✅ Using localhost tracker:', localhostUrl);
      }
      return localhostUrl;
    } else {
      // Fallback to production if localhost is not available
      cachedTrackerUrl = PRODUCTION_TRACKER_URL;
      trackerUrlTested = true;
      if (import.meta.env.DEV) {
        console.log('⚠️ Localhost tracker not available, using production tracker:', PRODUCTION_TRACKER_URL);
      }
      return PRODUCTION_TRACKER_URL;
    }
  } else {
    // For non-localhost hosts, use production tracker directly
    cachedTrackerUrl = PRODUCTION_TRACKER_URL;
    trackerUrlTested = true;
    return PRODUCTION_TRACKER_URL;
  }
};

// Get base URL without /api for Socket.IO connections
export const getBaseUrl = (): string => {
  return getApiBaseUrl().replace('/api', '');
};

// Export constants
export const API_BASE_URL = getApiBaseUrl();
export const BASE_URL = getBaseUrl();
// TRACKER_URL is now async - use getTrackerUrlAsync() instead
export const TRACKER_URL = getTrackerUrl(); // Default for immediate use, will be updated after async test

// Initialize tracker URL on app load (tests localhost and falls back to production)
if (typeof window !== 'undefined') {
  getTrackerUrlAsync().then((url) => {
if (import.meta.env.DEV) {
  console.log('🔗 API Configuration:', {
    API_BASE_URL,
        TRACKER_URL: url,
    BASE_URL,
    currentHost: window.location.hostname,
    currentPort: window.location.port,
    protocol: window.location.protocol,
      });
    }
  }).catch(() => {
    // Silent fallback, already handled in getTrackerUrlAsync
  });
}

