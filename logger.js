const { createLogger, format, transports } = require('winston');
const path = require('path');

const logFile = path.join(__dirname, 'sms-confirm.log');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
    format.printf(({timestamp, level, message, ...meta}) => {
      return `${timestamp} [${level.toUpperCase()}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
    })
  ),
  transports: [
    new transports.File({ filename: logFile, maxsize: 1024 * 1024 * 5, maxFiles: 5 })
  ],
});

module.exports = logger;
