import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { sendersApi, campaignsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';

export const Dashboard = () => {
  const [stats, setStats] = useState({
    totalSenders: 0,
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalSent: 0,
  });
  const [recentCampaigns, setRecentCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [sendersResult, campaignsResult] = await Promise.all([
        sendersApi.getSenders(),
        campaignsApi.getCampaigns(),
      ]);

      if (sendersResult.success && campaignsResult.success) {
        // Backend returns { success: true, senders: [...] } directly, not { data: { senders: [...] } }
        const senders = (sendersResult as any).senders || sendersResult.data?.senders || [];
        const campaigns = (campaignsResult as any).campaigns || campaignsResult.data?.campaigns || [];

        const activeCampaigns = campaigns.filter(
          (c: Campaign) => c.status === 'running' || c.status === 'paused'
        );
        const totalSent = campaigns.reduce(
          (sum: number, c: Campaign) => sum + (c.stats?.total_sent || 0),
          0
        );

        setStats({
          totalSenders: senders.length,
          totalCampaigns: campaigns.length,
          activeCampaigns: activeCampaigns.length,
          totalSent,
        });

        const recent = campaigns
          .sort((a: Campaign, b: Campaign) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 3);
        setRecentCampaigns(recent);
      }
    } catch (error: any) {
      console.error('Error loading dashboard:', error);
      showToast('Error loading dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStartCampaign = async (campaignId: string, canStart: boolean | undefined) => {
    if (canStart === undefined) return;
    if (!canStart) {
      showToast('Campaign not ready! Please configure senders, leads, and template first.', 'error');
      navigate(`/campaigns?setup=${campaignId}`);
      return;
    }

    try {
      const result = await campaignsApi.startCampaign(campaignId);
      if (result.success) {
        showToast('Campaign started successfully!', 'success');
        navigate('/active-campaign');
      } else {
        showToast(result.message || 'Failed to start campaign', 'error');
      }
    } catch (error: any) {
      showToast('Error starting campaign: ' + error.message, 'error');
    }
  };

  return (
    <Layout>
      
      {/* App Password Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <details className="cursor-pointer">
          <summary className="font-semibold text-blue-800 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <i className="fas fa-info-circle"></i>
              Important: App Password Information
            </span>
            <i className="fas fa-chevron-down"></i>
          </summary>
          <div className="mt-4 text-sm text-blue-700 space-y-2">
            <h4 className="font-semibold">Gmail App Passwords:</h4>
            <ul className="list-disc list-inside space-y-1">
              <li>✅ Spaces are allowed in app passwords and will be preserved</li>
              <li>✅ Use Gmail app passwords (not your regular Gmail password)</li>
              <li>✅ Enable 2-factor authentication first</li>
              <li>✅ App passwords are typically 16 characters long</li>
              <li>❌ Don't use your regular Gmail password</li>
            </ul>
            <h4 className="font-semibold mt-4">How to get an App Password:</h4>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to your Google Account settings</li>
              <li>Enable 2-factor authentication</li>
              <li>Go to Security → App passwords</li>
              <li>Generate a new app password for "Mail"</li>
              <li>Copy the 16-character password (spaces included)</li>
            </ol>
          </div>
        </details>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-paper-plane text-blue-600 text-2xl"></i>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-800">{stats.totalSenders}</h3>
            <p className="text-gray-600">Total Senders</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4">
          <div className="w-16 h-16 bg-green-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-tasks text-green-600 text-2xl"></i>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-800">{stats.totalCampaigns}</h3>
            <p className="text-gray-600">Total Campaigns</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4">
          <div className="w-16 h-16 bg-orange-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-bullseye text-orange-600 text-2xl"></i>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-800">{stats.activeCampaigns}</h3>
            <p className="text-gray-600">Active Campaigns</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4">
          <div className="w-16 h-16 bg-purple-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-envelope text-purple-600 text-2xl"></i>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-800">{formatNumber(stats.totalSent)}</h3>
            <p className="text-gray-600">Total Emails Sent</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="bg-white rounded-xl shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <i className="fas fa-bolt"></i> Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => navigate('/senders?action=add')}
            className="text-left p-4 border border-gray-200 rounded-lg hover:border-[#667eea] hover:shadow-md transition-all"
          >
            <i className="fas fa-plus-circle text-2xl text-[#667eea] mb-2"></i>
            <h3 className="font-semibold text-gray-800">Add New Sender</h3>
            <p className="text-sm text-gray-600">Configure new email sender</p>
          </button>

          <button
            onClick={() => navigate('/campaigns?action=create')}
            className="text-left p-4 border border-gray-200 rounded-lg hover:border-[#667eea] hover:shadow-md transition-all"
          >
            <i className="fas fa-clipboard-list text-2xl text-[#667eea] mb-2"></i>
            <h3 className="font-semibold text-gray-800">Create Campaign</h3>
            <p className="text-sm text-gray-600">Start a new email campaign</p>
          </button>

          <button
            onClick={() => navigate('/resources?tab=leads')}
            className="text-left p-4 border border-gray-200 rounded-lg hover:border-[#667eea] hover:shadow-md transition-all"
          >
            <i className="fas fa-folder-open text-2xl text-[#667eea] mb-2"></i>
            <h3 className="font-semibold text-gray-800">View Resources</h3>
            <p className="text-sm text-gray-600">Manage files and templates</p>
          </button>
        </div>
      </section>

      {/* Recent Activity */}
      <section className="bg-white rounded-xl shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <i className="fas fa-history"></i> Recent Activity
        </h2>
        {loading ? (
          <div className="text-center py-8">
            <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
          </div>
        ) : recentCampaigns.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <i className="fas fa-inbox text-4xl mb-2"></i>
            <p>No campaigns yet. Create your first campaign!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recentCampaigns.map((campaign) => {
              const progress = campaign.stats?.total_leads
                ? calculatePercentage(campaign.stats.total_sent, campaign.stats.total_leads)
                : '0';
              const hasLeads = !!campaign.leads_file;
              const hasTemplate = !!campaign.template_file;
              const hasSenders =
                campaign.selected_senders && campaign.selected_senders.length > 0;
              const canStart = hasLeads && hasTemplate && hasSenders;

              return (
                <div
                  key={campaign.id}
                  className="border border-gray-200 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-800">{campaign.name}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
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
                    <p className="text-sm text-gray-600 mb-2">{campaign.description || 'No description'}</p>
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                      <div
                        className="bg-[#667eea] h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Progress: {campaign.stats?.total_sent || 0} / {campaign.stats?.total_leads || 0}{' '}
                      sent
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    {campaign.status !== 'running' && (
                      <button
                        onClick={() => handleStartCampaign(campaign.id, canStart)}
                        className="px-3 py-1 bg-[#667eea] text-white rounded hover:opacity-90 text-sm"
                        title={
                          !canStart
                            ? `Campaign not ready: ${
                                !hasSenders ? 'No senders' : !hasLeads ? 'No leads' : 'No template'
                              }`
                            : ''
                        }
                      >
                        <i className="fas fa-play mr-1"></i> Start
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/campaigns?setup=${campaign.id}`)}
                      className="px-3 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm"
                    >
                      <i className="fas fa-cog mr-1"></i> Manage
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
};

