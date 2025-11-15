/**
 * routes/capacity.js (with time travel: ?at=ISO & ?bucket=N)
 */
const express = require('express');
const router = express.Router();
const { DateTime } = require('luxon');
const axios = require('axios');
const https = require('https');

const { getOccupiedLanesAt } = require('../services/lanesService');
const { fetchPoolVisitorsForInterval, getCurrentPoolClientsFull } = require('../services/posesheniya');

const LOG_PREFIX = '[CAPACITY]';
const CLICKHOUSE_HTTP = (process.env.CLICKHOUSE_HTTP || 'http://localhost:8123').replace(/\/+$/, '');
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DB = process.env.CLICKHOUSE_CAPACITY_DB || process.env.CLICKHOUSE_DB || 'default';
const CH_TABLE = process.env.CH_TABLE || 'sale.kass_documents';
const OFD_SERVICE_NAMES = (process.env.OFD_SERVICE_NAMES || 'Самостоятельное плавание').split(',').map(s => s.trim()).filter(Boolean);
const TIMEZONE = process.env.TIMEZONE || 'Asia/Yekaterinburg';
const MAX_CAPACITY = Number(process.env.MAX_CAPACITY || 150);
const LANE_CAPACITY = Number(process.env.LANE_CAPACITY || 15);
const HOLIDAYS = (process.env.HOLIDAYS || '').split(',').map(s => s.trim()).filter(Boolean);
const CAPACITY_DEBUG = process.env.CAPACITY_DEBUG === '1';

const agent = CLICKHOUSE_HTTP.startsWith('https://') ? new https.Agent({ rejectUnauthorized: false }) : undefined;
function log(...args) { if (CAPACITY_DEBUG) console.log(new Date().toISOString(), LOG_PREFIX, ...args); }
function err(...args) { console.error(new Date().toISOString(), LOG_PREFIX, ...args); }

function nowLocal() { return DateTime.now().setZone(TIMEZONE); }
function isHoliday(dt) { return HOLIDAYS.includes(dt.toISODate()); }

function getDisplayBucketForNow(dt) {
  const local = dt.setZone(TIMEZONE);
  const hour = local.hour, minute = local.minute;
  const total = hour * 60 + minute;
  const weekendLike = local.weekday >= 6 || isHoliday(local);
  if (total < 390 || total > 1319) return null;
  if (total >= 390 && total < 420) return 7;
  if (!weekendLike && total >= 680 && total < 800) return 13;
  return hour;
}

function getBucketIntervalByBucket(dt, bucket) {
  if (bucket == null) return null;
  const local = dt.setZone(TIMEZONE);
  const dayStart = local.startOf('day');
  const weekendLike = local.weekday >= 6 || isHoliday(local);
  if (bucket === 7) return { start: dayStart.plus({ hours: 6, minutes: 30 }), end: dayStart.plus({ hours: 7, minutes: 20 }) };
  if (!weekendLike && bucket === 13) return { start: dayStart.plus({ hours: 11, minutes: 20 }), end: dayStart.plus({ hours: 13, minutes: 20 }) };
  let startHour = bucket - 1, startMinute = 20;
  let endHour = bucket, endMinute = 20;
  if (bucket === 21) endMinute = 30;
  if (startHour < 0) startHour = 0;
  return { start: dayStart.plus({ hours: startHour, minutes: startMinute }), end: dayStart.plus({ hours: endHour, minutes: endMinute }) };
}

async function countSalesForInterval(startLuxon, endLuxon) {
  if (!startLuxon || !endLuxon) return 0;
  const startStr = startLuxon.toFormat('yyyy-LL-dd HH:mm:ss');
  const endStr = endLuxon.toFormat('yyyy-LL-dd HH:mm:ss');
  const arrayLiteral = `[${OFD_SERVICE_NAMES.map(s => `'${s.replace(/'/g, "\\'")}'`).join(',')}]`;

  const sql = `
    SELECT count() AS c
    FROM ${CH_TABLE}
    WHERE operationType = 1
      AND name IN ${arrayLiteral}
      AND dateTime_ekb >= toDateTime('${startStr}')
      AND dateTime_ekb < toDateTime('${endStr}')
    FORMAT JSON
  `.trim();

  const url = `${CLICKHOUSE_HTTP}/?user=${encodeURIComponent(CLICKHOUSE_USER)}&password=${encodeURIComponent(CLICKHOUSE_PASSWORD)}&database=${encodeURIComponent(CLICKHOUSE_DB)}`;
  if (CAPACITY_DEBUG) {
    log('countSalesForInterval', startStr, '->', endStr, 'services=', OFD_SERVICE_NAMES);
    log('SQL:', sql);
  }

  try {
    const resp = await axios.post(url, sql, { headers: { 'Content-Type': 'text/plain' }, timeout: 8000, httpsAgent: agent, validateStatus: () => true });
    if (resp.status !== 200) { if (CAPACITY_DEBUG) err('ClickHouse non-200', resp.status); return 0; }
    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    return Number(data?.data?.[0]?.c || 0);
  } catch (e) {
    if (CAPACITY_DEBUG) err('countSalesForInterval error', e?.message || e);
    return 0;
  }
}

router.get('/ping', (req, res) => res.json({ ok: true, route: '/api/capacity/ping' }));

/**
 * /now
 * Optional query parameters:
 *  - at=ISO_TIMESTAMP (например 2025-11-15T21:34:00+05:00) — считать как будто сейчас = at
 *  - bucket=N (число) — принудительно использовать bucket N (интервал рассчитывается на день at/now)
 */
router.get('/now', async (req, res) => {
  const tStart = Date.now();
  try {
    // parse optional at parameter
    const atParam = req.query.at;
    let requestedAt;
    if (atParam) {
      const parsed = DateTime.fromISO(String(atParam), { zone: TIMEZONE });
      if (!parsed.isValid) {
        // попытка без TZ
        requestedAt = DateTime.fromFormat(String(atParam), "yyyy-LL-dd HH:mm", { zone: TIMEZONE });
        if (!requestedAt.isValid) requestedAt = nowLocal();
      } else {
        requestedAt = parsed;
      }
    } else {
      requestedAt = nowLocal();
    }

    // determine displayBucket: optional override via ?bucket=
    const forcedBucket = req.query.bucket ? Number(req.query.bucket) : null;
    let displayBucket;
    if (forcedBucket && Number.isInteger(forcedBucket)) {
      displayBucket = forcedBucket;
    } else {
      displayBucket = getDisplayBucketForNow(requestedAt);
    }

    let intervalStart = null, intervalEnd = null;
    if (displayBucket !== null) {
      const ivl = getBucketIntervalByBucket(requestedAt, displayBucket);
      intervalStart = ivl.start; intervalEnd = ivl.end;
      log('displayBucket', displayBucket, 'interval', intervalStart.toISO(), '->', intervalEnd.toISO(), 'requestedAt=', requestedAt.toISO());
    } else {
      log('displayBucket=null (outside working hours) requestedAt=', requestedAt.toISO());
    }

    // lanesReserved at requestedAt (we still use schedule for that moment)
    let lanesReserved = 0;
    try { lanesReserved = await getOccupiedLanesAt(requestedAt); log('lanesReserved=', lanesReserved); } catch (e) { err('getOccupiedLanesAt error', e?.message || e); lanesReserved = 0; }

    // ofd sales for interval
    let ofdSales = 0;
    if (intervalStart && intervalEnd) {
      try { ofdSales = await countSalesForInterval(intervalStart, intervalEnd); } catch (e) { err('ofdSales error', e); ofdSales = 0; }
    }

    // visits from posesheniya for interval
    let visits = 0;
    if (intervalStart && intervalEnd) {
      try { visits = await fetchPoolVisitorsForInterval(intervalStart, intervalEnd); } catch (e) { err('visits error', e); visits = 0; }
    }

    const external_workload = Number(ofdSales || 0) + Number(visits || 0);
    const lanesPenalty = lanesReserved * LANE_CAPACITY;
    let available = MAX_CAPACITY - lanesPenalty - external_workload;
    if (available < 0) available = 0;

    log('summary', {
      requestedAt: requestedAt.toISO(),
      now_server: nowLocal().toISO(),
      bucket: displayBucket,
      intervalStart: intervalStart?.toISO(),
      intervalEnd: intervalEnd?.toISO(),
      lanesReserved,
      ofdSales,
      visits,
      external_workload,
      lanesPenalty,
      available,
      compute_ms: Date.now() - tStart
    });

    res.json({
      timestamp: nowLocal().toISO(),
      requested_at: requestedAt.toISO(),
      bucket: displayBucket,
      max_capacity: MAX_CAPACITY,
      lane_capacity: LANE_CAPACITY,
      lanes_reserved: lanesReserved,
      ofd_sales: ofdSales,
      visits,
      external_workload,
      available,
      details: {
        bucket_interval_start: intervalStart?.toISO() || null,
        bucket_interval_end: intervalEnd?.toISO() || null
      },
      latency_ms: Date.now() - tStart
    });
  } catch (e) {
    err('capacity/now error', e?.message || e);
    if (CAPACITY_DEBUG) err(e);
    res.status(500).json({ error: 'internal_error', message: e?.message || String(e) });
  }
});

module.exports = router;