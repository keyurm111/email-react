import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { CampaignSetupModal } from '../components/CampaignSetupModal';
import { campaignsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatDate, formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';

export const Campaigns = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [setupCampaign, setSetupCampaign] = useState<Campaign | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadCampaigns();
    const setupId = searchParams.get('setup');
    if (setupId) {
      setTimeout(() => {
        const campaign = campaigns.find(c => c.id === setupId);
        if (campaign) {
          setSetupCampaign(campaign);
        }
      }, 500);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (campaigns.length > 0) {
      const hasRunning = campaigns.some(c => c.status === 'running');
      if (hasRunning && !refreshIntervalRef.current) {
        console.log('🔄 Starting campaigns auto-refresh (every 5 seconds)');
        refreshIntervalRef.current = setInterval(() => {
          loadCampaigns();
        }, 5000);
      } else if (!hasRunning && refreshIntervalRef.current) {
        console.log('⏸️ Stopping campaigns auto-refresh');
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }
  }, [campaigns]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const result = await campaignsApi.getCampaigns();
      const campaignsList = (result as any).campaigns || result.data?.campaigns || [];
      if (result.success) {
        setCampaigns(campaignsList);
      } else {
        showToast('Error loading campaigns', 'error');
      }
    } catch (error: any) {
      console.error('Error loading campaigns:', error);
      showToast('Error loading campaigns', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getScheduleInfo = (campaign: Campaign): string => {
    if (campaign.schedule_enabled) {
      return `📅 Daily: ${campaign.schedule_time || '10:00'}`;
    } else if (campaign.scheduled_date) {
      try {
        const date = new Date(campaign.scheduled_date + ' ' + (campaign.schedule_time || '10:00'));
        return `📅 Scheduled: ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
      } catch (e) {
        return '📅 Scheduled';
      }
    } else if (campaign.start_immediate_daily) {
      return `🚀 Immediate + Daily ${campaign.schedule_time || '10:00'}`;
    } else {
      return '🚀 Ready to start';
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = (formData.get('name') as string).trim();
    const description = (formData.get('description') as string).trim();

    if (!name) {
      showToast('Campaign name required', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
      const result = await campaignsApi.createCampaign(name, description);
      const campaign = (result as any).campaign || result.data?.campaign;

      if (result.success && campaign) {
        showToast('Campaign created successfully!', 'success');
        if (form && typeof form.reset === 'function') {
          form.reset();
        }
        await loadCampaigns();

        // Optionally open setup modal
        if (campaign) {
          setTimeout(() => setSetupCampaign(campaign), 500);
        }
      } else {
        showToast(result.message || 'Error creating campaign', 'error');
      }
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      showToast('Error creating campaign: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-plus"></i> Create Campaign';
      }
    }
  };

  const handleSetup = (campaign: Campaign) => {
    setSetupCampaign(campaign);
  };

  const handleStartCampaign = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return;

    // Validation checks (same as HTML/JS version)
    if (!campaign.selected_senders || campaign.selected_senders.length === 0) {
      showToast('❌ No senders selected! Please setup the campaign first.', 'error');
      return;
    }

    if (!campaign.leads_data && !campaign.leads_file) {
      showToast('❌ No leads uploaded! Please setup the campaign first.', 'error');
      return;
    }

    if (!campaign.template_data && !campaign.template_file) {
      showToast('❌ No template uploaded! Please setup the campaign first.', 'error');
      return;
    }

    // All validations passed - start the campaign
    try {
      const result = await campaignsApi.startCampaign(campaignId);

      if (result.success) {
        showToast('✅ Campaign started successfully!', 'success');
        
        // Redirect to active campaign page
        setTimeout(() => {
          navigate(`/active-campaign?id=${encodeURIComponent(campaignId)}`);
        }, 500);
      } else {
        showToast(result.message || 'Error starting campaign', 'error');
      }
    } catch (error: any) {
      console.error('Error starting campaign:', error);
      showToast('Error starting campaign: ' + error.message, 'error');
    }
  };

  const handleDelete = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (campaign && confirm(`Are you sure you want to delete campaign: ${campaign.name}?`)) {
      try {
        const result = await campaignsApi.deleteCampaign(campaignId);
        if (result.success) {
          showToast('Campaign deleted successfully', 'success');
          await loadCampaigns();
        } else {
          showToast('Error deleting campaign', 'error');
        }
      } catch (error: any) {
        showToast('Error deleting campaign: ' + error.message, 'error');
      }
    }
  };

  // Filter campaigns based on search query
  const filteredCampaigns = campaigns.filter((campaign) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      campaign.name.toLowerCase().includes(query) ||
      (campaign.description || '').toLowerCase().includes(query) ||
      campaign.status.toLowerCase().includes(query)
    );
  });

  return (
    <Layout>
      {/* Create Campaign */}
      <section className="bg-white rounded-xl shadow-md mb-4 sm:mb-6">
        <div className={`border-b ${createFormOpen ? 'border-gray-200' : ''}`}>
          <div
            className="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between select-none"
            onClick={() => setCreateFormOpen(!createFormOpen)}
          >
            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-base sm:text-lg">
              <i className="fas fa-plus-circle"></i> 
              <span className="hidden sm:inline">Create New Campaign</span>
              <span className="sm:hidden">Create Campaign</span>
            </h3>
            <i className={`fas fa-chevron-down transition-transform duration-300 text-sm ${createFormOpen ? 'transform rotate-180' : ''}`}></i>
          </div>
        </div>
        {createFormOpen && (
          <div className="p-4 sm:p-6">
            <form onSubmit={handleCreateCampaign} className="space-y-4 sm:space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  placeholder="e.g., Q4 Newsletter"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  placeholder="Describe your campaign..."
                ></textarea>
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <i className="fas fa-plus"></i>
                Create Campaign
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Campaign List */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-3 sm:gap-4">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-list"></i> Your Campaigns
          </h2>
          {campaigns.length > 0 && (
            <div className="relative flex-1 sm:max-w-md w-full">
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="w-full pl-9 sm:pl-10 pr-8 sm:pr-10 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          )}
        </div>
        {loading ? (
          <div className="text-center py-6 sm:py-8">
            <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <i className="fas fa-inbox text-3xl sm:text-4xl mb-2"></i>
            <p className="text-sm sm:text-base">No campaigns yet. Create your first campaign above!</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <i className="fas fa-search text-3xl sm:text-4xl mb-2"></i>
            <p className="text-sm sm:text-base">No campaigns found matching "{searchQuery}"</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-sm sm:text-base text-[#667eea] hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-gray-600">
                Found <strong>{filteredCampaigns.length}</strong> {filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'} matching "{searchQuery}"
              </div>
            )}
            <div className="space-y-3 sm:space-y-4">
              {filteredCampaigns.map((campaign) => {
              const progress = campaign.stats?.total_leads
                ? calculatePercentage(campaign.stats.total_sent || 0, campaign.stats.total_leads)
                : '0';

              return (
                <div
                  key={campaign.id}
                  className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border-l-4 border-[#667eea] hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 sm:mb-4 gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
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
                      <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 italic line-clamp-2">{campaign.description || 'No description'}</p>
                      <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-gray-600 mb-3">
                        <span className="flex items-center gap-1 sm:gap-2">
                          <i className="fas fa-calendar text-[#667eea]"></i>
                          {formatDate(campaign.created_at)}
                        </span>
                        {campaign.selected_senders && campaign.selected_senders.length > 0 && (
                          <span className="flex items-center gap-1 sm:gap-2">
                            <i className="fas fa-paper-plane text-[#667eea]"></i>
                            {campaign.selected_senders.length} senders
                          </span>
                        )}
                        {campaign.stats?.total_leads && (
                          <span className="flex items-center gap-1 sm:gap-2">
                            <i className="fas fa-users text-[#667eea]"></i>
                            {formatNumber(campaign.stats.total_leads)} leads
                          </span>
                        )}
                        <span className="flex items-center gap-1 sm:gap-2">
                          <i className="fas fa-clock text-[#667eea]"></i>
                          <span className="hidden sm:inline">{getScheduleInfo(campaign)}</span>
                          <span className="sm:hidden">Scheduled</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {campaign.stats?.total_leads && (
                    <div className="mb-3 sm:mb-4">
                      <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-2">
                        <span>Progress</span>
                        <span>
                          {campaign.stats.total_sent || 0} / {campaign.stats.total_leads} ({progress}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-[#667eea] h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleSetup(campaign)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                    >
                      <i className="fas fa-cog"></i> <span className="hidden sm:inline">Setup</span>
                    </button>
                    {campaign.status === 'running' ? (
                      <button
                        onClick={() => navigate(`/active-campaign?id=${campaign.id}`)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-eye"></i> <span className="hidden sm:inline">View</span>
                      </button>
                    ) : campaign.status === 'completed' ? (
                      <button
                        onClick={() => navigate(`/active-campaign?id=${campaign.id}`)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-eye"></i> <span className="hidden sm:inline">View</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStartCampaign(campaign.id)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-green-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-play"></i> <span className="hidden sm:inline">Start</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(campaign.id)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-red-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                    >
                      <i className="fas fa-trash"></i> <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </section>

      {/* Setup Modal */}
      {setupCampaign && (
        <CampaignSetupModal
          campaign={setupCampaign}
          onClose={() => setSetupCampaign(null)}
          onUpdate={loadCampaigns}
          showToast={showToast}
        />
      )}
    </Layout>
  );
};
