import { useEffect, useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import { analyticsApi, campaignsApi } from '../services/api';
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
      const [analyticsResult, campaignsResult] = await Promise.all([
        analyticsApi.getAnalytics(),
        campaignsApi.getCampaigns(),
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

      if (campaignsResult.success) {
        const campaignsList = (campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [];
        setCampaigns(campaignsList);
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
      <section className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> {selectedCampaignId === 'all' ? 'Overall Statistics' : 'Campaign Statistics'}
          </h2>
          <div className="flex items-center gap-3">
            <label htmlFor="campaignFilter" className="text-sm font-medium text-gray-700">
              Filter by Campaign:
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowCampaignDropdown(!showCampaignDropdown)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] bg-white text-left min-w-[200px] flex items-center justify-between"
              >
                <span>{selectedCampaignName}</span>
                <i className={`fas fa-chevron-${showCampaignDropdown ? 'up' : 'down'} text-gray-400 ml-2`}></i>
              </button>
              
              {showCampaignDropdown && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
                  {/* Search Input */}
                  <div className="p-3 border-b border-gray-200">
                    <div className="relative">
                      <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                      <input
                        type="text"
                        value={campaignSearchQuery}
                        onChange={(e) => setCampaignSearchQuery(e.target.value)}
                        placeholder="Search campaigns..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] text-sm"
                        autoFocus
                      />
                      {campaignSearchQuery && (
                        <button
                          onClick={() => setCampaignSearchQuery('')}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <i className="fas fa-times text-xs"></i>
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
                      className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors ${
                        selectedCampaignId === 'all' ? 'bg-[#667eea] text-white hover:bg-[#5568d3]' : ''
                      }`}
                    >
                      All Campaigns
                    </button>
                    {filteredCampaignOptions.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        <i className="fas fa-search text-2xl mb-2"></i>
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
                          className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors ${
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
          <div className="text-center py-8">
            <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Total Sent */}
            <div className="bg-blue-50 rounded-lg p-6 flex items-center gap-4 border-l-4 border-blue-500">
              <div className="bg-blue-100 rounded-full p-4">
                <i className="fas fa-paper-plane text-blue-600 text-2xl"></i>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-800">{formatNumber(displayStats.total_sent)}</h3>
                <p className="text-sm text-gray-600">Total Sent</p>
              </div>
            </div>

            {/* Total Failed */}
            <div className="bg-red-50 rounded-lg p-6 flex items-center gap-4 border-l-4 border-red-500">
              <div className="bg-red-100 rounded-full p-4">
                <i className="fas fa-times-circle text-red-600 text-2xl"></i>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-800">{formatNumber(displayStats.total_failed)}</h3>
                <p className="text-sm text-gray-600">Total Failed</p>
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-green-50 rounded-lg p-6 flex items-center gap-4 border-l-4 border-green-500">
              <div className="bg-green-100 rounded-full p-4">
                <i className="fas fa-check-circle text-green-600 text-2xl"></i>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-800">{displayStats.successRate}%</h3>
                <p className="text-sm text-gray-600">Success Rate</p>
              </div>
            </div>

            {/* Total Campaigns / Total Leads */}
            <div className="bg-purple-50 rounded-lg p-6 flex items-center gap-4 border-l-4 border-purple-500">
              <div className="bg-purple-100 rounded-full p-4">
                <i className={`fas ${selectedCampaignId === 'all' ? 'fa-tasks' : 'fa-users'} text-purple-600 text-2xl`}></i>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-800">
                  {selectedCampaignId === 'all' 
                    ? formatNumber(campaigns.length) 
                    : formatNumber(displayStats.total_leads)}
                </h3>
                <p className="text-sm text-gray-600">
                  {selectedCampaignId === 'all' ? 'Total Campaigns' : 'Total Leads'}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Charts Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Pie Chart - Success vs Failed */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> Email Status Distribution
          </h3>
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
            </div>
          ) : displayStats.total_sent === 0 && displayStats.total_failed === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <i className="fas fa-inbox text-4xl mb-4"></i>
              <p>No email data available</p>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
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
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
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
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <i className="fas fa-chart-line"></i> Campaign Performance Trend
          </h3>
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <i className="fas fa-inbox text-4xl mb-4"></i>
              <p>No data to display</p>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
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
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
                          return `${context.dataset.label}: ${formatNumber(context.parsed.y)}`;
                        },
                      },
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        callback: function (value) {
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
        <section className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <i className="fas fa-chart-pie"></i> Campaign Email Distribution
          </h3>
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center">
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
                      position: 'right',
                      labels: {
                        padding: 15,
                        usePointStyle: true,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
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
      <section className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6 flex items-center gap-2">
          <i className="fas fa-chart-bar"></i> Campaign Performance
        </h2>
        
        {loading ? (
          <div className="text-center py-8">
            <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <i className="fas fa-inbox text-4xl mb-4"></i>
            <p>{selectedCampaignId === 'all' ? 'No campaigns yet' : 'No campaign selected'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredCampaigns.map((campaign) => {
              const campaignStats = campaign.stats || {};
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
                  className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">{campaign.name}</h3>
                    <span
                      className={`px-3 py-1 rounded text-xs font-semibold ${
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-gray-700">
                      <i className="fas fa-envelope text-[#667eea]"></i>
                      <span className="text-sm">Sent: <strong>{formatNumber(totalSent)}</strong></span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700">
                      <i className="fas fa-times-circle text-red-500"></i>
                      <span className="text-sm">Failed: <strong>{formatNumber(totalFailed)}</strong></span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700">
                      <i className="fas fa-clock text-orange-500"></i>
                      <span className="text-sm">Remaining: <strong>{formatNumber(remaining)}</strong></span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700">
                      <i className="fas fa-percentage text-green-500"></i>
                      <span className="text-sm">Success: <strong>{campaignSuccessRate}%</strong></span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {totalLeads > 0 && (
                    <div>
                      <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                        <div
                          className="bg-gradient-to-r from-[#667eea] to-[#764ba2] h-3 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                      <p className="text-sm text-gray-600">
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
