import { useEffect, useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import { analyticsApi, campaignsApi, trackerApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';
// @ts-ignore - react-simple-maps doesn't ship perfect TS typings
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
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

interface StateStats {
  name: string;
  total_sent: number;
  total_failed: number;
  success_rate: number;
}

interface CityStats {
  name: string;
  total_sent: number;
  total_failed: number;
  success_rate: number;
}

interface CountryStats {
  country: string;
  total_sent: number;
  total_failed: number;
  tracked_emails: number;
  success_rate: number;
  states: StateStats[];
  cities: CityStats[];
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
  const [countryStats, setCountryStats] = useState<CountryStats[]>([]);
  const [hoveredCountry, setHoveredCountry] = useState<CountryStats | null>(null);
  const [locationModalCountry, setLocationModalCountry] = useState<CountryStats | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryStats | null>(null);
  const { showToast } = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const geoUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

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

      // ---------- Country-level stats (overall, not filtered) ----------
      // Use an internal aggregation structure with state/city maps for per-country breakdown
      const countryAggMap = new Map<
        string,
        {
          country: string;
          total_sent: number;
          total_failed: number;
          tracked_emails: number;
          states: Map<string, { total_sent: number; total_failed: number }>;
          cities: Map<string, { total_sent: number; total_failed: number }>;
        }
      >();

      campaignsList.forEach((campaign) => {
        const countryName = (campaign.country || '').trim();
        if (!countryName) return;
        const sent = campaign.stats?.total_sent || 0;
        const failed = campaign.stats?.total_failed || 0;
        const stateName = (campaign.state || '').trim();
        const cityName = (campaign.city || '').trim();

        if (!countryAggMap.has(countryName)) {
          countryAggMap.set(countryName, {
            country: countryName,
            total_sent: 0,
            total_failed: 0,
            tracked_emails: 0,
            states: new Map(),
            cities: new Map(),
          });
        }
        const entry = countryAggMap.get(countryName)!;
        entry.total_sent += sent;
        entry.total_failed += failed;

        // Aggregate per-state stats
        if (stateName) {
          if (!entry.states.has(stateName)) {
            entry.states.set(stateName, { total_sent: 0, total_failed: 0 });
          }
          const stateEntry = entry.states.get(stateName)!;
          stateEntry.total_sent += sent;
          stateEntry.total_failed += failed;
        }

        // Aggregate per-city stats
        if (cityName) {
          if (!entry.cities.has(cityName)) {
            entry.cities.set(cityName, { total_sent: 0, total_failed: 0 });
          }
          const cityEntry = entry.cities.get(cityName)!;
          cityEntry.total_sent += sent;
          cityEntry.total_failed += failed;
        }
      });

      // Load tracking data (used for overall stats + per-country tracked emails)
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
        
        // Add tracked emails per country using campaign mapping
        trackingCampaigns.forEach((campaign: any) => {
          const campaignName = campaign.campaign_name;
          const matchingCampaign = campaignsList.find((c: Campaign) => c.name === campaignName);
          const countryName = matchingCampaign?.country?.trim();
          if (!countryName) return;
          if (!countryAggMap.has(countryName)) {
            countryAggMap.set(countryName, {
              country: countryName,
              total_sent: 0,
              total_failed: 0,
              tracked_emails: 0,
              states: new Map(),
              cities: new Map(),
            });
          }
          const entry = countryAggMap.get(countryName)!;
          entry.tracked_emails += campaign.unique_emails || 0;
        });
      }

      // Finalize success rate per country
      const countryStatsArray: CountryStats[] = Array.from(countryAggMap.values()).map((entry) => {
        const totalAttempts = entry.total_sent + entry.total_failed;

        const states: StateStats[] = Array.from(entry.states.entries()).map(
          ([name, s]) => {
            const attempts = s.total_sent + s.total_failed;
            return {
              name,
              total_sent: s.total_sent,
              total_failed: s.total_failed,
              success_rate: attempts > 0 ? (s.total_sent / attempts) * 100 : 0,
            };
          }
        );

        const cities: CityStats[] = Array.from(entry.cities.entries()).map(
          ([name, c]) => {
            const attempts = c.total_sent + c.total_failed;
            return {
              name,
              total_sent: c.total_sent,
              total_failed: c.total_failed,
              success_rate: attempts > 0 ? (c.total_sent / attempts) * 100 : 0,
            };
          }
        );

        // Sort by total_sent descending so most important locations are first
        states.sort((a, b) => b.total_sent - a.total_sent);
        cities.sort((a, b) => b.total_sent - a.total_sent);

        return {
          country: entry.country,
          total_sent: entry.total_sent,
          total_failed: entry.total_failed,
          tracked_emails: entry.tracked_emails,
          success_rate: totalAttempts > 0 ? (entry.total_sent / totalAttempts) * 100 : 0,
          states,
          cities,
        };
      });
      setCountryStats(countryStatsArray);
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
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-full sm:w-80 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
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

      {/* World Map - Country-wise Performance (Overall) */}
      {countryStats.length > 0 && (
        <section className="bg-white rounded-xl shadow-md p-3 sm:p-6 mb-2 sm:mb-6 max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="w-full lg:flex-[4] lg:pr-4">
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-1 sm:mb-2 flex items-center gap-2">
                <i className="fas fa-globe-americas"></i> Global Email Reach (All Campaigns)
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">
                Hover any country to see total emails sent, delivery success rate, and tracked recipients for that country.
                This map always shows <span className="font-semibold">overall</span> performance across all campaigns (ignores the campaign filter above).
              </p>
              <div className="w-full max-w-5xl mx-auto h-[24rem] sm:h-[28rem] lg:h-[36rem]">
                <ComposableMap
                  projectionConfig={{ scale: 175 }}
                  className="w-full h-full"
                >
                  <Geographies geography={geoUrl}>
                    {({ geographies }: any) =>
                      geographies.map((geo: any) => {
                        const name: string = geo.properties.name || geo.properties.NAME || '';

                        // Normalize helper to make matching more robust
                        const normalizeName = (value: string) =>
                          value.toLowerCase().replace(/[^a-z]/g, '');

                        const geoKey = normalizeName(name);

                        const statsForCountry =
                          countryStats.find((c) => {
                            const statsKey = normalizeName(c.country);
                            // Direct normalized match
                            if (statsKey === geoKey) return true;
                            // Fallback: one contains the other (handles e.g. "unitedstates" vs "unitedstatesofamerica")
                            return (
                              statsKey.includes(geoKey) ||
                              geoKey.includes(statsKey)
                            );
                          }) || null;
                        const isSelected =
                          !!statsForCountry &&
                          !!selectedCountry &&
                          selectedCountry.country === statsForCountry.country;

                        const intensity = statsForCountry
                          ? Math.min(1, statsForCountry.total_sent / 5000)
                          : 0;

                        // Base color for highlighted countries, darker if selected (works well for tap on mobile)
                        const baseColor = statsForCountry ? '#4f46e5' : '#e5e7eb';
                        const fillColor = statsForCountry
                          ? isSelected
                            ? `rgba(79,70,229,${0.75})`
                            : `rgba(79,70,229,${0.3 + 0.4 * intensity})`
                          : baseColor;

                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            onMouseEnter={() => {
                              if (hoverTimeoutRef.current !== null) {
                                window.clearTimeout(hoverTimeoutRef.current);
                                hoverTimeoutRef.current = null;
                              }
                              if (statsForCountry) {
                                setHoveredCountry(statsForCountry);
                              } else {
                                setHoveredCountry(null);
                              }
                            }}
                            onMouseLeave={() => {
                              // When a country is selected by click, don't auto-hide the card on mouse leave
                              if (selectedCountry) {
                                return;
                              }
                              if (hoverTimeoutRef.current !== null) {
                                window.clearTimeout(hoverTimeoutRef.current);
                              }
                              hoverTimeoutRef.current = window.setTimeout(() => {
                                setHoveredCountry(null);
                                hoverTimeoutRef.current = null;
                              }, 400);
                            }}
                            onClick={() => {
                              if (!statsForCountry) return;
                              setSelectedCountry((prev) =>
                                prev && prev.country === statsForCountry.country ? null : statsForCountry
                              );
                              setHoveredCountry(statsForCountry);
                            }}
                            style={{
                              default: {
                                fill: fillColor,
                                outline: 'none',
                                stroke: '#ffffff',
                                strokeWidth: 0.5,
                              },
                              hover: {
                                fill: statsForCountry ? (isSelected ? '#312e81' : '#4338ca') : '#d1d5db',
                                outline: 'none',
                                stroke: '#111827',
                                strokeWidth: 0.8,
                                cursor: statsForCountry ? 'pointer' : 'default',
                              },
                              pressed: {
                                fill: statsForCountry ? '#312e81' : '#9ca3af',
                                outline: 'none',
                              },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>
                </ComposableMap>
              </div>
            </div>

            {/* Hover tooltip card */}
            <div
              className="w-full lg:w-64 xl:w-72 bg-gray-50 rounded-lg border border-gray-200 p-3 sm:p-4"
              onMouseEnter={() => {
                if (hoverTimeoutRef.current !== null) {
                  window.clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = null;
                }
              }}
              onMouseLeave={() => {
                // When a country is locked in by click, keep the card visible
                if (selectedCountry) {
                  return;
                }
                if (hoverTimeoutRef.current !== null) {
                  window.clearTimeout(hoverTimeoutRef.current);
                }
                hoverTimeoutRef.current = window.setTimeout(() => {
                  setHoveredCountry(null);
                  hoverTimeoutRef.current = null;
                }, 400);
              }}
            >
              <h4 className="text-sm sm:text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <i className="fas fa-map-marker-alt text-[#667eea]"></i>
                {(selectedCountry || hoveredCountry)?.country || 'Hover a country'}
              </h4>
              {selectedCountry || hoveredCountry ? (
                (() => {
                  const country = selectedCountry || hoveredCountry!;
                  return (
                <div className="space-y-3 text-xs sm:text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <i className="fas fa-paper-plane text-blue-500"></i>
                      Sent
                    </span>
                    <span className="font-semibold">
                      {formatNumber(country.total_sent)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <i className="fas fa-times-circle text-red-500"></i>
                      Failed
                    </span>
                      <span className="font-semibold">
                      {formatNumber(country.total_failed)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <i className="fas fa-percentage text-green-500"></i>
                      Success Rate
                    </span>
                    <span className="font-semibold">
                      {country.success_rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <i className="fas fa-user-check text-emerald-500"></i>
                      Tracked Emails
                    </span>
                    <span className="font-semibold">
                      {formatNumber(country.tracked_emails)}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        <i className="fas fa-flag text-indigo-500"></i>
                        States Covered
                      </span>
                      <span className="font-semibold">
                        {country.states.length}
                      </span>
                    </div>
                    {country.states.length > 0 && (
                      <ul className="mt-1 space-y-1 max-h-28 overflow-y-auto pr-1">
                        {country.states.slice(0, 5).map((state) => (
                          <li key={state.name} className="flex items-center justify-between">
                            <span className="truncate">{state.name}</span>
                            <span className="text-[11px] text-gray-600 ml-2">
                              {formatNumber(state.total_sent)} sent, {state.success_rate.toFixed(1)}%
                            </span>
                          </li>
                        ))}
                        {country.states.length > 5 && (
                          <li className="text-[11px] text-gray-500">
                            +{country.states.length - 5} more states
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  <div className="border-t border-gray-200 pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        <i className="fas fa-city text-purple-500"></i>
                        Cities Covered
                      </span>
                      <span className="font-semibold">
                        {country.cities.length}
                      </span>
                    </div>
                    {country.cities.length > 0 && (
                      <ul className="mt-1 space-y-1 max-h-28 overflow-y-auto pr-1">
                        {country.cities.slice(0, 5).map((city) => (
                          <li key={city.name} className="flex items-center justify-between">
                            <span className="truncate">{city.name}</span>
                            <span className="text-[11px] text-gray-600 ml-2">
                              {formatNumber(city.total_sent)} sent, {city.success_rate.toFixed(1)}%
                            </span>
                          </li>
                        ))}
                        {country.cities.length > 5 && (
                          <li className="text-[11px] text-gray-500">
                            +{country.cities.length - 5} more cities
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  {(country.states.length > 0 || country.cities.length > 0) && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setLocationModalCountry(country)}
                        className="w-full mt-1 inline-flex items-center justify-center px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-md border border-[#667eea] text-[#667eea] hover:bg-[#667eea] hover:text-white transition-colors"
                      >
                        <i className="fas fa-list-ul mr-1"></i>
                        View all locations
                      </button>
                    </div>
                  )}
                </div>
                  );
                })()
              ) : (
                <p className="text-xs sm:text-sm text-gray-500">
                  Move your cursor over a highlighted country on the map to see how many emails you&apos;ve sent there,
                  how many succeeded, how many recipients generated tracking events, and which states &amp; cities you&apos;ve covered.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* World Map - Full Locations Modal */}
      {locationModalCountry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 sm:px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-start justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <i className="fas fa-globe-americas text-[#667eea]"></i>
                  {locationModalCountry.country} – All Locations
                </h3>
                <p className="text-xs sm:text-sm text-gray-500">
                  Detailed breakdown of every state and city where you&apos;ve run campaigns in this country.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocationModalCountry(null)}
                className="ml-3 text-gray-400 hover:text-gray-600"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {/* States table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm sm:text-base font-semibold text-gray-800 flex items-center gap-2">
                      <i className="fas fa-flag text-indigo-500"></i>
                      States ({locationModalCountry.states.length})
                    </h4>
                  </div>
                  {locationModalCountry.states.length === 0 ? (
                    <p className="text-xs sm:text-sm text-gray-500">
                      No states recorded for this country yet.
                    </p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="min-w-full text-xs sm:text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">State</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Sent</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Failed</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Success %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {locationModalCountry.states.map((state) => (
                            <tr key={state.name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 whitespace-nowrap">{state.name}</td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(state.total_sent)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(state.total_failed)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {state.success_rate.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Cities table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm sm:text-base font-semibold text-gray-800 flex items-center gap-2">
                      <i className="fas fa-city text-purple-500"></i>
                      Cities ({locationModalCountry.cities.length})
                    </h4>
                  </div>
                  {locationModalCountry.cities.length === 0 ? (
                    <p className="text-xs sm:text-sm text-gray-500">
                      No cities recorded for this country yet.
                    </p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="min-w-full text-xs sm:text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">City</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Sent</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Failed</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-700">Success %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {locationModalCountry.cities.map((city) => (
                            <tr key={city.name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 whitespace-nowrap">{city.name}</td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(city.total_sent)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(city.total_failed)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {city.success_rate.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end px-4 sm:px-6 py-3 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setLocationModalCountry(null)}
                className="inline-flex items-center px-4 py-2 text-xs sm:text-sm font-medium rounded-md bg-[#667eea] text-white hover:bg-[#5568d3] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Performance - only for specific campaign (not All Campaigns) */}
      {selectedCampaignId !== 'all' && (
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
              <p className="text-sm sm:text-base">No campaign selected</p>
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
      )}
    </Layout>
  );
};
