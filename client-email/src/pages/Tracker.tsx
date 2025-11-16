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

      if (tableResult.success && (tableResult.data as any)?.data) {
        // Map the table data to events format
        const mappedEvents = ((tableResult.data as any).data as any[]).map((record: any) => ({
          email: record.email || '',
          event_type: 'open' as const,
          timestamp: record.last_open || record.timestamp || new Date().toISOString(),
          campaign: campaignName,
          name: record.name,
          instagram: record.instagram,
          uid: record.uid,
          open_count: record.open_count || 1,
          last_open: record.last_open
        }));
        setEvents(mappedEvents);
      } else if (tableResult.success && (tableResult.data as any)?.events) {
        setEvents((tableResult.data as any).events);
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

  // Get opens and clicks from tracker data if available, otherwise from events
  const opensData = trackerData?.opens 
    ? trackerData.opens.map((open: any) => ({
        email: open.email || '',
        event_type: 'open' as const,
        timestamp: open.last_opened || open.timestamp || new Date().toISOString(),
        campaign: selectedCampaign,
        name: open.name,
        instagram: open.instagram,
        uid: open.uid,
        open_count: open.open_count || 1,
        last_open: open.last_opened
      }))
    : events.filter((e) => e.event_type === 'open');
  
  const clicksData = trackerData?.clicks
    ? trackerData.clicks.map((click: any) => ({
        email: click.email || '',
        event_type: 'click' as const,
        timestamp: click.timestamp || new Date().toISOString(),
        campaign: selectedCampaign,
        name: click.name,
        instagram: click.instagram,
        link_url: click.redirect_url
      }))
    : events.filter((e) => e.event_type === 'click');

  // Helper: split timestamp into separate time and date strings
  const getTimeAndDate = (timestamp: string) => {
    const d = new Date(timestamp);
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const date = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return { time, date };
  };

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
          {[
            { key: 'analytics', label: '📊 Analytics' },
            { key: 'realtime', label: '📈 Real-time Data' },
            { key: 'table', label: '📋 Campaign Table' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-3 sm:px-4 py-2 text-sm sm:text-base font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-b-2 border-[#667eea] text-[#667eea]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Summary Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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
              <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Unique Opens</h3>
              <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
                {trackerData?.unique_opens || new Set(opensData.map((e: TrackerEvent) => e.email)).size || 0}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow p-4 sm:p-6">
              <h3 className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Unique Clicks</h3>
              <p className="text-xl sm:text-2xl font-bold text-gray-800 truncate">
                {trackerData?.unique_clicks || new Set(clicksData.map((e: TrackerEvent) => e.email)).size || 0}
              </p>
            </div>
          </div>

          {/* Email Opens Table */}
          {opensData.length > 0 && (
            <section className="bg-white rounded-xl shadow p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
                <h3 className="text-base sm:text-lg font-semibold">📊 Email Opens</h3>
                <button
                  onClick={() => {
                    const opensTable = opensData.map((e: TrackerEvent) => {
                      const { time, date } = getTimeAndDate(e.timestamp);
                      return {
                        Email: e.email,
                        Name: e.name || 'N/A',
                        Instagram: e.instagram || 'N/A',
                        Time: time,
                        Date: date,
                        'Open Count': e.open_count || 1,
                        'Last Open': e.last_open || formatDate(e.timestamp),
                      };
                    });
                    downloadCSV(opensTable, `${selectedCampaign}_tracking.csv`);
                  }}
                  className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
                >
                  <i className="fas fa-download"></i> <span>Download Tracking Data (CSV)</span>
                </button>
              </div>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                  <table className="min-w-full text-xs sm:text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Email</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Name</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Instagram</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Time</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Date</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Open Count</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Last Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opensData.map((event: TrackerEvent, idx: number) => (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                          <td className="px-2 sm:px-4 py-2">{event.name || 'N/A'}</td>
                          <td className="px-2 sm:px-4 py-2">{event.instagram || 'N/A'}</td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
                            {getTimeAndDate(event.timestamp).time}
                          </td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
                            {getTimeAndDate(event.timestamp).date}
                          </td>
                          <td className="px-2 sm:px-4 py-2">{(event as any).open_count || 1}</td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{(event as any).last_open || formatDate(event.timestamp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Link Clicks Table */}
          {clicksData.length > 0 && (
            <section className="bg-white rounded-xl shadow p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
                <h3 className="text-base sm:text-lg font-semibold">🔗 Link Clicks</h3>
                <button
                  onClick={() => {
                    const clicksTable = clicksData.map((e: TrackerEvent) => {
                      const { time, date } = getTimeAndDate(e.timestamp);
                      return {
                        Email: e.email,
                        Name: e.name || 'N/A',
                        Instagram: e.instagram || 'N/A',
                        Time: time,
                        Date: date,
                        'Clicked URL': e.link_url || 'N/A',
                      };
                    });
                    downloadCSV(clicksTable, `${selectedCampaign}_clicks.csv`);
                  }}
                  className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
                >
                  <i className="fas fa-download"></i> <span>Download Click Data (CSV)</span>
                </button>
              </div>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                  <table className="min-w-full text-xs sm:text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Email</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Name</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Instagram</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Time</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Date</th>
                        <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">Clicked URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clicksData.map((event: TrackerEvent, idx: number) => (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                          <td className="px-2 sm:px-4 py-2">{event.name || 'N/A'}</td>
                          <td className="px-2 sm:px-4 py-2">{event.instagram || 'N/A'}</td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
                            {getTimeAndDate(event.timestamp).time}
                          </td>
                          <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
                            {getTimeAndDate(event.timestamp).date}
                          </td>
                          <td className="px-2 sm:px-4 py-2 break-all max-w-[200px] sm:max-w-none">{event.link_url || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {opensData.length === 0 && clicksData.length === 0 && (
            <div className="bg-white rounded-xl shadow p-6 text-center text-gray-500">
              <p>📊 No tracking data found for this campaign.</p>
            </div>
          )}
        </div>
      )}

      {/* Real-time Data Tab */}
      {activeTab === 'realtime' && (
        <div className="space-y-4 sm:space-y-6">
          <section className="bg-white rounded-xl shadow p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
              <h3 className="text-base sm:text-lg font-semibold">📈 Recent Activity</h3>
              <button
                onClick={() => {
                  if (selectedCampaign) {
                    loadCampaignData(selectedCampaign);
                  }
                }}
                className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
              >
                <i className="fas fa-sync-alt"></i> <span>🔄 Refresh Data</span>
              </button>
            </div>
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  <p>📊 No recent activity to display</p>
                </div>
              ) : (
                events.slice(0, 5).map((event, idx) => (
                  <div
                    key={idx}
                    className={`p-3 sm:p-4 rounded-lg ${
                      event.event_type === 'open'
                        ? 'bg-blue-50 border border-blue-200'
                        : 'bg-green-50 border border-green-200'
                    }`}
                  >
                    {event.event_type === 'open' ? (
                      <div className="flex items-start gap-2">
                        <i className="fas fa-envelope-open text-blue-600 mt-1"></i>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            📧 {event.email} opened email
                            {(event as any).open_count > 1 && ` (${(event as any).open_count} time(s))`}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">{formatDate(event.timestamp)}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <i className="fas fa-link text-green-600 mt-1"></i>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            🔗 {event.email} clicked: {event.link_url || 'N/A'}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">{formatDate(event.timestamp)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* Campaign Table Tab */}
      {activeTab === 'table' && (
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-2">
            <h3 className="text-base sm:text-lg font-semibold">📋 Tracking Table</h3>
            {events.length > 0 && (
              <button
                onClick={() => {
                  const tableData = events.map(e => {
                    const { time, date } = getTimeAndDate(e.timestamp);
                    return {
                      Email: e.email,
                      Name: e.name || 'N/A',
                      UID: e.uid || e.campaign || 'N/A',
                      Instagram: e.instagram || 'N/A',
                      Time: time,
                      Date: date,
                      'Open Count': (e as any).open_count || ((e as any).event_type === 'open' ? 1 : 0),
                      'Last Open': (e as any).last_open || ((e as any).event_type === 'open' ? formatDate(e.timestamp) : 'N/A'),
                    };
                  });
                  downloadCSV(tableData, `${selectedCampaign}_campaign_table.csv`);
                }}
                className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-[#667eea] text-white rounded hover:opacity-90 flex items-center justify-center gap-1 sm:gap-2"
              >
                <i className="fas fa-download"></i> <span>Download Campaign Table (CSV)</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle px-4 sm:px-0">
              <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-gray-50">
                <tr>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">📧 Email</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">👤 Name</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">🆔 UID</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">📱 Instagram</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">🕐 Time</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">📅 Date</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">🔢 Opens</th>
                    <th className="px-2 sm:px-4 py-2 text-left font-medium text-gray-700">🕕 Last Open</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                      <td colSpan={8} className="px-2 sm:px-4 py-6 sm:py-8 text-center text-gray-500 text-xs sm:text-sm">
                      No tracking data available for this campaign yet
                    </td>
                  </tr>
                ) : (
                  events.map((event, idx) => (
                      <tr key={idx} className="border-t hover:bg-gray-50">
                        <td className="px-2 sm:px-4 py-2 break-words">{event.email}</td>
                        <td className="px-2 sm:px-4 py-2">{(event as any).name || 'N/A'}</td>
                        <td className="px-2 sm:px-4 py-2">{(event as any).uid || event.campaign || 'N/A'}</td>
                        <td className="px-2 sm:px-4 py-2">{(event as any).instagram || 'N/A'}</td>
                        <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{formatDate(event.timestamp).split(' ')[1] || 'N/A'}</td>
                        <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{formatDate(event.timestamp).split(' ')[0] || 'N/A'}</td>
                        <td className="px-2 sm:px-4 py-2">{(event as any).open_count || ((event as any).event_type === 'open' ? 1 : 0)}</td>
                        <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{(event as any).last_open || ((event as any).event_type === 'open' ? formatDate(event.timestamp) : 'N/A')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
          {events.length > 0 && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                ✅ Found {events.length} tracking records for campaign: {selectedCampaign}
              </p>
            </div>
          )}
        </section>
      )}
    </Layout>
  );
};

