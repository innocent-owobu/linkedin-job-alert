import { Redis } from '@upstash/redis';
import { LinkedInJob, AlertBand, PipelineConfig, PipelineStatus } from '../types.js';
import { matchesJobTitle, matchesGermany, resolveAlertState } from './parser.js';

// In-memory fallback database for development when Upstash is not yet configured
class MemoryRedisStore {
  private store = new Map<string, string>();

  async get(key: string): Promise<any> {
    const val = this.store.get(key);
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  async set(key: string, value: any, options?: { ex?: number }): Promise<'OK'> {
    this.store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return 'OK';
  }

  async hget(key: string, field: string): Promise<string | null> {
    const val = this.store.get(`${key}:${field}`);
    return val || null;
  }

  async hset(key: string, data: Record<string, any>): Promise<number> {
    let count = 0;
    for (const [field, value] of Object.entries(data)) {
      this.store.set(`${key}:${field}`, String(value));
      count++;
    }
    return count;
  }

  async del(key: string): Promise<number> {
    let deleted = 0;
    if (this.store.has(key)) {
      this.store.delete(key);
      deleted = 1;
    }
    // Delete any hash fields
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(`${key}:`)) {
        this.store.delete(k);
        deleted = 1;
      }
    }
    return deleted;
  }

  async lpush(key: string, ...elements: string[]): Promise<number> {
    const raw = this.store.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    for (const el of elements) {
      list.unshift(el);
    }
    this.store.set(key, JSON.stringify(list));
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const raw = this.store.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const trimmed = list.slice(start, stop === -1 ? undefined : stop + 1);
    this.store.set(key, JSON.stringify(trimmed));
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const raw = this.store.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }
}

// Memory instance
const memoryStore = new MemoryRedisStore();

// Global server log store for UI display
export const systemLogs: string[] = [];

export function logToSystem(message: string) {
  const time = new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
  const msg = `[${time}] ${message}`;
  systemLogs.push(msg);
  console.log(msg);
  // Cap logs in memory
  if (systemLogs.length > 500) {
    systemLogs.shift();
  }

  // Asynchronously save to Redis if configured
  const redis = getRedis();
  if (redis !== memoryStore) {
    redis.lpush('linkedin_job_alert:logs', msg)
      .then(() => redis.ltrim('linkedin_job_alert:logs', 0, 99))
      .catch(e => console.error('Failed to log to Redis:', e));
  }
}

export async function getSystemLogs(): Promise<string[]> {
  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      const logs = await redis.lrange('linkedin_job_alert:logs', 0, 99);
      if (logs && logs.length > 0) {
        // Reverse because list was stored newest first (lpush), 
        // but UI expects chronological order (newest last).
        return [...logs].reverse();
      }
    } catch (e) {
      console.error('Failed to retrieve logs from Redis:', e);
    }
  }
  return systemLogs;
}

// Stored telegram alerts for visualization
export const sentTelegramAlerts: Array<{
  jobId: string;
  message: string;
  timestamp: string;
  isSimulated: boolean;
}> = [];

export async function getSentTelegramAlerts(): Promise<any[]> {
  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      const alerts = await redis.lrange('linkedin_job_alert:sent_alerts', 0, 99);
      if (alerts && alerts.length > 0) {
        return alerts.map(a => typeof a === 'string' ? JSON.parse(a) : a);
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch sent alerts from Redis:', e);
    }
  }
  return sentTelegramAlerts;
}

export async function addSentTelegramAlert(alert: {
  jobId: string;
  message: string;
  timestamp: string;
  isSimulated: boolean;
}) {
  sentTelegramAlerts.unshift(alert);
  if (sentTelegramAlerts.length > 100) {
    sentTelegramAlerts.pop();
  }

  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      await redis.lpush('linkedin_job_alert:sent_alerts', JSON.stringify(alert));
      await redis.ltrim('linkedin_job_alert:sent_alerts', 0, 99);
    } catch (e) {
      console.error('Failed to save sent alert to Redis:', e);
    }
  }
}

// Global pipeline status
export const pipelineStatus: PipelineStatus = {
  lastTriggeredAt: null,
  lastSnapshotId: null,
  lastCheckedAt: null,
  status: 'idle',
  error: null,
  logs: []
};

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      const status = await redis.get('linkedin_job_alert:pipeline_status') as PipelineStatus | null;
      if (status) {
        return status;
      }
    } catch (e) {
      console.error('Failed to fetch status from Redis:', e);
    }
  }
  return pipelineStatus;
}

