/**
 * services/posesheniya.js
 *
 * Клиент для получения детальных посещений (club_workload_detail).
 * Экспортирует:
 *  - fetchPoolVisitorsForInterval(startLuxon, endLuxon) -> Number (уникальные посетители с start ∈ [start,end))
 *  - getCurrentPoolClientsFull() -> Array объектов { id, name, ticket, start, end } (present now)
 *
 * Настройки:
 *  - API_URL, API_KEY, API_USERNAME, API_PASSWORD, CLUB_ID, TIMEZONE
 *  - CLUB_WORKLOAD_FILTER_EXCLUDE (через запятую). По умолчанию: 'Групповое занятие,Тренажерный зал,Тренажёрный зал'
 *  - CLUB_WORKLOAD_DEBUG=1 — подробные логи
 *  - POSESHENIYA_REJECT_UNAUTHORIZED=0 — отключить TLS-проверку (по необходимости)
 */

const axios = require('axios');
const https = require('https');
const { DateTime } = require('luxon');

const LOG_PREFIX = '[posesheniya]';
const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || '';
const API_USERNAME = process.env.API_USERNAME || '';
const API_PASSWORD = process.env.API_PASSWORD || '';
const CLUB_ID = process.env.CLUB_ID || '';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Yekaterinburg';
const TIMEOUT = Number(process.env.CLUB_WORKLOAD_TIMEOUT_MS || 5000);
const DEBUG = process.env.CLUB_WORKLOAD_DEBUG === '1';
const REJECT_UNAUTHORIZED = process.env.POSESHEHIYA_REJECT_UNAUTHORIZED === '0' ? false : true;

const DEFAULT_EXCLUDE = 'Групповое занятие,Тренажерный зал, Продажа, Аквастарт'; // по умолчанию не исключаем "Аквастарт"
const EXCLUDE_PATTERNS = (process.env.CLUB_WORKLOAD_FILTER_EXCLUDE || DEFAULT_EXCLUDE)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const httpsAgent = new https.Agent({ rejectUnauthorized: REJECT_UNAUTHORIZED });
const DETAIL_ENDPOINT = API_URL ? `${API_URL}/club_workload_detail` : '';

function log(...args) { if (DEBUG) console.log(new Date().toISOString(), LOG_PREFIX, ...args); }
function err(...args) { console.error(new Date().toISOString(), LOG_PREFIX, ...args); }

/**
 * Попытки распознать строку даты в нескольких форматах и вернуть Luxon DateTime.
 */
function parseDate(str) {
  if (!str) return null;
  try {
    // Пробуем ISO
    let dt = DateTime.fromISO(String(str), { zone: TIMEZONE });
    if (dt.isValid) return dt;

    // Чаще встречающиеся форматы
    const formats = [
      'yyyy-MM-dd HH:mm',
      'yyyy-MM-dd HH:mm:ss',
      'dd.MM.yyyy HH:mm',
      'dd.MM.yyyy HH:mm:ss',
      "yyyy-MM-dd'T'HH:mm:ss",
      "yyyy-MM-dd'T'HH:mm:ss.SSSZZ",
    ];
    for (const f of formats) {
      dt = DateTime.fromFormat(String(str), f, { zone: TIMEZONE });
      if (dt.isValid) return dt;
    }

    // unix ms
    const num = Number(str);
    if (!Number.isNaN(num)) {
      dt = DateTime.fromMillis(num, { zone: TIMEZONE });
      if (dt.isValid) return dt;
    }
  } catch (e) {
    if (DEBUG) err('parseDate error', e);
  }
  if (DEBUG) err('parseDate failed for', str);
  return null;
}

/**
 * Проверка: считать запись как "свободное плавание" (true) или исключать (false).
 * По умолчанию исключаем только групповые занятия и тренажёрный зал.
 * Если нужно исключать Аквастарт — добавь 'Аквастарт' в CLUB_WORKLOAD_FILTER_EXCLUDE в .env.
 */
function isPoolFreeSwim(item) {
  try {
    const title = (item?.ticket?.title || item?.ticketTitle || item?.serviceName || '').toString().toLowerCase();
    const type = (item?.ticket?.type || '').toString().toLowerCase();

    for (const pattern of EXCLUDE_PATTERNS) {
      if (!pattern) continue;
      const pat = pattern.toLowerCase();
      if (title.includes(pat)) {
        log('excluded by pattern', pattern, 'title=', item?.ticket?.title || item?.ticketTitle);
        return false;
      }
    }

    // если это явный пакет групповых занятий - исключаем
    if (type === 'package' && title.includes('групповое занятие')) {
      log('excluded by package group', title);
      return false;
    }

    return true;
  } catch (e) {
    if (DEBUG) err('isPoolFreeSwim error', e, item);
    return false;
  }
}

/**
 * Нормализует ответ axios в массив.
 */
function normalizeArray(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.data?.data)) return resp.data.data;
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.result)) return resp.result;
  if (Array.isArray(resp?.data?.items)) return resp.data.items;
  return [];
}

/**
 * Собираем конфиг запроса — добавляем club_id как параметр, если он задан.
 */
