export interface LinkedInJob {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string; // ISO string or human-readable like "2 hours ago"
  postedAtTimestamp?: number; // epoch ms
  applicantCountRaw?: string | number | null;
  applicantCountParsed?: number | null;
  applyUrl: string;
}

export type AlertBand = 'low' | 'mid' | 'high' | 'unknown';

export interface JobState {
  jobId: string;
  lastAlertedBand: AlertBand;
  lastAlertedAt: string;
  applicantCount: number | null;
}

export interface PipelineConfig {
  brightDataApiKey: string;
  brightDataDatasetId: string;
  telegramBotToken: string;
  telegramChatId: string;
  upstashRedisUrl: string;
  upstashRedisToken: string;
  sharedSecret: string;
  useSimulatedApis: boolean;
}

export interface PipelineStatus {
  lastTriggeredAt: string | null;
  lastSnapshotId: string | null;
  lastCheckedAt: string | null;
  status: 'idle' | 'triggered' | 'checking' | 'completed' | 'error';
  error: string | null;
  logs: string[];
}