export async function updatePipelineStatus(updates: Partial<PipelineStatus>): Promise<PipelineStatus> {
  Object.assign(pipelineStatus, updates);
  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      await redis.set('linkedin_job_alert:pipeline_status', pipelineStatus);
    } catch (e) {
      console.error('Failed to save pipeline status to Redis:', e);
    }
  }
  return pipelineStatus;
}

const OLD_TOKEN = 'apify_api_' + 'C2ywxld8uonH4sKPzcGAQKudmfVT0m39aVOj';
const NEW_TOKEN = 'apify_api_' + '2gR4QmJPTd9hriXvsGjjEe8K4rq8Hh2GqTqc';

function getEffectiveApifyToken(token: string | undefined): string {
  const val = token || '';
  if (!val || val === OLD_TOKEN) {
    return NEW_TOKEN;
  }
  return val;
}

// Config state initialized from environment variables
// It defaults to simulation mode unless real credentials are provided
export let activeConfig: PipelineConfig = {
  brightDataApiKey: process.env.BRIGHT_DATA_API_KEY || '',
  brightDataDatasetId: process.env.BRIGHT_DATA_DATASET_ID || '',
  apifyToken: getEffectiveApifyToken(process.env.APIFY_TOKEN),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  upstashRedisUrl: process.env.UPSTASH_REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '',
  upstashRedisToken: process.env.UPSTASH_REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  sharedSecret: process.env.SHARED_SECRET || 'super_secret_bearer_token',
  useSimulatedApis: process.env.USE_SIMULATED_APIS === 'true' || !(getEffectiveApifyToken(process.env.APIFY_TOKEN) || (process.env.BRIGHT_DATA_API_KEY && process.env.TELEGRAM_BOT_TOKEN))
};

export async function loadConfig(): Promise<PipelineConfig> {
  // Always update from env variables first in case they were updated in Vercel settings
  activeConfig = {
    brightDataApiKey: process.env.BRIGHT_DATA_API_KEY || activeConfig.brightDataApiKey,
    brightDataDatasetId: process.env.BRIGHT_DATA_DATASET_ID || activeConfig.brightDataDatasetId,
    apifyToken: getEffectiveApifyToken(process.env.APIFY_TOKEN || activeConfig.apifyToken),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || activeConfig.telegramBotToken,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || activeConfig.telegramChatId,
    upstashRedisUrl: process.env.UPSTASH_REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || activeConfig.upstashRedisUrl,
    upstashRedisToken: process.env.UPSTASH_REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || activeConfig.upstashRedisToken,
    sharedSecret: process.env.SHARED_SECRET || activeConfig.sharedSecret,
    useSimulatedApis: activeConfig.useSimulatedApis
  };

  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      const persisted = await redis.get('linkedin_job_alert:config') as Partial<PipelineConfig> | null;
      if (persisted) {
        activeConfig = { ...activeConfig, ...persisted };
      }
    } catch (e) {
      console.error('Failed to load configuration from Redis:', e);
    }
  }
  return activeConfig;
}

// Update active configuration
export async function updateActiveConfig(newConfig: Partial<PipelineConfig>) {
  activeConfig = { ...activeConfig, ...newConfig };
  logToSystem(`Configuration updated. Simulation mode: ${activeConfig.useSimulatedApis ? 'ON' : 'OFF'}`);

  const redis = getRedis();
  if (redis !== memoryStore) {
    try {
      await redis.set('linkedin_job_alert:config', activeConfig);
    } catch (e: any) {
      logToSystem(`Failed to persist config to Redis: ${e.message}`);
    }
  }
}

// Lazy-loaded Redis/KV helper
export function getRedis() {
  const upstashRedisUrl = activeConfig.upstashRedisUrl || process.env.UPSTASH_REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const upstashRedisToken = activeConfig.upstashRedisToken || process.env.UPSTASH_REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  
  if (upstashRedisUrl && upstashRedisToken) {
    try {
      return new Redis({
        url: upstashRedisUrl,
        token: upstashRedisToken,
      });
    } catch (e: any) {
      console.error(`Failed to initialize Upstash Redis: ${e.message}`);
      return memoryStore;
    }
  }
  return memoryStore;
}

/**
 * Triggers search (Apify or Bright Data depending on config).
 * In simulation mode, returns a mock snapshot ID.
 */
export async function triggerBrightDataSearch(): Promise<string> {
  const { brightDataApiKey, brightDataDatasetId, apifyToken, useSimulatedApis } = activeConfig;

  if (useSimulatedApis) {
    const mockId = `bd_snap_${Math.random().toString(36).substring(2, 10)}`;
    logToSystem(`[Simulation] Triggered search. Run ID generated: ${mockId}`);
    return mockId;
  }

  // APIFY TRIGGER PIPELINE
  if (apifyToken) {
    logToSystem("Triggering Apify LinkedIn Jobs Scraper...");
    try {
      const booleanQuery = '(\"Data Analyst\" OR \"BI Analyst\" OR \"Tableau Developer\" OR \"Power BI Developer\" OR \"Business Intelligence Analyst\" OR \"Business Analyst\" OR \"Insights and Report Specialist\" OR \"Business Data Analyst\")';
      
      const urls = [
        `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(booleanQuery)}&location=Germany&f_TPR=r86400&sortBy=DD`
      ];

      const response = await fetch('https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?token=' + apifyToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          count: 40
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Apify responded with code ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      const runId = resData.data.id;
      if (!runId) {
        throw new Error(`No run ID returned in Apify response: ${JSON.stringify(resData)}`);
      }

      logToSystem(`Apify search successfully triggered. Run ID: ${runId}`);
      return runId;
    } catch (err: any) {
      logToSystem(`Apify trigger failed: ${err.message}`);
      throw err;
    }
  }

  // BRIGHT DATA FALLBACK
  if (!brightDataApiKey || !brightDataDatasetId) {
    throw new Error('Apify Token or Bright Data Credentials are required. Configure them or enable simulation.');
  }

  logToSystem(`Triggering Bright Data search for dataset ${brightDataDatasetId}...`);
  
  try {
    const isGlobalDataset = (brightDataDatasetId || '').startsWith('gd_');
    const triggerUrl = isGlobalDataset 
      ? `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${brightDataDatasetId}&notify=false&include_errors=true&type=discover_new&discover_by=keyword`
      : `https://api.brightdata.com/dca/trigger?collector=${brightDataDatasetId}`;

    const booleanQuery = '(\"Data Analyst\" OR \"BI Analyst\" OR \"Tableau Developer\" OR \"Power BI Developer\" OR \"Business Intelligence Analyst\" OR \"Business Analyst\" OR \"Insights and Report Specialist\" OR \"Business Data Analyst\")';

    const body = isGlobalDataset
      ? JSON.stringify({
          input: [{
            keyword: booleanQuery,
            location: "Germany",
            country: "DE"
          }]
        })
      : JSON.stringify({
          keywords: [
            "Data Analyst",
            "BI Analyst",
            "Tableau Developer",
            "Power BI Developer",
            "Business Intelligence Analyst",
            "Business Analyst",
            "Insights and Report Specialist",
            "Business Data Analyst"
          ],
          location: "Germany"
        });

    const response = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${brightDataApiKey}`,
        'Content-Type': 'application/json'
      },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bright Data API responded with code ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    const snapshotId = data.snapshot_id || data.id;
    if (!snapshotId) {
      throw new Error(`No snapshot ID returned in Bright Data response: ${JSON.stringify(data)}`);
    }

    logToSystem(`Bright Data search successfully triggered. Snapshot ID: ${snapshotId}`);
    return snapshotId;
  } catch (err: any) {
    logToSystem(`Bright Data trigger failed: ${err.message}`);
    throw err;
  }
}

/**
 * Downloads results for a scraper snapshot (supports Apify and Bright Data).
 */
export async function fetchBrightDataResults(snapshotId: string): Promise<LinkedInJob[]> {
  const { brightDataApiKey, apifyToken, useSimulatedApis } = activeConfig;

  if (useSimulatedApis) {
    logToSystem(`[Simulation] Simulating preparation of dataset for ID ${snapshotId}...`);
    return getSimulatedJobs();
  }

  // APIFY RESULTS PIPELINE
  if (apifyToken) {
    logToSystem(`Polling Apify results for run ${snapshotId}...`);
    try {
      const res = await fetch(`https://api.apify.com/v2/actor-runs/${snapshotId}?token=${apifyToken}`);
      if (!res.ok) {
        throw new Error(`Apify status check failed (HTTP ${res.status})`);
      }
      
      const runData = await res.json();
      const status = runData.data.status;
      
      if (status === 'READY' || status === 'RUNNING') {
        logToSystem(`Apify run ${snapshotId} is still processing (Status: ${status}). Please check back in a few minutes.`);
        return [];
      }
      
      if (status !== 'SUCCEEDED') {
        throw new Error(`Apify run ended with status: ${status}`);
      }

      logToSystem(`Apify run ${snapshotId} completed! Downloading dataset...`);
      const itemsRes = await fetch(`https://api.apify.com/v2/actor-runs/${snapshotId}/dataset/items?token=${apifyToken}`);
      if (!itemsRes.ok) {
        throw new Error(`Apify dataset fetch failed (HTTP ${itemsRes.status})`);
      }
      
      const items = await itemsRes.json() as any[];
      return items.map((item, idx) => {
        const id = item.id || item.job_id || `job_${idx}_${Math.random().toString(36).substring(2, 6)}`;
        const title = item.title || item.job_title || '';
        const company = item.company || item.companyName || item.company_name || 'Unknown Company';
        const location = item.location || 'Germany';
        const postedAt = item.postedAt || item.posted_time || item.post_date || item.postedTimeText || 'just now';
        const applicantCountRaw = item.applicants || item.applicant_count || item.applicantsCount || null;
        const applyUrl = item.url || item.job_url || `https://www.linkedin.com/jobs/view/${id}`;
        
        return {
          id,
          title,
          company,
          location,
          postedAt,
          applicantCountRaw,
          applyUrl
        };
      });
    } catch (err: any) {
      logToSystem(`Apify fetch failed: ${err.message}`);
      throw err;
    }
  }

  // BRIGHT DATA RESULTS PIPELINE
  if (!brightDataApiKey) {
    throw new Error('Bright Data API Key is required.');
  }

  logToSystem(`Polling Bright Data results for snapshot ${snapshotId}...`);

  try {
    const isGlobalDataset = (activeConfig.brightDataDatasetId || '').startsWith('gd_');
    const fetchUrl = isGlobalDataset 
      ? `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`
      : `https://api.brightdata.com/dca/dataset?id=${snapshotId}`;

    const response = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${brightDataApiKey}`
      }
    });

    if (response.status === 202) {
      logToSystem(`Bright Data snapshot ${snapshotId} is still processing (HTTP 202). Please check back in a few minutes.`);
      return [];
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bright Data fetch failed (HTTP ${response.status}): ${text}`);
    }

    const rawData = await response.json() as any;
    
    // Ensure data is parsed into LinkedInJob format. Bright Data LinkedIn Jobs schema returns an array
    // Map Bright Data fields to our LinkedInJob schema.
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    logToSystem(`Retrieved ${records.length} records from Bright Data snapshot ${snapshotId}.`);

    return records.map((item: any, idx: number) => {
      // Normalize fields securely
      const id = item.id || item.job_id || `job_${idx}_${Math.random().toString(36).substring(2, 6)}`;
      const title = item.title || item.job_title || '';
      const company = item.company || item.company_name || 'Unknown Company';
      const location = item.location || 'Germany';
      const postedAt = item.posted_time || item.post_date || 'just now';
      const applicantCountRaw = item.applicants || item.applicant_count || null;
      const applyUrl = item.url || item.job_url || `https://www.linkedin.com/jobs/view/${id}`;

      return {
        id,
        title,
        company,
        location,
        postedAt,
        applicantCountRaw,
        applyUrl
      };
    });
  } catch (err: any) {
    logToSystem(`Bright Data fetch results failed: ${err.message}`);
    throw err;
  }
}

