import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { testBackendConnection, testTrackerConnection } from './utils/connectionTest.ts'

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
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
