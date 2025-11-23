// routes/slots.js
// Слоты из JSON-файла /opt/catalog-backend/api-backend/data/test_appointments.json
//
// Формат файла (массив объектов):
// { "date": "2025-11-24", "time": "17:00", "appointment_id": "..." }
//
// Эндпоинт:
//   GET /api/slots?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
// Ответ:
//   { "slots": [ { "appointment_id": "...", "start_date": "YYYY-MM-DDTHH:MM:00" }, ... ] }

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const APPTS_FILE =
  process.env.SLOTS_FILE ||
  '/opt/catalog-backend/api-backend/data/test_appointments.json';

function safeReadAppointments() {
  try {
    const txt = fs.readFileSync(APPTS_FILE, 'utf8');
    const data = JSON.parse(txt);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (e) {
    console.error('[SLOTS] read error:', e.message);
    return [];
  }
}

function inRange(dateStr, start, end) {
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

router.get('/', (req, res) => {
  const start = req.query.start_date
    ? String(req.query.start_date)
    : null;
  const end = req.query.end_date ? String(req.query.end_date) : null;

  const all = safeReadAppointments();

  const filtered = all
    .filter((item) => inRange(item.date, start, end))
    .map((item) => {
      const date = String(item.date || '').trim();
      const time = String(item.time || '').trim();
      const appointment_id = String(item.appointment_id || '').trim();

      const startDate =
        date && time ? `${date}T${time}:00` : null;

      return {
        appointment_id,
        start_date: startDate
      };
    })
    .filter((s) => s.appointment_id && s.start_date);

  res.json({ slots: filtered });
});

module.exports = router;
