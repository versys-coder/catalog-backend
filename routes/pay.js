// routes/pay.js
// Маршруты оплаты через Альфу + интеграция FastSale + TTL / ограничение заказов.
//
// Эндпоинты:
//   POST /api/pay/create  — регистрация заказа в Альфе
//   GET  /api/pay/status  — запрос статуса в Альфе + триггер FastSale
//
// Особенности:
//   - TTL заказа 5 минут ( PAY_TTL_MS, по умолчанию 5*60*1000 )
//   - По истечении TTL вызывается /rest/decline.do, meta-файлы удаляются,
//     событие логируется в JSONL-файл PAY_DECLINED_LOG
//   - Ограничение числа активных заказов на телефон / IP
//     (PAY_MAX_ACTIVE_PER_PHONE, PAY_MAX_ACTIVE_PER_IP)
//   - meta-файлы в каталоге PAY_ORDERS_DIR (по умолчанию /opt/catalog/tmp/orders)

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const {
  alfaRegister,
  alfaGetStatusExtended,
  alfaDecline
} = require('../services/alfaService');
const { sendFastSale } = require('../services/fastsaleService');

// -----------------------------
// Константы / настройки
// -----------------------------

const TTL_MS =
  parseInt(process.env.PAY_TTL_MS || '', 10) || 5 * 60 * 1000; // 5 минут
const ORDERS_DIR =
  process.env.PAY_ORDERS_DIR || '/opt/catalog/tmp/orders';
const DECLINED_LOG =
  process.env.PAY_DECLINED_LOG || '/opt/catalog/tmp/pay_declined.jsonl';
const MAX_ACTIVE_PER_PHONE =
  parseInt(process.env.PAY_MAX_ACTIVE_PER_PHONE || '', 10) || 3;
const MAX_ACTIVE_PER_IP =
  parseInt(process.env.PAY_MAX_ACTIVE_PER_IP || '', 10) || 20;

ensureDir(ORDERS_DIR);
ensureDir(path.dirname(DECLINED_LOG));

// -----------------------------
// Middleware логирования
// -----------------------------
router.use((req, _res, next) => {
  console.log(
    `[PAY] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ip=${req.ip}`
  );
  next();
});

// -----------------------------
// Utils
// -----------------------------
function normRub(v) {
  let s = String(v || '').replace(/\s+/g, '').replace(',', '.');
  const f = parseFloat(s);
  return Number.isFinite(f) ? Math.round(f) : 0;
}

function ensureDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
}

