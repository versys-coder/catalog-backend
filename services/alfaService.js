// services/alfaService.js
// Клиент для Альфа e-Commerce.
// ВАЖНО: используется ТОЛЬКО токен авторизации (ALFA_TOKEN).
// Все запросы: POST x-www-form-urlencoded UTF-8 на ALFA_BASE_URL/rest/*.

const axios = require('axios');

const ALFA_BASE_URL = (process.env.ALFA_BASE_URL || '').replace(/\/+$/, '');
const ALFA_TOKEN = process.env.ALFA_TOKEN || '';
const ALFA_SKIP_SSL_VERIFY =
  process.env.ALFA_SKIP_SSL_VERIFY === '1' ||
  String(process.env.ALFA_SKIP_SSL_VERIFY || '').toLowerCase() === 'true';

if (!ALFA_BASE_URL) {
  console.error('[alfaService] ALFA_BASE_URL is not set');
}

if (!ALFA_TOKEN) {
  console.error('[alfaService] ALFA_TOKEN is not set');
}

if (ALFA_SKIP_SSL_VERIFY) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const client = axios.create({
  baseURL: ALFA_BASE_URL,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  },
  timeout: 20000
});

/**
 * Общий POST в Альфу.
 * path: "register.do" / "rest/getOrderStatusExtended.do" и т.п.
 * params: объект с полями запроса.
 */
async function alfaPost(path, params = {}) {
  const clean = String(path || '').replace(/^\/+/, '');
  const finalPath = clean.startsWith('rest/') ? `/${clean}` : `/rest/${clean}`;

  const body = new URLSearchParams();
  body.append('token', ALFA_TOKEN);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }

  try {
    const resp = await client.post(finalPath, body.toString());
    return { ok: true, status: resp.status, data: resp.data };
  } catch (err) {
    const data = err.response?.data || null;
    const status = err.response?.status || null;
    console.error('[alfaService] ERROR:', data || err.message);
    return { ok: false, status, error: err.message, data };
  }
}

// Методы Альфы
async function alfaRegister(fields) {
  return alfaPost('register.do', fields);
}

async function alfaGetStatusExtended(params) {
  return alfaPost('getOrderStatusExtended.do', params);
}

async function alfaDecline(orderId) {
  return alfaPost('decline.do', { orderId });
}

module.exports = {
  alfaPost,
  alfaRegister,
  alfaGetStatusExtended,
  alfaDecline
};
