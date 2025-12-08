/**
 * VOICE AGENT SERVER - HÍBRIDO v1 + v2
 * 
 * Soporta dos modos de operación:
 * 
 * MODO LEGACY (v1): ENABLE_REALTIME=false
 * - POST /stt con Whisper + GPT-4o + TTS
 * - Detección de pausas en frontend
 * - Latencia: 2-4 segundos
 * 
 * MODO REALTIME (v2): ENABLE_REALTIME=true
 * - WebSocket /v2/voice
 * - Streaming bidireccional: Deepgram + GPT-4o + ElevenLabs
 * - Latencia: <500ms
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config, { validateConfig } from './src/config/env.js';
import logger from './src/utils/logger.js';
import { setupLegacyRoutes } from './src/legacy/stt-handler.js';
import { initWebSocketServer } from './src/websocket/handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========================================
// VALIDAR CONFIGURACIÓN
// ========================================
if (!validateConfig()) {
  logger.error('Error en configuración. Abortando arranque.');
  process.exit(1);
}

// ========================================
// CREAR APP EXPRESS
// ========================================
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// HEALTH CHECK
// ========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: config.enableRealtime ? 'realtime (v2)' : 'legacy (v1)',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ========================================
// CONFIGURAR RUTAS SEGÚN MODO
// ========================================

if (config.enableRealtime) {
  // =========== MODO REALTIME (v2) ===========
  logger.info('🚀 Iniciando en MODO REALTIME (v2)');
  logger.info('   - WebSocket streaming habilitado');
  logger.info('   - Endpoint: /v2/voice');
  
  // Inicializar WebSocket Server
  initWebSocketServer(server);
  
  logger.info('✓ Modo Realtime configurado correctamente');
  
} else {
  // =========== MODO LEGACY (v1) ===========
  logger.info('📞 Iniciando en MODO LEGACY (v1)');
  logger.info('   - POST /stt habilitado');
  logger.info('   - Compatibilidad total con versión anterior');
  
  // Configurar rutas legacy
  setupLegacyRoutes(app);
  
  logger.info('✓ Modo Legacy configurado correctamente');
}

// ========================================
// PÁGINA DE INFORMACIÓN
// ========================================
app.get('/info', (req, res) => {
  res.json({
    name: 'Voice Agent Zener',
    version: '2.0.0',
    mode: config.enableRealtime ? 'realtime (v2)' : 'legacy (v1)',
    endpoints: config.enableRealtime ? {
      websocket: 'ws://localhost:' + config.port + '/v2/voice',
      health: '/health',
      info: '/info',
    } : {
      stt: 'POST /stt',
      health: '/health',
      info: '/info',
    },
    providers: {
      stt: config.enableRealtime ? 'Deepgram' : 'OpenAI Whisper',
      llm: 'OpenAI GPT-4o-mini',
      tts: 'ElevenLabs',
    },
    config: {
      maxHistoryMessages: config.session.maxHistoryMessages,
      audioChunkSizeMs: config.audio.chunkSizeMs,
      maxSilenceMs: config.audio.maxSilenceMs,
    },
  });
});

// ========================================
// MANEJO DE ERRORES
// ========================================
app.use((err, req, res, next) => {
  logger.error('Error no capturado:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// ========================================
// MANEJO DE SEÑALES DE SISTEMA
// ========================================
process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido. Cerrando servidor gracefully...');
  server.close(() => {
    logger.info('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recibido. Cerrando servidor gracefully...');
  server.close(() => {
    logger.info('Servidor cerrado');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// ========================================
// ARRANCAR SERVIDOR
// ========================================
server.listen(config.port, () => {
  logger.info('========================================');
  logger.info('🎙️  VOICE AGENT ZENER - SERVIDOR INICIADO');
  logger.info('========================================');
  logger.info(`Puerto: ${config.port}`);
  logger.info(`Entorno: ${config.nodeEnv}`);
  logger.info(`Modo: ${config.enableRealtime ? 'REALTIME (v2) 🚀' : 'LEGACY (v1) 📞'}`);
  logger.info('========================================');
  logger.info('Endpoints disponibles:');
  logger.info(`  - Health check: http://localhost:${config.port}/health`);
  logger.info(`  - Información: http://localhost:${config.port}/info`);
  
  if (config.enableRealtime) {
    logger.info(`  - WebSocket: ws://localhost:${config.port}/v2/voice`);
  } else {
    logger.info(`  - POST STT: http://localhost:${config.port}/stt`);
  }
  
  logger.info('========================================');
  logger.info('Proveedores configurados:');
  logger.info(`  - STT: ${config.enableRealtime ? 'Deepgram' : 'OpenAI Whisper'}`);
  logger.info(`  - LLM: OpenAI ${config.openai.model}`);
  logger.info(`  - TTS: ElevenLabs ${config.elevenlabs.model}`);
  logger.info('========================================');
  logger.info('✓ Servidor listo para recibir conexiones');
  logger.info('========================================');
});

export default app;
