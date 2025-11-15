require('dotenv').config();

/* Константы */
const TOTAL_LANES = 10;
const LANE_CAPACITY = 15;

/* Вызов внешнего API расписания */
async function fetchExternalSchedule(startIso, endIso) {
  const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL;
  const API_USERNAME = process.env.API_USERNAME;
  const API_PASSWORD = process.env.API_PASSWORD;

  if (!EXTERNAL_API_URL) throw new Error('EXTERNAL_API_URL not configured');

  const body = { method: 'classes_all', start_date: startIso, end_date: endIso };
  const headers = { 'Content-Type': 'application/json' };
  if (API_USERNAME) {
    const auth = Buffer.from(`${API_USERNAME}:${API_PASSWORD || ''}`).toString('base64');
    headers.Authorization = `Basic ${auth}`;
  }

  const resp = await fetch(EXTERNAL_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`External API HTTP ${resp.status}: ${await resp.text().catch(()=>'')}`);
  const json = await resp.json().catch(() => { throw new Error('External API JSON parse error'); });
  if (json?.error) throw new Error('External API logical error: ' + (json.error_txt || 'unknown'));
  return Array.isArray(json?.data) ? json.data : [];
}

/* Парсеры и утилиты (взято из poolWorkload) */
function parseRusDateTimeToParts(str) {
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const [, dd, MM, yyyy, HH, mm, ss] = m;
  return {
    dateIso: `${yyyy}-${MM}-${dd}`,
    hour: clampInt(HH, 0, 23),
    minute: clampInt(mm, 0, 59),
    second: clampInt(ss, 0, 59),
  };
}
function clampInt(v, min, max) { const n = parseInt(v, 10); return Math.max(min, Math.min(max, n)); }
function overlapsHour(start, end, h) {
  if (start.hour > h) return false;
  if (end.hour > h) return true;
  if (end.hour < h) return false;
  return end.minute > 0 || end.second > 0;
}
function isBreakHour(dateIso, hour) {
  if (hour !== 12) return false;
  const day = new Date(dateIso).getDay(); // 0 - вс
  return day >= 1 && day <= 5;
}

/* Нормализация событий */
function normalizeEvents(rawEvents) {
  const events = [];
  for (const ev of rawEvents) {
    if (!ev.start_date || !ev.end_date) continue;
    const start = parseRusDateTimeToParts(ev.start_date);
    const end = parseRusDateTimeToParts(ev.end_date);
    if (!start || !end) continue;

    const room = (ev.room || '').trim();
    const isTrainingPool = /Тренировочный бассейн/i.test(room);

    let laneNumber = null;
    const laneMatch = room.match(/(\d+)\s*дорожк/i);
    if (laneMatch) laneNumber = Number(laneMatch[1]);

    const activityType = (ev.activity_type || '').trim();
    const isReserve = ev.is_time_reserve === true || /резерв/i.test(activityType);
    const canceled = ev.canceled === true;

    let classType = 'other';
    if (isReserve) classType = 'reserve';
    else if (/групп/i.test(activityType)) classType = 'group';
    else if (/аренда/i.test(activityType)) classType = 'rent';
    else if (/персональ/i.test(activityType)) classType = 'personal';

    events.push({
      dateIso: start.dateIso,
      start,
      end,
      isTrainingPool,
      laneNumber,
      classType,
      active: !canceled,
    });
  }
  return events;
}

/* Почасовой расчет по событиям */
function calcHour(events, dateIso, hour) {
  const rel = events.filter(ev => ev.active && ev.dateIso === dateIso && overlapsHour(ev.start, ev.end, hour));
  const laneSet = new Set();
  let unknownLaneCount = 0;
  let personalCount = 0;

  for (const ev of rel) {
    if (!ev.isTrainingPool) continue;
    switch (ev.classType) {
      case 'personal':
        personalCount += 1; break;
      case 'group':
      case 'rent':
      case 'reserve':
        if (ev.laneNumber != null) laneSet.add(ev.laneNumber);
        else unknownLaneCount += 1;
        break;
      default: break;
    }
  }

  let busyLanes = laneSet.size + unknownLaneCount;
  if (busyLanes > TOTAL_LANES) busyLanes = TOTAL_LANES;

  const freeLanes = Math.max(0, TOTAL_LANES - busyLanes);
  const occupiedPlaces = busyLanes * LANE_CAPACITY + personalCount;
  const preliminaryFreePlaces = Math.max(0, TOTAL_LANES * LANE_CAPACITY - occupiedPlaces);

  return { busyLanes, freeLanes, preliminaryFreePlaces };
}

module.exports = {
  TOTAL_LANES, LANE_CAPACITY,
  fetchExternalSchedule, normalizeEvents, calcHour, isBreakHour
};