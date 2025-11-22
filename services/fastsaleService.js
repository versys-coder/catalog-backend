// services/fastsaleService.js
// Вынесенная логика отправки продажи в 1С (FastSale).
// Используется из pay.js после успешной оплаты в Альфе.

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

function safeInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function sendFastSale(meta) {
  try {
    const FASTSALE_ENDPOINT =
      process.env.FASTSALE_ENDPOINT || process.env.FASTSALES_ENDPOINT || '';
    const CLUB_ID = process.env.CLUB_ID || '';
    const API_USER_TOKEN = process.env.API_USER_TOKEN || '';
    const API_KEY = process.env.API_KEY || '';
    const BASIC_USER = process.env.BASIC_USER || '';
    const BASIC_PASS = process.env.BASIC_PASS || '';

    if (!FASTSALE_ENDPOINT || !CLUB_ID) {
      console.error(
        '[fastsaleService] FASTSALE_ENDPOINT or CLUB_ID is not set'
      );
      return { ok: false, error: 'missing_env' };
    }

    const priceRub = safeInt(meta.price_rub || meta.price || 0);
    const serviceId = meta.serviceId || meta.service_id;
    const phoneRaw = meta.phone || '';
    const normalizedPhone = String(phoneRaw).replace(/\D+/g, '');

    const docId = meta.docId || uuidv4();
    const dateIso = new Date().toISOString();

    const requestBody = {
      club_id: CLUB_ID,
      phone: normalizedPhone,
      sale: {
        docId,
        date: dateIso,
        cashless: priceRub,
        goods: [
          {
            id: serviceId,
            qnt: 1,
            summ: priceRub
          }
        ]
      }
    };

    const headers = {
      'Content-Type': 'application/json; charset=UTF-8'
    };
    if (API_USER_TOKEN) headers['usertoken'] = API_USER_TOKEN;
    if (API_KEY) headers['apikey'] = API_KEY;
    if (BASIC_USER || BASIC_PASS) {
      const base = Buffer.from(
        `${BASIC_USER}:${BASIC_PASS}`,
        'utf8'
      ).toString('base64');
      headers['Authorization'] = `Basic ${base}`;
    }

    console.log('[fastsaleService] POST', FASTSALE_ENDPOINT, 'body=', requestBody);

    const resp = await axios.post(FASTSALE_ENDPOINT, requestBody, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    });

    console.log(
      '[fastsaleService] HTTP',
      resp.status,
      'resp=',
      typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)
    );

    if (resp.status >= 400) {
      return { ok: false, status: resp.status, data: resp.data };
    }

    if (resp.data && resp.data.ok === false) {
      return { ok: false, status: resp.status, data: resp.data };
    }

    return { ok: true, status: resp.status, data: resp.data, docId };
  } catch (err) {
    console.error(
      '[fastsaleService] ERROR:',
      err.response?.data || err.message
    );
    return { ok: false, error: err.message, data: err.response?.data };
  }
}

module.exports = { sendFastSale };
