/**
 * Simple logger for Super-Memory
 * 
 * Console output with timestamps and log levels.
 * Respects BOOMERANG_LOG_LEVEL environment variable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get log level from environment variable or default to 'info'
let currentLevel: LogLevel = (process.env.BOOMERANG_LOG_LEVEL as LogLevel) || 'info';

/**
 * Format a log message with timestamp and level
 */
function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Check if a log level should be logged based on current level
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const logger = {
  /**
   * Debug level logging
   */
  debug(message: string, meta?: unknown): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, meta));
    }
  },

  /**
   * Info level logging
   */
  info(message: string, meta?: unknown): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, meta));
    }
  },

  /**
   * Warning level logging
   */
  warn(message: string, meta?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  /**
   * Error level logging
   */
  error(message: string, meta?: unknown): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, meta));
    }
  },

  /**
   * Set the log level at runtime
   */
  setLevel(level: LogLevel): void {
    (currentLevel as LogLevel) = level;
  },

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return currentLevel;
  },
};

export default logger;