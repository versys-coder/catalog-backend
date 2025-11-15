const express = require('express');
const router = express.Router();
const logger = require('../logger');

router.post('/', async (req, res) => {
  const { phone, confirmation_code, request_id, method } = req.body;
  const { API_URL, API_USERNAME, API_PASSWORD, API_KEY } = process.env;

  // Логируем входящий запрос
  logger.info('[IN] confirm_phone', { phone, confirmation_code, request_id, method });

  const url = `${API_URL}confirm_phone`;
  const payload = { phone, confirmation_code, request_id, method };
  const basicAuth = Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');

  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        apikey: API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await apiRes.text();

    // Логируем ответ внешнего API
    logger.info('[OUT] confirm_phone API response', { phone, confirmation_code, request_id, apiStatus: apiRes.status, apiResponse: text });

    try {
      const data = JSON.parse(text);
      res.status(apiRes.status).json(data);
    } catch {
      logger.error('[ERR] confirm_phone invalid JSON', { phone, confirmation_code, request_id, raw: text });
      res.status(502).json({ error: 'Invalid JSON from backend', raw: text });
    }
  } catch (e) {
    logger.error('[ERR] confirm_phone error', { phone, confirmation_code, request_id, error: String(e) });
    res.status(500).json({ error: String(e) });
  }
});

module.exports = router;