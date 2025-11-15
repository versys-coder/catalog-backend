require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@clickhouse/client');

// --- ClickHouse client setup ---
const clickhouse = createClient({
  url: `https://${process.env.CLICKHOUSE_HOST}:${process.env.CLICKHOUSE_PORT}`,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DB,
});

// --- Список бассейнов, как в TEMP_CARD_ORDER ---
const POOLS = [
  "Тренировочный",
  "Детский",
  "Демонстрационный",
  "Прыжковый"
];

// --- Endpoint получения температур бассейнов ---
router.get('/', async (req, res) => {
  try {
    // Получаем последние температуры для каждого бассейна
    const sql = `
      SELECT pool, Temp
      FROM (
        SELECT
          pool,
          Temp,
          row_number() OVER (PARTITION BY pool ORDER BY timestamp DESC) AS rn
        FROM pool_params
        WHERE pool IN ('Тренировочный', 'Детский', 'Демонстрационный', 'Прыжковый')
      )
      WHERE rn = 1
    `;

    const result = await clickhouse.query({
      query: sql,
      format: 'JSON'
    });

    const data = await result.json();
    // Приводим к формату { "Тренировочный": 27.4, ... }
    const temps = {};
    for (const pool of POOLS) {
      temps[pool] = null;
    }
    for (const row of data.data) {
      temps[row.pool] = row.Temp;
    }
    res.json(temps);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка запроса к ClickHouse" });
  }
});

module.exports = router;