function buildRequestConfig() {
  const headers = { 'User-Agent': 'catalog-backend/posesheniya (axios)' };
  if (API_KEY) headers.apikey = API_KEY;
  const cfg = {
    headers,
    httpsAgent,
    timeout: TIMEOUT,
    validateStatus: () => true,
  };
  if (CLUB_ID) {
    cfg.params = { club_id: CLUB_ID };
  }
  // Basic auth если задан
  if (API_USERNAME) {
    cfg.auth = { username: API_USERNAME, password: API_PASSWORD || '' };
  }
  return cfg;
}

/**
 * fetchPoolVisitorsForInterval(startLuxon, endLuxon)
 * Возвращает число уникальных посетителей, у которых start_date ∈ [start,end),
 * и которые проходят isPoolFreeSwim.
 */
async function fetchPoolVisitorsForInterval(startLuxon, endLuxon) {
  log('fetchPoolVisitorsForInterval', startLuxon?.toISO(), '->', endLuxon?.toISO(), 'CLUB_ID=', CLUB_ID);
  if (!DETAIL_ENDPOINT) {
    err('DETAIL_ENDPOINT not configured');
    return 0;
  }
  if (!startLuxon || !endLuxon) {
    err('Invalid interval passed');
    return 0;
  }

  const t0 = Date.now();
  try {
    const cfg = buildRequestConfig();
    log('HTTP GET', DETAIL_ENDPOINT, 'params=', cfg.params ? cfg.params : '(none)');
    const resp = await axios.get(DETAIL_ENDPOINT, cfg);
    log('HTTP status', resp.status, 'content-type=', resp.headers?.['content-type'] || '');

    if (resp.status !== 200) {
      err('DETAIL endpoint returned non-200', resp.status, resp.statusText);
      if (DEBUG) err('resp.data=', JSON.stringify(resp.data).slice(0, 1000));
      return 0;
    }

    const arr = normalizeArray(resp);
    log('normalizeArray count=', arr.length, 'took_ms=', Date.now() - t0);

    if (DEBUG && arr.length) {
      const sample = arr.slice(0, 8).map(i => ({
        start: i.start_date,
        end: i.end_date,
        client: i.client?.name,
        client_id: i.client?.id,
        ticket: i.ticket?.title || i.ticketTitle || i.serviceName
      }));
      log('sample items=', JSON.stringify(sample, null, 0));
    }

    const seen = new Set();
    let count = 0, inWindow = 0, filtered = 0, badDate = 0;

    for (const item of arr) {
      const sd = parseDate(item.start_date);
      if (!sd) { badDate++; if (DEBUG) log('badDate parse failed for', item?.start_date); continue; }
      if (sd >= startLuxon && sd < endLuxon) {
        inWindow++;
        if (!isPoolFreeSwim(item)) { filtered++; continue; }
        const cid = item?.client?.id || `${item?.client?.name || 'no-name'}:${item?.ticket?.title || item?.ticketTitle || item?.serviceName || 'no-ticket'}`;
        if (!seen.has(cid)) { seen.add(cid); count++; } else if (DEBUG) log('duplicate skipped', cid);
      }
    }

    log('interval stats', { inWindow, allowed: count, filtered, badDate, uniqueKeys: seen.size, duration_ms: Date.now() - t0 });
    return count;
  } catch (e) {
    err('fetchPoolVisitorsForInterval error', e?.message || e);
    if (DEBUG) err(e);
    return 0;
  }
}

/**
 * getCurrentPoolClientsFull()
 * Возвращает массив уникальных клиентов, которые СЕЙЧАС в клубе (start <= now < end)
 */
async function getCurrentPoolClientsFull() {
  log('getCurrentPoolClientsFull - CLUB_ID=', CLUB_ID);
  const out = [];
  if (!DETAIL_ENDPOINT) {
    err('DETAIL_ENDPOINT not configured');
    return out;
  }
  const now = DateTime.now().setZone(TIMEZONE);
  const t0 = Date.now();
  try {
    const cfg = buildRequestConfig();
    const resp = await axios.get(DETAIL_ENDPOINT, cfg);
    log('HTTP status', resp.status);
    if (resp.status !== 200) {
      err('DETAIL endpoint returned non-200', resp.status);
      return out;
    }
    const arr = normalizeArray(resp);
    if (DEBUG) log('items fetched', arr.length);

    const seen = new Set();
    for (const item of arr) {
      const sd = parseDate(item.start_date);
      const ed = parseDate(item.end_date);
      if (!sd || !ed) continue;
      if (sd <= now && now < ed) {
        if (!isPoolFreeSwim(item)) { if (DEBUG) log('present but filtered out', item.client?.name, item.ticket?.title); continue; }
        const cid = item?.client?.id || `${item?.client?.name || 'no-name'}:${item?.ticket?.title || item?.ticketTitle || item?.serviceName || 'no-ticket'}`;
        if (seen.has(cid)) continue;
        seen.add(cid);
        out.push({
          id: cid,
          name: item.client?.name || null,
          ticket: item.ticket?.title || item?.ticketTitle || item?.serviceName || null,
          start: item.start_date,
          end: item.end_date
        });
      }
    }

    log('getCurrentPoolClientsFull result', { present: out.length, uniqueKeys: seen.size, duration_ms: Date.now() - t0 });
    if (DEBUG && out.length) log('present sample=', JSON.stringify(out.slice(0, 10), null, 2));
    return out;
  } catch (e) {
    err('getCurrentPoolClientsFull error', e?.message || e);
    if (DEBUG) err(e);
    return out;
  }
}

module.exports = {
  fetchPoolVisitorsForInterval,
  getCurrentPoolClientsFull,
};