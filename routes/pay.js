// routes/pay.js
// Логика оплаты через Альфу + TTL + FastSale.
// ВАЖНО: FastSale вызывается ТОЛЬКО в /status при подтверждённой оплате.

const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const {
  alfaRegister,
  alfaGetStatusExtended,
  alfaDecline
} = require("../services/alfaService");

const { sendFastSale } = require("../services/fastsaleService");

// ============================
// Настройки
// ============================

const TTL_MS =
  parseInt(process.env.PAY_TTL_MS || "", 10) || 5 * 60 * 1000;

const ORDERS_DIR =
  process.env.PAY_ORDERS_DIR || "/opt/catalog/tmp/orders";

const DECLINED_LOG =
  process.env.PAY_DECLINED_LOG ||
  "/opt/catalog/tmp/pay_declined.jsonl";

const MAX_ACTIVE_PER_PHONE =
  parseInt(process.env.PAY_MAX_ACTIVE_PER_PHONE || "", 10) || 3;

const MAX_ACTIVE_PER_IP =
  parseInt(process.env.PAY_MAX_ACTIVE_PER_IP || "", 10) || 20;

const STATIC_RETURN_URL = process.env.PAY_RETURN_URL || "";

ensureDir(ORDERS_DIR);
ensureDir(path.dirname(DECLINED_LOG));

// ============================
// Утилиты
// ============================

router.use((req, _res, next) => {
  console.log(
    `[PAY] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ip=${req.ip}`
  );
  next();
});

function ensureDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
}

function normRub(v) {
  let s = String(v || "").replace(/\s+/g, "").replace(",", ".");
  const f = parseFloat(s);
  return Number.isFinite(f) ? Math.round(f) : 0;
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

function isMetaActive(meta, now = Date.now()) {
  if (!meta) return false;
  if (meta.cancelledByTTL) return false;
  if (meta.paymentFinalized) return false;

  const createdTs = meta.created ? Date.parse(meta.created) : NaN;
  const ttl = meta.ttlMs || TTL_MS;

  if (!Number.isFinite(createdTs)) return false;
  return now - createdTs <= ttl;
}

function logDeclined(meta, alfaRes, reason = "ttl") {
  try {
    fs.appendFileSync(
      DECLINED_LOG,
      JSON.stringify({
        ts: new Date().toISOString(),
        reason,
        orderId: meta.orderId,
        orderNumber: meta.orderNumber,
        phone: meta.phone,
        amount_kop: meta.amount_kop,
        ip: meta.clientIp,
        alfa: alfaRes
      }) + "\n"
    );
  } catch {}
}

function countActive(phone, ip) {
  let byPhone = 0;
  let byIp = 0;
  const now = Date.now();

  try {
    for (const f of fs.readdirSync(ORDERS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const meta = safeReadJson(path.join(ORDERS_DIR, f));
      if (!isMetaActive(meta, now)) continue;
      if (phone && meta.phone === phone) byPhone++;
      if (ip && meta.clientIp === ip) byIp++;
    }
  } catch (e) {
    console.error("[PAY] countActive error:", e.message);
  }

  return { byPhone, byIp };
}

function isPaidStatus(d) {
  const st = d.orderStatus;
  const ps = d.paymentAmountInfo?.paymentState;
  const approved = Number(d.paymentAmountInfo?.approvedAmount || 0);

  if (String(st) === "2" && approved > 0) return true;
  if (ps === "DEPOSITED") return true;

  return false;
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0].trim();
  }
  return req.ip || "";
}

// ============================
// POST /create
// ============================
router.post("/create", async (req, res) => {
  try {
    const b = req.body || {};

    const serviceId = b.service_id || b.serviceId || b.id;
    const serviceName = b.service_name || b.serviceName || b.name;
    const priceRub = normRub(b.price);
    const phone = String(b.phone || "").trim();
    const backUrl = String(b.back_url || "").trim();

    if (!serviceId || !serviceName || !priceRub || !phone) {
      return res.status(400).json({
        ok: false,
        message: "Missing fields"
      });
    }

    const clientIp = getClientIp(req);
    const { byPhone, byIp } = countActive(phone, clientIp);

    if (MAX_ACTIVE_PER_PHONE > 0 && byPhone >= MAX_ACTIVE_PER_PHONE) {
      return res.status(429).json({
        ok: false,
        message: "Слишком много активных неоплаченных заказов на этот телефон."
      });
    }

    if (MAX_ACTIVE_PER_IP > 0 && byIp >= MAX_ACTIVE_PER_IP) {
      return res.status(429).json({
        ok: false,
        message: "Слишком много активных неоплаченных заказов с этого IP."
      });
    }

    const amount_kop = priceRub * 100;

    const orderNumber =
      "o" +
      Date.now().toString(36) +
      Math.random().toString(36).substring(2, 7);

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || req.protocol;

    let returnUrl = STATIC_RETURN_URL;
    if (!returnUrl) {
      returnUrl = `${proto}://${host}/catalog/public/return_alfa.php`;
    }

    if (backUrl) {
      const sep = returnUrl.includes("?") ? "&" : "?";
      returnUrl += sep + "back_url=" + encodeURIComponent(backUrl);
    }

    const fields = {
      amount: amount_kop,
      currency: "810",
      language: "ru",
      orderNumber,
      returnUrl,
      clientId: phone,
      description: `${serviceName} #${serviceId}`
    };

    const reg = await alfaRegister(fields);

    if (!reg.ok) {
      return res.status(502).json({
        ok: false,
        message: "alfa_register_failed",
        raw: reg
      });
    }

    const d = reg.data;

    if (d.errorCode && d.errorCode !== "0") {
      return res.status(400).json({
        ok: false,
        message: d.errorMessage || "Alfa error",
        raw: d
      });
    }

    const now = new Date();

    const meta = {
      created: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      ttlMs: TTL_MS,

      orderId: d.orderId,
      orderNumber,
      formUrl: d.formUrl,

      serviceId,
      serviceName,
      phone,
      backUrl,
      clientIp,

      amount_kop,
      price_rub: priceRub,

      fastSaleSent: false,
      paymentFinalized: false
    };

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
      console.error("[PAY] META WRITE ERROR:", e.message);
    }

    return res.json({
      ok: true,
      orderId: meta.orderId,
      orderNumber,
      formUrl: meta.formUrl,
      raw: d
    });
  } catch (err) {
    console.error("[PAY] create ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "internal_error"
    });
  }
});

