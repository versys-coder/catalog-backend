const axios = require('axios');
const { DateTime } = require('luxon');

function getTimezone() {
  return process.env.TIMEZONE || 'Asia/Yekaterinburg';
}
function nowLocal() {
  return DateTime.now().setZone(getTimezone());
}

async function getCurrentHourWorkload() {
  const base = (process.env.WORKLOAD_API_BASE || '').replace(/\/+$/, '');
  const key = process.env.WORKLOAD_API_KEY;
  if (!base || !key) return { count: 0, max: null };

  const url = `${base}/club_workload_quantity`;
  const resp = await axios.get(url, { headers: { apikey: key }, timeout: 5000 });
  const data = resp.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const max = typeof data.max === 'number' ? data.max : null;

  const now = nowLocal();
  const hh = String(now.hour).padStart(2, '0');
  const keyTime = `${hh}:00`;
  const found = items.find(i => i.time === keyTime);

  return { count: found ? Number(found.count || 0) : 0, max };
}

async function getDayWorkloadMap() {
  const base = (process.env.WORKLOAD_API_BASE || '').replace(/\/+$/, '');
  const key = process.env.WORKLOAD_API_KEY;
  if (!base || !key) return new Map();

  const url = `${base}/club_workload_quantity`;
  const resp = await axios.get(url, { headers: { apikey: key }, timeout: 5000 });
  const data = resp.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const map = new Map();
  for (const it of items) {
    map.set(it.time, Number(it.count || 0));
  }
  return map;
}

module.exports = { getCurrentHourWorkload, getDayWorkloadMap };