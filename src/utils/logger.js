const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../../scraper.log');

const log = (message, level = 'INFO') => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage + '\n');
};

module.exports = {
  info: (msg) => log(msg, 'INFO'),
  error: (msg) => log(msg, 'ERROR'),
  warn: (msg) => log(msg, 'WARN'),
};
