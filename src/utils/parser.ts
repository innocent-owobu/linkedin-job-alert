import { AlertBand, LinkedInJob } from '../types';

/**
 * Parses applicant count from a raw number or string format.
 * Examples:
 * - 12 -> 12
 * - "12 applicants" -> 12
 * - "Over 100 people clicked Apply" -> 101
 * - "100+ applicants" -> 101
 * - "Over 50 applicants" -> 51
 * - null/undefined -> null
 */
export function parseApplicantCount(raw: string | number | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return raw;
  
  const str = String(raw).toLowerCase().trim();
  if (!str) return null;

  // Handle explicit representations exceeding 100
  if (
    str.includes('100+') || 
    str.includes('over 100') || 
    str.includes('more than 100') || 
    str.includes('100 plus') || 
    str.includes('over hundred') ||
    str.includes('100-plus')
  ) {
    return 101; // Treat as exceeding the 100 ceiling
  }

  // Handle other "over X" or "X+" patterns
  const overMatch = str.match(/(?:over|more than)\s*(\d+)/) || str.match(/(\d+)\+/);
  if (overMatch) {
    const val = parseInt(overMatch[1], 10);
    return val + 1;
  }

  // Handle standard number extraction
  const match = str.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Classifies applicant count into its respective alert band.
 */
export function getAlertBand(count: number | null): AlertBand {
  if (count === null) {
    return 'unknown';
  }
  if (count <= 15) {
    return 'low';
  }
  if (count >= 16 && count <= 100) {
    return 'mid';
  }
  return 'high';
}

/**
 * Determines if a job's relative posting age is within the given hours threshold.
 * Handles dates/timestamps as well as relative strings ("2 hours ago", "1h ago", "30 minutes ago", etc.)
 */
export function isPostedWithinHours(postedAt: string | undefined, hoursThreshold: number): boolean {
  if (!postedAt) return false;
  const str = postedAt.toLowerCase().trim();

  // Try parsing as ISO/standard date
  const timestamp = Date.parse(postedAt);
  if (!isNaN(timestamp)) {
    const diffMs = Date.now() - timestamp;
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours <= hoursThreshold && diffHours >= 0;
  }

  // Handle relative time strings
  if (
    str.includes('minute') || 
    str.includes('second') || 
    str.includes('just now') || 
    str.includes('now') ||
    str.includes('min')
  ) {
    return true;
  }

  // Match hour expressions like "1 hour ago", "1h ago", "2 hours"
  const hourMatch = str.match(/(\d+)\s*h/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return hours <= hoursThreshold;
  }

  // Days, weeks, months, or "yesterday" are older than hoursThreshold
  if (
    str.includes('day') || 
    str.includes('yesterday') || 
    str.includes('week') || 
    str.includes('month') || 
    str.includes('year') ||
    str.includes('d ago')
  ) {
    return false;
  }

  return false;
}

/**
 * Evaluates whether a job posting matches target title keywords (case-insensitive).
 */
export function matchesJobTitle(title: string | undefined): boolean {
  if (!title) return false;
  const targetTitles = [
    'data analyst',
    'bi analyst',
    'tableau developer',
    'power bi developer',
    'business intelligence analyst',
    'business analyst',
    'insights and report specialist',
    'business data analyst'
  ];
  
  const normalized = title.toLowerCase().trim();
  return targetTitles.some(target => normalized.includes(target));
}

/**
 * Evaluates whether a job posting location is in Germany.
 */
export function matchesGermany(location: string | undefined): boolean {
  if (!location) return false;
  const str = location.toLowerCase().trim();
  return str.includes('germany') || str.includes('deutschland') || str.includes('de');
}

/**
 * Core alert resolution logic.
 * Decides whether to send an alert (initial or follow-up) based on current state and historical state.
 * Returns { shouldAlert: boolean, type: 'initial' | 'follow-up' | 'none', newBand: AlertBand }
 */
export function resolveAlertState(
  job: LinkedInJob,
  previousBand: AlertBand | undefined | null
): { shouldAlert: boolean; type: 'initial' | 'follow-up' | 'none'; currentBand: AlertBand } {
  // Parse fields
  const count = parseApplicantCount(job.applicantCountRaw);
  const currentBand = getAlertBand(count);
  const isFresh = isPostedWithinHours(job.postedAt, 2);

  // Check absolute constraints
  if (currentBand === 'high') {
    return { shouldAlert: false, type: 'none', currentBand };
  }

  // Case 1: First time we are seeing/evaluating this job
  if (previousBand === undefined || previousBand === null) {
    if (currentBand === 'low') {
      return { shouldAlert: true, type: 'initial', currentBand };
    }
    if (currentBand === 'unknown' && isFresh) {
      return { shouldAlert: true, type: 'initial', currentBand };
    }
    return { shouldAlert: false, type: 'none', currentBand };
  }

  // Case 2: We have previously alerted on this job
  if (previousBand === currentBand) {
    // No state change
    return { shouldAlert: false, type: 'none', currentBand };
  }

  // Validate alertable band transitions:
  // - Crossing between <=15 ('low') and 16-100 ('mid') in either direction
  // - Crossing from 'unknown' to 'low' or 'mid'
  const isAlertableTransition = (
    (previousBand === 'low' && currentBand === 'mid') ||
    (previousBand === 'mid' && currentBand === 'low') ||
    (previousBand === 'unknown' && (currentBand === 'low' || currentBand === 'mid'))
  );

  if (isAlertableTransition) {
    return { shouldAlert: true, type: 'follow-up', currentBand };
  }

  return { shouldAlert: false, type: 'none', currentBand };
}
