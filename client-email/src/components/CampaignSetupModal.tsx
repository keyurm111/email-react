import { useState, useEffect, useRef } from 'react';
import { sendersApi, campaignsApi, leadsApi, templatesApi } from '../services/api';
import type { Campaign, Sender } from '../types';

interface CampaignSetupModalProps {
  campaign: Campaign | null;
  onClose: () => void;
  onUpdate: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

export const CampaignSetupModal = ({ campaign, onClose, onUpdate, showToast }: CampaignSetupModalProps) => {
  const [activeTab, setActiveTab] = useState('senders');
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [leadsUploadMode, setLeadsUploadMode] = useState<'new' | 'existing'>('new');
  const [templateUploadMode, setTemplateUploadMode] = useState<'new' | 'existing'>('new');
  const [leadsFile, setLeadsFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [existingLeads, setExistingLeads] = useState<any[]>([]);
  const [existingTemplates, setExistingTemplates] = useState<any[]>([]);
  const [selectedExistingLead, setSelectedExistingLead] = useState<string>('');
  const [selectedExistingTemplate, setSelectedExistingTemplate] = useState<string>('');
  const [leadsPreview, setLeadsPreview] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const [settings, setSettings] = useState<{
    subject_line: string;
    daily_limit: number | string;
    delay: number;
    startOption: string;
    schedule_date: string;
    schedule_time: string;
  }>({
    subject_line: '',
    daily_limit: 120,
    delay: 30,
    startOption: 'immediate',
    schedule_date: '',
    schedule_time: '10:00',
  });
  const [uploading, setUploading] = useState(false);
  const [togglingSender, setTogglingSender] = useState(false);
  const leadsFileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (campaign) {
      setSelectedSenders(campaign.selected_senders || []);
      setSettings({
        subject_line: campaign.subject_line || '',
        daily_limit: campaign.daily_limit || 120,
        delay: campaign.delay || 30,
        startOption: campaign.start_immediate_daily
          ? 'immediate-daily'
          : campaign.scheduled_date
          ? 'specific-date'
          : campaign.schedule_enabled
          ? 'daily'
          : 'immediate',
        schedule_date: campaign.scheduled_date || '',
        schedule_time: campaign.schedule_time || '10:00',
      });

      // Load existing data
      if (campaign.leads_data) {
        setLeadsPreview(campaign.leads_data);
        setLeadsUploadMode('new');
      }
      if (campaign.template_data) {
        setTemplatePreview(campaign.template_data);
        setTemplateUploadMode('new');
      }

      loadSetupData();
    }
  }, [campaign]);

  const loadSetupData = async () => {
    try {
      const [sendersResult, leadsResult, templatesResult] = await Promise.all([
        sendersApi.getSenders(),
        leadsApi.getLeadFiles(),
        templatesApi.getTemplateFiles(),
      ]);

      if (sendersResult.success) {
        const sendersList = (sendersResult as any).senders || sendersResult.data?.senders || [];
        setSenders(sendersList);
      }

      if (leadsResult.success) {
        const leadsList = (leadsResult as any).leads || leadsResult.data?.leads || [];
        setExistingLeads(leadsList);
      }

      if (templatesResult.success) {
        const templatesList = (templatesResult as any).templates || templatesResult.data?.templates || [];
        setExistingTemplates(templatesList);
      }
    } catch (error) {
      console.error('Error loading setup data:', error);
    }
  };

  const updateSetupProgress = (camp: Campaign) => {
    const steps = {
      'step-senders': camp.selected_senders && camp.selected_senders.length > 0,
      'step-leads': !!(camp.leads_file || camp.leads_data),
      'step-template': !!(camp.template_file || camp.template_data),
      'step-settings': !!camp.subject_line,
    };
    return steps;
  };

