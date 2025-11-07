{
    name: 'email-backend',
    script: '/root/360/email-react/server-email/run_api_server.py',
    interpreter: '/root/360/email-react/server-email/venv/bin/python3',
    cwd: '/root/360/email-react/server-email',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      API_PORT: 7027,
      DEBUG: 'False',
      MONGO_URI: process.env.MONGO_URI || '',  // Set your MongoDB URI here
      NODE_ENV: 'production'
    },
    error_file: '/root/360/email-react/logs/backend-error.log',
    out_file: '/root/360/email-react/logs/backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }