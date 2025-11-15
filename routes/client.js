const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/', async (req, res) => {
  const { usertoken } = req.body;
  const { API_URL, API_KEY, API_USERNAME, API_PASSWORD } = process.env;
  if (!API_URL || !API_KEY || !API_USERNAME || !API_PASSWORD) {
    return res.status(500).json({ error: "Missing API credentials or URL" });
  }
  if (!usertoken) {
    return res.status(400).json({ error: "Missing usertoken" });
  }
  const basicAuth = 'Basic ' + Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');
  const url = `${API_URL}client`;
  try {
    const apiRes = await axios.get(url, {
      headers: {
        apikey: API_KEY,
        usertoken: usertoken,
        Authorization: basicAuth,
        "User-Agent": "PostmanRuntime/7.45.0",
        Accept: "*/*"
      },
    });
    res.status(apiRes.status).json(apiRes.data);
  } catch (e) {
    if (e.response) {
      res.status(e.response.status).json(e.response.data);
    } else {
      res.status(500).json({ error: String(e) });
    }
  }
});

module.exports = router;