  const toggleSender = async (email: string) => {
    if (!campaign || togglingSender) return;

    // Use local state instead of campaign prop to avoid race conditions
    const currentSelected = selectedSenders;
    const index = currentSelected.indexOf(email);
    const newSelected = index > -1
      ? currentSelected.filter(e => e !== email)
      : [...currentSelected, email];

    // Prevent multiple simultaneous toggles
    setTogglingSender(true);

    // Optimistically update UI immediately
    setSelectedSenders(newSelected);

    try {
      showToast(index > -1 ? `Removing ${email}...` : `Adding ${email}...`, 'info');

      const result = await campaignsApi.updateCampaign(campaign.id, {
        selected_senders: newSelected,
      });

      if (result.success) {
        showToast(index > -1 ? `✅ Removed ${email}` : `✅ Added ${email}`, 'success');
        
        // Reload senders display to get latest data
        const sendersResult = await sendersApi.getSenders();
        if (sendersResult.success) {
          const sendersList = (sendersResult as any).senders || sendersResult.data?.senders || [];
          setSenders(sendersList);
        }

        // Refresh campaign data from parent to sync
        onUpdate();
      } else {
        showToast('Error updating senders', 'error');
        // Revert on error
        setSelectedSenders(currentSelected);
      }
    } catch (error: any) {
      console.error('Error toggling sender:', error);
      showToast('Error updating senders: ' + error.message, 'error');
      // Revert on error
      setSelectedSenders(currentSelected);
    } finally {
      setTogglingSender(false);
    }
  };

