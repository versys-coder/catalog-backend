const {
  fetchExternalSchedule,
  normalizeEvents,
  calcHour,
  TOTAL_LANES,
} = require('./scheduleService');

/**
 * Smart TTL cache for schedule events by date (ISO).
 * - Key: YYYY-MM-DD
 * - Value: { events: any[], ts: number }  // ts = fetched-at (ms)
 */
const CACHE_TTL_MS = Number(process.env.LANES_CACHE_TTL_MS || 30_000); // 30s by default
const ALLOW_STALE_ON_ERROR = process.env.LANES_CACHE_STALE_ON_ERROR !== '0'; // use stale on fetch error
const DEBUG = process.env.LANES_CACHE_DEBUG === '1';

const cache = new Map();

/**
 * Convert dt (Luxon DateTime | Date | ISO string) to YYYY-MM-DD
 */
function toIsoDate(dt) {
  if (typeof dt?.toISODate === 'function') return dt.toISODate();
  if (typeof dt === 'string') return dt.slice(0, 10);
  if (dt instanceof Date) return dt.toISOString().slice(0, 10);
  return String(dt);
}

function isFresh(ts) {
  return (Date.now() - ts) < CACHE_TTL_MS;
}

/**
 * Fetches and normalizes events for a given date (YYYY-MM-DD),
 * respects TTL cache.
 */
async function loadEventsForDate(dateIso) {
  const cached = cache.get(dateIso);
  if (cached && isFresh(cached.ts)) {
    if (DEBUG) console.log('[lanesService] cache HIT', dateIso);
    return cached.events;
  }

  if (DEBUG) {
    if (cached) console.log('[lanesService] cache EXPIRED', dateIso);
    else console.log('[lanesService] cache MISS', dateIso);
  }

  try {
    const raw = await fetchExternalSchedule(dateIso, dateIso);
    const events = normalizeEvents(raw);
    cache.set(dateIso, { events, ts: Date.now() });
    if (DEBUG) console.log('[lanesService] fetched & cached', dateIso, 'events=', events.length);
    return events;
  } catch (e) {
    console.error('[lanesService] fetch error for', dateIso, e?.message || e);
    // If allowed, fall back to stale cache (if exists)
    if (ALLOW_STALE_ON_ERROR && cached?.events) {
      if (DEBUG) console.log('[lanesService] using STALE cache for', dateIso);
      return cached.events;
    }
    throw e;
  }
}

/**
 * Returns number of occupied lanes at provided time (Luxon DateTime preferred).
 * Uses TTL cache for daily schedule; recalculates busy lanes for requested hour each call.
 */
async function getOccupiedLanesAt(dt) {
  try {
    const dateIso = toIsoDate(dt);
    const hour = typeof dt?.hour === 'number' ? dt.hour : 0;

    const events = await loadEventsForDate(dateIso);
    const { busyLanes = 0 } = calcHour(events, dateIso, hour);

    const clamped = Math.max(0, Math.min(Number(busyLanes) || 0, Number(TOTAL_LANES) || busyLanes));
    if (DEBUG) console.log('[lanesService] occupied', { dateIso, hour, busyLanes: clamped });
    return clamped;
  } catch (e) {
    console.error('lanesService.getOccupiedLanesAt error:', e?.message || e);
    return 0;
  }
}

/**
 * Manually invalidate cache for a specific date (YYYY-MM-DD)
 */
function invalidateDateCache(dateIso) {
  cache.delete(dateIso);
  if (DEBUG) console.log('[lanesService] cache invalidated for', dateIso);
}

/**
 * Clear entire cache.
 */
function clearCache() {
  cache.clear();
  if (DEBUG) console.log('[lanesService] cache cleared');
}

/**
 * Prefetch and warm cache for a given date (YYYY-MM-DD).
 */
async function prefetchDate(dateIso) {
  await loadEventsForDate(dateIso);
}

/**
 * Basic cache stats
 */
function getCacheStats() {
  const now = Date.now();
  const entries = [];
  for (const [dateIso, { ts, events }] of cache.entries()) {
    entries.push({
      dateIso,
      age_ms: now - ts,
      fresh: isFresh(ts),
      events: Array.isArray(events) ? events.length : 0,
    });
  }
  return {
    ttl_ms: CACHE_TTL_MS,
    size: cache.size,
    entries,
  };
}

module.exports = {
  getOccupiedLanesAt,
  invalidateDateCache,
  clearCache,
  prefetchDate,
  getCacheStats,
};
