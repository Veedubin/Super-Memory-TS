/**
 * Simple logger for Super-Memory
 *
 * Console output with timestamps and log levels.
 * Respects BOOMERANG_LOG_LEVEL environment variable.
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
// Get log level from environment variable or default to 'info'
let currentLevel = process.env.BOOMERANG_LOG_LEVEL || 'info';
/**
 * Format a log message with timestamp and level
 */
function formatMessage(level, message, meta) {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}
/**
 * Check if a log level should be logged based on current level
 */
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
export const logger = {
    /**
     * Debug level logging
     */
    debug(message, meta) {
        if (shouldLog('debug')) {
            console.debug(formatMessage('debug', message, meta));
        }
    },
    /**
     * Info level logging
     */
    info(message, meta) {
        if (shouldLog('info')) {
            console.info(formatMessage('info', message, meta));
        }
    },
    /**
     * Warning level logging
     */
    warn(message, meta) {
        if (shouldLog('warn')) {
            console.warn(formatMessage('warn', message, meta));
        }
    },
    /**
     * Error level logging
     */
    error(message, meta) {
        if (shouldLog('error')) {
            console.error(formatMessage('error', message, meta));
        }
    },
    /**
     * Set the log level at runtime
     */
    setLevel(level) {
        currentLevel = level;
    },
    /**
     * Get the current log level
     */
    getLevel() {
        return currentLevel;
    },
};
export default logger;
