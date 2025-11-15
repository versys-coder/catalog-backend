const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());

// API роуты
app.use('/api/book', require('./routes/book'));
app.use('/api/client', require('./routes/client'));
app.use('/api/confirm_phone', require('./routes/confirm_phone'));
app.use('/api/slots', require('./routes/slots'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/set_password', require('./routes/set_password'));
app.use('/api/pools-temps', require('./routes/temps'));
app.use('/api/pool-workload', require('./routes/poolWorkload'));
app.use('/api/capacity', require('./routes/capacity'));

// Статика гистограммы
app.use('/histogram', express.static(path.join(__dirname, '../build-histogram')));
app.get(['/histogram', '/histogram/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '../build-histogram', 'index.html'));
});

// Основная статика (SPA)
app.use(express.static(path.join(__dirname, '../build')));

// SPA fallback: пропускаем все /api/* дальше (иначе будут проблемы)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '../build', 'index.html'));
});

// 404 для API если ни один роут не сработал
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

const PORT = process.env.PORT || 5300;
app.listen(PORT, () => console.log(`API server listening on port ${PORT}`));

module.exports = app;