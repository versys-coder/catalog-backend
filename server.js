// server.js — стабильная версия с расширенным логированием
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// -------- Middlewares --------
app.set('trust proxy', true);

app.use('/api/*', (req, res, next) => {
  console.log(`🔥 API CATCH: ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const cors = require('cors');
app.use(cors());

// --- FULL REQUEST LOGGING ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  if (req.method !== 'GET') {
    console.log('Body:', JSON.stringify(req.body));
  }
  next();
});

// -------- API ROUTES --------
app.use('/api/book', require('./routes/book'));
app.use('/api/client', require('./routes/client'));
app.use('/api/confirm_phone', require('./routes/confirm_phone'));
app.use('/api/slots', require('./routes/slots'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/set_password', require('./routes/set_password'));
app.use('/api/pools-temps', require('./routes/temps'));
app.use('/api/pool-workload', require('./routes/poolWorkload'));
app.use('/api/capacity', require('./routes/capacity'));
app.use('/api/pay', require('./routes/pay'));    // VERY IMPORTANT

// Health endpoint
app.get('/healthz', (req, res) => res.json({ ok: true }));

// -------- Histogram Static --------
app.use('/histogram', express.static(path.join(__dirname, '../build-histogram')));
app.get(['/histogram', '/histogram/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '../build-histogram', 'index.html'));
});

// -------- Main SPA Static --------
app.use(express.static(path.join(__dirname, '../build')));

// SPA fallback (но НЕ перехватывать /api/*)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '../build', 'index.html'));
});

// -------- API 404 --------
app.use('/api', (req, res) => {
  console.log('API 404:', req.originalUrl);
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// -------- Global Error Handler --------
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ ok: false, error: 'internal_error', message: String(err) });
  }
  res.status(500).send('Internal Server Error');
});

// -------- Start Server --------
const PORT = Number(process.env.PORT || 5300);
const server = app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT} (PID=${process.pid})`);
});

// -------- Graceful Shutdown --------
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
