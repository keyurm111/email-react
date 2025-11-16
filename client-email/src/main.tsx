import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { testBackendConnection, testTrackerConnection } from './utils/connectionTest.ts'

// Helper function to check if error is from browser extension
const isExtensionError = (error: any): boolean => {
  if (!error) return false;
  const message = error.message || error.toString() || '';
  return (
    message.includes('message channel closed') ||
    message.includes('asynchronous response') ||
    message.includes('Extension context invalidated') ||
    message.includes('runtime.lastError') ||
    error.name === 'AbortError'
  );
};

// Global error handler for unhandled promise rejections (catches extension errors)
window.addEventListener('unhandledrejection', (event) => {
  if (isExtensionError(event.reason)) {
    // Suppress extension-related errors
    event.preventDefault();
    if (import.meta.env.DEV) {
      console.warn('⚠️ Suppressed browser extension error (harmless)');
    }
    return;
  }
  // Log other unhandled rejections in development
  if (import.meta.env.DEV) {
    console.error('Unhandled promise rejection:', event.reason);
  }
});

// Global error handler for runtime errors
window.addEventListener('error', (event) => {
  if (isExtensionError(event.error)) {
    // Suppress extension-related errors
    event.preventDefault();
    if (import.meta.env.DEV) {
      console.warn('⚠️ Suppressed browser extension error (harmless)');
    }
    return false;
  }
});

// Test backend connection on app start (development only)
if (import.meta.env.DEV) {
  console.log('🔍 Testing backend connections...');
  Promise.all([
    testBackendConnection(),
    testTrackerConnection(),
  ]).then(([apiResult, trackerResult]) => {
    console.log('📡 API Server:', apiResult.message);
    console.log('📊 Tracker Server:', trackerResult.message);
    if (!apiResult.success) {
      console.warn(
        '\n⚠️  IMPORTANT: Backend API is not running!\n' +
        '   Please start it with: cd Bulk-email-automation- && python3 run_api_server.py\n'
      );
    }
  }).catch((error) => {
    // Silently handle extension errors during connection test
    if (!isExtensionError(error)) {
      console.error('Connection test error:', error);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register service worker for PWA (only in production & when supported)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        if (import.meta.env.DEV) {
          console.log('Service worker registered:', registration.scope)
        }
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.error('Service worker registration failed:', error)
        }
      })
  })
}

