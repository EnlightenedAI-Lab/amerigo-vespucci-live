const levels = { debug: 10, info: 20, warn: 30, error: 40 };
let activeLevel = levels[process.env.LOG_LEVEL] || levels.info;

export function setLogLevel(level) {
  activeLevel = levels[level] || levels.info;
}

function write(level, message, details) {
  if (levels[level] < activeLevel) return;
  const entry = { time: new Date().toISOString(), level, message, ...(details ? { details } : {}) };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message, details) => write('debug', message, details),
  info: (message, details) => write('info', message, details),
  warn: (message, details) => write('warn', message, details),
  error: (message, details) => write('error', message, details)
};
