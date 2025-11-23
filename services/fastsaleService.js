// services/fastsaleService.js
// Отправка продажи в 1С FastSale. Полное логирование.

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const FASTSALE_DEBUG_LOG =
  process.env.FASTSALE_DEBUG_LOG ||
  "/opt/catalog/tmp/fastsale_debug.jsonl";

ensureDir(path.dirname(FASTSALE_DEBUG_LOG));

function ensureDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
}

function appendDebug(record) {
  try {
    fs.appendFileSync(
      FASTSALE_DEBUG_LOG,
      JSON.stringify(record) + "\n"
    );
  } catch (e) {
    console.error("[fastsaleService] DEBUG LOG ERROR:", e.message);
  }
}

function safeInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * meta — объект из ORDERS_DIR
 * extraContext — { orderStatusData?, manual? }
 */
async function sendFastSale(meta, extraContext = {}) {
  const ctx = extraContext || {};

  const FASTSALE_ENDPOINT = process.env.FASTSALE_ENDPOINT || "";
  const BASIC_USER = process.env.BASIC_USER || "";
  const BASIC_PASS = process.env.BASIC_PASS || "";
  const CLUB_ID = process.env.CLUB_ID || "";

  // Проверяем минимальный набор
  if (!FASTSALE_ENDPOINT || !BASIC_USER || !BASIC_PASS || !CLUB_ID) {
    console.error("[fastsaleService] Missing FASTSALE env vars");

    appendDebug({
      ts: new Date().toISOString(),
      stage: "config_error",
      FASTSALE_ENDPOINT,
      BASIC_USER_set: !!BASIC_USER,
      BASIC_PASS_set: !!BASIC_PASS,
      CLUB_ID,
      meta,
      context: ctx
    });

    return { ok: false, error: "missing_env" };
  }

  try {
    const priceRub = safeInt(meta.price_rub || meta.price || 0);
    const serviceId = meta.serviceId || meta.service_id;
    const normalizedPhone = String(meta.phone || "").replace(/\D+/g, "");

    const docId = meta.docId || uuidv4();
    const dateIso = new Date().toISOString();

    // ЖИВОЙ РЕАЛЬНЫЙ ФОРМАТ
    const body = {
      club_id: CLUB_ID,
      phone: normalizedPhone,
      sale: {
        docId,
        date: dateIso,
        cashless: priceRub,
        goods: [
          { id: serviceId, qnt: 1, summ: priceRub }
        ]
      }
    };

    const baseAuth = Buffer.from(
      `${BASIC_USER}:${BASIC_PASS}`,
      "utf8"
    ).toString("base64");

    const headers = {
      "Content-Type": "application/json; charset=UTF-8",
      "Authorization": `Basic ${baseAuth}`
    };

    const debugBase = {
      ts: new Date().toISOString(),
      endpoint: FASTSALE_ENDPOINT,
      headers: {
        basicAuth: true
      },
      meta: {
        orderId: meta.orderId,
        orderNumber: meta.orderNumber,
        serviceId,
        phone: meta.phone,
        normalizedPhone,
        price_rub: priceRub
      },
      context: ctx
    };

    console.log("[fastsaleService] POST", FASTSALE_ENDPOINT, "body=", body);

    appendDebug({
      ...debugBase,
      stage: "request",
      requestBody: body
    });

    const resp = await axios.post(FASTSALE_ENDPOINT, body, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    });

    appendDebug({
      ...debugBase,
      stage: "response",
      httpStatus: resp.status,
      responseData: resp.data
    });

    console.log("[fastsaleService] HTTP", resp.status, resp.data);

    if (resp.status >= 400) {
      return { ok: false, status: resp.status, data: resp.data };
    }

    // Формат 1С: { result: true/false }
    if (resp.data && resp.data.result === false) {
      return { ok: false, status: resp.status, data: resp.data };
    }

    return {
      ok: true,
      status: resp.status,
      data: resp.data,
      docId
    };
  } catch (err) {
    const respData = err.response?.data || null;

    console.error("[fastsaleService] ERROR:", respData || err.message);

    appendDebug({
      ts: new Date().toISOString(),
      stage: "error",
      error: String(err.message || err),
      responseData: respData,
      meta,
      context: ctx
    });

    return { ok: false, error: err.message, data: respData };
  }
}

module.exports = { sendFastSale };