  const handleLeadsFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !campaign) return;

    setUploading(true);
    showToast('Uploading leads...', 'info');

    try {
      const result = await leadsApi.uploadLeads(campaign.id, file);

      if (result.success) {
        showToast(`Uploaded ${(result as any).count || 0} leads successfully!`, 'success');
        setLeadsFile(null);
        
        // Update preview
        if ((result as any).preview || (result as any).leads_data) {
          setLeadsPreview((result as any).preview || (result as any).leads_data);
        }

        onUpdate();
      } else {
        showToast(result.message || 'Error uploading leads', 'error');
      }
    } catch (error: any) {
      console.error('Error uploading leads:', error);
      showToast('Error uploading leads: ' + error.message, 'error');
    } finally {
      setUploading(false);
      if (leadsFileInputRef.current) {
        leadsFileInputRef.current.value = '';
      }
    }
  };

  const handleTemplateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !campaign) return;

    setUploading(true);
    showToast('Uploading template...', 'info');

    try {
      const result = await templatesApi.uploadTemplate(campaign.id, file);

      if (result.success) {
        const templateContent = (result as any).template_data || (result as any).preview || '';
        const hasTracking = templateContent.includes('track/open?email=') || templateContent.includes('track/open');

        if (hasTracking) {
          showToast('✅ Template uploaded with tracking pixel injected!', 'success');
        } else {
          showToast('Template uploaded successfully (check tracking injection)', 'warning');
        }

        setTemplateFile(null);
        
        // Update preview
        if (templateContent) {
          setTemplatePreview(templateContent);
        }

        onUpdate();
      } else {
        showToast(result.message || 'Error uploading template', 'error');
      }
    } catch (error: any) {
      console.error('Error uploading template:', error);
      showToast('Error uploading template: ' + error.message, 'error');
    } finally {
      setUploading(false);
      if (templateFileInputRef.current) {
        templateFileInputRef.current.value = '';
      }
    }
  };

  const handleUseExistingLeads = async () => {
    if (!selectedExistingLead || !campaign) {
      showToast('Please select a lead file', 'error');
      return;
    }

    try {
      showToast('Loading leads...', 'info');

      const result = await campaignsApi.updateCampaign(campaign.id, {
        leads_file: selectedExistingLead,
      });

      if (result.success) {
        showToast('Leads file selected successfully!', 'success');
        
        // Try to get preview from existing leads
        const leadsResult = await leadsApi.getLeadFiles();
        if (leadsResult.success) {
          const leadsList = (leadsResult as any).leads || leadsResult.data?.leads || [];
          const leadFile = leadsList.find((l: any) => l.filename === selectedExistingLead);
          if (leadFile && leadFile.preview) {
            setLeadsPreview(leadFile.preview);
          }
        }

        onUpdate();
      } else {
        showToast(result.message || 'Error selecting leads file', 'error');
      }
    } catch (error: any) {
      console.error('Error using existing leads:', error);
      showToast('Error using existing leads: ' + error.message, 'error');
    }
  };

  const handleUseExistingTemplate = async () => {
    if (!selectedExistingTemplate || !campaign) {
      showToast('Please select a template', 'error');
      return;
    }

    try {
      showToast('Loading template...', 'info');

      const result = await campaignsApi.updateCampaign(campaign.id, {
        template_file: selectedExistingTemplate,
      });

      if (result.success) {
        showToast('Template selected successfully!', 'success');
        
        // Try to get preview from existing templates
        const templatesResult = await templatesApi.getTemplateFiles();
        if (templatesResult.success) {
          const templatesList = (templatesResult as any).templates || templatesResult.data?.templates || [];
          const templateFile = templatesList.find((t: any) => t.filename === selectedExistingTemplate);
          if (templateFile && templateFile.content) {
            setTemplatePreview(templateFile.content);
          }
        }

        onUpdate();
      } else {
        showToast(result.message || 'Error selecting template', 'error');
      }
    } catch (error: any) {
      console.error('Error using existing template:', error);
      showToast('Error using existing template: ' + error.message, 'error');
    }
  };

  const handleRemoveLeads = async () => {
    if (!campaign) return;
    
    if (!confirm('Are you sure you want to remove the leads from this campaign?')) {
      return;
    }

    try {
      const result = await campaignsApi.updateCampaign(campaign.id, {
        leads_file: null,
        leads_data: null,
        'stats.total_leads': 0,
      } as any);

      if (result.success) {
        showToast('Leads removed successfully', 'success');
        setLeadsPreview(null);
        setLeadsUploadMode('new');
        onUpdate();
      } else {
        showToast('Error removing leads', 'error');
      }
    } catch (error: any) {
      console.error('Error removing leads:', error);
      showToast('Error removing leads: ' + error.message, 'error');
    }
  };

  const handleRemoveTemplate = async () => {
    if (!campaign) return;
    
    if (!confirm('Are you sure you want to remove the template from this campaign?')) {
      return;
    }

    try {
      const result = await campaignsApi.updateCampaign(campaign.id, {
        template_file: null,
        template_data: null,
      });

      if (result.success) {
        showToast('Template removed successfully', 'success');
        setTemplatePreview(null);
        setTemplateUploadMode('new');
        onUpdate();
      } else {
        showToast('Error removing template', 'error');
      }
    } catch (error: any) {
      console.error('Error removing template:', error);
      showToast('Error removing template: ' + error.message, 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!campaign) return;

    const submitBtn = e.currentTarget.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      if (!settings.subject_line) {
        showToast('Please enter a subject line', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
        }
        return;
      }

      // Validate daily limit
      const dailyLimit = typeof settings.daily_limit === 'number' ? settings.daily_limit : (parseInt(String(settings.daily_limit)) || 120);
      if (isNaN(dailyLimit) || dailyLimit < 1 || dailyLimit > 500) {
        showToast('Daily limit must be between 1 and 500', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
        }
        return;
      }

      const updateData: any = {
        subject_line: settings.subject_line,
        daily_limit: dailyLimit, // Use validated value
        delay: settings.delay,
        schedule_time: settings.schedule_time || '10:00',
      };

      switch (settings.startOption) {
        case 'immediate':
          updateData.schedule_enabled = false;
          updateData.scheduled_date = null;
          updateData.start_immediate_daily = false;
          break;
        case 'immediate-daily':
          updateData.schedule_enabled = false;
          updateData.scheduled_date = null;
          updateData.start_immediate_daily = true;
          break;
        case 'specific-date':
          updateData.schedule_enabled = false;
          updateData.scheduled_date = settings.schedule_date;
          updateData.start_immediate_daily = false;
          if (!settings.schedule_date) {
            showToast('Please select a date', 'error');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
            }
            return;
          }
          break;
        case 'daily':
          updateData.schedule_enabled = true;
          updateData.scheduled_date = null;
          updateData.start_immediate_daily = false;
          break;
      }

      const result = await campaignsApi.updateCampaign(campaign.id, updateData);

      if (result.success) {
        showToast('Settings saved successfully!', 'success');
        onUpdate();
      } else {
        showToast(result.message || 'Error saving settings', 'error');
      }
    } catch (error: any) {
      console.error('Error saving settings:', error);
      showToast('Error saving settings: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
      }
    }
  };

  const parseLeadsPreview = (data: string): string[][] => {
    if (!data) return [];
    const rows = data.split('\n').filter(row => row.trim());
    return rows.map(row => row.split(',').map(cell => cell.trim()));
  };

  const displayLeadsPreviewTable = (data: string): string => {
    const rows = parseLeadsPreview(data);
    if (rows.length === 0) return '';

    const headers = rows[0];
    const dataRows = rows.slice(1, 6); // Show first 5 rows

    let html = '<div class="overflow-x-auto"><table class="min-w-full border border-gray-300"><thead><tr class="bg-gray-100">';
    headers.forEach(header => {
      html += `<th class="px-4 py-2 border border-gray-300 text-left">${header}</th>`;
    });
    html += '</tr></thead><tbody>';

    dataRows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        html += `<td class="px-4 py-2 border border-gray-300">${cell}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += `<p class="text-gray-500 text-sm mt-2"><i class="fas fa-info-circle"></i> Showing first ${dataRows.length} of ${rows.length - 1} leads</p>`;

    return html;
  };

  if (!campaign) return null;

  const progressSteps = updateSetupProgress(campaign);
  const availableSenders = senders.filter(s => !selectedSenders.includes(s.email));
  const selectedSendersList = senders.filter(s => selectedSenders.includes(s.email));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-2 sm:p-4" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 sm:p-6 flex items-center justify-between z-10">
          <h2 className="text-base sm:text-xl font-semibold text-gray-800 truncate pr-2">
            <i className="fas fa-cog mr-2"></i>
            <span className="hidden sm:inline">Setup Campaign: </span>
            <span className="sm:hidden">Setup: </span>
            {campaign.name}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0">
            <i className="fas fa-times text-lg sm:text-xl"></i>
          </button>
        </div>

        {/* Setup Progress */}
        <div className="p-4 sm:p-6 bg-gray-50 border-b border-gray-200">
          <h4 className="font-semibold text-sm sm:text-base text-gray-800 mb-3 sm:mb-4">Setup Progress:</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            {[
              { id: 'step-senders', label: 'Select Senders', completed: progressSteps['step-senders'] },
              { id: 'step-leads', label: 'Upload Leads', completed: progressSteps['step-leads'] },
              { id: 'step-template', label: 'Upload Template', completed: progressSteps['step-template'] },
              { id: 'step-settings', label: 'Configure Settings', completed: progressSteps['step-settings'] },
            ].map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-1 sm:gap-2 text-xs sm:text-sm ${step.completed ? 'text-green-600' : 'text-gray-600'}`}
              >
                <i className={`fas text-xs sm:text-sm ${step.completed ? 'fa-check-circle text-green-600' : 'fa-circle'}`}></i>
                <span className="truncate">{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Setup Tabs */}
        <div className="border-b border-gray-200 flex overflow-x-auto">
          {[
            { id: 'senders', icon: 'fa-paper-plane', label: 'Senders' },
            { id: 'leads', icon: 'fa-users', label: 'Leads' },
            { id: 'template', icon: 'fa-file-code', label: 'Template' },
            { id: 'settings', icon: 'fa-cog', label: 'Settings' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-6 py-2 sm:py-3 text-sm sm:text-base font-medium transition-colors whitespace-nowrap flex items-center gap-1 sm:gap-2 ${
                activeTab === tab.id
                  ? 'border-b-2 border-[#667eea] text-[#667eea]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <i className={`fas ${tab.icon} text-xs sm:text-sm`}></i>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6">
          {/* Senders Tab */}
          {activeTab === 'senders' && (
            <div className="space-y-4 sm:space-y-6">
              <h4 className="font-semibold text-sm sm:text-base text-gray-800">Select Sender Emails for this Campaign:</h4>
              <div className="space-y-2">
                {availableSenders.length === 0 ? (
                  <p className="text-gray-500">All senders are selected</p>
                ) : (
                  availableSenders.map((sender) => (
                    <div
                      key={sender.email}
                      className={`bg-gray-50 p-3 sm:p-4 rounded-lg flex items-center justify-between hover:bg-gray-100 transition-colors ${
                        togglingSender ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                      onClick={() => !togglingSender && toggleSender(sender.email)}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <i className="fas fa-envelope text-[#667eea] flex-shrink-0"></i>
                        <div className="min-w-0 flex-1">
                          <strong className="text-sm sm:text-base text-gray-800 block truncate">{sender.email}</strong>
                          {sender.name && <div className="text-xs sm:text-sm text-gray-600 truncate">{sender.name}</div>}
                        </div>
                      </div>
                      <button 
                        className="px-2 sm:px-3 py-1 bg-[#667eea] text-white rounded-lg hover:opacity-90 text-xs sm:text-sm flex-shrink-0"
                        disabled={togglingSender}
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                  ))
                )}
              </div>

              <h4 className="font-semibold text-sm sm:text-base text-gray-800 mt-4 sm:mt-6">Selected Senders:</h4>
              <div className="space-y-2">
                {selectedSendersList.length === 0 ? (
                  <p className="text-xs sm:text-sm text-gray-500">No senders selected yet</p>
                ) : (
                  selectedSendersList.map((sender) => (
                    <div
                      key={sender.email}
                      className={`bg-green-50 border-l-3 border-green-500 p-3 sm:p-4 rounded-lg flex items-center justify-between hover:bg-green-100 transition-colors ${
                        togglingSender ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                      onClick={() => !togglingSender && toggleSender(sender.email)}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <i className="fas fa-envelope text-green-600 flex-shrink-0"></i>
                        <div className="min-w-0 flex-1">
                          <strong className="text-sm sm:text-base text-gray-800 block truncate">{sender.email}</strong>
                          {sender.name && <div className="text-xs sm:text-sm text-gray-600 truncate">{sender.name}</div>}
                        </div>
                      </div>
                      <button 
                        className="px-2 sm:px-3 py-1 bg-red-500 text-white rounded-lg hover:opacity-90 text-xs sm:text-sm flex-shrink-0"
                        disabled={togglingSender}
                      >
                        <i className="fas fa-minus"></i>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Leads Tab */}
          {activeTab === 'leads' && (
            <div className="space-y-4 sm:space-y-5">
              <h4 className="font-semibold text-sm sm:text-base text-gray-800">Upload Leads for this Campaign:</h4>
              
              <div className="space-y-4">
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="leadsUpload"
                      value="new"
                      checked={leadsUploadMode === 'new'}
                      onChange={() => setLeadsUploadMode('new')}
                      className="w-5 h-5"
                    />
                    <span>Upload New CSV File</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="leadsUpload"
                      value="existing"
                      checked={leadsUploadMode === 'existing'}
                      onChange={() => setLeadsUploadMode('existing')}
                      className="w-5 h-5"
                    />
                    <span>Use Existing Lead File</span>
                  </label>
                </div>

                {leadsUploadMode === 'new' && !leadsPreview && (
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-[#667eea] hover:bg-gray-50 transition-colors"
                    onClick={() => leadsFileInputRef.current?.click()}
                  >
                    <input
                      ref={leadsFileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleLeadsFileChange}
                    />
                    <i className="fas fa-cloud-upload-alt text-3xl sm:text-4xl text-[#667eea] mb-2 sm:mb-3"></i>
                    <p className="font-semibold text-sm sm:text-base text-gray-700">Click to upload or drag and drop</p>
                    <small className="text-xs sm:text-sm text-gray-500">CSV files only</small>
                  </div>
                )}

                {leadsUploadMode === 'existing' && !leadsPreview && (
                  <div className="space-y-3">
                    <select
                      value={selectedExistingLead}
                      onChange={(e) => setSelectedExistingLead(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    >
                      <option value="">Select existing lead file...</option>
                      {existingLeads.map((lead) => (
                        <option key={lead.filename} value={lead.filename}>
                          {lead.filename} {lead.size ? `(${lead.size})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleUseExistingLeads}
                      className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-[#667eea] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-check"></i> Use Selected Leads
                    </button>
                  </div>
                )}

                {leadsPreview && (
                  <div className="bg-gray-50 p-3 sm:p-5 rounded-lg">
                    <h4 className="font-semibold text-sm sm:text-base text-gray-800 mb-2 sm:mb-3">Preview:</h4>
                    <div className="overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: displayLeadsPreviewTable(leadsPreview) }}
                    />
                    <button
                      type="button"
                      onClick={handleRemoveLeads}
                      className="mt-3 sm:mt-4 w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-red-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-trash"></i> Remove Leads
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Template Tab */}
          {activeTab === 'template' && (
            <div className="space-y-4 sm:space-y-5">
              <h4 className="font-semibold text-sm sm:text-base text-gray-800">Upload Email Template for this Campaign:</h4>
              
              <div className="space-y-4">
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="templateUpload"
                      value="new"
                      checked={templateUploadMode === 'new'}
                      onChange={() => setTemplateUploadMode('new')}
                      className="w-5 h-5"
                    />
                    <span>Upload New HTML Template</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="templateUpload"
                      value="existing"
                      checked={templateUploadMode === 'existing'}
                      onChange={() => setTemplateUploadMode('existing')}
                      className="w-5 h-5"
                    />
                    <span>Use Existing Template</span>
                  </label>
                </div>

                {templateUploadMode === 'new' && !templatePreview && (
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-[#667eea] hover:bg-gray-50 transition-colors"
                    onClick={() => templateFileInputRef.current?.click()}
                  >
                    <input
                      ref={templateFileInputRef}
                      type="file"
                      accept=".html"
                      className="hidden"
                      onChange={handleTemplateFileChange}
                    />
                    <i className="fas fa-cloud-upload-alt text-3xl sm:text-4xl text-[#667eea] mb-2 sm:mb-3"></i>
                    <p className="font-semibold text-sm sm:text-base text-gray-700">Click to upload or drag and drop</p>
                    <small className="text-xs sm:text-sm text-gray-500">HTML files only</small>
                  </div>
                )}

                {templateUploadMode === 'existing' && !templatePreview && (
                  <div className="space-y-3">
                    <select
                      value={selectedExistingTemplate}
                      onChange={(e) => setSelectedExistingTemplate(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    >
                      <option value="">Select existing template...</option>
                      {existingTemplates.map((template) => (
                        <option key={template.filename} value={template.filename}>
                          {template.filename}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleUseExistingTemplate}
                      className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-[#667eea] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-check"></i> Use Selected Template
                    </button>
                  </div>
                )}

                {templatePreview && (
                  <div className="bg-gray-50 p-3 sm:p-5 rounded-lg">
                    <h4 className="font-semibold text-sm sm:text-base text-gray-800 mb-2 sm:mb-3">Preview:</h4>
                    <div className="mb-2 sm:mb-3">
                      {templatePreview.includes('track/open?email=') || templatePreview.includes('track/open') ? (
                        <div className="bg-green-100 border border-green-500 rounded-lg p-2 sm:p-3 text-xs sm:text-sm text-green-800">
                          <i className="fas fa-check-circle mr-2"></i>
                          <strong>✅ Tracking Pixel Injected</strong> - Your template includes email open tracking.
                        </div>
                      ) : (
                        <div className="bg-yellow-100 border border-yellow-500 rounded-lg p-2 sm:p-3 text-xs sm:text-sm text-yellow-800">
                          <i className="fas fa-exclamation-triangle mr-2"></i>
                          <strong>⚠️ No Tracking Pixel Found</strong> - Tracking may not work.
                        </div>
                      )}
                    </div>
                    <pre className="bg-gray-900 text-gray-100 p-2 sm:p-4 rounded-lg overflow-x-auto text-xs max-h-40 sm:max-h-60 overflow-y-auto">
                      {templatePreview.length > 500 ? templatePreview.substring(0, 500) + '...' : templatePreview}
                    </pre>
                    <button
                      type="button"
                      onClick={handleRemoveTemplate}
                      className="mt-3 sm:mt-4 w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-red-500 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-trash"></i> Remove Template
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="space-y-4 sm:space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 sm:mb-3">Campaign Start Options:</label>
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="startOption"
                      value="immediate"
                      checked={settings.startOption === 'immediate'}
                      onChange={() => setSettings({ ...settings, startOption: 'immediate' })}
                      className="w-5 h-5"
                    />
                    <span>Start Immediately</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="startOption"
                      value="immediate-daily"
                      checked={settings.startOption === 'immediate-daily'}
                      onChange={() => setSettings({ ...settings, startOption: 'immediate-daily' })}
                      className="w-5 h-5"
                    />
                    <span>Start Immediately + Daily Schedule</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="startOption"
                      value="specific-date"
                      checked={settings.startOption === 'specific-date'}
                      onChange={() => setSettings({ ...settings, startOption: 'specific-date' })}
                      className="w-5 h-5"
                    />
                    <span>Schedule for Specific Date</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="startOption"
                      value="daily"
                      checked={settings.startOption === 'daily'}
                      onChange={() => setSettings({ ...settings, startOption: 'daily' })}
                      className="w-5 h-5"
                    />
                    <span>Daily Schedule</span>
                  </label>
                </div>
              </div>

              {settings.startOption === 'specific-date' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={settings.schedule_date}
                    onChange={(e) => setSettings({ ...settings, schedule_date: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  />
                </div>
              )}

              {(settings.startOption === 'immediate-daily' || settings.startOption === 'daily' || settings.startOption === 'specific-date') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Time</label>
                  <input
                    type="time"
                    value={settings.schedule_time}
                    onChange={(e) => setSettings({ ...settings, schedule_time: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Subject Line *
                </label>
                <input
                  type="text"
                  value={settings.subject_line}
                  onChange={(e) => setSettings({ ...settings, subject_line: e.target.value })}
                  required
                  className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  placeholder="Your email subject..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Daily Limit (emails per sender)
                  </label>
                  <input
                    type="number"
                    value={typeof settings.daily_limit === 'string' ? settings.daily_limit : (settings.daily_limit || 120)}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow user to type freely - don't validate during typing
                      if (value === '') {
                        // Allow empty temporarily for user to clear and type
                        setSettings({ ...settings, daily_limit: '' });
                      } else {
                        const numValue = parseInt(value);
                        // Update with the number if valid, otherwise keep as string for typing (handles partial input like "12")
                        if (!isNaN(numValue)) {
                          setSettings({ ...settings, daily_limit: numValue });
                        } else {
                          // Keep the string value so user can continue typing
                          setSettings({ ...settings, daily_limit: value });
                        }
                      }
                    }}
                    onBlur={(e) => {
                      // Validate and clamp value only when user leaves the field
                      const value = e.target.value;
                      const numValue = parseInt(value);
                      if (isNaN(numValue) || value === '' || numValue < 1) {
                        setSettings({ ...settings, daily_limit: 120 });
                      } else if (numValue > 500) {
                        setSettings({ ...settings, daily_limit: 500 });
                      } else {
                        // Valid value, ensure it's stored as number
                        setSettings({ ...settings, daily_limit: numValue });
                      }
                    }}
                    min="1"
                    max="500"
                    placeholder="120"
                    className="no-spinners w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  />
                  <p className="text-xs text-gray-500 mt-1">Enter a value between 1 and 500 emails per sender per day</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delay between batches (seconds)
                  </label>
                  <select
                    value={settings.delay}
                    onChange={(e) => setSettings({ ...settings, delay: parseInt(e.target.value) })}
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  >
                    <option value="15">15 seconds</option>
                    <option value="30">30 seconds</option>
                    <option value="60">60 seconds</option>
                    <option value="120">120 seconds</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <i className="fas fa-save"></i> Save Settings
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-6 flex justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
          >
            <i className="fas fa-times"></i> Close Setup
          </button>
        </div>
      </div>
    </div>
  );
};
