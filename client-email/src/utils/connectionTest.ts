/**
 * Connection Test Utility
 * Tests backend API connectivity on app initialization
 */

import { getApiBaseUrl, getTrackerUrl } from '../lib/apiConfig';

const API_BASE_URL = getApiBaseUrl();

export const testBackendConnection = async (): Promise<{
  success: boolean;
  message: string;
  url: string;
}> => {
  try {
    // Use the health endpoint
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: `✅ Backend API is connected and running (Status: ${data.status || 'healthy'})`,
        url: API_BASE_URL,
      };
    } else {
      return {
        success: false,
        message: `⚠️ Backend API returned status ${response.status}`,
        url: API_BASE_URL,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Cannot connect to backend API at ${API_BASE_URL}. Make sure the API server is running on port 7027.`,
      url: API_BASE_URL,
    };
  }
};

export const testTrackerConnection = async (): Promise<{
  success: boolean;
  message: string;
  url: string;
}> => {
  try {
    // Get tracker URL
    const TRACKER_URL = getTrackerUrl();
    
    const response = await fetch(`${TRACKER_URL}/health`, {
      method: 'GET',
    });

    if (response.ok) {
      return {
        success: true,
        message: '✅ Tracker server is connected and running',
        url: TRACKER_URL,
      };
    } else {
      return {
        success: false,
        message: `⚠️ Tracker server returned status ${response.status}`,
        url: TRACKER_URL,
      };
    }
  } catch (error: any) {
    // Fallback: try to get the URL anyway for the message
    const TRACKER_URL = getTrackerUrl();
    return {
      success: false,
      message: '⚠️ Tracker server is not running (optional - tracking features will be disabled)',
      url: TRACKER_URL,
    };
  }
};