function safeReadJson(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

function isMetaActive(meta, nowMs = Date.now()) {
  if (!meta) return false;
  if (meta.cancelledByTTL) return false;
  if (meta.paymentFinalized) return false;

  const createdStr = meta.created || meta.createdAt;
  const createdTs = createdStr ? Date.parse(createdStr) : NaN;
  const ttl = meta.ttlMs || TTL_MS;

  if (!Number.isFinite(createdTs)) return false;
  return nowMs - createdTs <= ttl;
}

function logDeclined(meta, alfaRes, reason = 'ttl') {
  try {
    const record = {
      ts: new Date().toISOString(),
      reason,
      orderId: meta.orderId,
      orderNumber: meta.orderNumber,
      phone: meta.phone,
      email: meta.email,
      amount_kop: meta.amount_kop,
      ip: meta.clientIp,
      alfa: alfaRes
    };
    fs.appendFileSync(DECLINED_LOG, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('[PAY] DECLINE LOG ERROR:', e.message);
  }
}

function countActiveOrders(phone, ip) {
  let byPhone = 0;
  let byIp = 0;
  const nowMs = Date.now();

  try {
    const files = fs.readdirSync(ORDERS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const meta = safeReadJson(path.join(ORDERS_DIR, f));
      if (!isMetaActive(meta, nowMs)) continue;

      if (phone && meta.phone === phone) byPhone++;
      if (ip && meta.clientIp === ip) byIp++;
    }
  } catch (e) {
    console.error('[PAY] countActiveOrders error:', e.message);
  }

  return { byPhone, byIp };
}

function isPaidStatus(data) {
  const st = data.orderStatus;
  const ps = data.paymentAmountInfo && data.paymentAmountInfo.paymentState;
  const approved =
    data.paymentAmountInfo && Number(data.paymentAmountInfo.approvedAmount || 0);

  // 2 + approved > 0 — обычно "оплачен"
  if (String(st) === '2' && approved > 0) return true;
  if (ps === 'DEPOSITED') return true;
  return false;
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) {
    return xf.split(',')[0].trim();
  }
  return req.ip || '';
}

// -----------------------------
// POST /api/pay/create
// -----------------------------
router.post('/create', async (req, res) => {
  try {
    const b = req.body || {};

    const serviceId = b.service_id || b.serviceId || b.id;
    const serviceName = b.service_name || b.serviceName || b.name;
    const price = normRub(b.price);
    const phone = String(b.phone || '').trim();
    const email = String(b.email || '').trim();

    if (!serviceId || !serviceName || !price || !phone || !email) {
      return res
        .status(400)
        .json({ ok: false, message: 'Missing fields' });
    }

    const clientIp = getClientIp(req);

    // Ограничение активных заказов
    const counters = countActiveOrders(phone, clientIp);
    if (MAX_ACTIVE_PER_PHONE > 0 && counters.byPhone >= MAX_ACTIVE_PER_PHONE) {
      return res.status(429).json({
        ok: false,
        message:
          'Слишком много активных неоплаченных заказов на этот телефон. Завершите или дождитесь окончания предыдущих.'
      });
    }
    if (MAX_ACTIVE_PER_IP > 0 && counters.byIp >= MAX_ACTIVE_PER_IP) {
      return res.status(429).json({
        ok: false,
        message:
          'Слишком много активных неоплаченных заказов с данного IP.'
      });
    }

    const amountKop = price * 100;
    const orderNumber = `svc${serviceId}_${Date.now()}`;

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const returnUrl = `${proto}://${host}/catalog/public/return_alfa.php`;

    const fields = {
      amount: amountKop,
      currency: '810',
      language: 'ru',
      orderNumber,
      returnUrl,
      clientId: phone,
      email,
      description: `${serviceName} #${serviceId}`
    };

    const alfaResp = await alfaRegister(fields);

    if (!alfaResp.ok) {
      return res.status(502).json({
        ok: false,
        message: 'Alfa request failed',
        raw: alfaResp
      });
    }

    const data = alfaResp.data;

    if (data.errorCode && data.errorCode !== '0') {
      return res.status(400).json({
        ok: false,
        message: data.errorMessage || 'Alfa error',
        raw: data
      });
    }

    const now = new Date();
    const meta = {
      created: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      ttlMs: TTL_MS,

      orderNumber,
      orderId: data.orderId,
      formUrl: data.formUrl,

      serviceId,
      serviceName,
      phone,
      email,
      clientIp,

      amount_kop: amountKop,
      price_rub: price,

      fastSaleSent: false,
      paymentFinalized: false
    };

    // Сохраняем мету по orderId и orderNumber
    try {
      if (meta.orderId) {
        fs.writeFileSync(
          path.join(ORDERS_DIR, `${meta.orderId}.json`),
          JSON.stringify(meta, null, 2)
        );
      }
      fs.writeFileSync(
        path.join(ORDERS_DIR, `${orderNumber}.json`),
        JSON.stringify(meta, null, 2)
      );
    } catch (e) {
      console.warn('[PAY] WRITE META FAIL:', e.message);
    }

    return res.json({
      ok: true,
      orderId: meta.orderId,
      orderNumber,
      formUrl: meta.formUrl,
      raw: data
    });
  } catch (err) {
    console.error('[PAY] create error:', err);
    res
      .status(500)
      .json({ ok: false, message: 'internal_error', error: String(err) });
  }
});

// -----------------------------
// GET /api/pay/status?orderId=...
// -----------------------------
router.get('/status', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res
        .status(400)
        .json({ ok: false, message: 'orderId required' });
    }

    const metaPath = path.join(ORDERS_DIR, `${orderId}.json`);
    const meta = fs.existsSync(metaPath) ? safeReadJson(metaPath) : null;

    // TTL / автоотмена
    if (meta && isMetaActive(meta) === false && !meta.cancelledByTTL) {
      console.log(
        `[PAY] TTL expired for orderId=${orderId}, calling decline.do`
      );
      const declineRes = await alfaDecline(orderId);

      const updated = {
        ...(meta || {}),
        cancelledByTTL: true,
        cancelledAt: new Date().toISOString(),
        alfaDeclineResult: declineRes
      };

      logDeclined(updated, declineRes, 'ttl');

      // удаляем мету по orderId и orderNumber
      safeUnlink(metaPath);
      if (updated.orderNumber) {
        safeUnlink(
          path.join(ORDERS_DIR, `${updated.orderNumber}.json`)
        );
      }

      return res.status(408).json({
        ok: false,
        timeout: true,
        message: 'Время оплаты истекло. Заказ отменён.',
        decline: declineRes
      });
    }

    // Запрос статуса в Альфе
    const alfaResp = await alfaGetStatusExtended({ orderId });

    if (!alfaResp.ok) {
      return res.status(502).json({
        ok: false,
        message: 'alfa_status_failed',
        raw: alfaResp
      });
    }

    const data = alfaResp.data;
    const paid = isPaidStatus(data);

    // Если оплата прошла и есть мета — триггер FastSale один раз
    if (paid && meta && !meta.fastSaleSent) {
      console.log('[PAY] Paid detected, sending FastSale for', orderId);
      const fsResp = await sendFastSale(meta);

      const updated = {
        ...meta,
        fastSaleSent: true,
        fastSaleAt: new Date().toISOString(),
        fastSaleResult: fsResp,
        paymentFinalized: true
      };

      try {
        fs.writeFileSync(
          metaPath,
          JSON.stringify(updated, null, 2)
        );
        if (updated.orderNumber) {
          fs.writeFileSync(
            path.join(ORDERS_DIR, `${updated.orderNumber}.json`),
            JSON.stringify(updated, null, 2)
          );
        }
      } catch (e) {
        console.warn(
          '[PAY] META SAVE AFTER FASTSALE FAIL:',
          e.message
        );
      }
    }

    return res.json({
      ok: true,
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      orderStatus: data.orderStatus,
      actionCode: data.actionCode,
      actionCodeDescription: data.actionCodeDescription,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      paymentAmountInfo: data.paymentAmountInfo,
      raw: data
    });
  } catch (err) {
    console.error('[PAY] status error:', err);
    res
      .status(500)
      .json({ ok: false, message: 'internal_error', error: String(err) });
  }
});

module.exports = router;
