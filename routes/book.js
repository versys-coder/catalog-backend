const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  console.log('[BOOK] New request', {
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query,
  });

  try {
    const { appointment_id, usertoken } = req.body || {};
    if (!appointment_id || !usertoken) {
      return res.status(400).json({ error: 'appointment_id and usertoken required' });
    }

    const { API_URL, API_KEY, API_USERNAME, API_PASSWORD } = process.env;
    if (!API_URL || !API_KEY || !API_USERNAME || !API_PASSWORD) {
      return res.status(500).json({ error: 'API_URL, API_KEY, API_USERNAME or API_PASSWORD not set in environment variables' });
    }

    const basicAuth = 'Basic ' + Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');
    const apiPayload = { appointment_id };
    const apiHeaders = {
      'Content-Type': 'application/json',
      apikey: API_KEY,
      usertoken: usertoken,
      'User-Agent': 'PostmanRuntime/7.45.0',
      'Authorization': basicAuth,
    };

    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const apiRes = await fetch(`${API_URL}client_to_class`, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify(apiPayload),
    });

    const status = apiRes.status;
    const responseHeaders = {};
    apiRes.headers.forEach((val, key) => responseHeaders[key] = val);
    const text = await apiRes.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { raw: text };
    }

    res.status(status).json({
      status,
      data,
      raw: text,
      responseHeaders,
      error: (status < 200 || status >= 300) ? (data?.error || data?.message || text) : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: String(e), stack: e?.stack });
  }
});

module.exports = router;
