import express, { Request, Response } from 'express';
import path from 'path';
import { 
  activeConfig, 
  updateActiveConfig, 
  loadConfig,
  getRedis, 
  triggerBrightDataSearch, 
  fetchBrightDataResults, 
  sendTelegramAlert, 
  getSystemLogs, 
  logToSystem, 
  getSentTelegramAlerts, 
  getPipelineStatus,
  updatePipelineStatus
} from '../src/utils/backend.js';
import { resolveAlertState, parseApplicantCount, getAlertBand, isPostedWithinHours, matchesJobTitle, matchesGermany } from '../src/utils/parser.js';
import { LinkedInJob, AlertBand } from '../src/types.js';

const app = express();
const PORT = 3000;

app.use(express.json());

// Middleware to dynamically load configurations from Redis
app.use(async (req, res, next) => {
  try {
    await loadConfig();
  } catch (err) {
    console.error('Failed to load config in middleware:', err);
  }
  next();
});

// Security middleware to validate Bearer token
function authenticate(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  const secret = activeConfig.sharedSecret || 'super_secret_bearer_token';
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logToSystem(`Unauthorized access attempt from IP ${req.ip} - Missing Bearer Token`);
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer Token' });
    return;
  }
  
  const token = authHeader.split(' ')[1];
  if (token !== secret) {
    logToSystem(`Unauthorized access attempt from IP ${req.ip} - Incorrect Bearer Token`);
    res.status(401).json({ error: 'Unauthorized: Incorrect Bearer Token' });
    return;
  }
  
  next();
}

// ==========================================
// API PIPELINE ENDPOINTS
// ==========================================

/**
 * 1. TRIGGER ENDPOINT
 * POST /api/trigger
 * Triggers Bright Data search and stores the snapshot/job ID in Redis.
 */
