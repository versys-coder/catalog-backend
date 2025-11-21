// services/alfaService.js
// Универсальный клиент для Альфа-REST.
// Поддерживает ALFA_TOKEN или ALFA_USER+ALFA_PASS.
// Ожидает ALFA_BASE_URL без /rest (например: https://alfa.rbsuat.com/payment)

const axios = require('axios');

const ALFA_BASE_URL = (process.env.ALFA_BASE_URL || '').replace(/\/+$/, '');
const ALFA_TOKEN = process.env.ALFA_TOKEN || '';
const ALFA_USER = process.env.ALFA_USER || process.env.ALFA_USERNAME || '';
const ALFA_PASS = process.env.ALFA_PASS || process.env.ALFA_PASSWORD || '';
const ALFA_SKIP_SSL_VERIFY = (process.env.ALFA_SKIP_SSL_VERIFY === '1' || String(process.env.ALFA_SKIP_SSL_VERIFY).toLowerCase() === 'true');

if (!ALFA_BASE_URL) console.error('ALFA_BASE_URL is not set');
if (!ALFA_TOKEN && (!ALFA_USER || !ALFA_PASS)) console.error('ALFA_TOKEN or ALFA_USER+ALFA_PASS must be set');

const client = axios.create({
  baseURL: ALFA_BASE_URL, // we'll call e.g. '/rest/register.do'
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  timeout: 20000,
  // don't set auth header — credentials go into body as required by Alfa REST
});

if (ALFA_SKIP_SSL_VERIFY) {
  // eslint-disable-next-line node/no-deprecated-api
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * alfaPost(path, params)
 * path: '/rest/register.do' or 'rest/register.do' / '/register.do' (will normalize)
 * params: plain object
 */
async function alfaPost(path, params = {}) {
  const p = String(path || '').replace(/^\/+/, '');
  const fullPath = (p.startsWith('rest/') ? `/${p}` : `/rest/${p}`);

  const body = new URLSearchParams();

  // add auth params (token OR userName+password)
  if (ALFA_TOKEN) {
    body.append('token', ALFA_TOKEN);
  } else {
    body.append('userName', ALFA_USER);
    body.append('password', ALFA_PASS);
  }

  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }

  try {
    const resp = await client.post(fullPath, body.toString());
    // Always return { ok: true, data: resp.data, status: resp.status }
    return { ok: true, data: resp.data, status: resp.status };
  } catch (err) {
    // normalize error
    const data = err.response?.data ?? null;
    const status = err.response?.status ?? null;
    console.error('alfaPost ERROR:', data || err.message);
    return { ok: false, error: err.message, data, status };
  }
}

module.exports = { alfaPost };
