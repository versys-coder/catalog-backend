const LOG_ENABLED = process.env.CAPACITY_DEBUG === '1';

function logCapacity(...args) {
  if (!LOG_ENABLED) return;
  const ts = new Date().toISOString();
  console.log('[CAPACITY]', ts, ...args);
}

module.exports = { logCapacity };