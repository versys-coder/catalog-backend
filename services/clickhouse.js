const { createClient } = require('@clickhouse/client');

let client;

function getClickhouse() {
  if (!client) {
    client = createClient({
      host: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 8123}`,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      database: process.env.CLICKHOUSE_DB || 'sale',
      clickhouse_settings: { wait_end_of_query: 1 }
    });
  }
  return client;
}

module.exports = { getClickhouse };