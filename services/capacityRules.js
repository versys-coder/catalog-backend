const { DateTime } = require('luxon');

function getTimezone() {
  return process.env.TIMEZONE || 'Asia/Yekaterinburg';
}

function nowLocal() {
  return DateTime.now().setZone(getTimezone());
}

function getHourBucket(dt) {
  const local = dt.setZone(getTimezone());
  const hour = local.hour;
  if (hour < 7 || hour > 21) return null;
  return hour;
}

function getBucketInterval(dt, bucket) {
  const base = dt.setZone(getTimezone()).startOf('day');
  const start = base.plus({ hours: bucket });
  const end = base.plus({ hours: bucket + 1 });
  return { start, end };
}

module.exports = { nowLocal, getHourBucket, getBucketInterval, getTimezone };