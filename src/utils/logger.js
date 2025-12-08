import pino from 'pino';
import config from '../config/env.js';

/**
 * Logger centralizado usando Pino
 * Logs estructurados en JSON para producción
 * Pretty print para desarrollo
 */
const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

/**
 * Crear logger específico para un módulo
 */
export function createModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}

/**
 * Log de métrica de latencia
 */
export function logLatency(operation, durationMs, metadata = {}) {
  if (!config.monitoring.enableMetrics) return;
  
  logger.info({
    type: 'metric',
    operation,
    durationMs,
    ...metadata,
  }, `⏱️  ${operation}: ${durationMs}ms`);
}

/**
 * Log de evento de audio
 */
export function logAudio(event, metadata = {}) {
  if (!config.monitoring.debugAudio) return;
  
  logger.debug({
    type: 'audio',
    event,
    ...metadata,
  }, `🔊 ${event}`);
}

/**
 * Log de evento de sesión
 */
export function logSession(sessionId, event, metadata = {}) {
  logger.info({
    type: 'session',
    sessionId,
    event,
    ...metadata,
  }, `👤 [${sessionId}] ${event}`);
}

/**
 * Log de error con contexto
 */
export function logError(error, context = {}) {
  logger.error({
    type: 'error',
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    ...context,
  }, `❌ ${error.message}`);
}

/**
 * Log de coste (para tracking de APIs externas)
 */
export function logCost(service, amount, metadata = {}) {
  if (!config.monitoring.enableMetrics) return;
  
  logger.info({
    type: 'cost',
    service,
    amount,
    ...metadata,
  }, `💰 ${service}: $${amount.toFixed(4)}`);
}

export default logger;
