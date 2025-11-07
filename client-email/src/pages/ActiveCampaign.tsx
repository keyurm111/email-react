import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { campaignsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';

interface CampaignLog {
  timestamp: string;
  level: string;
  message: string;
  details?: any;
}

export const ActiveCampaign = () => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLogStatusRef = useRef<string | null>(null);

  // Get campaign ID from URL
  const campaignId = searchParams.get('id');

  // Initialize and load campaign - all hooks at top level
  useEffect(() => {
    if (campaignId && campaignId.trim() && campaignId !== 'null' && campaignId !== 'undefined') {
      loadCampaignData(campaignId);
    } else {
      findAndLoadActiveCampaign();
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (logsIntervalRef.current) {
        clearInterval(logsIntervalRef.current);
      }
    };
  }, []);

  // Update URL params when campaign ID changes externally
  useEffect(() => {
    if (campaign?.id && campaignId !== campaign.id) {
      setSearchParams({ id: campaign.id });
    }
  }, [campaign?.id]);

  // Handle campaign status changes for polling
  useEffect(() => {
    if (!campaign) return;

    if (campaign.status === 'running') {
      startLogsPolling();
      startAutoRefresh();
    } else if (campaign.status === 'paused') {
      stopLogsPolling();
      startAutoRefresh();
    } else {
      stopLogsPolling();
      stopAutoRefresh();
    }
  }, [campaign?.status, campaign?.id]);

  // Check for completion status changes
  useEffect(() => {
    if (!campaign || !logs || logs.length === 0) return;

    const latestLog = logs[logs.length - 1];
    const status = latestLog.details?.status;

    if (status && status !== lastLogStatusRef.current) {
      if (status === 'campaign_completed') {
        const totalSent = latestLog.details.total_sent || 0;
        const totalFailed = latestLog.details.total_failed || 0;
        showToast(
          `🎉 Campaign Completed! ${totalSent} emails sent successfully${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
          'success'
        );
        lastLogStatusRef.current = status;

        setTimeout(() => {
          findAndLoadActiveCampaign();
        }, 2000);
      } else if (status === 'daily_limit_reached') {
        const dailySent = latestLog.details.daily_sent || 0;
        const dailyLimit = latestLog.details.daily_limit || 0;
        showToast(`⏸️ Daily Limit Reached! Sent ${dailySent}/${dailyLimit} emails today. Campaign paused.`, 'warning');
        lastLogStatusRef.current = status;
      }
    }
  }, [logs, campaign, showToast]);

  const findAndLoadActiveCampaign = async () => {
    try {
      const result = await campaignsApi.getCampaigns();
      const campaignsList = (result as any).campaigns || result.data?.campaigns || [];

      if (result.success && campaignsList.length > 0) {
        const sortedCampaigns = [...campaignsList].sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime();
          const dateB = new Date(b.created_at || 0).getTime();
          return dateB - dateA;
        });

        let activeCampaign = sortedCampaigns.find((c) => c.status === 'running');
        if (!activeCampaign) {
          activeCampaign = sortedCampaigns.find((c) => c.status === 'paused');
        }
        if (!activeCampaign) {
          activeCampaign = sortedCampaigns[0];
        }

        if (activeCampaign?.id) {
          const newId = activeCampaign.id;
          setSearchParams({ id: newId });
          await loadCampaignData(newId);
          return;
        }
      }

      showToast('No active campaign found. Please start a campaign first.', 'error');
      setTimeout(() => navigate('/campaigns'), 3000);
    } catch (error: any) {
      console.error('Error finding active campaign:', error);
      showToast('Error loading campaigns: ' + error.message, 'error');
      setTimeout(() => navigate('/campaigns'), 3000);
    }
  };

  const loadCampaignData = async (id: string) => {
    if (!id) {
      console.error('Cannot load campaign: No campaign ID');
      await findAndLoadActiveCampaign();
      return;
    }

    try {
      setLoading(true);
      const result = await campaignsApi.getCampaign(id);
      const loadedCampaign = (result as any).campaign || result.data?.campaign;

      if (result.success && loadedCampaign) {
        // Check if current campaign is no longer running - switch to a running one
        if (loadedCampaign.status !== 'running' && loadedCampaign.status !== 'paused') {
          const campaignsResult = await campaignsApi.getCampaigns();
          const campaignsList = (campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [];

          if (campaignsResult.success && campaignsList.length > 0) {
            const sortedCampaigns = [...campaignsList].sort((a, b) => {
              const dateA = new Date(a.created_at || 0).getTime();
              const dateB = new Date(b.created_at || 0).getTime();
              return dateB - dateA;
            });

            const runningCampaign = sortedCampaigns.find((c) => c.status === 'running');
            if (runningCampaign && runningCampaign.id !== id) {
              console.log(`Switching to running campaign: ${runningCampaign.id} (${runningCampaign.name})`);
              setSearchParams({ id: runningCampaign.id });
              await loadCampaignData(runningCampaign.id);
              return;
            }
          }
        }

        // Check if URL has different campaign ID
        const urlCampaignId = searchParams.get('id');
        if (urlCampaignId && urlCampaignId !== id) {
          stopLogsPolling();
          await loadCampaignData(urlCampaignId);
          return;
        }

        setCampaign(loadedCampaign);
        if (loadedCampaign.status === 'running') {
          loadRecentActivity(loadedCampaign.id);
        }
      } else {
        showToast('Error loading campaign: ' + (result.message || 'Campaign not found'), 'error');
        await findAndLoadActiveCampaign();
      }
    } catch (error: any) {
      console.error('Error loading campaign:', error);
      showToast('Error loading campaign: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRecentActivity = async (campaignId: string) => {
    try {
      const result = await campaignsApi.getCampaignLogs(campaignId);
      const logsList = (result as any).logs || result.data?.logs || [];

      if (result.success) {
        displayActivity(logsList);
      }
    } catch (error) {
      console.error('Error loading activity:', error);
    }
  };

  const displayActivity = (logsList: CampaignLog[]) => {
    if (!logsList || logsList.length === 0) {
      setLogs([]);
      return;
    }

    // Filter to show only important logs (like HTML version)
    const importantLogs = logsList.filter((log) => {
      if (log.level === 'warning' || log.level === 'error') return true;
      if (log.level === 'success' && log.message.includes('Batch')) return true;
      if (log.details && (log.details.status === 'campaign_completed' || log.details.status === 'daily_limit_reached')) return true;
      if (log.message.includes('Starting to send')) return true;
      return false;
    });

    // If filtering removed all logs, show at least the latest few
    const finalLogs = importantLogs.length === 0 && logsList.length > 0 ? logsList.slice(-5) : importantLogs;

    // Reverse to show newest first
    setLogs([...finalLogs].reverse());
  };

  const startLogsPolling = () => {
    if (logsIntervalRef.current) {
      console.log('Logs polling already running, stopping old one...');
      stopLogsPolling();
    }

    const currentCampaignId = searchParams.get('id');
    if (!currentCampaignId) {
      console.warn('Cannot start logs polling: No campaign ID');
      return;
    }

    console.log(`📊 Starting live logs polling for campaign: ${currentCampaignId}`);

    logsIntervalRef.current = setInterval(async () => {
      const id = searchParams.get('id');
      if (!id) {
        stopLogsPolling();
        return;
      }

      try {
        const result = await campaignsApi.getCampaignLogs(id);
        const logsList = (result as any).logs || result.data?.logs || [];

        if (result.success && logsList) {
          displayActivity(logsList);
        }
      } catch (error) {
        console.error('Error fetching logs:', error);
      }
    }, 2000); // Poll every 2 seconds
  };

  const stopLogsPolling = () => {
    if (logsIntervalRef.current) {
      clearInterval(logsIntervalRef.current);
      logsIntervalRef.current = null;
    }
    lastLogStatusRef.current = null;
  };

  const startAutoRefresh = () => {
    if (refreshIntervalRef.current) return;

    console.log('🔄 Starting auto-refresh (every 5 seconds)');

    refreshIntervalRef.current = setInterval(async () => {
      // First check if there's a newer running campaign
      try {
        const campaignsResult = await campaignsApi.getCampaigns();
        const campaignsList = (campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [];

        if (campaignsResult.success && campaignsList.length > 0) {
          const sortedCampaigns = [...campaignsList].sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
          });

          const newestRunningCampaign = sortedCampaigns.find((c) => c.status === 'running');
          const currentId = searchParams.get('id');

          if (newestRunningCampaign && newestRunningCampaign.id !== currentId) {
            console.log(`🔄 Switching to newer running campaign: ${newestRunningCampaign.id} (${newestRunningCampaign.name})`);

            stopLogsPolling();
            setSearchParams({ id: newestRunningCampaign.id });
          }
        }
      } catch (error) {
        console.error('Error checking for active campaigns:', error);
      }

      // Load current campaign data
      const currentId = searchParams.get('id');
      if (currentId) {
        loadCampaignData(currentId);
      }
    }, 5000); // Refresh every 5 seconds
  };

  const stopAutoRefresh = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  const handleStart = async () => {
    if (!campaign) return;
    if (!confirm('Are you sure you want to start this campaign?')) return;

    try {
      const result = await campaignsApi.startCampaign(campaign.id);

      if (result.success) {
        showToast('Campaign started successfully!', 'success');
        await loadCampaignData(campaign.id);
        startAutoRefresh();
        startLogsPolling(); // Start live logs when campaign starts
      } else {
        showToast(result.message || 'Error starting campaign', 'error');
      }
    } catch (error: any) {
      showToast('Error starting campaign: ' + error.message, 'error');
    }
  };

  const handlePause = async () => {
    if (!campaign) return;
    if (!confirm('Are you sure you want to pause this campaign?')) return;

    try {
      const result = await campaignsApi.pauseCampaign(campaign.id);

      if (result.success) {
        showToast('Campaign paused', 'success');
        await loadCampaignData(campaign.id);
        stopAutoRefresh();
        stopLogsPolling();
      } else {
        showToast(result.message || 'Error pausing campaign', 'error');
      }
    } catch (error: any) {
      showToast('Error pausing campaign: ' + error.message, 'error');
    }
  };

  const handleResume = async () => {
    if (!campaign) return;

    try {
      const result = await campaignsApi.startCampaign(campaign.id);

      if (result.success) {
        showToast('Campaign resumed!', 'success');
        await loadCampaignData(campaign.id);
        startAutoRefresh();
        startLogsPolling(); // Start live logs when campaign resumes
      } else {
        showToast(result.message || 'Error resuming campaign', 'error');
      }
    } catch (error: any) {
      showToast('Error resuming campaign: ' + error.message, 'error');
    }
  };

  const handleReset = async () => {
    if (!campaign) return;
    if (!confirm('Are you sure you want to reset this campaign? This will clear all progress.')) return;

    try {
      const result = await campaignsApi.resetCampaign(campaign.id);

      if (result.success) {
        showToast('Campaign reset successfully', 'success');
        await loadCampaignData(campaign.id);
      } else {
        showToast(result.message || 'Error resetting campaign', 'error');
      }
    } catch (error: any) {
      showToast('Error resetting campaign: ' + error.message, 'error');
    }
  };

  // Calculate stats - all hooks must be before any conditional returns
  const stats = campaign?.stats || { total_leads: 0, total_sent: 0, total_failed: 0 };
  const totalLeads = stats.total_leads || 0;
  const totalSent = stats.total_sent || 0;
  const totalFailed = stats.total_failed || 0;
  const remaining = totalLeads - totalSent - totalFailed;
  const successRate = totalSent > 0 ? calculatePercentage(totalSent, totalSent + totalFailed) : '0';
  const progress = totalLeads > 0 ? calculatePercentage(totalSent, totalLeads) : '0';

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <i className="fas fa-spinner fa-spin text-2xl sm:text-4xl text-gray-400"></i>
        </div>
      </Layout>
    );
  }

  if (!campaign) {
    return (
      <Layout>
        <div className="text-center py-8 sm:py-12">
          <i className="fas fa-inbox text-3xl sm:text-4xl text-gray-400 mb-3 sm:mb-4"></i>
          <p className="text-sm sm:text-base text-gray-600">Loading campaign details...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Campaign Info Card */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-6 gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 truncate">{campaign.name}</h2>
            <p className="text-sm sm:text-base text-gray-600 mt-1 line-clamp-2">{campaign.description || 'No description'}</p>
          </div>
          <span
            className={`px-2 sm:px-3 py-1 rounded-lg text-xs sm:text-sm font-semibold flex-shrink-0 ${
              campaign.status === 'running'
                ? 'bg-green-100 text-green-800'
                : campaign.status === 'paused'
                ? 'bg-yellow-100 text-yellow-800'
                : campaign.status === 'completed'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {campaign.status}
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-blue-50 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-l-4 border-blue-500">
            <i className="fas fa-envelope text-blue-600 text-xl sm:text-2xl flex-shrink-0"></i>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{formatNumber(totalSent)}</h3>
              <p className="text-xs sm:text-sm text-gray-600">Sent</p>
            </div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-l-4 border-red-500">
            <i className="fas fa-exclamation-circle text-red-600 text-xl sm:text-2xl flex-shrink-0"></i>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{formatNumber(totalFailed)}</h3>
              <p className="text-xs sm:text-sm text-gray-600">Failed</p>
            </div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-l-4 border-orange-500">
            <i className="fas fa-clock text-orange-600 text-xl sm:text-2xl flex-shrink-0"></i>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{formatNumber(remaining)}</h3>
              <p className="text-xs sm:text-sm text-gray-600">Remaining</p>
            </div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-l-4 border-green-500">
            <i className="fas fa-percentage text-green-600 text-xl sm:text-2xl flex-shrink-0"></i>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{successRate}%</h3>
              <p className="text-xs sm:text-sm text-gray-600">Success Rate</p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {totalLeads > 0 && (
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-2">
              <span>Overall Progress</span>
              <span className="text-right">
                {formatNumber(totalSent)} / {formatNumber(totalLeads)} ({progress}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 sm:h-3">
              <div
                className="bg-gradient-to-r from-[#667eea] to-[#764ba2] h-2 sm:h-3 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Campaign Controls */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          {campaign.status === 'draft' && (
            <button
              onClick={handleStart}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base bg-green-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <i className="fas fa-play"></i> 
              <span className="hidden sm:inline">Start Campaign</span>
              <span className="sm:hidden">Start</span>
            </button>
          )}
          {campaign.status === 'running' && (
            <button
              onClick={handlePause}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base bg-yellow-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <i className="fas fa-pause"></i> 
              <span className="hidden sm:inline">Pause Campaign</span>
              <span className="sm:hidden">Pause</span>
            </button>
          )}
          {campaign.status === 'paused' && (
            <button
              onClick={handleResume}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base bg-green-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <i className="fas fa-play"></i> 
              <span className="hidden sm:inline">Resume Campaign</span>
              <span className="sm:hidden">Resume</span>
            </button>
          )}
          <button
            onClick={handleReset}
            className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base bg-red-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <i className="fas fa-redo"></i> 
            <span className="hidden sm:inline">Reset Campaign</span>
            <span className="sm:hidden">Reset</span>
          </button>
          <button
            onClick={() => navigate('/campaigns')}
            className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
          >
            <i className="fas fa-arrow-left"></i> 
            <span className="hidden sm:inline">Back to Campaigns</span>
            <span className="sm:hidden">Back</span>
          </button>
        </div>
      </section>

      {/* Campaign Details */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {/* Senders */}
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
              <i className="fas fa-paper-plane"></i> Senders
            </h3>
            <div className="space-y-2">
              {campaign.selected_senders && campaign.selected_senders.length > 0 ? (
                campaign.selected_senders.map((email) => (
                  <div key={email} className="flex items-center gap-2 text-sm sm:text-base text-gray-700">
                    <i className="fas fa-envelope text-[#667eea] flex-shrink-0"></i>
                    <span className="truncate">{email}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm sm:text-base text-gray-500">No senders configured</p>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
              <i className="fas fa-cog"></i> Configuration
            </h3>
            <div className="space-y-2 sm:space-y-3">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Subject Line</strong>
                <span className="text-xs sm:text-sm text-gray-600 break-words text-right">{campaign.subject_line || 'Not set'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Daily Limit</strong>
                <span className="text-xs sm:text-sm text-gray-600">{campaign.daily_limit || 'Unlimited'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Delay (seconds)</strong>
                <span className="text-xs sm:text-sm text-gray-600">{campaign.delay || '30'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Schedule Time</strong>
                <span className="text-xs sm:text-sm text-gray-600">{campaign.schedule_time || 'Not set'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Leads File</strong>
                <span className="text-xs sm:text-sm text-gray-600 truncate text-right">{campaign.leads_file || 'Not uploaded'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                <strong className="text-xs sm:text-sm text-gray-700">Template File</strong>
                <span className="text-xs sm:text-sm text-gray-600 truncate text-right">{campaign.template_file || 'Not uploaded'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Activity */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
          <i className="fas fa-history"></i> Recent Activity
        </h2>
        <div className="space-y-2 sm:space-y-3 max-h-80 sm:max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="text-center py-6 sm:py-8 text-gray-500">
              <i className="fas fa-inbox text-3xl sm:text-4xl mb-2"></i>
              <p className="text-sm sm:text-base">No activity yet</p>
            </div>
          ) : (
            logs.map((log, idx) => {
              let icon = 'fa-info-circle';
              let bgClass = 'bg-blue-50 border-blue-200';
              let borderColor = '#3b82f6';
              let textColor = 'text-blue-800';

              if (log.level === 'success') {
                icon = 'fa-check-circle';
                bgClass = 'bg-green-50 border-green-200';
                borderColor = '#10b981';
                textColor = 'text-green-800';
              } else if (log.level === 'error') {
                icon = 'fa-times-circle';
                bgClass = 'bg-red-50 border-red-200';
                borderColor = '#ef4444';
                textColor = 'text-red-800';
              } else if (log.level === 'warning') {
                icon = 'fa-exclamation-triangle';
                bgClass = 'bg-yellow-50 border-yellow-200';
                borderColor = '#f59e0b';
                textColor = 'text-yellow-800';
              }

              const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
              const isCompletion = log.details && (log.details.status === 'campaign_completed' || log.details.status === 'daily_limit_reached');

              return (
                <div
                  key={idx}
                  className={`${bgClass} border-l-4 rounded-lg p-3 sm:p-4 ${isCompletion ? 'shadow-md' : ''}`}
                  style={{ borderLeftColor: borderColor }}
                >
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className="flex-shrink-0" style={{ color: borderColor }}>
                      <i className={`fas ${icon} text-base sm:text-lg`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${textColor} ${isCompletion ? 'text-sm sm:text-base font-semibold' : 'text-xs sm:text-sm'} break-words`}>
                        {log.message}
                      </p>
                      {log.details?.error && (
                        <p className="text-xs sm:text-sm text-red-600 mt-1 break-words">Error: {log.details.error}</p>
                      )}
                      <span className="text-xs text-gray-500 mt-1 sm:mt-2 block">{time}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </Layout>
  );
};
