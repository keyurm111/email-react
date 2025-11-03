export interface User {
  user_id: string;
  username: string;
  email: string;
}

export interface Sender {
  email: string;
  name?: string;
  password?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  use_tls?: boolean;
  use_ssl?: boolean;
  type: 'gmail' | 'smtp';
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  created_at: string;
  selected_senders?: string[];
  leads_file?: string;
  template_file?: string;
  subject_line?: string;
  daily_limit?: number;
  delay?: number;
  schedule_enabled?: boolean;
  schedule_time?: string;
  stats?: {
    total_leads: number;
    total_sent: number;
    total_failed: number;
  };
  history?: {
    sent?: string[];
    failed?: string[];
  };
}

export interface CampaignLog {
  timestamp: string;
  level: string;
  message: string;
}

export interface TrackerCampaign {
  name: string;
  opens: number;
  clicks: number;
}

export interface TrackerEvent {
  email: string;
  event_type: 'open' | 'click';
  timestamp: string;
  campaign: string;
  link_url?: string;
}

export interface Requirement {
  id: string;
  description: string;
  status: string;
  created_at: string;
}

