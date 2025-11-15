const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const apiUrl = "https://api.aramba.ru/singleSms?apikey=ERS-LKDoaGCQRfSH";
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    let data;
    const contentType = resp.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await resp.json();
    } else {
      data = { text: await resp.text() };
    }

    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
