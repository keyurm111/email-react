import { useEffect, useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import { analyticsApi, campaignsApi, trackerApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler,
} from 'chart.js';
// @ts-ignore - react-chartjs-2 exports are not properly typed
import { Pie, Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler
);

interface AnalyticsStats {
  total_sent: number;
  total_failed: number;
  total_leads: number;
  total_campaigns: number;
}

interface TrackingStats {
  total_opens: number;
  unique_opens: number;
  total_clicks: number;
  unique_emails: number;
  open_rate: number;
  click_rate: number;
}

export const Analytics = () => {
  const [stats, setStats] = useState<AnalyticsStats>({
    total_sent: 0,
    total_failed: 0,
    total_leads: 0,
    total_campaigns: 0,
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trackingStats, setTrackingStats] = useState<TrackingStats>({
    total_opens: 0,
    unique_opens: 0,
    total_clicks: 0,
    unique_emails: 0,
    open_rate: 0,
    click_rate: 0,
  });
  const [campaignTrackingData, setCampaignTrackingData] = useState<Record<string, TrackingStats>>({});
  const { showToast } = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAnalytics();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCampaignDropdown(false);
      }
    };

    if (showCampaignDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCampaignDropdown]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [analyticsResult, campaignsResult, trackerResult] = await Promise.all([
        analyticsApi.getAnalytics(),
        campaignsApi.getCampaigns(),
        trackerApi.getTrackerCampaigns().catch(() => ({ success: false, campaigns: [] })), // Don't fail if tracker is unavailable
      ]);

      if (analyticsResult.success) {
        const analyticsData = (analyticsResult as any).stats || analyticsResult.data?.stats || {};
        setStats({
          total_sent: analyticsData.total_sent || 0,
          total_failed: analyticsData.total_failed || 0,
          total_leads: analyticsData.total_leads || 0,
          total_campaigns: analyticsData.total_campaigns || 0,
        });
      }

      const campaignsList: Campaign[] = campaignsResult.success
        ? ((campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [])
        : [];

      if (campaignsResult.success) {
        setCampaigns(campaignsList);
      }

      // Load tracking data
      if (trackerResult.success && (trackerResult as any).campaigns) {
        const trackingCampaigns = (trackerResult as any).campaigns || [];
        
        // Get total sent from analytics result (not from state which might not be updated yet)
        const analyticsData = (analyticsResult as any).stats || analyticsResult.data?.stats || {};
        const totalSent = analyticsData.total_sent || 0;
        
        // Calculate overall tracking stats
        const overallTracking: TrackingStats = trackingCampaigns.reduce((acc: TrackingStats, campaign: any) => ({
          total_opens: acc.total_opens + (campaign.total_opens || 0),
          unique_opens: acc.unique_opens + (campaign.unique_opens || 0),
          total_clicks: acc.total_clicks + (campaign.total_clicks || 0),
          unique_emails: Math.max(acc.unique_emails, campaign.unique_emails || 0), // Use max for unique emails
          open_rate: 0, // Will calculate below
          click_rate: 0, // Will calculate below
        }), { total_opens: 0, unique_opens: 0, total_clicks: 0, unique_emails: 0, open_rate: 0, click_rate: 0 });

        // Calculate rates based on total sent emails
        overallTracking.open_rate = totalSent > 0 ? (overallTracking.total_opens / totalSent) * 100 : 0;
        overallTracking.click_rate = totalSent > 0 ? (overallTracking.total_clicks / totalSent) * 100 : 0;

        setTrackingStats(overallTracking);

        // Store per-campaign tracking data
        const campaignTracking: Record<string, TrackingStats> = {};
        trackingCampaigns.forEach((campaign: any) => {
          // Get campaign sent count for rate calculation
          const campaignSent = campaignsList.find((c: Campaign) => c.name === campaign.campaign_name)?.stats?.total_sent || 0;
          campaignTracking[campaign.campaign_name] = {
            total_opens: campaign.total_opens || 0,
            unique_opens: campaign.unique_opens || 0,
            total_clicks: campaign.total_clicks || 0,
            unique_emails: campaign.unique_emails || 0,
            open_rate: campaignSent > 0 ? ((campaign.total_opens || 0) / campaignSent) * 100 : (campaign.open_rate || 0),
            click_rate: campaignSent > 0 ? ((campaign.total_clicks || 0) / campaignSent) * 100 : (campaign.click_rate || 0),
          };
        });
        setCampaignTrackingData(campaignTracking);
      }
    } catch (error: any) {
      console.error('Error loading analytics:', error);
      showToast('Error loading analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  const successRate = stats.total_sent > 0
    ? calculatePercentage(stats.total_sent, stats.total_sent + stats.total_failed)
    : '0';

  // Filter campaigns for search in dropdown
  const filteredCampaignOptions = campaigns.filter((campaign) => {
    if (!campaignSearchQuery.trim()) return true;
    const query = campaignSearchQuery.toLowerCase();
    return campaign.name.toLowerCase().includes(query);
  });

  // Filter campaigns based on selection
  const filteredCampaigns = selectedCampaignId === 'all'
    ? campaigns
    : campaigns.filter(c => c.id === selectedCampaignId);

  // Get selected campaign name for display
  const selectedCampaignName = selectedCampaignId === 'all'
    ? 'All Campaigns'
    : campaigns.find(c => c.id === selectedCampaignId)?.name || 'All Campaigns';

  // Calculate filtered stats when campaign is selected
  const filteredStats = selectedCampaignId !== 'all'
    ? (() => {
        const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);
        if (!selectedCampaign || !selectedCampaign.stats) {
          return { total_sent: 0, total_failed: 0, total_leads: 0, successRate: '0' };
        }
        const campaignStats = selectedCampaign.stats;
        const sent = campaignStats.total_sent || 0;
        const failed = campaignStats.total_failed || 0;
        const leads = campaignStats.total_leads || 0;
        return {
          total_sent: sent,
          total_failed: failed,
          total_leads: leads,
          successRate: sent > 0 ? calculatePercentage(sent, sent + failed) : '0',
        };
      })()
    : null;

  // Get tracking stats for selected campaign or overall
  const displayTrackingStats = selectedCampaignId !== 'all'
    ? (() => {
        const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);
        if (!selectedCampaign) {
          return trackingStats;
        }
        return campaignTrackingData[selectedCampaign.name] || trackingStats;
      })()
    : trackingStats;

  // Use filtered stats if campaign selected, otherwise use overall stats
  const displayStats = filteredStats || {
    total_sent: stats.total_sent,
    total_failed: stats.total_failed,
    total_leads: stats.total_leads,
    successRate: successRate,
  };

  return (
    <Layout>
      {/* Overall Statistics */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-3">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> 
            <span className="hidden sm:inline">{selectedCampaignId === 'all' ? 'Overall Statistics' : 'Campaign Statistics'}</span>
            <span className="sm:hidden">{selectedCampaignId === 'all' ? 'Overall Stats' : 'Campaign Stats'}</span>
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <label htmlFor="campaignFilter" className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
              <span className="hidden sm:inline">Filter by Campaign:</span>
              <span className="sm:hidden">Filter:</span>
            </label>
            <div className="relative w-full sm:w-auto" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowCampaignDropdown(!showCampaignDropdown)}
                className="w-full sm:min-w-[200px] px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] bg-white text-left flex items-center justify-between"
              >
                <span className="truncate">{selectedCampaignName}</span>
                <i className={`fas fa-chevron-${showCampaignDropdown ? 'up' : 'down'} text-gray-400 ml-2 flex-shrink-0`}></i>
              </button>
              
              {showCampaignDropdown && (
                <div className="absolute right-0 sm:right-auto mt-2 w-full sm:w-80 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
                  {/* Search Input */}
                  <div className="p-2 sm:p-3 border-b border-gray-200">
                    <div className="relative">
                      <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm"></i>
                      <input
                        type="text"
                        value={campaignSearchQuery}
                        onChange={(e) => setCampaignSearchQuery(e.target.value)}
                        placeholder="Search campaigns..."
                        className="w-full pl-9 sm:pl-10 pr-8 sm:pr-10 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                        autoFocus
                      />
                      {campaignSearchQuery && (
                        <button
                          onClick={() => setCampaignSearchQuery('')}
                          className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Dropdown Options */}
                  <div className="overflow-y-auto max-h-64">
                    <button
                      onClick={() => {
                        setSelectedCampaignId('all');
                        setShowCampaignDropdown(false);
                        setCampaignSearchQuery('');
                      }}
                      className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base text-left hover:bg-gray-50 transition-colors ${
                        selectedCampaignId === 'all' ? 'bg-[#667eea] text-white hover:bg-[#5568d3]' : ''
                      }`}
                    >
                      All Campaigns
                    </button>
                    {filteredCampaignOptions.length === 0 ? (
                      <div className="px-3 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-xs sm:text-sm">
                        <i className="fas fa-search text-xl sm:text-2xl mb-2"></i>
                        <p>No campaigns found</p>
                      </div>
                    ) : (
                      filteredCampaignOptions.map((campaign) => (
                        <button
                          key={campaign.id}
                          onClick={() => {
                            setSelectedCampaignId(campaign.id);
                            setShowCampaignDropdown(false);
                            setCampaignSearchQuery('');
                          }}
                          className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base text-left hover:bg-gray-50 transition-colors truncate ${
                            selectedCampaignId === campaign.id
                              ? 'bg-[#667eea] text-white hover:bg-[#5568d3]'
                              : ''
                          }`}
                        >
                          {campaign.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="text-center py-6 sm:py-8">
            <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
          </div>
        ) : (
          <>
            {/* Email Sending Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mb-4 sm:mb-6">
              {/* Total Sent */}
              <div className="bg-blue-50 rounded-lg p-3 sm:p-6 flex items-center gap-2 sm:gap-4 border-l-4 border-blue-500">
                <div className="bg-blue-100 rounded-full p-2 sm:p-4 flex-shrink-0">
                  <i className="fas fa-paper-plane text-blue-600 text-lg sm:text-2xl"></i>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-2xl font-bold text-gray-800 truncate">{formatNumber(displayStats.total_sent)}</h3>
                  <p className="text-xs sm:text-sm text-gray-600">Total Sent</p>
                </div>
              </div>

              {/* Total Failed */}
              <div className="bg-red-50 rounded-lg p-3 sm:p-6 flex items-center gap-2 sm:gap-4 border-l-4 border-red-500">
                <div className="bg-red-100 rounded-full p-2 sm:p-4 flex-shrink-0">
                  <i className="fas fa-times-circle text-red-600 text-lg sm:text-2xl"></i>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-2xl font-bold text-gray-800 truncate">{formatNumber(displayStats.total_failed)}</h3>
                  <p className="text-xs sm:text-sm text-gray-600">Total Failed</p>
                </div>
              </div>

              {/* Success Rate */}
              <div className="bg-green-50 rounded-lg p-3 sm:p-6 flex items-center gap-2 sm:gap-4 border-l-4 border-green-500">
                <div className="bg-green-100 rounded-full p-2 sm:p-4 flex-shrink-0">
                  <i className="fas fa-check-circle text-green-600 text-lg sm:text-2xl"></i>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-2xl font-bold text-gray-800 truncate">{displayStats.successRate}%</h3>
                  <p className="text-xs sm:text-sm text-gray-600">Success Rate</p>
                </div>
              </div>

              {/* Total Campaigns / Total Leads */}
              <div className="bg-purple-50 rounded-lg p-3 sm:p-6 flex items-center gap-2 sm:gap-4 border-l-4 border-purple-500">
                <div className="bg-purple-100 rounded-full p-2 sm:p-4 flex-shrink-0">
                  <i className={`fas ${selectedCampaignId === 'all' ? 'fa-tasks' : 'fa-users'} text-purple-600 text-lg sm:text-2xl`}></i>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-2xl font-bold text-gray-800 truncate">
                    {selectedCampaignId === 'all' 
                      ? formatNumber(campaigns.length) 
                      : formatNumber(displayStats.total_leads)}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-600">
                    {selectedCampaignId === 'all' ? 'Total Campaigns' : 'Total Leads'}
                  </p>
                </div>
              </div>
            </div>

            {/* Tracking Stats */}
            <div className="border-t border-gray-200 pt-4 sm:pt-6">
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                <i className="fas fa-chart-line"></i> Email Tracking Metrics
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                {/* Total Opens */}
                <div className="bg-cyan-50 rounded-lg p-3 sm:p-4 border-l-4 border-cyan-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-envelope-open text-cyan-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">{formatNumber(displayTrackingStats.total_opens)}</h4>
                  </div>
                  <p className="text-xs text-gray-600">Total Opens</p>
                </div>

                {/* Unique Opens */}
                <div className="bg-indigo-50 rounded-lg p-3 sm:p-4 border-l-4 border-indigo-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-user-check text-indigo-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">{formatNumber(displayTrackingStats.unique_opens)}</h4>
                  </div>
                  <p className="text-xs text-gray-600">Unique Opens</p>
                </div>

                {/* Total Clicks */}
                <div className="bg-orange-50 rounded-lg p-3 sm:p-4 border-l-4 border-orange-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-mouse-pointer text-orange-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">{formatNumber(displayTrackingStats.total_clicks)}</h4>
                  </div>
                  <p className="text-xs text-gray-600">Total Clicks</p>
                </div>

                {/* Open Rate */}
                <div className="bg-teal-50 rounded-lg p-3 sm:p-4 border-l-4 border-teal-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-percentage text-teal-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">
                      {displayTrackingStats.open_rate > 0 ? displayTrackingStats.open_rate.toFixed(1) : '0'}%
                    </h4>
                  </div>
                  <p className="text-xs text-gray-600">Open Rate</p>
                </div>

                {/* Click Rate */}
                <div className="bg-pink-50 rounded-lg p-3 sm:p-4 border-l-4 border-pink-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-hand-pointer text-pink-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">
                      {displayTrackingStats.click_rate > 0 ? displayTrackingStats.click_rate.toFixed(1) : '0'}%
                    </h4>
                  </div>
                  <p className="text-xs text-gray-600">Click Rate</p>
                </div>

                {/* Unique Emails */}
                <div className="bg-amber-50 rounded-lg p-3 sm:p-4 border-l-4 border-amber-500">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-users text-amber-600 text-sm sm:text-base"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">{formatNumber(displayTrackingStats.unique_emails)}</h4>
                  </div>
                  <p className="text-xs text-gray-600">Unique Recipients</p>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Charts Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Pie Chart - Success vs Failed */}
        <div className="bg-white rounded-xl shadow-md p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> Email Status Distribution
          </h3>
          {loading ? (
            <div className="text-center py-6 sm:py-8">
              <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
            </div>
          ) : displayStats.total_sent === 0 && displayStats.total_failed === 0 ? (
            <div className="text-center py-8 sm:py-12 text-gray-500">
              <i className="fas fa-inbox text-3xl sm:text-4xl mb-2 sm:mb-4"></i>
              <p className="text-sm sm:text-base">No email data available</p>
            </div>
          ) : (
            <div className="h-48 sm:h-64 flex items-center justify-center">
              <Pie
                data={{
                  labels: ['Sent Successfully', 'Failed'],
                  datasets: [
                    {
                      label: 'Emails',
                      data: [displayStats.total_sent, displayStats.total_failed],
                      backgroundColor: ['#10b981', '#ef4444'],
                      borderColor: ['#059669', '#dc2626'],
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        padding: 10,
                        font: {
                          size: window.innerWidth < 640 ? 10 : 12,
                        },
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context: any) {
                          const label = context.label || '';
                          const value = formatNumber(context.parsed);
                          const total = displayStats.total_sent + displayStats.total_failed;
                          const percentage = total > 0
                            ? ((context.parsed / total) * 100).toFixed(1)
                            : '0';
                          return `${label}: ${value} (${percentage}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>

        {/* Line Chart - Campaign Performance Trend */}
        <div className="bg-white rounded-xl shadow-md p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
            <i className="fas fa-chart-line"></i> Campaign Performance Trend
          </h3>
          {loading ? (
            <div className="text-center py-6 sm:py-8">
              <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="text-center py-8 sm:py-12 text-gray-500">
              <i className="fas fa-inbox text-3xl sm:text-4xl mb-2 sm:mb-4"></i>
              <p className="text-sm sm:text-base">No data to display</p>
            </div>
          ) : (
            <div className="h-48 sm:h-64 flex items-center justify-center">
              <Line
                data={{
                  labels: filteredCampaigns.map((c) => c.name.length > 15 ? c.name.substring(0, 15) + '...' : c.name),
                  datasets: [
                    {
                      label: 'Sent',
                      data: filteredCampaigns.map((c) => c.stats?.total_sent || 0),
                      borderColor: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      fill: true,
                      tension: 0.4,
                    },
                    {
                      label: 'Failed',
                      data: filteredCampaigns.map((c) => c.stats?.total_failed || 0),
                      borderColor: '#ef4444',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      fill: true,
                      tension: 0.4,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        padding: 10,
                        font: {
                          size: window.innerWidth < 640 ? 10 : 12,
                        },
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context: any) {
                          return `${context.dataset.label}: ${formatNumber(context.parsed.y)}`;
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      ticks: {
                        font: {
                          size: window.innerWidth < 640 ? 9 : 11,
                        },
                        maxRotation: window.innerWidth < 640 ? 45 : 0,
                        minRotation: window.innerWidth < 640 ? 45 : 0,
                      },
                    },
                    y: {
                      beginAtZero: true,
                      ticks: {
                        font: {
                          size: window.innerWidth < 640 ? 9 : 11,
                        },
                        callback: function (value: any) {
                          return formatNumber(Number(value));
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>
      </section>

      {/* Campaign Distribution Chart */}
      {selectedCampaignId === 'all' && filteredCampaigns.length > 0 && (
        <section className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> Campaign Email Distribution
          </h3>
          {loading ? (
            <div className="text-center py-6 sm:py-8">
              <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
            </div>
          ) : (
            <div className="h-64 sm:h-80 flex items-center justify-center">
              <Pie
                data={{
                  labels: filteredCampaigns.map((c) => 
                    c.name.length > 20 ? c.name.substring(0, 20) + '...' : c.name
                  ),
                  datasets: [
                    {
                      label: 'Total Sent',
                      data: filteredCampaigns.map((c) => c.stats?.total_sent || 0),
                      backgroundColor: [
                        '#3b82f6',
                        '#8b5cf6',
                        '#ec4899',
                        '#f59e0b',
                        '#10b981',
                        '#06b6d4',
                        '#ef4444',
                        '#84cc16',
                        '#f97316',
                        '#6366f1',
                      ],
                      borderColor: '#ffffff',
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: window.innerWidth < 1024 ? 'bottom' : 'right',
                      labels: {
                        padding: window.innerWidth < 640 ? 8 : 15,
                        usePointStyle: true,
                        font: {
                          size: window.innerWidth < 640 ? 10 : 12,
                        },
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context: any) {
                          const label = context.label || '';
                          const value = formatNumber(context.parsed);
                          const total = filteredCampaigns.reduce(
                            (sum, c) => sum + (c.stats?.total_sent || 0),
                            0
                          );
                          const percentage = total > 0
                            ? ((context.parsed / total) * 100).toFixed(1)
                            : '0';
                          return `${label}: ${value} emails (${percentage}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          )}
        </section>
      )}

      {/* Campaign Performance */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-4 sm:mb-6 flex items-center gap-2">
          <i className="fas fa-chart-bar"></i> Campaign Performance
        </h2>
        
        {loading ? (
          <div className="text-center py-6 sm:py-8">
            <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-8 sm:py-12 text-gray-500">
            <i className="fas fa-inbox text-3xl sm:text-4xl mb-2 sm:mb-4"></i>
            <p className="text-sm sm:text-base">{selectedCampaignId === 'all' ? 'No campaigns yet' : 'No campaign selected'}</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {filteredCampaigns.map((campaign) => {
              const campaignStats = campaign.stats || { total_leads: 0, total_sent: 0, total_failed: 0 };
              const totalSent = campaignStats.total_sent || 0;
              const totalFailed = campaignStats.total_failed || 0;
              const totalLeads = campaignStats.total_leads || 0;
              const remaining = totalLeads - totalSent - totalFailed;
              const campaignSuccessRate = totalSent > 0
                ? calculatePercentage(totalSent, totalSent + totalFailed)
                : '0';
              const progress = totalLeads > 0
                ? calculatePercentage(totalSent, totalLeads)
                : '0';

              return (
                <div
                  key={campaign.id}
                  className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 sm:mb-4 gap-2">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-800 truncate">{campaign.name}</h3>
                    <span
                      className={`px-2 sm:px-3 py-1 rounded text-xs font-semibold flex-shrink-0 ${
                        campaign.status === 'running'
                          ? 'bg-green-100 text-green-800'
                          : campaign.status === 'completed'
                          ? 'bg-blue-100 text-blue-800'
                          : campaign.status === 'paused'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </div>

                  {/* Campaign Meta */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-3 sm:mb-4">
                    <div className="flex items-center gap-1 sm:gap-2 text-gray-700">
                      <i className="fas fa-envelope text-[#667eea] flex-shrink-0"></i>
                      <span className="text-xs sm:text-sm">Sent: <strong>{formatNumber(totalSent)}</strong></span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 text-gray-700">
                      <i className="fas fa-times-circle text-red-500 flex-shrink-0"></i>
                      <span className="text-xs sm:text-sm">Failed: <strong>{formatNumber(totalFailed)}</strong></span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 text-gray-700">
                      <i className="fas fa-clock text-orange-500 flex-shrink-0"></i>
                      <span className="text-xs sm:text-sm">Remaining: <strong>{formatNumber(remaining)}</strong></span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 text-gray-700">
                      <i className="fas fa-percentage text-green-500 flex-shrink-0"></i>
                      <span className="text-xs sm:text-sm">Success: <strong>{campaignSuccessRate}%</strong></span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {totalLeads > 0 && (
                    <div>
                      <div className="w-full bg-gray-200 rounded-full h-2 sm:h-3 mb-2">
                        <div
                          className="bg-gradient-to-r from-[#667eea] to-[#764ba2] h-2 sm:h-3 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-600">
                        {formatNumber(totalSent)} / {formatNumber(totalLeads)} sent ({progress}%)
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
};