app.post('/api/trigger', authenticate, async (req: Request, res: Response) => {
  logToSystem(`CRON TRIGGERED: Step 1 (Triggering Bright Data search)`);
  await updatePipelineStatus({ status: 'triggered' });
  
  try {
    const snapshotId = await triggerBrightDataSearch();
    const redis = getRedis();
    
    // Store pending snapshot ID in Redis
    await redis.set('linkedin_job_alert:current_snapshot', {
      id: snapshotId,
      triggeredAt: new Date().toISOString()
    });
    
    await updatePipelineStatus({
      lastTriggeredAt: new Date().toISOString(),
      lastSnapshotId: snapshotId,
      status: 'idle',
      error: null
    });
    
    logToSystem(`Step 1 Complete: Snapshot ${snapshotId} saved to Redis.`);
    res.json({ 
      success: true, 
      message: 'Bright Data search triggered successfully.', 
      snapshotId 
    });
  } catch (err: any) {
    await updatePipelineStatus({
      status: 'error',
      error: err.message
    });
    logToSystem(`Step 1 Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 2. CHECK ALERTS ENDPOINT
 * POST /api/check-alerts
 * Running ~8-10 mins later. Downloads results, applies filters, alerts via Telegram, updates Redis state.
 */
app.post('/api/check-alerts', authenticate, async (req: Request, res: Response) => {
  logToSystem(`CRON TRIGGERED: Step 2 (Checking Snapshot & Sending Telegram Alerts)`);
  await updatePipelineStatus({ status: 'checking' });
  
  try {
    const redis = getRedis();
    
    // 1. Retrieve the pending snapshot ID
    const pendingData = await redis.get('linkedin_job_alert:current_snapshot') as any;
    
    if (!pendingData || !pendingData.id) {
      logToSystem(`Step 2 Aborted: No pending snapshot ID found in Redis. Execute trigger (Step 1) first.`);
      await updatePipelineStatus({ status: 'idle' });
      res.status(400).json({ 
        success: false, 
        message: 'No pending snapshot ID found in Redis. Step 1 must run first.' 
      });
      return;
    }
    
    const snapshotId = pendingData.id;
    logToSystem(`Retrieving results for pending snapshot ID: ${snapshotId}`);
    
    // 2. Fetch crawled jobs from Bright Data
    const jobs = await fetchBrightDataResults(snapshotId);
    
    if (jobs.length === 0) {
      logToSystem(`Step 2 Deferred: Snapshot results are not ready yet or returned empty.`);
      await updatePipelineStatus({ status: 'idle' });
      res.json({ 
        success: true, 
        message: 'Snapshot is still processing in Bright Data. Will re-check on next schedule run.', 
        ready: false 
      });
      return;
    }
    
    // 3. Process jobs against matching rules and applicant count bands
    let matchedCount = 0;
    let alertedCount = 0;
    const details: any[] = [];
    
    for (const job of jobs) {
      const isTitleMatch = matchesJobTitle(job.title);
      const isLocationMatch = matchesGermany(job.location);
      
      if (!isTitleMatch || !isLocationMatch) {
        continue; // Skip irrelevant postings
      }
      
      matchedCount++;
      const redisKey = `linkedin_job_alert:job:${job.id}`;
      
      // Get previous band from Redis
      const previousBand = await redis.get(redisKey) as AlertBand | undefined;
      
      // Run the resolver
      const resolution = resolveAlertState(job, previousBand);
      const parsedCount = parseApplicantCount(job.applicantCountRaw);
      
      details.push({
        id: job.id,
        title: job.title,
        company: job.company,
        applicantsRaw: job.applicantCountRaw,
        applicantsParsed: parsedCount,
        previousBand,
        currentBand: resolution.currentBand,
        shouldAlert: resolution.shouldAlert,
        alertType: resolution.type
      });
      
      if (resolution.shouldAlert) {
        // Send alert
        const success = await sendTelegramAlert(
          job, 
          resolution.type as 'initial' | 'follow-up', 
          parsedCount, 
          resolution.currentBand, 
          previousBand
        );
        
        if (success) {
          alertedCount++;
          // Save alerted band with a 14-day TTL to avoid bloating memory
          await redis.set(redisKey, resolution.currentBand, { ex: 3600 * 24 * 14 });
        }
      }
    }
    
    // 4. Delete current snapshot since it was successfully processed
    await redis.del('linkedin_job_alert:current_snapshot');
    
    await updatePipelineStatus({
      lastCheckedAt: new Date().toISOString(),
      status: 'completed',
      error: null
    });
    
    logToSystem(`Step 2 Completed: Processed ${jobs.length} jobs. Matched target: ${matchedCount}. Sent alerts: ${alertedCount}.`);
    
    res.json({
      success: true,
      ready: true,
      processedCount: jobs.length,
      matchedCount,
      alertedCount,
      details
    });
  } catch (err: any) {
    await updatePipelineStatus({
      status: 'error',
      error: err.message
    });
    logToSystem(`Step 2 Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SYSTEM DASHBOARD SUPPORT ROUTES (Not secured for visualization UI)
// ==========================================

app.get('/api/logs', async (req, res) => {
  const logs = await getSystemLogs();
  res.json({ logs });
});

app.get('/api/state', async (req, res) => {
  const currentConfig = activeConfig; // Already loaded by middleware
  const currentStatus = await getPipelineStatus();
  const currentAlerts = await getSentTelegramAlerts();

  res.json({
    config: {
      ...currentConfig,
      brightDataApiKey: currentConfig.brightDataApiKey ? '••••••••' + currentConfig.brightDataApiKey.slice(-4) : '',
      telegramBotToken: currentConfig.telegramBotToken ? '••••••••' + currentConfig.telegramBotToken.slice(-4) : '',
      upstashRedisToken: currentConfig.upstashRedisToken ? '••••••••' : ''
    },
    status: currentStatus,
    alerts: currentAlerts
  });
});

app.post('/api/config', async (req, res) => {
  const incoming = req.body;
  
  // Unmask keys if they weren't edited/submitted as masked strings
  const updates: any = {};
  for (const [key, val] of Object.entries(incoming)) {
    if (typeof val === 'string' && val.startsWith('••••••••')) {
      continue; // keep existing value, don't update with masked placeholder
    }
    updates[key] = val;
  }
  
  await updateActiveConfig(updates);
  res.json({ success: true, message: 'Configuration updated successfully.' });
});

/**
 * Endpoint for UI interactive test suite.
 * Evaluates job filtering and transition logic directly on user-provided or preset examples.
 */
app.post('/api/test-filter', (req, res) => {
  const { job, previousBand } = req.body as { job: LinkedInJob; previousBand?: AlertBand };
  
  const parsedCount = parseApplicantCount(job.applicantCountRaw);
  const currentBand = getAlertBand(parsedCount);
  const isFresh = isPostedWithinHours(job.postedAt, 2);
  const isTitleMatch = matchesJobTitle(job.title);
  const isLocationMatch = matchesGermany(job.location);
  const resolution = resolveAlertState(job, previousBand);
  
  res.json({
    jobId: job.id,
    titleMatch: isTitleMatch,
    locationMatch: isLocationMatch,
    parsedCount,
    currentBand,
    isFresh,
    shouldAlert: isTitleMatch && isLocationMatch && resolution.shouldAlert,
    alertType: isTitleMatch && isLocationMatch ? resolution.type : 'none',
    newBand: resolution.currentBand
  });
});

// ==========================================
// VITE CLIENT ROUTING
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logToSystem(`Vite/Express Server running on port ${PORT}`);
    logToSystem(`System ready in Europe/Berlin (Germany timezone matching ready)`);
  });
}

// Only start the Express listening server when running locally
if (!process.env.VERCEL && !process.env.NOW_REGION) {
  startServer();
}

export default app;
