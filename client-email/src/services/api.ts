import { getUser } from '../utils/storage';
import type { User, Sender, Campaign, CampaignLog, TrackerCampaign, TrackerEvent, Requirement } from '../types';
import { API_BASE_URL, getTrackerUrl } from '../lib/apiConfig';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  [key: string]: any;
}

// Helper function to check if error is from browser extension
const isExtensionError = (error: any): boolean => {
  if (!error) return false;
  const message = error.message || error.toString() || '';
  return (
    message.includes('message channel closed') ||
    message.includes('asynchronous response') ||
    message.includes('Extension context invalidated') ||
    message.includes('runtime.lastError')
  );
};

async function apiRequest<T>(endpoint: string, method: string = 'GET', data: any = null): Promise<T> {
  const user = getUser();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (user?.user_id) {
    headers['X-User-ID'] = user.user_id;
  }

  const config: RequestInit = {
    method,
    headers,
  };

  if (data && (method === 'POST' || method === 'PUT')) {
    config.body = JSON.stringify(data);
  }

  try {
    const url = `${API_BASE_URL}${endpoint}`;
    if (import.meta.env.DEV) {
      console.log(`🌐 ${method} ${url}`, data ? { body: data } : '');
    }

    const response = await fetch(url, config);
    
    // Handle non-JSON responses
    let result;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`);
    }

    if (!response.ok) {
      throw new Error(result.message || `API request failed with status ${response.status}`);
    }

    if (import.meta.env.DEV) {
      console.log(`✅ Response:`, result);
      // Log response structure for debugging
      if (result && typeof result === 'object') {
        console.log(`📋 Response keys:`, Object.keys(result));
      }
    }

    return result;
  } catch (error: any) {
    // Silently ignore browser extension errors
    if (isExtensionError(error)) {
    if (import.meta.env.DEV) {
        console.warn('⚠️ Browser extension interference detected (this is harmless)');
      }
      // Retry the request once to see if it works despite extension interference
      try {
        const url = `${API_BASE_URL}${endpoint}`;
        const response = await fetch(url, config);
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          if (response.ok) {
            return result;
          }
        }
      } catch (retryError) {
        // If retry also fails, continue with original error handling
      }
    }
    
    // Handle aborted requests (user navigation, etc.)
    if (error.name === 'AbortError') {
      throw new Error('Request was cancelled');
    }
    
    if (import.meta.env.DEV && !isExtensionError(error)) {
      console.error('❌ API Error:', {
        endpoint,
        method,
        error: error.message,
        stack: error.stack,
      });
    }
    
    // Provide more helpful error messages
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      throw new Error(
        `Cannot connect to backend server at ${API_BASE_URL}. Make sure the API server is running on port 7027.`
      );
    }
    
    throw error;
  }
}

// Authentication API
export const authApi = {
  login: async (email: string, password: string): Promise<ApiResponse<{ user: User }> & { user?: User }> => {
    // Backend returns { success: true, user: {...} } directly
    return apiRequest('/auth/login', 'POST', { email, password });
  },
  register: async (username: string, email: string, password: string): Promise<ApiResponse<{ user: User }> & { user?: User }> => {
    // Backend returns { success: true, user: {...} } directly
    return apiRequest('/auth/register', 'POST', { username, email, password });
  },
};

// Senders API
export const sendersApi = {
  getSenders: async (): Promise<ApiResponse<{ senders: Sender[] }> & { senders?: Sender[] }> => {
    // Backend returns { success: true, senders: [...] } directly
    return apiRequest('/senders');
  },
  addGmailSender: async (email: string, password: string, name: string): Promise<ApiResponse<void>> => {
    return apiRequest('/senders/gmail', 'POST', { email, password, name });
  },
  addSmtpSender: async (senderData: Partial<Sender>): Promise<ApiResponse<void>> => {
    return apiRequest('/senders/smtp', 'POST', senderData);
  },
  updateSender: async (email: string, senderData: Partial<Sender>): Promise<ApiResponse<void>> => {
    return apiRequest(`/senders/${encodeURIComponent(email)}`, 'PUT', senderData);
  },
  deleteSender: async (email: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/senders/${encodeURIComponent(email)}`, 'DELETE');
  },
  testSender: async (email: string): Promise<ApiResponse<void> & { healthy?: boolean; message?: string }> => {
    // Backend returns { success: true, healthy: boolean, message: string }
    return apiRequest(`/senders/${encodeURIComponent(email)}/test`, 'POST');
  },
  testSmtpConnection: async (smtpData: Partial<Sender>): Promise<ApiResponse<void> & { healthy?: boolean; message?: string }> => {
    // Backend returns { success: true, healthy: boolean, message: string }
    return apiRequest('/senders/smtp/test', 'POST', smtpData);
  },
};

