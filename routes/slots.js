const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const { API_URL, CLUB_ID, API_USERNAME, API_PASSWORD, API_KEY } = process.env;
  if (!API_URL || !CLUB_ID || !API_USERNAME || !API_PASSWORD || !API_KEY) {
    return res.status(500).json({ error: 'Some required environment variables are missing' });
  }

  let start_date, end_date;
  if (req.query.start_date && req.query.end_date) {
    start_date = req.query.start_date;
    end_date = req.query.end_date;
  } else {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    start_date = start.toISOString().slice(0, 10);
    end_date = end.toISOString().slice(0, 10);
  }

  const params = new URLSearchParams({
    club_id: CLUB_ID,
    start_date,
    end_date,
  });

  const basicAuth = Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');
  const url = `${API_URL}classes?${params.toString()}`;

  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

    const apiRes = await fetch(url, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        apikey: API_KEY,
        'User-Agent': 'PostmanRuntime/7.44.1',
        Accept: '*/*',
      }
    });

    const text = await apiRes.text();

    try {
      const data = JSON.parse(text);
      const TARGET_SERVICE_ID = "9672bb23-7060-11f0-a902-00583f11e32d";
      const slots = (data.data || [])
        .filter(item => item.service?.id === TARGET_SERVICE_ID)
        .map(item => ({
          appointment_id: item.appointment_id,
          start_date: item.start_date,
          end_date: item.end_date,
          available_slots: item.available_slots,
          capacity: item.capacity,
          room: item.room?.title,
          service: item.service?.title,
          service_id: item.service?.id,
        }));

      res.status(200).json({ slots });
    } catch {
      res.status(502).json({ error: 'Invalid JSON from backend', raw: text });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

module.exports = router;