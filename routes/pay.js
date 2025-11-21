// routes/pay.js
const express = require('express');
const router = express.Router();
const { alfaPost } = require('../services/alfaService');
const fs = require('fs');
const path = require('path');

// лог
router.use((req, res, next) => {
  console.log(`>>> PAY: ${req.method} ${req.originalUrl}`);
  next();
});

function normRub(v) {
  let s = String(v || '').replace(/\s+/g, '').replace(',', '.');
  const f = parseFloat(s);
  return Number.isFinite(f) ? Math.round(f) : 0;
}

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

const ORDERS_DIR = '/opt/catalog/tmp/orders';
ensureDir(ORDERS_DIR);

/**
 * POST /api/pay/create
 * ТОЛЬКО РЕГИСТРАЦИЯ ЗАКАЗА В АЛЬФЕ
 */
router.post('/create', async (req, res) => {
  try {
    const b = req.body || {};

    const serviceId = b.service_id;
    const serviceName = b.service_name;
    const price = normRub(b.price);
    const phone = b.phone;
    const email = b.email;

    if (!serviceId || !serviceName || !price || !phone || !email) {
      return res.status(400).json({ ok: false, message: "Missing fields" });
    }

    const amountKop = price * 100;

    // Корректный orderNumber (ваш собственный)
    const orderNumber = `svc${serviceId}_${Date.now()}`;

    // Формируем returnUrl
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const returnUrl = `${proto}://${host}/catalog/public/return_alfa.php`;

    // Требуется официально для register.do
    const fields = {
      amount: amountKop,
      currency: "810",
      language: "ru",
      orderNumber,
      returnUrl,
      clientId: phone,
      email,
      description: `${serviceName} #${serviceId}`
    };

    const alfaResp = await alfaPost('/register.do', fields);

    if (!alfaResp.ok)
      return res.status(500).json({ ok: false, message: "Alfa request failed", raw: alfaResp });

    const data = alfaResp.data;

    if (data.errorCode && data.errorCode !== "0")
      return res.status(400).json({ ok: false, message: data.errorMessage, raw: data });

    const meta = {
      created: new Date().toISOString(),
      orderNumber,
      orderId: data.orderId,
      formUrl: data.formUrl,
      serviceId,
      serviceName,
      phone,
      email,
      amount_kop: amountKop,
      price_rub: price
    };

    // сохраняем 2 файла (по orderId и orderNumber)
    try {
      if (meta.orderId)
        fs.writeFileSync(path.join(ORDERS_DIR, meta.orderId + '.json'), JSON.stringify(meta, null, 2));

      fs.writeFileSync(path.join(ORDERS_DIR, orderNumber + '.json'), JSON.stringify(meta, null, 2));
    } catch (e) {
      console.warn("WRITE META FAIL:", e.message);
    }

    return res.json({
      ok: true,
      orderId: meta.orderId,
      orderNumber,
      formUrl: meta.formUrl,
      raw: data
    });

  } catch (err) {
    console.error("create error:", err);
    res.status(500).json({ ok: false, message: "internal_error", error: String(err) });
  }
});

/**
 * GET /api/pay/status?orderId=...
 * Только getOrderStatusExtended.do
 */
router.get('/status', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId)
      return res.status(400).json({ ok: false, message: "orderId required" });

    const alfaResp = await alfaPost('/getOrderStatusExtended.do', { orderId });

    if (!alfaResp.ok)
      return res.status(500).json({ ok: false, message: "alfa failed", raw: alfaResp });

    const data = alfaResp.data;

    return res.json({
      ok: true,
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      orderStatus: data.orderStatus, // 0 – создан, 2 – отменён, 6 – оплачен
      actionCode: data.actionCode,
      actionCodeDescription: data.actionCodeDescription,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      raw: data
    });

  } catch (err) {
    console.error("status error:", err);
    res.status(500).json({ ok: false, message: "internal_error", error: String(err) });
  }
});

module.exports = router;
