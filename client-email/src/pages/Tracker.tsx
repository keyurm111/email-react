import { useEffect, useState } from 'react';
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
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedCampaign) {
      loadCampaignData(selectedCampaign);
    }
  }, [selectedCampaign]);

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

  return (
    <Layout>

      {/* Campaign Selector */}
      <section className="bg-white rounded-xl shadow p-6 mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Campaign
        </label>
        <select
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
        >
          <option value="">Select a campaign...</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.name}>
              {campaign.name}
            </option>
          ))}
        </select>
      </section>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-4">
          {['analytics', 'realtime', 'table'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-4 py-2 font-medium transition-colors ${
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-sm text-gray-600 mb-2">Total Opens</h3>
            <p className="text-2xl font-bold text-gray-800">
              {trackerData?.total_opens || opensData.length || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-sm text-gray-600 mb-2">Total Clicks</h3>
            <p className="text-2xl font-bold text-gray-800">
              {trackerData?.total_clicks || clicksData.length || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-sm text-gray-600 mb-2">Open Rate</h3>
            <p className="text-2xl font-bold text-gray-800">
              {trackerData?.open_rate
                ? `${(trackerData.open_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-sm text-gray-600 mb-2">Click Rate</h3>
            <p className="text-2xl font-bold text-gray-800">
              {trackerData?.click_rate
                ? `${(trackerData.click_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {/* Real-time Data Tab */}
      {activeTab === 'realtime' && (
        <div className="space-y-6">
          <section className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Email Opens</h3>
              {opensData.length > 0 && (
                <button
                  onClick={() => downloadCSV(opensData, `opens_${selectedCampaign}.csv`)}
                  className="px-3 py-1 bg-[#667eea] text-white rounded text-sm hover:opacity-90"
                >
                  <i className="fas fa-download mr-1"></i> Download CSV
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Timestamp</th>
                    <th className="px-4 py-2 text-left">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {opensData.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                        No opens recorded yet
                      </td>
                    </tr>
                  ) : (
                    opensData.slice(0, 50).map((event, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{event.email}</td>
                        <td className="px-4 py-2">{formatDate(event.timestamp)}</td>
                        <td className="px-4 py-2">{event.campaign}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Link Clicks</h3>
              {clicksData.length > 0 && (
                <button
                  onClick={() => downloadCSV(clicksData, `clicks_${selectedCampaign}.csv`)}
                  className="px-3 py-1 bg-[#667eea] text-white rounded text-sm hover:opacity-90"
                >
                  <i className="fas fa-download mr-1"></i> Download CSV
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Link URL</th>
                    <th className="px-4 py-2 text-left">Timestamp</th>
                    <th className="px-4 py-2 text-left">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {clicksData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        No clicks recorded yet
                      </td>
                    </tr>
                  ) : (
                    clicksData.slice(0, 50).map((event, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{event.email}</td>
                        <td className="px-4 py-2">{event.link_url || 'N/A'}</td>
                        <td className="px-4 py-2">{formatDate(event.timestamp)}</td>
                        <td className="px-4 py-2">{event.campaign}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Campaign Table Tab */}
      {activeTab === 'table' && (
        <section className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Campaign Tracking Table</h3>
            {events.length > 0 && (
              <button
                onClick={() => downloadCSV(events, `campaign_table_${selectedCampaign}.csv`)}
                className="px-3 py-1 bg-[#667eea] text-white rounded text-sm hover:opacity-90"
              >
                <i className="fas fa-download mr-1"></i> Download CSV
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Event Type</th>
                  <th className="px-4 py-2 text-left">Timestamp</th>
                  <th className="px-4 py-2 text-left">Campaign</th>
                  <th className="px-4 py-2 text-left">Link URL</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No tracking data available
                    </td>
                  </tr>
                ) : (
                  events.slice(0, 100).map((event, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-4 py-2">{event.email}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            event.event_type === 'open'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {event.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-2">{formatDate(event.timestamp)}</td>
                      <td className="px-4 py-2">{event.campaign}</td>
                      <td className="px-4 py-2">{event.link_url || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Layout>
  );
};

