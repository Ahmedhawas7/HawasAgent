import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import config from '../config/index.js';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
let currentLevel = LEVELS.INFO;

function ensureLogDir() {
  mkdirSync(config.storage.logsPath, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function formatMsg(level, module, message, data) {
  const entry = {
    ts: timestamp(),
    level,
    module,
    message,
    ...(data ? { data } : {})
  };
  return JSON.stringify(entry);
}

function writeLog(level, module, message, data) {
  if (LEVELS[level] < currentLevel) return;

  const line = formatMsg(level, module, message, data);
  const color = { DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', FATAL: '\x1b[35m' }[level] || '';
  const reset = '\x1b[0m';

  console.log(`${color}[${level}]${reset} [${module}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);

  try {
    ensureLogDir();
    const date = new Date().toISOString().split('T')[0];
    const logFile = join(config.storage.logsPath, `${date}.log`);
    appendFileSync(logFile, line + '\n');
  } catch (e) {
    // Silently fail on log write errors
  }
}

function createLogger(module) {
  return {
    debug: (msg, data) => writeLog('DEBUG', module, msg, data),
    info: (msg, data) => writeLog('INFO', module, msg, data),
    warn: (msg, data) => writeLog('WARN', module, msg, data),
    error: (msg, data) => writeLog('ERROR', module, msg, data),
    fatal: (msg, data) => writeLog('FATAL', module, msg, data),
  };
}

function setLogLevel(level) {
  if (LEVELS[level] !== undefined) currentLevel = LEVELS[level];
}

export { createLogger, setLogLevel, LEVELS };
export default createLogger;
