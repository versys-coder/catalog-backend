// services/alfaService.js
// Поддержка токена ИЛИ userName/password (авто-выбор).
// Полностью соответствует протоколу Альфы.

const axios = require('axios');

const ALFA_BASE_URL = (process.env.ALFA_BASE_URL || '').replace(/\/+$/, '');
const ALFA_TOKEN = process.env.ALFA_TOKEN || '';
const ALFA_USER = process.env.ALFA_USER || process.env.ALFA_USERNAME || '';
const ALFA_PASS = process.env.ALFA_PASS || process.env.ALFA_PASSWORD || '';

const ALFA_SKIP_SSL_VERIFY =
  process.env.ALFA_SKIP_SSL_VERIFY === '1' ||
  String(process.env.ALFA_SKIP_SSL_VERIFY || '').toLowerCase() === 'true';

if (!ALFA_BASE_URL) {
  console.error('[alfaService] ALFA_BASE_URL is not set');
}
if (!ALFA_TOKEN && (!ALFA_USER || !ALFA_PASS)) {
  console.error('[alfaService] Neither ALFA_TOKEN nor ALFA_USER+ALFA_PASS is set');
}

const client = axios.create({
  baseURL: ALFA_BASE_URL,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  },
  timeout: 20000
});

// Sandbox: отключение SSL
if (ALFA_SKIP_SSL_VERIFY) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * alfaPost(path, params)
 * Автоматически добавляет токен ИЛИ user/pass.
 */
async function alfaPost(path, params = {}) {
  const p = String(path || '').replace(/^\/+/, '');
  const fullPath = p.startsWith('rest/') ? `/${p}` : `/rest/${p}`;

  const body = new URLSearchParams();

  // Авторизация: токен ИЛИ user+pass
  if (ALFA_TOKEN) {
    body.append('token', ALFA_TOKEN);
  } else {
    body.append('userName', ALFA_USER);
    body.append('password', ALFA_PASS);
  }

  // Остальные параметры
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }

  try {
    const resp = await client.post(fullPath, body.toString());
    return { ok: true, data: resp.data, status: resp.status };
  } catch (err) {
    const data = err.response?.data ?? null;
    const status = err.response?.status ?? null;
    console.error('[alfaService] ERROR:', data || err.message);
    return { ok: false, error: err.message, data, status };
  }
}

// Удобные врапперы

async function alfaRegister(fields) {
  return alfaPost('/register.do', fields);
}

async function alfaGetStatusExtended(params) {
  return alfaPost('/getOrderStatusExtended.do', params);
}

async function alfaDecline(orderId) {
  return alfaPost('/decline.do', { orderId });
}

module.exports = {
  alfaPost,
  alfaRegister,
  alfaGetStatusExtended,
  alfaDecline
};