// ============================
// GET /status
// ============================
router.get("/status", async (req, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        message: "orderId required"
      });
    }

    const metaPath = path.join(ORDERS_DIR, `${orderId}.json`);
    const meta = fs.existsSync(metaPath) ? safeReadJson(metaPath) : null;

    // TTL / автоотмена
    if (meta && !isMetaActive(meta) && !meta.cancelledByTTL) {
      const decl = await alfaDecline(orderId);

      const upd = {
        ...(meta || {}),
        cancelledByTTL: true,
        cancelledAt: new Date().toISOString(),
        alfaDeclineResult: decl
      };

      logDeclined(upd, decl, "ttl");

      safeUnlink(metaPath);
      if (upd.orderNumber) {
        safeUnlink(path.join(ORDERS_DIR, `${upd.orderNumber}.json`));
      }

      return res.status(408).json({
        ok: false,
        timeout: true,
        message: "Время оплаты истекло. Заказ отменён.",
        decline: decl
      });
    }

    // Статус в Альфе
    const st = await alfaGetStatusExtended({ orderId });

    if (!st.ok) {
      return res.status(502).json({
        ok: false,
        message: "alfa_status_failed",
        raw: st
      });
    }

    const data = st.data;
    const paid = isPaidStatus(data);

    // FastSale (только 1 раз)
    if (paid && meta && !meta.fastSaleSent) {
      const fsResp = await sendFastSale(meta, { orderStatusData: data });

      const upd = {
        ...meta,
        fastSaleSent: true,
        fastSaleAt: new Date().toISOString(),
        fastSaleResult: fsResp,
        paymentFinalized: true
      };

      try {
        fs.writeFileSync(metaPath, JSON.stringify(upd, null, 2));
        if (upd.orderNumber) {
          fs.writeFileSync(
            path.join(ORDERS_DIR, `${upd.orderNumber}.json`),
            JSON.stringify(upd, null, 2)
          );
        }
      } catch (e) {
        console.error("[PAY] META SAVE ERROR:", e.message);
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
      paid,
      raw: data
    });
  } catch (err) {
    console.error("[PAY] status ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "internal_error"
    });
  }
});

// ============================
// POST /mark_paid
// ============================
router.post("/mark_paid", async (req, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        message: "orderId required"
      });
    }

    const metaPath = path.join(ORDERS_DIR, `${orderId}.json`);
    const meta = fs.existsSync(metaPath) ? safeReadJson(metaPath) : null;

    if (!meta) {
      return res.status(404).json({
        ok: false,
        message: "meta_not_found"
      });
    }

    if (meta.fastSaleSent && meta.paymentFinalized) {
      return res.json({ ok: true, already: true, meta });
    }

    const fsResp = await sendFastSale(meta, { manual: true });

    const upd = {
      ...meta,
      fastSaleSent: true,
      paymentFinalized: true,
      fastSaleAt: new Date().toISOString(),
      fastSaleResult: fsResp,
      markedPaidManually: true
    };

    try {
      fs.writeFileSync(metaPath, JSON.stringify(upd, null, 2));
      if (upd.orderNumber) {
        fs.writeFileSync(
          path.join(ORDERS_DIR, `${upd.orderNumber}.json`),
          JSON.stringify(upd, null, 2)
        );
      }
    } catch (e) {
      console.error("[PAY] META SAVE ERROR:", e.message);
    }

    return res.json({
      ok: true,
      fastSale: fsResp,
      meta: upd
    });
  } catch (err) {
    console.error("[PAY] mark_paid ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "internal_error"
    });
  }
});

module.exports = router;