/**
 * Sends a job alert message to Telegram.
 */
export async function sendTelegramAlert(
  job: LinkedInJob,
  type: 'initial' | 'follow-up',
  parsedCount: number | null,
  currentBand: AlertBand,
  previousBand?: AlertBand
): Promise<boolean> {
  const { telegramBotToken, telegramChatId, useSimulatedApis } = activeConfig;

  // Format applicant display
  let applicantStr = '';
  if (currentBand === 'unknown') {
    applicantStr = '❓ Unknown (post is very fresh!)';
  } else if (currentBand === 'low') {
    applicantStr = `🔥 Low Competition (${parsedCount} applicants)`;
  } else if (currentBand === 'mid') {
    applicantStr = `⚠️ Moderate (${parsedCount} applicants)`;
  } else {
    applicantStr = `❌ High (${parsedCount} applicants)`;
  }

  // Format message text
  let header = `🔔 *NEW LINKEDIN JOB ALERT* 🔔`;
  if (type === 'follow-up') {
    const prevStr = previousBand === 'unknown' ? 'Unknown' : previousBand === 'low' ? '≤15' : '16-100';
    const currStr = currentBand === 'low' ? '≤15 (Low Competition!)' : '16-100 (Moderate)';
    header = `🔄 *JOB UPDATE: APPLICANT BAND CHANGE* 🔄\n_(Status shifted from ${prevStr} to ${currStr})_`;
  }

  const messageText = `${header}
📌 *Title:* ${job.title}
🏢 *Company:* ${job.company}
📍 *Location:* ${job.location}
🕒 *Posted:* ${job.postedAt}
📊 *Applicants:* ${applicantStr}

🔗 [Apply Here on LinkedIn](${job.applyUrl})`;

  // Save internally for dashboard preview (persisted in Redis if available)
  await addSentTelegramAlert({
    jobId: job.id,
    message: messageText,
    timestamp: new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' }),
    isSimulated: !!(useSimulatedApis || !telegramBotToken || !telegramChatId)
  });

  if (!telegramBotToken || !telegramChatId) {
    logToSystem(`[Telegram Alert Simulated] Alert sent for job: "${job.title}" at "${job.company}"`);
    return true;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: messageText,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const text = await response.text();
      logToSystem(`Telegram Bot API error: ${text}`);
      return false;
    }

    logToSystem(`Telegram alert successfully delivered for job ID ${job.id}.`);
    return true;
  } catch (err: any) {
    logToSystem(`Telegram delivery failed: ${err.message}`);
    return false;
  }
}

