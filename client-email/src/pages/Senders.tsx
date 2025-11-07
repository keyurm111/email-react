import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { sendersApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import type { Sender } from '../types';

export const Senders = () => {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [gmailFormOpen, setGmailFormOpen] = useState(false);
  const [smtpFormOpen, setSmtpFormOpen] = useState(false);
  const [editingSender, setEditingSender] = useState<Sender | null>(null);
  const [testingEmail, setTestingEmail] = useState<string | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [showPassword, setShowPassword] = useState<{ [key: string]: boolean }>({});
  const { showToast } = useToast();

  useEffect(() => {
    loadSenders();
    // Check URL params for auto-open
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'add') {
      setGmailFormOpen(true);
    }
  }, []);

  const loadSenders = async () => {
    try {
      setLoading(true);
      const result = await sendersApi.getSenders();
      const senders = (result as any).senders || result.data?.senders || [];
      if (result.success) {
        setSenders(senders);
        return true;
      } else {
        showToast('Error loading senders', 'error');
        return false;
      }
    } catch (error: any) {
      console.error('Error loading senders:', error);
      showToast('Error loading senders', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = (fieldId: string) => {
    setShowPassword(prev => ({ ...prev, [fieldId]: !prev[fieldId] }));
  };

  const handleAddGmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = (formData.get('email') as string).trim();
    const password = formData.get('password') as string;
    const name = (formData.get('name') as string).trim();

    if (!email || !password) {
      showToast('Please enter both email and password', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    }

    try {
      const result = await sendersApi.addGmailSender(email, password, name);
      if (result.success) {
        showToast('✅ Gmail sender added successfully!', 'success');
        if (form && typeof form.reset === 'function') {
          form.reset();
        }
        await loadSenders();
      } else {
        showToast('❌ ' + (result.message || 'Error adding sender'), 'error');
      }
    } catch (error: any) {
      console.error('Error adding sender:', error);
      showToast('❌ Error adding sender: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-plus"></i> Add Sender';
      }
    }
  };

  const handleAddSmtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const senderData: Partial<Sender> = {
      email: (formData.get('email') as string).trim(),
      name: (formData.get('name') as string).trim(),
      smtp_host: (formData.get('smtp_host') as string).trim(),
      smtp_port: parseInt(formData.get('smtp_port') as string || '587'),
      smtp_user: (formData.get('smtp_user') as string).trim(),
      smtp_password: formData.get('smtp_password') as string,
      use_tls: formData.get('use_tls') === 'on' || formData.get('use_tls') === 'true',
      use_ssl: formData.get('use_ssl') === 'on' || formData.get('use_ssl') === 'true',
      type: 'smtp',
    };

    if (!senderData.email || !senderData.smtp_host || !senderData.smtp_user || !senderData.smtp_password) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      const result = await sendersApi.addSmtpSender(senderData);
      if (result.success) {
        showToast('✅ SMTP sender added successfully!', 'success');
        if (form && typeof form.reset === 'function') {
          form.reset();
        }
        await loadSenders();
      } else {
        showToast('❌ ' + (result.message || 'Error adding SMTP sender'), 'error');
      }
    } catch (error: any) {
      console.error('Error adding SMTP sender:', error);
      showToast('❌ Error adding SMTP sender: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Sender';
      }
    }
  };

  const handleTestSmtpConnection = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const form = (e.currentTarget.closest('form') as HTMLFormElement);
    if (!form) return;

    const formData = new FormData(form);
    const smtpData: Partial<Sender> = {
      smtp_host: (formData.get('smtp_host') as string).trim(),
      smtp_port: parseInt(formData.get('smtp_port') as string || '587'),
      smtp_user: (formData.get('smtp_user') as string).trim(),
      smtp_password: formData.get('smtp_password') as string,
      use_tls: formData.get('use_tls') === 'on' || formData.get('use_tls') === 'true',
      use_ssl: formData.get('use_ssl') === 'on' || formData.get('use_ssl') === 'true',
    };

    if (!smtpData.smtp_host || !smtpData.smtp_user || !smtpData.smtp_password) {
      showToast('Please fill in all SMTP fields', 'error');
      return;
    }

    setTestingSmtp(true);
    showToast('Testing SMTP connection...', 'info');

    try {
      const result = await sendersApi.testSmtpConnection(smtpData);
      if (result.success && result.healthy) {
        showToast('✅ SMTP connection successful!', 'success');
      } else {
        showToast('❌ SMTP connection failed: ' + (result.message || 'Unknown error'), 'error');
      }
    } catch (error: any) {
      showToast('❌ SMTP connection failed: ' + error.message, 'error');
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleEdit = (sender: Sender) => {
    setEditingSender(sender);
    if (sender.type === 'gmail') {
      setGmailFormOpen(true);
    } else {
      setSmtpFormOpen(true);
    }
  };

  const handleCloseEdit = () => {
    setEditingSender(null);
    setGmailFormOpen(false);
    setSmtpFormOpen(false);
  };

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!editingSender) return;
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      let result;
      
      if (editingSender.type === 'gmail') {
        const updateData = {
          email: (formData.get('email') as string).trim(),
          password: formData.get('password') as string,
          name: (formData.get('name') as string).trim(),
          type: 'gmail' as const,
        };
        result = await sendersApi.updateSender(editingSender.email, updateData);
      } else {
        const updateData: Partial<Sender> = {
          email: (formData.get('email') as string).trim() || editingSender.email,
          name: (formData.get('name') as string).trim() || editingSender.email,
          smtp_host: (formData.get('smtp_host') as string).trim(),
          smtp_port: parseInt(formData.get('smtp_port') as string || '587'),
          smtp_user: (formData.get('smtp_user') as string).trim(),
          smtp_password: formData.get('smtp_password') as string,
          use_tls: (formData.get('use_tls') as string) === 'on' || (formData.get('use_tls') as string) === 'true',
          use_ssl: (formData.get('use_ssl') as string) === 'on' || (formData.get('use_ssl') as string) === 'true',
          type: 'smtp' as const,
        };
        result = await sendersApi.updateSender(editingSender.email, updateData);
      }

      if (result.success) {
        showToast('Sender updated successfully!', 'success');
        handleCloseEdit();
        await loadSenders();
      } else {
        showToast(result.message || 'Error updating sender', 'error');
      }
    } catch (error: any) {
      console.error('Error updating sender:', error);
      showToast('Error updating sender: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Changes';
      }
    }
  };

  const handleDelete = async (email: string) => {
    if (!confirm(`Are you sure you want to delete sender: ${email}?`)) return;
    try {
      const result = await sendersApi.deleteSender(email);
      if (result.success) {
        showToast('Sender deleted successfully', 'success');
        await loadSenders();
      } else {
        showToast('Error deleting sender', 'error');
      }
    } catch (error: any) {
      showToast('Error deleting sender: ' + error.message, 'error');
    }
  };

  const handleTest = async (email: string) => {
    setTestingEmail(email);
    showToast('Testing sender...', 'info');
    try {
      const result = await sendersApi.testSender(email);
      if (result.success && result.healthy) {
        showToast('Sender is healthy!', 'success');
      } else {
        showToast('Sender check failed: ' + result.message, 'error');
      }
    } catch (error: any) {
      showToast('Error testing sender: ' + error.message, 'error');
    } finally {
      setTestingEmail(null);
    }
  };

  return (
    <Layout>
      {/* Add Gmail Sender */}
      <section className="bg-white rounded-xl shadow-md mb-4 sm:mb-6">
        <div className={`border-b ${gmailFormOpen ? 'border-gray-200' : ''}`}>
          <div
            className="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between select-none"
            onClick={() => setGmailFormOpen(!gmailFormOpen)}
          >
            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-base sm:text-lg">
              <i className="fas fa-plus-circle"></i> 
              <span className="hidden sm:inline">Add New Gmail Sender</span>
              <span className="sm:hidden">Gmail Sender</span>
            </h3>
            <i className={`fas fa-chevron-down transition-transform duration-300 text-sm ${gmailFormOpen ? 'transform rotate-180' : ''}`}></i>
          </div>
        </div>
        {gmailFormOpen && (
          <div className="p-4 sm:p-6">
            <form onSubmit={editingSender?.type === 'gmail' ? handleUpdate : handleAddGmail} className="space-y-4 sm:space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sender Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    defaultValue={editingSender?.email || ''}
                    disabled={!!editingSender}
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="your@gmail.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sender Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingSender?.name || ''}
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="e.g., John Doe, Company Name"
                  />
                  <small className="text-gray-500 text-xs mt-1 block">This will appear as the sender name in emails</small>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gmail App Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword['gmailPassword'] ? 'text' : 'password'}
                    name="password"
                    defaultValue={editingSender?.password || ''}
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] pr-10 sm:pr-12"
                    placeholder="16-character app password"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('gmailPassword')}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 sm:px-3 py-1 text-gray-600 hover:text-gray-800"
                  >
                    <i className={`fas text-sm ${showPassword['gmailPassword'] ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
                <small className="text-gray-500 text-xs mt-1 block">
                  <i className="fas fa-info-circle mr-1"></i>
                  Enter your Gmail app password. Spaces are allowed and will be preserved.
                </small>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <strong className="text-blue-900 block mb-2 text-sm sm:text-base">💡 App Password Tips:</strong>
                <ul className="list-disc list-inside text-xs sm:text-sm text-blue-800 space-y-1">
                  <li>Use Gmail app passwords (not your regular password)</li>
                  <li>Spaces in app passwords are allowed</li>
                  <li>Enable 2-factor authentication first</li>
                </ul>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                type="submit"
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <i className="fas fa-plus"></i>
                {editingSender ? 'Update Sender' : 'Add Sender'}
              </button>
              {editingSender && (
                <button
                  type="button"
                  onClick={handleCloseEdit}
                    className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              )}
              </div>
            </form>
          </div>
        )}
      </section>

      {/* Add SMTP Sender */}
      <section className="bg-white rounded-xl shadow-md mb-4 sm:mb-6">
        <div className={`border-b ${smtpFormOpen ? 'border-gray-200' : ''}`}>
          <div
            className="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between select-none"
            onClick={() => setSmtpFormOpen(!smtpFormOpen)}
          >
            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-base sm:text-lg">
              <i className="fas fa-server"></i> 
              <span className="hidden sm:inline">Add Custom SMTP Sender</span>
              <span className="sm:hidden">SMTP Sender</span>
            </h3>
            <i className={`fas fa-chevron-down transition-transform duration-300 text-sm ${smtpFormOpen ? 'transform rotate-180' : ''}`}></i>
          </div>
        </div>
        {smtpFormOpen && (
          <div className="p-4 sm:p-6">
            <form onSubmit={editingSender?.type === 'smtp' ? handleUpdate : handleAddSmtp} className="space-y-4 sm:space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sender Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    defaultValue={editingSender?.email || ''}
                    disabled={!!editingSender}
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="your@domain.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sender Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingSender?.name || ''}
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="e.g., Sales Team"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Host *
                  </label>
                  <input
                    type="text"
                    name="smtp_host"
                    defaultValue={editingSender?.smtp_host || ''}
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="smtp.hostinger.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Port *
                  </label>
                  <input
                    type="number"
                    name="smtp_port"
                    defaultValue={editingSender?.smtp_port || 587}
                    min="1"
                    max="65535"
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="587"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Username *
                  </label>
                  <input
                    type="text"
                    name="smtp_user"
                    defaultValue={editingSender?.smtp_user || ''}
                    required
                    className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword['smtpPassword'] ? 'text' : 'password'}
                      name="smtp_password"
                      defaultValue={editingSender?.smtp_password || ''}
                      required
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] pr-10 sm:pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('smtpPassword')}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 sm:px-3 py-1 text-gray-600 hover:text-gray-800"
                    >
                      <i className={`fas text-sm ${showPassword['smtpPassword'] ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="use_tls"
                    defaultChecked={editingSender?.use_tls !== false}
                    className="w-4 h-4 sm:w-5 sm:h-5 rounded border-gray-300 text-[#667eea] focus:ring-[#667eea]"
                  />
                  <span className="text-sm font-medium text-gray-700">Use TLS</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="use_ssl"
                    defaultChecked={editingSender?.use_ssl || false}
                    className="w-4 h-4 sm:w-5 sm:h-5 rounded border-gray-300 text-[#667eea] focus:ring-[#667eea]"
                  />
                  <span className="text-sm font-medium text-gray-700">Use SSL</span>
                </label>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handleTestSmtpConnection}
                  disabled={testingSmtp}
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <i className={`fas ${testingSmtp ? 'fa-spinner fa-spin' : 'fa-vial'}`}></i>
                  Test Connection
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  <i className="fas fa-save"></i>
                  {editingSender ? 'Update Sender' : 'Save Sender'}
                </button>
                {editingSender && (
                  <button
                    type="button"
                    onClick={handleCloseEdit}
                    className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>

      {/* Sender List */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
          <i className="fas fa-list"></i> Your Sender Emails
        </h2>
        {loading ? (
          <div className="text-center py-6 sm:py-8">
            <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
          </div>
        ) : senders.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <i className="fas fa-inbox text-3xl sm:text-4xl mb-2"></i>
            <p className="text-sm sm:text-base">No senders added yet. Add your first sender above.</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {senders.map((sender) => {
              const hasSpaces = sender.type === 'gmail' && sender.password && sender.password.includes(' ');
              return (
                <div
                  key={sender.email}
                  className="border-l-4 border-[#667eea] bg-white rounded-lg shadow-sm p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:shadow-md transition-shadow"
                >
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center text-white text-lg sm:text-xl flex-shrink-0">
                    <i className={`fas ${sender.type === 'gmail' ? 'fa-envelope' : 'fa-server'}`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm sm:text-base text-gray-800 truncate">{sender.email}</h4>
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold flex-shrink-0 ${
                          sender.type === 'gmail'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {sender.type.toUpperCase()}
                      </span>
                      {hasSpaces && (
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-yellow-100 text-yellow-800 flex-shrink-0">
                          Has Spaces
                        </span>
                      )}
                    </div>
                    {sender.name && (
                      <p className="text-xs sm:text-sm text-gray-600 mb-1">
                        <i className="fas fa-user mr-1"></i>
                        {sender.name}
                      </p>
                    )}
                    {sender.type === 'smtp' && (
                      <p className="text-xs sm:text-sm text-gray-600 truncate">
                        <i className="fas fa-server mr-1"></i>
                        {sender.smtp_host}:{sender.smtp_port}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 self-start sm:self-auto">
                    <button
                      onClick={() => handleTest(sender.email)}
                      disabled={testingEmail === sender.email}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex items-center justify-center disabled:opacity-50"
                      title="Test Sender"
                    >
                      {testingEmail === sender.email ? (
                        <i className="fas fa-spinner fa-spin text-sm"></i>
                      ) : (
                        <i className="fas fa-vial text-sm"></i>
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(sender)}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors flex items-center justify-center"
                      title="Edit Sender"
                    >
                      <i className="fas fa-edit text-sm"></i>
                    </button>
                    <button
                      onClick={() => handleDelete(sender.email)}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center"
                      title="Delete Sender"
                    >
                      <i className="fas fa-trash text-sm"></i>
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
