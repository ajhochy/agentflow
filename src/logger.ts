export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.AGENTFLOW_LOG_LEVEL as LogLevel) ?? 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(level: LogLevel, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = level.toUpperCase().padEnd(5);
  process.stderr.write(`${timestamp} [${prefix}] ${message}\n`);
}

export const logger = {
  debug: (msg: string) => log('debug', msg),
  info: (msg: string) => log('info', msg),
  warn: (msg: string) => log('warn', msg),
  error: (msg: string) => log('error', msg),
};