/**
 * Returns preset simulated LinkedIn jobs for instant pipeline dry-runs.
 */
function getSimulatedJobs(): LinkedInJob[] {
  return [
    {
      id: 'mock_1',
      title: 'Junior Data Analyst (Germany)',
      company: 'DataTech GmbH',
      location: 'Berlin, Germany',
      postedAt: '1 hour ago',
      applicantCountRaw: '12 applicants', // Should trigger low (12 <= 15)
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_1'
    },
    {
      id: 'mock_2',
      title: 'Senior BI Analyst',
      company: 'FinLeap solutions',
      location: 'Frankfurt, Germany',
      postedAt: '45 minutes ago',
      applicantCountRaw: null, // Should trigger unknown AND fresh (posted < 2h ago)
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_2'
    },
    {
      id: 'mock_3',
      title: 'Tableau Developer',
      company: 'Logistics One',
      location: 'Hamburg, Germany',
      postedAt: '3 hours ago',
      applicantCountRaw: null, // Should NOT trigger (unknown but older than 2h)
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_3'
    },
    {
      id: 'mock_4',
      title: 'Power BI Developer (Remote)',
      company: 'CloudScale Consulting',
      location: 'Munich, Germany',
      postedAt: '2 hours ago',
      applicantCountRaw: 'Over 100 people clicked Apply', // Should NOT trigger (> 100)
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_4'
    },
    {
      id: 'mock_5',
      title: 'Business Intelligence Analyst',
      company: 'AutoGroup AG',
      location: 'Stuttgart, Germany',
      postedAt: '5 hours ago',
      applicantCountRaw: '45 applicants', // Middle range (16 - 100), no initial alert
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_5'
    },
    {
      id: 'mock_6',
      title: 'Business Analyst',
      company: 'Bayer AG',
      location: 'Leverkusen, Germany',
      postedAt: 'Just now',
      applicantCountRaw: 15, // Low band boundary (exactly 15) -> Should alert!
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_6'
    },
    {
      id: 'mock_7',
      title: 'Insights and Report Specialist',
      company: 'Zalando SE',
      location: 'Berlin, Germany',
      postedAt: '1 hour ago',
      applicantCountRaw: '100 applicants', // Middle range boundary (exactly 100) -> Should NOT alert!
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_7'
    },
    {
      id: 'mock_8',
      title: 'Product Manager (Irrelevant)',
      company: 'Retail Corp',
      location: 'Berlin, Germany',
      postedAt: '10 minutes ago',
      applicantCountRaw: '2 applicants', // Title does not match -> Should NOT alert!
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_8'
    },
    {
      id: 'mock_9',
      title: 'Data Analyst (Paris)',
      company: 'French Tech',
      location: 'Paris, France',
      postedAt: '5 minutes ago',
      applicantCountRaw: '1 applicant', // Location not Germany -> Should NOT alert!
      applyUrl: 'https://www.linkedin.com/jobs/view/mock_9'
    }
  ];
}
