import { useEffect, useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import { campaignsApi, trackerApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../utils/helpers';
import type { Campaign, TrackerEvent } from '../types';

export const Tracker = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [trackerData, setTrackerData] = useState<any>(null);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'analytics' | 'realtime' | 'table'>('analytics');
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const { showToast } = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedCampaign) {
      loadCampaignData(selectedCampaign);
    }
  }, [selectedCampaign]);

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

  const loadData = async () => {
    try {
      const campaignsResult = await campaignsApi.getCampaigns();
      const campaigns = (campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [];
      if (campaignsResult.success) {
        setCampaigns(campaigns);
      }

      const trackerResult = await trackerApi.getTrackerCampaigns();
      if (trackerResult.success && trackerResult.data?.campaigns) {
        setTrackerData(trackerResult.data);
      } else if (trackerResult.error === 'TRACKER_NOT_RUNNING') {
        showTrackerNotRunningMessage();
      }
    } catch (error: any) {
      console.error('Error loading tracker data:', error);
      if (error.message?.includes('Failed to fetch')) {
        showTrackerNotRunningMessage();
      }
    }
  };

  const loadCampaignData = async (campaignName: string) => {
    try {
      const [analyticsResult, tableResult] = await Promise.all([
        trackerApi.getTrackerCampaignData(campaignName),
        trackerApi.getTrackerTable(campaignName),
      ]);

      if (analyticsResult.success) {
        setTrackerData(analyticsResult.data || analyticsResult);
      }

      if (tableResult.success && tableResult.data?.events) {
        setEvents(tableResult.data.events);
      }
    } catch (error: any) {
      console.error('Error loading campaign data:', error);
      showToast('Error loading tracking data', 'error');
    }
  };

  const showTrackerNotRunningMessage = () => {
    showToast(
      'Tracker server is not running. Start it with: cd tracker && python run.py',
      'warning'
    );
  };

  const downloadCSV = (data: any[], filename: string) => {
    const csv = [
      Object.keys(data[0] || {}).join(','),
      ...data.map((row) => Object.values(row).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const opensData = events.filter((e) => e.event_type === 'open');
  const clicksData = events.filter((e) => e.event_type === 'click');

  // Filter campaigns for search in dropdown
  const filteredCampaignOptions = campaigns.filter((campaign) => {
    if (!campaignSearchQuery.trim()) return true;
    const query = campaignSearchQuery.toLowerCase();
    return campaign.name.toLowerCase().includes(query);
  });

  // Get selected campaign display name
  const selectedCampaignName = selectedCampaign
    ? campaigns.find(c => c.name === selectedCampaign)?.name || 'Select a campaign...'
    : 'Select a campaign...';

  return (
    <Layout>

      {/* Campaign Selector */}
      <section className="bg-white rounded-xl shadow p-4 sm:p-6 mb-4 sm:mb-6">
        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
          Select Campaign
        </label>
        <div className="relative w-full" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowCampaignDropdown(!showCampaignDropdown)}
            className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] bg-white text-left flex items-center justify-between"
          >
            <span className="truncate">{selectedCampaignName}</span>
            <i className={`fas fa-chevron-${showCampaignDropdown ? 'up' : 'down'} text-gray-400 ml-2 flex-shrink-0`}></i>
          </button>
          
          {showCampaignDropdown && (
            <div className="absolute mt-2 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
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
                    setSelectedCampaign('');
                    setShowCampaignDropdown(false);
                    setCampaignSearchQuery('');
                  }}
                  className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base text-left hover:bg-gray-50 transition-colors ${
                    selectedCampaign === '' ? 'bg-[#667eea] text-white hover:bg-[#5568d3]' : ''
                  }`}
                >
                  Select a campaign...
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
                        setSelectedCampaign(campaign.name);
                        setShowCampaignDropdown(false);
                        setCampaignSearchQuery('');
                      }}
                      className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base text-left hover:bg-gray-50 transition-colors truncate ${
                        selectedCampaign === campaign.name
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
      </section>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4 sm:mb-6 overflow-x-auto">
        <div className="flex gap-2 sm:gap-4 min-w-max sm:min-w-0">
          {['analytics', 'realtime', 'table'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-3 sm:px-4 py-2 text-sm sm:text-base font-medium transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-b-2 border-[#667eea] text-[#667eea]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-xl shadow p-4 sm:p-6">
            <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Total Opens</h3>
            <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
              {trackerData?.total_opens || opensData.length || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 sm:p-6">
            <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Total Clicks</h3>
            <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
              {trackerData?.total_clicks || clicksData.length || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 sm:p-6">
            <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Open Rate</h3>
            <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
              {trackerData?.open_rate
                ? `${(trackerData.open_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 sm:p-6">
            <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Click Rate</h3>
            <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
              {trackerData?.click_rate
                ? `${(trackerData.click_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {/* Real-time Data Tab */}
      {activeTab === 'realtime' && (
        <div className="space-y-4 sm:space-y-6">
          <section className="bg-white rounded-xl shadow p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
              <h3 className="text-base sm:text-lg font-semibold">Email Opens</h3>
              {opensData.length > 0 && (
                <button
                  onClick={() => downloadCSV(opensData, `opens_${selectedCampaign}.csv`)}
                  className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
                >
                  <i className="fas fa-download"></i> <span className="hidden sm:inline">Download CSV</span>
                  <span className="sm:hidden">Download</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50">
                  <tr>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Email</th>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Timestamp</th>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {opensData.length === 0 ? (
                    <tr>
                        <td colSpan={3} className="px-2 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-xs sm:text-sm">
                        No opens recorded yet
                      </td>
                    </tr>
                  ) : (
                    opensData.slice(0, 50).map((event, idx) => (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                          <td className="px-2 sm:px-4 py-2 truncate max-w-[150px]">{event.campaign}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl shadow p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
              <h3 className="text-base sm:text-lg font-semibold">Link Clicks</h3>
              {clicksData.length > 0 && (
                <button
                  onClick={() => downloadCSV(clicksData, `clicks_${selectedCampaign}.csv`)}
                  className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
                >
                  <i className="fas fa-download"></i> <span className="hidden sm:inline">Download CSV</span>
                  <span className="sm:hidden">Download</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50">
                  <tr>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Email</th>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Link URL</th>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Timestamp</th>
                      <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {clicksData.length === 0 ? (
                    <tr>
                        <td colSpan={4} className="px-2 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-xs sm:text-sm">
                        No clicks recorded yet
                      </td>
                    </tr>
                  ) : (
                    clicksData.slice(0, 50).map((event, idx) => (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                          <td className="px-2 sm:px-4 py-2 break-all max-w-[200px] sm:max-w-none">{event.link_url || 'N/A'}</td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                          <td className="px-2 sm:px-4 py-2 truncate max-w-[150px]">{event.campaign}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Campaign Table Tab */}
      {activeTab === 'table' && (
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
            <h3 className="text-base sm:text-lg font-semibold">Campaign Tracking Table</h3>
            {events.length > 0 && (
              <button
                onClick={() => downloadCSV(events, `campaign_table_${selectedCampaign}.csv`)}
                className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
              >
                <i className="fas fa-download"></i> <span className="hidden sm:inline">Download CSV</span>
                <span className="sm:hidden">Download</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle px-4 sm:px-0">
              <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-gray-50">
                <tr>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Email</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Event Type</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Timestamp</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Campaign</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Link URL</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                      <td colSpan={5} className="px-2 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-xs sm:text-sm">
                      No tracking data available
                    </td>
                  </tr>
                ) : (
                  events.slice(0, 100).map((event, idx) => (
                      <tr key={idx} className="border-t hover:bg-gray-50">
                        <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                        <td className="px-2 sm:px-4 py-2">
                        <span
                            className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-xs ${
                            event.event_type === 'open'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {event.event_type}
                        </span>
                      </td>
                        <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                        <td className="px-2 sm:px-4 py-2 truncate max-w-[150px]">{event.campaign}</td>
                        <td className="px-2 sm:px-4 py-2 break-all max-w-[200px] sm:max-w-none">{event.link_url || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
};

