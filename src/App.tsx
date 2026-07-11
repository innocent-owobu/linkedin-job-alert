import { useState, useEffect, useRef, FormEvent } from 'react';
import { 
  Play, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Terminal, 
  Settings, 
  Send, 
  FileText, 
  Activity, 
  Database, 
  MapPin, 
  Clock, 
  HelpCircle, 
  Lock, 
  Check, 
  X, 
  ShieldAlert,
  Layers,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PipelineConfig, PipelineStatus, LinkedInJob, AlertBand } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tests' | 'alerts' | 'settings' | 'guide'>('dashboard');
  const [config, setConfig] = useState<PipelineConfig>({
    brightDataApiKey: '',
    brightDataDatasetId: '',
    telegramBotToken: '',
    telegramChatId: '',
    upstashRedisUrl: '',
    upstashRedisToken: '',
    sharedSecret: 'super_secret_bearer_token',
    useSimulatedApis: true
  });
  
  const [status, setStatus] = useState<PipelineStatus>({
    lastTriggeredAt: null,
    lastSnapshotId: null,
    lastCheckedAt: null,
    status: 'idle',
    error: null,
    logs: []
  });
  
  const [alerts, setAlerts] = useState<Array<{
    jobId: string;
    message: string;
    timestamp: string;
    isSimulated: boolean;
  }>>([]);

  const [systemLogs, setSystemLogs] = useState<string[]>([]);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [testResults, setTestResults] = useState<Record<number, any>>({});
  const [runningTests, setRunningTests] = useState(false);
  const [time, setTime] = useState<string>('');

  const [leftPanelMode, setLeftPanelMode] = useState<'jobs' | 'logs'>('jobs');

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Sync times
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Format to German local time
      const deTime = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
      const deDate = now.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
      setTime(`${deDate} ${deTime} (Europe/Berlin)`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch state on mount and poll
  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        // Keep configuration from backend, but don't overwrite if user edited inputs
        setConfig(prev => ({
          ...prev,
          ...data.config,
          // Retain simulation toggle state locally
          useSimulatedApis: data.config.useSimulatedApis
        }));
        setStatus(data.status);
        setAlerts(data.alerts);
      }
    } catch (e) {
      console.error('Failed to fetch state', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data.logs);
      }
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  useEffect(() => {
    fetchState();
    fetchLogs();
    const stateInterval = setInterval(fetchState, 3000);
    const logInterval = setInterval(fetchLogs, 2000);
    return () => {
      clearInterval(stateInterval);
      clearInterval(logInterval);
    };
  }, []);

  // Scroll to bottom of terminal
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [systemLogs]);

  // Handle trigger (Step 1)
  const handleTriggerStep1 = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.sharedSecret}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Trigger failed');
      await fetchState();
      await fetchLogs();
    } catch (err: any) {
      alert(`Step 1 Trigger Failed: ${err.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  // Handle check alerts (Step 2)
  const handleTriggerStep2 = async () => {
    setIsChecking(true);
    try {
      const res = await fetch('/api/check-alerts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.sharedSecret}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check failed');
      await fetchState();
      await fetchLogs();
    } catch (err: any) {
      alert(`Step 2 Failed: ${err.message}`);
    } finally {
      setIsChecking(false);
    }
  };

  // Save config
  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        alert('Configuration saved successfully on backend!');
        fetchState();
      } else {
        alert('Failed to save configuration.');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Test Suite cases
  const testCases = [
    {
      id: 1,
      name: "Low Competition (Exactly 12 applicants)",
      job: {
        id: "test_job_1",
        title: "Junior Data Analyst",
        company: "DataTech GmbH",
        location: "Berlin, Germany",
        postedAt: "1 hour ago",
        applicantCountRaw: "12 applicants"
      },
      previousBand: undefined,
      expectedBand: "low",
      expectedAlert: true,
      expectedType: "initial",
      explanation: "Applicant count (12) is <= 15. Standard low-competition entry. Triggers initial alert."
    },
    {
      id: 2,
      name: "Low Boundary (Exactly 15 applicants)",
      job: {
        id: "test_job_2",
        title: "Power BI Developer",
        company: "Retail Corp",
        location: "Munich, Germany",
        postedAt: "2 hours ago",
        applicantCountRaw: 15
      },
      previousBand: undefined,
      expectedBand: "low",
      expectedAlert: true,
      expectedType: "initial",
      explanation: "Inclusive boundary check. Exactly 15 is <= 15 and must trigger an alert."
    },
    {
      id: 3,
      name: "Mid Boundary (Exactly 100 applicants)",
      job: {
        id: "test_job_3",
        title: "BI Analyst",
        company: "Corporate Group",
        location: "Frankfurt, Germany",
        postedAt: "4 hours ago",
        applicantCountRaw: "100 applicants"
      },
      previousBand: undefined,
      expectedBand: "mid",
      expectedAlert: false,
      expectedType: "none",
      explanation: "The mid-band is 16-100. Exactly 100 applicants is not alertable initially."
    },
    {
      id: 4,
      name: "Over 100 Hard Ceiling String",
      job: {
        id: "test_job_4",
        title: "Business Intelligence Analyst",
        company: "AutoGroup AG",
        location: "Stuttgart, Germany",
        postedAt: "5 hours ago",
        applicantCountRaw: "Over 100 people clicked Apply"
      },
      previousBand: undefined,
      expectedBand: "high",
      expectedAlert: false,
      expectedType: "none",
      explanation: "Parsed as >100 (high band). High-competition postings are never alertable under any circumstance."
    },
    {
      id: 5,
      name: "Unknown count, fresh post (<2 hours)",
      job: {
        id: "test_job_5",
        title: "Tableau Developer",
        company: "Logistics One",
        location: "Hamburg, Germany",
        postedAt: "1.5 hours ago",
        applicantCountRaw: null
      },
      previousBand: undefined,
      expectedBand: "unknown",
      expectedAlert: true,
      expectedType: "initial",
      explanation: "Unknown count is alertable if and only if the posting is fresh (within last 2 hours)."
    },
    {
      id: 6,
      name: "Unknown count, older post (>2 hours)",
      job: {
        id: "test_job_6",
        title: "Business Data Analyst",
        company: "Industrial AG",
        location: "Dusseldorf, Germany",
        postedAt: "3 hours ago",
        applicantCountRaw: null
      },
      previousBand: undefined,
      expectedBand: "unknown",
      expectedAlert: false,
      expectedType: "none",
      explanation: "Unknown counts on postings older than 2 hours are never alertable."
    },
    {
      id: 7,
      name: "Crossing: LOW (<=15) -> MID (16-100)",
      job: {
        id: "test_job_7",
        title: "Data Analyst",
        company: "Consulting SE",
        location: "Cologne, Germany",
        postedAt: "1 hour ago",
        applicantCountRaw: "24 applicants"
      },
      previousBand: "low" as AlertBand,
      expectedBand: "mid",
      expectedAlert: true,
      expectedType: "follow-up",
      explanation: "Applicant count rose from ≤15 to 16–100. This crossing must trigger a follow-up status alert."
    },
    {
      id: 8,
      name: "Crossing: MID (16-100) -> LOW (<=15)",
      job: {
        id: "test_job_8",
        title: "Business Intelligence Analyst",
        company: "Smart Solutions",
        location: "Berlin, Germany",
        postedAt: "2 hours ago",
        applicantCountRaw: "10 applicants"
      },
      previousBand: "mid" as AlertBand,
      expectedBand: "low",
      expectedAlert: true,
      expectedType: "follow-up",
      explanation: "Applicant count decreased from mid range to low range. This crossing triggers a follow-up status alert."
    },
    {
      id: 9,
      name: "Transition: UNKNOWN -> LOW (Update)",
      job: {
        id: "test_job_9",
        title: "Insights and Report Specialist",
        company: "Zalando",
        location: "Berlin, Germany",
        postedAt: "2 hours ago",
        applicantCountRaw: "5 applicants"
      },
      previousBand: "unknown" as AlertBand,
      expectedBand: "low",
      expectedAlert: true,
      expectedType: "follow-up",
      explanation: "The job was previously alerted in the unknown/fresh band, and now has 5 applicants (low). This is an alertable change."
    },
    {
      id: 10,
      name: "De-duplication (Same Band)",
      job: {
        id: "test_job_10",
        title: "Tableau Developer",
        company: "Media Tech",
        location: "Munich, Germany",
        postedAt: "2 hours ago",
        applicantCountRaw: "14 applicants"
      },
      previousBand: "low" as AlertBand,
      expectedBand: "low",
      expectedAlert: false,
      expectedType: "none",
      explanation: "Remained in the low band (14 <= 15). De-duplication rule prevents redundant alerts."
    },
    {
      id: 11,
      name: "Title Filter Test",
      job: {
        id: "test_job_11",
        title: "Full Stack Engineer (React/Node)",
        company: "Creative Studio",
        location: "Hamburg, Germany",
        postedAt: "10 minutes ago",
        applicantCountRaw: "2 applicants"
      },
      previousBand: undefined,
      expectedBand: "low",
      expectedAlert: false,
      expectedType: "none",
      explanation: "Although it has 2 applicants, the title does not match target roles. Filtered out."
    },
    {
      id: 12,
      name: "Location Filter Test",
      job: {
        id: "test_job_12",
        title: "BI Analyst",
        company: "Global Tech",
        location: "London, United Kingdom",
        postedAt: "5 minutes ago",
        applicantCountRaw: "1 applicant"
      },
      previousBand: undefined,
      expectedBand: "low",
      expectedAlert: false,
      expectedType: "none",
      explanation: "Job location is outside Germany. Filtered out."
    }
  ];

  // Run all tests
  const runFilterTestSuite = async () => {
    setRunningTests(true);
    const results: Record<number, any> = {};
    for (const tc of testCases) {
      try {
        const res = await fetch('/api/test-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job: tc.job,
            previousBand: tc.previousBand
          })
        });
        if (res.ok) {
          const data = await res.json();
          const passBand = data.currentBand === tc.expectedBand;
          const passAlert = data.shouldAlert === tc.expectedAlert;
          const passType = data.alertType === tc.expectedType;
          results[tc.id] = {
            ...data,
            passed: passBand && passAlert && passType
          };
        }
      } catch (e) {
        console.error(e);
      }
    }
    setTestResults(results);
    setRunningTests(false);
  };

  return (
    <div className="min-h-screen bg-[#161616] text-neutral-200 flex flex-col font-sans antialiased">
      
      {/* HEADER SECTION - Styled with Sleek Interface theme colors & layout */}
      <header id="main_header" className="bg-[#1f1f1f] border-b border-neutral-800 px-6 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white font-display">Sentinel: LinkedIn Job Alerter</h1>
            <p className="text-xs text-neutral-400 font-mono mt-0.5">Deployment: Vercel Hobby • Germany Region Focus</p>
          </div>
        </div>
        
        {/* Sleek dynamic statuses / badges */}
        <div className="flex flex-wrap items-center gap-3">
          {/* UTC Clock Badge */}
          <div className="flex items-center gap-2 bg-neutral-800/60 px-3.5 py-1.5 rounded-full border border-neutral-700/50 text-xs font-mono text-neutral-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>{time || "Loading..."}</span>
          </div>

          {/* Sandbox Status Badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
            config.useSimulatedApis 
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            <div className={`w-2 h-2 rounded-full ${config.useSimulatedApis ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`} />
            <span>{config.useSimulatedApis ? 'Upstash Redis: Sandbox' : 'Upstash Redis: Live'}</span>
          </div>

          {/* Telegram Status Badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
            config.telegramBotToken && config.telegramChatId
              ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
              : 'bg-neutral-800/30 text-neutral-400 border-neutral-800/20'
          }`}>
            <div className={`w-2 h-2 rounded-full ${config.telegramBotToken && config.telegramChatId ? 'bg-sky-500' : 'bg-slate-500'}`} />
            <span>Telegram Bot: {config.telegramBotToken && config.telegramChatId ? 'Active' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {/* DASHBOARD LAYOUT GRID */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        
        {/* LEFT COLUMN: CONTROL & TERMINAL LOGS (5 cols) */}
        <section id="control_column" className="lg:col-span-5 flex flex-col gap-6">
          
          {/* PIPELINE CONTROL CENTER CARD */}
          <div className="bg-[#1c1c1c] border border-neutral-800/80 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <h2 className="font-semibold text-white flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
                <Database className="w-4 h-4 text-indigo-400" /> Pipeline Control Center
              </h2>
              <span className={`px-2.5 py-1 text-[10px] rounded font-mono uppercase font-semibold ${
                status.status === 'idle' ? 'bg-neutral-800/60 text-neutral-400 border border-neutral-700/50' :
                status.status === 'triggered' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/35' :
                status.status === 'checking' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/35' :
                status.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35' :
                'bg-rose-500/15 text-rose-400 border border-rose-500/35'
              }`}>
                Status: {status.status}
              </span>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              Vercel relies on cron-job.org to execute these async functions. Trigger them manually to evaluate job caching, filter logic, and telegram alerts:
            </p>

            {/* Pipeline Stage Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
              
              {/* STAGE 1 BUTTON */}
              <button
                id="btn_trigger_step1"
                onClick={handleTriggerStep1}
                disabled={isTriggering || isChecking}
                className="flex flex-col items-start p-4 rounded-xl border border-neutral-800 bg-[#121212] hover:bg-neutral-800/40 hover:border-neutral-700 disabled:opacity-40 transition-all text-left group"
              >
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-indigo-400 group-hover:text-indigo-300">
                  <Play className={`w-3.5 h-3.5 ${isTriggering ? 'animate-spin' : ''}`} />
                  <span>Run Step 1</span>
                </div>
                <span className="text-[10px] text-neutral-500 mt-1 font-mono">Trigger Bright Data search</span>
              </button>

              {/* STAGE 2 BUTTON */}
              <button
                id="btn_trigger_step2"
                onClick={handleTriggerStep2}
                disabled={isTriggering || isChecking}
                className="flex flex-col items-start p-4 rounded-xl border border-neutral-800 bg-[#121212] hover:bg-neutral-800/40 hover:border-neutral-700 disabled:opacity-40 transition-all text-left group"
              >
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-emerald-400 group-hover:text-emerald-300">
                  <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                  <span>Run Step 2</span>
                </div>
                <span className="text-[10px] text-neutral-500 mt-1 font-mono">Evaluate & Alert</span>
              </button>

            </div>

            {/* Redis/KV State Display */}
            <div className="bg-neutral-800/20 border border-neutral-800/80 rounded-xl p-4 text-xs font-mono space-y-2.5">
              <div className="text-indigo-400 font-bold uppercase text-[10px] tracking-wider pb-1.5 border-b border-neutral-800/60">
                Upstash Redis Cache Metadata
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Snapshot Pointer ID:</span>
                <span className="text-indigo-400 font-bold">{status.lastSnapshotId || 'None (Step 1 Pending)'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Last Trigger:</span>
                <span className="text-neutral-300">
                  {status.lastTriggeredAt ? new Date(status.lastTriggeredAt).toLocaleTimeString() : 'Never'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Checked & Alerted:</span>
                <span className="text-neutral-300">
                  {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString() : 'Never'}
                </span>
              </div>
            </div>

          </div>

          {/* REALTIME SYSTEM LOGS TERMINAL CARD */}
          <div className="bg-[#1c1c1c] border border-neutral-800/80 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-[350px]">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3 mb-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setLeftPanelMode('jobs')}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    leftPanelMode === 'jobs'
                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/35'
                      : 'text-neutral-400 hover:text-neutral-200 border border-transparent hover:bg-neutral-800/40'
                  }`}
                >
                  Matched Jobs Feed
                </button>
                <button
                  onClick={() => setLeftPanelMode('logs')}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    leftPanelMode === 'logs'
                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/35'
                      : 'text-neutral-400 hover:text-neutral-200 border border-transparent hover:bg-neutral-800/40'
                  }`}
                >
                  System Logs
                </button>
              </div>
              
              {leftPanelMode === 'logs' && (
                <button 
                  onClick={() => setSystemLogs([])} 
                  className="text-[10px] text-neutral-400 hover:text-white border border-neutral-850 hover:border-neutral-700 bg-neutral-900 px-2.5 py-1 rounded-md transition-all font-mono"
                >
                  Clear
                </button>
              )}
            </div>

            {leftPanelMode === 'jobs' ? (
              <div className="flex-1 overflow-y-auto space-y-3 max-h-[780px] pr-1">
                {alerts.length === 0 ? (
                  <div className="text-neutral-500 italic flex items-center justify-center h-full py-20 text-xs">Waiting for job matches...</div>
                ) : (
                  alerts.map((alertItem, index) => {
                    const title = alertItem.message.match(/📌 \*Title:\* (.*)/)?.[1] || 'Unknown Title';
                    const company = alertItem.message.match(/🏢 \*Company:\* (.*)/)?.[1] || 'Unknown Company';
                    const location = alertItem.message.match(/📍 \*Location:\* (.*)/)?.[1] || 'Germany';
                    const applyUrl = alertItem.message.match(/🔗 \[Apply Here on LinkedIn\]\((.*)\)/)?.[1] || '#';
                    const applicants = alertItem.message.match(/📊 \*Applicants:\* (.*)/)?.[1] || 'Low Competition';
                    
                    return (
                      <div key={index} className="bg-[#121212] border border-neutral-800 p-3 rounded-xl flex flex-col gap-1.5 transition-all hover:border-neutral-700/80">
                        <div className="flex justify-between items-start gap-2">
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-white leading-tight truncate" title={title}>{title}</h4>
                            <div className="text-[10px] text-neutral-400 flex items-center gap-1.5 flex-wrap">
                              <span className="text-indigo-400 font-semibold truncate max-w-[120px]">{company}</span>
                              <span className="text-neutral-600">•</span>
                              <span className="truncate max-w-[150px]">{location}</span>
                            </div>
                          </div>
                          <a 
                            href={applyUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-[9px] font-bold text-white rounded-md transition-all flex-shrink-0"
                          >
                            Apply
                          </a>
                        </div>
                        
                        <div className="flex justify-between items-center border-t border-neutral-800/60 pt-1.5 text-[9px] font-mono">
                          <span className="text-emerald-400 font-bold">{applicants}</span>
                          <span className="text-neutral-500">{alertItem.timestamp}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div ref={logContainerRef} className="bg-[#121212] rounded-xl border border-neutral-800 p-4 flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed max-h-[780px] shadow-inner">
                {systemLogs.length === 0 ? (
                  <div className="text-slate-600 italic flex items-center justify-center h-full">Waiting for operations...</div>
                ) : (
                  <div className="space-y-1">
                    {systemLogs.map((log, index) => {
                      let color = 'text-neutral-300';
                      if (log.includes('CRON TRIGGERED')) color = 'text-amber-300 font-semibold';
                      else if (log.includes('Step 1 Complete') || log.includes('Step 2 Completed')) color = 'text-green-400 font-semibold';
                      else if (log.includes('Alert sent') || log.includes('successfully delivered')) color = 'text-indigo-300';
                      else if (log.includes('Simulation')) color = 'text-neutral-500';
                      else if (log.includes('Failed') || log.includes('Error') || log.includes('error')) color = 'text-rose-400';
                      
                      return (
                        <div key={index} className={`${color} border-l border-neutral-800 pl-2`}>
                          {log}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

        </section>

        {/* RIGHT COLUMN: TABS FOR VIEWS (7 cols) */}
        <section id="display_column" className="lg:col-span-7 flex flex-col gap-6 bg-[#1c1c1c]/90 border border-neutral-800/80 rounded-2xl p-6 md:p-8 shadow-xl">
          
          {/* TAB BAR HEADER */}
          <nav id="tabs_navigation" className="flex border-b border-neutral-800/80 pb-4 flex-wrap gap-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'tests', label: 'Boundary Tests', icon: ShieldAlert },
              { id: 'alerts', label: 'Telegram Alerts', icon: Send },
              { id: 'settings', label: 'Credentials', icon: Settings },
              { id: 'guide', label: 'Vercel Guide', icon: FileText }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                    activeTab === tab.id 
                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/35' 
                      : 'text-neutral-400 hover:text-neutral-200 border border-transparent hover:bg-neutral-800/40'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* TAB CONTENTS */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              
              {/* TAB 1: PIPELINE DASHBOARD SUMMARY */}
              {activeTab === 'dashboard' && (
                <motion.div
                  key="dashboard_tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="space-y-6"
                >
                  {/* Stats Grid - Sleek Style matching mockup */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-neutral-800/30 p-5 rounded-2xl border border-neutral-800/80">
                      <p className="text-neutral-500 text-xs font-semibold mb-1 uppercase tracking-wider">Alerts (Session)</p>
                      <p className="text-3xl font-bold text-white font-display">{alerts.length}</p>
                    </div>
                    <div className="bg-neutral-800/30 p-5 rounded-2xl border border-neutral-800/80">
                      <p className="text-neutral-500 text-xs font-semibold mb-1 uppercase tracking-wider">Tests Configured</p>
                      <p className="text-3xl font-bold text-indigo-400 font-display">{testCases.length}</p>
                    </div>
                    <div className="bg-neutral-800/30 p-5 rounded-2xl border border-neutral-800/80">
                      <p className="text-neutral-500 text-xs font-semibold mb-1 uppercase tracking-wider">Matched Roles</p>
                      <p className="text-3xl font-bold text-emerald-400 font-display">8</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" /> Target Parameter Configurations
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-neutral-800/30 border border-neutral-800/80 p-5 rounded-2xl">
                      <p className="text-xs text-indigo-400 font-bold mb-3 uppercase tracking-wider">ROLE PATTERNS</p>
                      <div className="flex flex-wrap gap-2">
                        {['Data Analyst', 'BI Analyst', 'Tableau Developer', 'Power BI Developer', 'Business Intelligence Analyst', 'Business Analyst', 'Insights and Report Specialist', 'Business Data Analyst'].map((role) => (
                          <span key={role} className="text-[10px] px-2 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-neutral-300 font-mono">
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-neutral-800/30 border border-neutral-800/80 p-5 rounded-2xl">
                      <p className="text-xs text-indigo-400 font-bold mb-3 uppercase tracking-wider">ALERT LOGIC</p>
                      <ul className="text-xs space-y-2 text-neutral-300">
                        <li className="flex justify-between">
                          <span className="text-neutral-400">Max Applicants</span> 
                          <span className="text-white font-mono bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">15</span>
                        </li>
                        <li className="flex justify-between">
                          <span className="text-neutral-400">Freshness (H)</span> 
                          <span className="text-white font-mono bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">2.0</span>
                        </li>
                        <li className="flex justify-between">
                          <span className="text-neutral-400">Hard Ceiling</span> 
                          <span className="text-rose-400 font-mono bg-rose-950/20 px-2 py-0.5 rounded border border-rose-900/30">100</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* HOW IT WORKS DIAGRAM */}
                  <div className="bg-neutral-800/20 border border-neutral-800/80 p-5 rounded-2xl space-y-3">
                    <p className="text-xs text-indigo-400 font-bold uppercase tracking-wider">Two-Stage Asynchronous Architecture</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center text-xs pt-1">
                      <div className="bg-[#121212] border border-neutral-800 p-3.5 rounded-xl">
                        <div className="text-[10px] text-indigo-400 font-mono font-semibold uppercase">01. Cron Trigger</div>
                        <div className="font-bold text-white mt-1 text-xs font-display">Step 1 Trigger</div>
                        <div className="text-[10px] text-neutral-400 mt-1.5 leading-relaxed">Runs on the hour. Initiates scraper and saves intermediate snapshot ID in Redis.</div>
                      </div>
                      
                      <div className="flex items-center justify-center text-slate-600 font-mono hidden md:flex text-lg">
                        ➔
                      </div>

                      <div className="bg-[#121212] border border-neutral-800 p-3.5 rounded-xl">
                        <div className="text-[10px] text-emerald-400 font-mono font-semibold uppercase">02. Evaluate & Alert</div>
                        <div className="font-bold text-white mt-1 text-xs font-display">Step 2 Trigger</div>
                        <div className="text-[10px] text-neutral-400 mt-1.5 leading-relaxed">Runs at +8m offset. Downloads data, evaluates state engine boundary transitions, alerts via Telegram.</div>
                      </div>
                    </div>
                  </div>

                  {/* LATEST JOB ALERTS LIST */}
                  <div className="bg-neutral-800/30 border border-neutral-800/80 p-5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Recent Alerts Feed
                    </h4>
                    
                    {alerts.length === 0 ? (
                      <p className="text-neutral-500 italic text-xs py-4 text-center">No alerts sent yet. Automation is active.</p>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                        {alerts.slice(0, 10).map((alertItem, index) => {
                          const title = alertItem.message.match(/📌 \*Title:\* (.*)/)?.[1] || 'Unknown Title';
                          const company = alertItem.message.match(/🏢 \*Company:\* (.*)/)?.[1] || 'Unknown Company';
                          const location = alertItem.message.match(/📍 \*Location:\* (.*)/)?.[1] || 'Germany';
                          const applyUrl = alertItem.message.match(/🔗 \[Apply Here on LinkedIn\]\((.*)\)/)?.[1] || '#';
                          const applicants = alertItem.message.match(/📊 \*Applicants:\* (.*)/)?.[1] || 'Low Competition';
                          
                          return (
                            <div key={index} className="bg-[#121212] border border-neutral-800 p-3.5 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3 transition-all hover:border-neutral-700/80">
                              <div className="space-y-1">
                                <h5 className="text-xs font-bold text-white leading-tight">{title}</h5>
                                <p className="text-[10px] text-neutral-400 flex items-center gap-1.5 flex-wrap">
                                  <span className="text-indigo-400 font-semibold">{company}</span>
                                  <span className="text-slate-600">•</span>
                                  <span>{location}</span>
                                  <span className="text-slate-600">•</span>
                                  <span className="text-emerald-400 font-mono">{applicants}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-3 self-end md:self-center">
                                <span className="text-[9px] font-mono text-neutral-500">{alertItem.timestamp}</span>
                                <a 
                                  href={applyUrl} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-[10px] font-semibold text-white rounded-lg transition-all"
                                >
                                  Apply
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="bg-neutral-900/50 border border-neutral-800/80 p-4 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-500/10 rounded-full flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></div>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white uppercase tracking-wider">Pipeline Engine Status</p>
                        <p className="text-[10px] text-neutral-400">Ready for automated cron job polling intervals</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[10px] font-mono bg-[#121212] text-neutral-400 px-2 py-1 rounded border border-neutral-800">v1.2.0-sleek</span>
                      <span className="text-[10px] font-mono bg-[#121212] text-neutral-400 px-2 py-1 rounded border border-neutral-800">React + Vite</span>
                    </div>
                  </div>

                </motion.div>
              )}

              {/* TAB 2: INTERACTIVE BOUNDARY TEST SUITE */}
              {activeTab === 'tests' && (
                <motion.div
                  key="tests_tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="space-y-4"
                >
                  <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">Boundary Test Suite & Validation Engine</h3>
                      <p className="text-xs text-neutral-400 mt-0.5">Validates the parser, deduplication rules, and applicant thresholds.</p>
                    </div>
                    <button
                      id="btn_run_tests"
                      onClick={runFilterTestSuite}
                      disabled={runningTests}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 text-xs font-semibold rounded-lg flex items-center gap-1.5 text-white transition-all shadow-md shadow-indigo-600/10"
                    >
                      {runningTests ? 'Running...' : 'Run All Tests'}
                    </button>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[500px] pr-1">
                    {testCases.map((tc) => {
                      const result = testResults[tc.id];
                      return (
                        <div key={tc.id} className="bg-neutral-800/30 border border-neutral-800 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-start gap-4">
                            <div>
                              <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest font-mono">Test Case {tc.id}</span>
                              <h4 className="text-xs font-bold text-white mt-0.5">{tc.name}</h4>
                            </div>
                            {result ? (
                              <span className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-md border ${
                                result.passed 
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              }`}>
                                {result.passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                {result.passed ? 'PASSED' : 'FAILED'}
                              </span>
                            ) : (
                              <span className="text-[10px] text-neutral-500 italic">Pending execution</span>
                            )}
                          </div>

                          {/* Details & Specs */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] bg-[#121212] p-3 rounded-lg border border-neutral-800/60 font-mono text-neutral-300">
                            <div>
                              <span className="text-neutral-500 block text-[9px] uppercase tracking-wider font-semibold">Raw Count:</span>
                              <span>{tc.job.applicantCountRaw === null ? 'null' : String(tc.job.applicantCountRaw)}</span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block text-[9px] uppercase tracking-wider font-semibold">Post Age:</span>
                              <span>{tc.job.postedAt}</span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block text-[9px] uppercase tracking-wider font-semibold">Prev Band:</span>
                              <span>{tc.previousBand || 'none'}</span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block text-[9px] uppercase tracking-wider font-semibold">Role Fit:</span>
                              <span>{tc.job.title.includes('Full Stack') || tc.job.title.includes('Engineer') ? 'Filter Out' : 'Match'}</span>
                            </div>
                          </div>

                          {/* Evaluation comparison */}
                          {result && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-[#121212] border border-neutral-800/50 p-3.5 rounded-lg text-[11px]">
                              <div className="space-y-1">
                                <div className="text-neutral-500 font-bold uppercase text-[9px] tracking-wider">Engine Evaluation:</div>
                                <div className="space-y-1 font-mono text-neutral-300">
                                  <div>Current Band: <strong className="text-neutral-100">{result.currentBand}</strong> (Expected: <strong className="text-neutral-400">{tc.expectedBand}</strong>)</div>
                                  <div>Alert Action: <strong className={result.shouldAlert ? 'text-amber-400' : 'text-neutral-400'}>{result.shouldAlert ? 'ALERTED' : 'NO ALERT'}</strong></div>
                                  <div>Alert Type: <span className="text-indigo-400">{result.alertType}</span></div>
                                </div>
                              </div>
                              <div className="p-3 bg-neutral-800/40 border border-neutral-700/40 rounded text-neutral-400 leading-relaxed text-[11px]">
                                <span className="font-semibold text-neutral-300 block mb-1">Pass Rule Justification:</span>
                                {tc.explanation}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* TAB 3: TELEGRAM SENT ALERTS FEED */}
              {activeTab === 'alerts' && (
                <motion.div
                  key="alerts_tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="space-y-4 flex flex-col h-full"
                >
                  <div className="border-b border-neutral-800 pb-3">
                    <h3 className="text-sm font-bold text-white">Delivered Telegram Notifications Feed</h3>
                    <p className="text-xs text-neutral-400 mt-0.5">Dispatched alerts log copy. Preserves full markdown templates sent to the channel.</p>
                  </div>

                  <div className="space-y-4 overflow-y-auto max-h-[450px] flex-1 pr-1">
                    {alerts.length === 0 ? (
                      <div className="text-neutral-500 italic flex items-center justify-center py-20 border border-dashed border-neutral-800 rounded-2xl bg-neutral-900/10">
                        No alerts generated in this session yet. Run Step 2 with Sandbox on to populate simulated alerts instantly!
                      </div>
                    ) : (
                      alerts.map((alertItem, idx) => (
                        <div key={idx} className="bg-neutral-800/30 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3">
                          <div className="flex justify-between items-center border-b border-neutral-800/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="p-1 bg-indigo-500/10 text-indigo-400 rounded-md">
                                <Send className="w-3.5 h-3.5" />
                              </span>
                              <span className="text-[10px] text-neutral-400 font-mono">{alertItem.timestamp}</span>
                            </div>
                            <span className={`px-2.5 py-0.5 text-[9px] rounded font-mono font-bold border uppercase ${
                              alertItem.isSimulated 
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}>
                              {alertItem.isSimulated ? 'Simulation' : 'Delivered Live'}
                            </span>
                          </div>
                          
                          {/* Alert block content render */}
                          <div className="bg-[#121212] border border-neutral-800 p-4 rounded-lg font-mono text-[11px] text-neutral-200 whitespace-pre-wrap leading-relaxed shadow-inner">
                            {alertItem.message}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}

              {/* TAB 4: CONFIGURATION & CREDENTIALS */}
              {activeTab === 'settings' && (
                <motion.div
                  key="settings_tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                >
                  <form onSubmit={handleSaveConfig} className="space-y-6">
                    <div className="border-b border-neutral-800 pb-3">
                      <h3 className="text-sm font-bold text-white font-display">Pipeline Credentials & API Keys</h3>
                      <p className="text-xs text-neutral-400 mt-0.5">Manage live keys. Values are loaded dynamically from server configurations.</p>
                    </div>

                    {/* SANDBOX SIMULATOR TOGGLE */}
                    <div className="p-5 bg-indigo-950/20 border border-indigo-900/30 rounded-2xl flex items-center justify-between gap-6 shadow-sm">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          Interactive Sandbox Simulator
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-relaxed max-w-md">
                          Utilizes local mock datasets and simulated alert delivery targets when active. Turn off to run live API pipelines.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfig(prev => ({ ...prev, useSimulatedApis: !prev.useSimulatedApis }))}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.useSimulatedApis ? 'bg-indigo-600' : 'bg-neutral-800'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          config.useSimulatedApis ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      
                      {/* BRIGHT DATA CREDENTIALS */}
                      <div className="space-y-3 bg-neutral-800/20 border border-neutral-800 p-5 rounded-2xl">
                        <h4 className="font-bold text-white border-b border-neutral-800 pb-2 mb-2 uppercase tracking-wide text-neutral-300">1. Bright Data Settings</h4>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Bright Data API Key</label>
                          <input
                            type="password"
                            value={config.brightDataApiKey}
                            onChange={e => setConfig(prev => ({ ...prev, brightDataApiKey: e.target.value }))}
                            placeholder="Dataset API Key"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Dataset ID (LinkedIn Jobs)</label>
                          <input
                            type="text"
                            value={config.brightDataDatasetId}
                            onChange={e => setConfig(prev => ({ ...prev, brightDataDatasetId: e.target.value }))}
                            placeholder="e.g. gd_l1v950f11n"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* TELEGRAM CREDENTIALS */}
                      <div className="space-y-3 bg-neutral-800/20 border border-neutral-800 p-5 rounded-2xl">
                        <h4 className="font-bold text-white border-b border-neutral-800 pb-2 mb-2 uppercase tracking-wide text-neutral-300">2. Telegram Bot Settings</h4>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Telegram Bot Token</label>
                          <input
                            type="password"
                            value={config.telegramBotToken}
                            onChange={e => setConfig(prev => ({ ...prev, telegramBotToken: e.target.value }))}
                            placeholder="From @BotFather"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Telegram Chat / Channel ID</label>
                          <input
                            type="text"
                            value={config.telegramChatId}
                            onChange={e => setConfig(prev => ({ ...prev, telegramChatId: e.target.value }))}
                            placeholder="e.g. -1001554902341"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* UPSTASH REDIS CREDENTIALS */}
                      <div className="space-y-3 bg-neutral-800/20 border border-neutral-800 p-5 rounded-2xl">
                        <h4 className="font-bold text-white border-b border-neutral-800 pb-2 mb-2 uppercase tracking-wide text-neutral-300">3. Upstash Redis / Vercel KV</h4>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Upstash REST URL</label>
                          <input
                            type="text"
                            value={config.upstashRedisUrl}
                            onChange={e => setConfig(prev => ({ ...prev, upstashRedisUrl: e.target.value }))}
                            placeholder="https://...upstash.io"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Upstash REST Token</label>
                          <input
                            type="password"
                            value={config.upstashRedisToken}
                            onChange={e => setConfig(prev => ({ ...prev, upstashRedisToken: e.target.value }))}
                            placeholder="REST Token"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* SECURITY & TOKEN */}
                      <div className="space-y-3 bg-neutral-800/20 border border-neutral-800 p-5 rounded-2xl">
                        <h4 className="font-bold text-white border-b border-neutral-800 pb-2 mb-2 uppercase tracking-wide text-neutral-300">4. Pipeline Access Security</h4>
                        <div className="space-y-1">
                          <label className="text-neutral-400">Cron Authorization Secret</label>
                          <input
                            type="text"
                            value={config.sharedSecret}
                            onChange={e => setConfig(prev => ({ ...prev, sharedSecret: e.target.value }))}
                            placeholder="Bearer Token Value"
                            className="w-full bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-neutral-100 placeholder-slate-700 focus:border-indigo-500 focus:outline-none font-mono"
                          />
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-relaxed pt-1">
                          Guards routes from malicious executions. Attach this as a Bearer authorization token on cron-job.org endpoints.
                        </p>
                      </div>

                    </div>

                    <div className="flex justify-end gap-3 border-t border-neutral-800 pt-4">
                      <button
                        type="submit"
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold rounded-lg text-xs transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
                      >
                        <Check className="w-4 h-4" /> Save Configuration
                      </button>
                    </div>

                  </form>
                </motion.div>
              )}

              {/* TAB 5: VERCEL DEPLOYMENT README GUIDE */}
              {activeTab === 'guide' && (
                <motion.div
                  key="guide_tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="space-y-6 text-xs text-neutral-300 leading-relaxed max-h-[500px] overflow-y-auto pr-2"
                >
                  <h3 className="text-base font-bold text-white border-b border-neutral-800 pb-2 mb-3 font-display">
                    Vercel Hobby Deployment & Configuration Guide
                  </h3>

                  {/* STEP 1 */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-white flex items-center gap-2.5">
                      <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs border border-indigo-500/30">1</span>
                      Setup Bright Data Discover LinkedIn Dataset
                    </h4>
                    <p className="pl-8 text-neutral-400">
                      Bright Data provides pre-packaged datasets and scraper services.
                    </p>
                    <ol className="pl-14 list-decimal space-y-1 text-neutral-400 font-mono text-[11px]">
                      <li>Register or log in to <a href="https://brightdata.com" target="_blank" rel="noreferrer" className="text-indigo-400 underline hover:text-indigo-300">Bright Data</a>.</li>
                      <li>Go to <strong>Datasets & Scrapers</strong> ➔ Search for <strong>LinkedIn Jobs</strong> dataset.</li>
                      <li>Generate an <strong>API Token</strong> and record your <strong>Dataset ID</strong>.</li>
                    </ol>
                  </div>

                  {/* STEP 2 */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-white flex items-center gap-2.5">
                      <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs border border-indigo-500/30">2</span>
                      Create Telegram Alert Bot
                    </h4>
                    <p className="pl-8 text-neutral-400">
                      Telegram offers high-frequency bot endpoints with zero costs.
                    </p>
                    <ol className="pl-14 list-decimal space-y-1 text-neutral-400 font-mono text-[11px]">
                      <li>Message <strong className="text-neutral-200">@BotFather</strong> on Telegram and send <code>/newbot</code>.</li>
                      <li>Record the generated <strong>Bot API Token</strong>.</li>
                      <li>Add the bot to a target group/channel as administrator, and fetch your chat ID using raw data logs.</li>
                    </ol>
                  </div>

                  {/* STEP 3 */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-white flex items-center gap-2.5">
                      <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs border border-indigo-500/30">3</span>
                      Configure Free Upstash Redis Store
                    </h4>
                    <p className="pl-8 text-neutral-400">
                      Stateless Vercel functions require a fast KV storage to track scraper states and deduplicate notifications.
                    </p>
                    <ol className="pl-14 list-decimal space-y-1 text-neutral-400 font-mono text-[11px]">
                      <li>Sign up on <a href="https://upstash.com" target="_blank" rel="noreferrer" className="text-indigo-400 underline hover:text-indigo-300">Upstash</a>.</li>
                      <li>Create a <strong>Serverless Redis Database</strong>.</li>
                      <li>Copy the REST URL and REST Token to use as credentials.</li>
                    </ol>
                  </div>

                  {/* STEP 4 */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-white flex items-center gap-2.5">
                      <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs border border-indigo-500/30">4</span>
                      Deploy to Vercel Hobby Plan
                    </h4>
                    <p className="pl-8 text-neutral-400">
                      Vercel hosts the API endpoints. Deploy via Vercel CLI or import your git repository:
                    </p>
                    <div className="pl-8 mt-2">
                      <p className="text-neutral-400 font-semibold mb-1">Set these Environment Variables in your Vercel Dashboard:</p>
                      <pre className="bg-[#121212] border border-neutral-800 p-4 rounded-xl text-[10px] font-mono mt-1 text-neutral-300 shadow-inner">
{`BRIGHT_DATA_API_KEY="your_bright_data_api_key"
BRIGHT_DATA_DATASET_ID="your_dataset_id"
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_CHAT_ID="your_chat_id"
UPSTASH_REDIS_URL="your_upstash_redis_rest_url"
UPSTASH_REDIS_TOKEN="your_upstash_redis_rest_token"
SHARED_SECRET="select_a_secure_token_for_cron_job_auth"`}
                      </pre>
                    </div>
                  </div>

                  {/* STEP 5 */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-white flex items-center gap-2.5">
                      <span className="bg-indigo-500/20 text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs border border-indigo-500/30">5</span>
                      Configure cron-job.org Trigger Sequences
                    </h4>
                    <p className="pl-8 text-neutral-400">
                      Configure two independent cron jobs to execute the stages at a balanced offset:
                    </p>
                    
                    <div className="pl-8 space-y-3 mt-2">
                      <div className="bg-[#121212] border border-neutral-800 p-4 rounded-xl">
                        <div className="font-bold text-indigo-400 text-xs font-display">Cron Job A: Search Trigger (Step 1)</div>
                        <ul className="list-disc pl-4 text-neutral-400 space-y-1.5 mt-2 font-mono text-[10px]">
                          <li><strong>Endpoint:</strong> <code>https://your-vercel-domain.vercel.app/api/trigger</code></li>
                          <li><strong>Method:</strong> <code>POST</code></li>
                          <li><strong>Header:</strong> <code>Authorization: Bearer your_shared_secret_here</code></li>
                          <li><strong>Schedule:</strong> <code>0 6-20/1 * * *</code> (Hourly, on the hour between 6am and 8pm)</li>
                        </ul>
                      </div>

                      <div className="bg-[#121212] border border-neutral-800 p-4 rounded-xl">
                        <div className="font-bold text-emerald-400 text-xs font-display">Cron Job B: Evaluate & Alert (Step 2)</div>
                        <ul className="list-disc pl-4 text-neutral-400 space-y-1.5 mt-2 font-mono text-[10px]">
                          <li><strong>Endpoint:</strong> <code>https://your-vercel-domain.vercel.app/api/check-alerts</code></li>
                          <li><strong>Method:</strong> <code>POST</code></li>
                          <li><strong>Header:</strong> <code>Authorization: Bearer your_shared_secret_here</code></li>
                          <li><strong>Schedule:</strong> <code>8 6-20/1 * * *</code> (Hourly, at 8 minutes past the hour to allow discovery scraper delays)</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                </motion.div>
              )}

            </AnimatePresence>
          </div>

        </section>

      </main>

      {/* FOOTER BAR */}
      <footer id="main_footer" className="mt-auto border-t border-neutral-800/80 bg-[#1f1f1f] px-6 py-4 text-center text-xs text-neutral-500 flex flex-col sm:flex-row justify-between items-center gap-2 shadow-inner">
        <div>Developed and tested securely for Germany timezone. No client-side API keys exposed.</div>
        <div className="font-mono text-[10px] text-slate-600">Port: 3000 | Ingress Inflow Ready | Sentinel Core</div>
      </footer>

    </div>
  );
}
