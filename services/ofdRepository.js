const { getClickhouse } = require('./clickhouse');

function getTimezone() {
  return process.env.TIMEZONE || 'Asia/Yekaterinburg';
}

function getOfdServiceNames() {
  const raw = process.env.OFD_SERVICE_NAMES || '';
  const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['Самостоятельное плавание'];
}

async function countSalesForInterval(startLuxon, endLuxon) {
  const ch = getClickhouse();
  const table = process.env.CH_TABLE || 'sale.kass_documents';
  const services = getOfdServiceNames();
  const arrayLiteral = `[${services.map(s => `'${s.replace(/'/g, "\\'")}'`).join(',')}]`;

  const startStr = startLuxon.toFormat('yyyy-LL-dd HH:mm:ss');
  const endStr   = endLuxon.toFormat('yyyy-LL-dd HH:mm:ss');

  const query = `
    SELECT count() AS c
    FROM ${table}
    WHERE operationType = 1
      AND name IN ${arrayLiteral}
      AND dateTime_ekb >= toDateTime('${startStr}')
      AND dateTime_ekb < toDateTime('${endStr}')
  `;

  const rs = await ch.query({ query, format: 'JSON' });
  const data = await rs.json();
  return Number(data.data?.[0]?.c ?? 0);
}

module.exports = { countSalesForInterval };