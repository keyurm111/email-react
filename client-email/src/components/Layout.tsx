import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { showToast } = useToast();

  const navItems = [
    { path: '/dashboard', icon: 'fa-home', label: 'Dashboard' },
    { path: '/senders', icon: 'fa-paper-plane', label: 'Manage Senders' },
    { path: '/campaigns', icon: 'fa-tasks', label: 'Manage Campaigns' },
    { path: '/active-campaign', icon: 'fa-bullseye', label: 'Active Campaign' },
    { path: '/analytics', icon: 'fa-chart-line', label: 'Analytics' },
    { path: '/tracker', icon: 'fa-chart-bar', label: 'Tracker' },
    { path: '/resources', icon: 'fa-folder-open', label: 'Resources' },
    { path: '/requirements', icon: 'fa-clipboard-list', label: 'Requirements' },
    { path: '/profile', icon: 'fa-user', label: 'Profile' },
  ];

  const handleLogout = () => {
    logout();
    showToast('Logged out successfully', 'success');
    setTimeout(() => navigate('/'), 1000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-full w-64 bg-white shadow-lg z-40 transform transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white p-6 text-center">
            <i className="fas fa-envelope-open-text text-3xl mb-2"></i>
            <h2 className="font-semibold text-lg">Email Automation</h2>
          </div>

          <nav className="flex-1 overflow-y-auto py-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-6 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                  location.pathname === item.path ? 'bg-blue-50 text-[#667eea] border-r-2 border-[#667eea]' : ''
                }`}
                onClick={() => setSidebarOpen(false)}
              >
                <i className={`fas ${item.icon} w-5`}></i>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="p-4 border-t border-gray-200">
            <button
              onClick={handleLogout}
              className="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <i className="fas fa-sign-out-alt"></i>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Header */}
        <header className="bg-white shadow-sm sticky top-0 z-20 px-4 py-4 lg:px-8">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-gray-700 hover:text-gray-900"
            >
              <i className="fas fa-bars text-xl"></i>
            </button>
            <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <i className="fas fa-home"></i>
              {navItems.find(item => item.path === location.pathname)?.label || 'Dashboard'}
            </h1>
            <div className="flex items-center gap-2 text-gray-700">
              <span className="hidden sm:block">{user?.username || user?.email}</span>
              <i className="fas fa-user-circle text-2xl"></i>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
};

