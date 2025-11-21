/**
 * /api/pool-workload
 * Версия, использующая общий services/scheduleService.
 * Обратная совместимость ответа сохранена.
 */
require('dotenv').config();
const express = require('express');
const router = express.Router();

const {
  TOTAL_LANES, LANE_CAPACITY,
  fetchExternalSchedule, normalizeEvents, calcHour, isBreakHour
} = require('../services/scheduleService');

const TOTAL_PLACES = TOTAL_LANES * LANE_CAPACITY;
const EKB_TZ_OFFSET = Number(process.env.EKB_TZ_OFFSET || 5);

// Явно по умолчанию production — если переменная окружения SCHEDULE_MODE не задана, будет 'prod'.
// (Вы сказали, что 'test' больше не будет — этот код берёт 'prod' по умолчанию.)
const SCHEDULE_MODE = process.env.SCHEDULE_MODE || 'prod';

// TEST_RANGE_START/END используются ТОЛЬКО если SCHEDULE_MODE === 'test'.
// Оставляем поддержку (на случай ручного тестирования), но не активируем их по умолчанию.
const TEST_RANGE_START = process.env.TEST_RANGE_START || null;
const TEST_RANGE_END = process.env.TEST_RANGE_END || null;

function getEkaterinburgDateHour() {
  const nowUtc = new Date();
  const ekbMs = nowUtc.getTime() + EKB_TZ_OFFSET * 3600 * 1000;
  const ekbDateObj = new Date(ekbMs);
  const date = ekbDateObj.toISOString().slice(0, 10);
  const hour = ekbDateObj.getUTCHours();
  return { date, hour };
}
function addDaysIso(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function getDateArray(startIso, endIso) {
  const arr = []; let cur = new Date(startIso); const end = new Date(endIso);
  while (cur <= end) { arr.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
  return arr;
}

router.get('/', async (req, res) => {
  const { start_date, end_date, start_hour, end_hour } = req.query;
  const { date: nowDate, hour: nowHour } = getEkaterinburgDateHour();

  const fromHour = start_hour ? parseInt(start_hour, 10) : 7;
  const toHour = end_hour ? parseInt(end_hour, 10) : 21;
  const hourArr = []; for (let h = fromHour; h <= toHour; h++) hourArr.push(h);

  let startIso, endIso;
  if (SCHEDULE_MODE === 'test') {
    startIso = TEST_RANGE_START;
    endIso = addDaysIso(startIso, 6);
    if (new Date(endIso) > new Date(TEST_RANGE_END)) endIso = TEST_RANGE_END;
  } else {
    startIso = start_date || nowDate;
    endIso = end_date || addDaysIso(startIso, 6);
  }

  try {
    const rawEvents = await fetchExternalSchedule(startIso, endIso);
    const events = normalizeEvents(rawEvents);
    const dates = getDateArray(startIso, endIso);
    const slots = [];

    for (const d of dates) {
      for (const h of hourArr) {
        const breakFlag = isBreakHour(d, h);
        const { busyLanes, freeLanes, preliminaryFreePlaces } = calcHour(events, d, h);
        const freePlaces = breakFlag ? 0 : preliminaryFreePlaces;

        slots.push({
          date: d,
          hour: h,
          current: null,
          freeLanes,
          busyLanes,
          totalLanes: TOTAL_LANES,
          freePlaces,
          totalPlaces: TOTAL_PLACES,
          isBreak: breakFlag
        });
      }
    }

    res.json({
      currentNow: { date: nowDate, hour: nowHour, current: null, source: 'none' },
      meta: {
        serverNowDate: nowDate,
        serverNowHour: nowHour,
        tzOffset: EKB_TZ_OFFSET,
        scheduleMode: SCHEDULE_MODE || 'prod',
        testRange: SCHEDULE_MODE === 'test' ? { start: TEST_RANGE_START, end: TEST_RANGE_END } : undefined,
      },
      slots
    });
  } catch (e) {
    console.error('pool-workload error:', e);
    res.status(500).json({ error: 'internal_error', details: String(e.message || e) });
  }
});

module.exports = router;