// Campaigns API
export const campaignsApi = {
  getCampaigns: async (): Promise<ApiResponse<{ campaigns: Campaign[] }> & { campaigns?: Campaign[] }> => {
    // Backend returns { success: true, campaigns: [...] } directly
    return apiRequest('/campaigns');
  },
  getCampaign: async (campaignId: string): Promise<ApiResponse<{ campaign: Campaign }> & { campaign?: Campaign }> => {
    // Backend returns { success: true, campaign: {...} } directly
    return apiRequest(`/campaigns/${campaignId}`);
  },
  createCampaign: async (name: string, description: string): Promise<ApiResponse<{ campaign: Campaign }> & { campaign?: Campaign }> => {
    // Backend returns { success: true, campaign: {...} } directly
    return apiRequest('/campaigns', 'POST', { name, description });
  },
  updateCampaign: async (campaignId: string, campaignData: Partial<Campaign>): Promise<ApiResponse<void>> => {
    return apiRequest(`/campaigns/${campaignId}`, 'PUT', campaignData);
  },
  deleteCampaign: async (campaignId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/campaigns/${campaignId}`, 'DELETE');
  },
  startCampaign: async (campaignId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/campaigns/${campaignId}/start`, 'POST');
  },
  pauseCampaign: async (campaignId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/campaigns/${campaignId}/pause`, 'POST');
  },
  resetCampaign: async (campaignId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/campaigns/${campaignId}/reset`, 'POST');
  },
  getCampaignLogs: async (campaignId: string): Promise<ApiResponse<{ logs: CampaignLog[] }> & { logs?: CampaignLog[] }> => {
    // Backend returns { success: true, logs: [...] } directly
    return apiRequest(`/campaigns/${campaignId}/logs`);
  },
};

// Leads API
export const leadsApi = {
  uploadLeads: async (campaignId: string, file: File): Promise<ApiResponse<void>> => {
    const formData = new FormData();
    formData.append('file', file);
    const user = getUser();
    const response = await fetch(`${API_BASE_URL}/campaigns/${campaignId}/leads`, {
      method: 'POST',
      headers: {
        'X-User-ID': user?.user_id || '',
      },
      body: formData,
    });
    return response.json();
  },
  getLeadFiles: async (): Promise<ApiResponse<{ leads: any[] }>> => {
    return apiRequest('/leads');
  },
};

// Templates API
export const templatesApi = {
  uploadTemplate: async (campaignId: string, file: File): Promise<ApiResponse<void>> => {
    const formData = new FormData();
    formData.append('file', file);
    const user = getUser();
    const response = await fetch(`${API_BASE_URL}/campaigns/${campaignId}/template`, {
      method: 'POST',
      headers: {
        'X-User-ID': user?.user_id || '',
      },
      body: formData,
    });
    return response.json();
  },
  getTemplateFiles: async (): Promise<ApiResponse<{ templates: any[] }>> => {
    return apiRequest('/templates');
  },
};

// Analytics API
export const analyticsApi = {
  getAnalytics: async (): Promise<ApiResponse<{ stats: { total_sent: number; total_failed: number; total_leads: number; total_campaigns: number } }>> => {
    return apiRequest('/analytics');
  },
  getCampaignAnalytics: async (campaignId: string): Promise<ApiResponse<{ stats: any }>> => {
    return apiRequest(`/analytics/campaigns/${campaignId}`);
  },
};

// Tracker API
export const trackerApi = {
  getTrackerCampaigns: async (): Promise<ApiResponse<{ campaigns: TrackerCampaign[] }>> => {
    try {
      const TRACKER_URL = getTrackerUrl();
      const user = getUser();
      const response = await fetch(`${TRACKER_URL}/user/campaigns`, {
        headers: {
          'X-User-ID': user?.user_id || '',
        },
      });
      if (!response.ok) {
        throw new Error(`Tracker server returned ${response.status}`);
      }
      return await response.json();
    } catch (error: any) {
      // Don't log extension errors
      if (!isExtensionError(error)) {
      console.warn('Tracker server not available:', error.message);
      }
      return {
        success: false,
        error: 'TRACKER_NOT_RUNNING',
        message: 'Tracker server is not running. Start it with: cd tracker && python run.py',
        campaigns: [],
      };
    }
  },
  getTrackerCampaignData: async (campaignName: string): Promise<ApiResponse<any>> => {
    try {
      const TRACKER_URL = getTrackerUrl();
      const response = await fetch(`${TRACKER_URL}/campaign/${encodeURIComponent(campaignName)}`);
      if (!response.ok) {
        throw new Error(`Tracker server returned ${response.status}`);
      }
      return await response.json();
    } catch (error: any) {
      // Don't log extension errors
      if (!isExtensionError(error)) {
      console.warn('Tracker server not available:', error.message);
      }
      return {
        success: false,
        error: 'TRACKER_NOT_RUNNING',
        message: 'Tracker server is not running',
      };
    }
  },
  getTrackerTable: async (campaignName?: string): Promise<ApiResponse<{ events: TrackerEvent[] }>> => {
    try {
      const TRACKER_URL = getTrackerUrl();
      const user = getUser();
      const url = campaignName
        ? `${TRACKER_URL}/user/table?campaign=${encodeURIComponent(campaignName)}`
        : `${TRACKER_URL}/user/table`;
      const response = await fetch(url, {
        headers: {
          'X-User-ID': user?.user_id || '',
        },
      });
      if (!response.ok) {
        throw new Error(`Tracker server returned ${response.status}`);
      }
      return await response.json();
    } catch (error: any) {
      // Don't log extension errors
      if (!isExtensionError(error)) {
      console.warn('Tracker server not available:', error.message);
      }
      return {
        success: false,
        error: 'TRACKER_NOT_RUNNING',
        message: 'Tracker server is not running',
        events: [],
      };
    }
  },
};

// Requirements API
export const requirementsApi = {
  getRequirements: async (): Promise<ApiResponse<{ requirements: Requirement[] }>> => {
    return apiRequest('/requirements');
  },
  updateRequirementStatus: async (reqId: string, status: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/requirements/${reqId}/status`, 'PUT', { status });
  },
  deleteRequirement: async (reqId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/requirements/${reqId}`, 'DELETE');
  },
  createCampaignFromRequirement: async (reqId: string): Promise<ApiResponse<void>> => {
    return apiRequest(`/requirements/${reqId}/campaign`, 'POST');
  },
};
