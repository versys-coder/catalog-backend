const express = require('express');
const router = express.Router();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

router.post('/', async (req, res) => {
  const { phone, pass_token } = req.body;
  const password = process.env.FITNESS_PASSWORD_DEFAULT;
  const url = process.env.API_URL ? process.env.API_URL.replace(/\/$/, '') + '/password' : null;
  const apikey = process.env.API_KEY;
  const apiUsername = process.env.API_USERNAME;
  const apiPassword = process.env.API_PASSWORD;

  // DEBUG: выводим все нужные переменные
  console.log('URL:', url);
  console.log('APIKEY:', apikey);
  console.log('API_USERNAME:', apiUsername);
  console.log('API_PASSWORD:', apiPassword);
  console.log('PASSWORD:', password);

  if (!phone || !pass_token) {
    return res.status(400).json({ error: "Missing phone or pass_token" });
  }
  if (!url) {
    return res.status(500).json({ error: "API_URL не определён в .env" });
  }
  if (!apikey) {
    return res.status(500).json({ error: "API_KEY не определён в .env" });
  }
  if (!apiUsername || !apiPassword) {
    return res.status(500).json({ error: "API_USERNAME или API_PASSWORD не определены в .env" });
  }

  const basicAuth = 'Basic ' + Buffer.from(`${apiUsername}:${apiPassword}`).toString('base64');

  try {
    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apikey,
        "User-Agent": "PostmanRuntime/7.45.0",
        "Authorization": basicAuth,
      },
      body: JSON.stringify({
        phone,
        password,
        pass_token,
      }),
    });

    const text = await apiRes.text();
    try {
      const data = JSON.parse(text);
      res.status(apiRes.status).json(data);
    } catch {
      res.status(apiRes.status).send(text);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;