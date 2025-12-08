import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

/**
 * Validar que una variable de entorno requerida exista
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable de entorno requerida no encontrada: ${name}`);
  }
  return value;
}

/**
 * Obtener variable de entorno con valor por defecto
 */
function getEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

/**
 * Obtener variable de entorno como booleano
 */
function getBoolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Obtener variable de entorno como número
 */
function getNumEnv(name, defaultValue) {
  const value = process.env[name];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

// ========================================
// CONFIGURACIÓN EXPORTADA
// ========================================

export const config = {
  // General
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: getNumEnv('PORT', 3000),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  
  // Modo de operación
  enableRealtime: getBoolEnv('ENABLE_REALTIME', false),
  
  // Deepgram (STT) - OPCIONAL si usas Groq
  deepgram: {
    apiKey: getEnv('DEEPGRAM_API_KEY', ''),
    model: getEnv('DEEPGRAM_MODEL', 'nova-2'),
    language: getEnv('DEEPGRAM_LANGUAGE', 'es'),
  },
  
  // Groq (STT alternativo - GRATIS)
  groq: {
    apiKey: getEnv('GROQ_API_KEY', ''),
    model: getEnv('GROQ_MODEL', 'whisper-large-v3'),
  },
  
  // Proveedor STT a usar (deepgram o groq)
  sttProvider: getEnv('STT_PROVIDER', 'groq').toLowerCase(),
  
  // OpenAI (LLM)
  openai: {
    apiKey: requireEnv('OPENAI_API_KEY'),
    model: getEnv('OPENAI_MODEL', 'gpt-4o-mini'),
  },
  
  // ElevenLabs (TTS)
  elevenlabs: {
    apiKey: requireEnv('ELEVENLABS_API_KEY'),
    voiceId: requireEnv('ELEVENLABS_VOICE_ID'),
    model: getEnv('ELEVENLABS_MODEL', 'eleven_turbo_v2_5'),
  },
  
  // Redis (opcional)
  redis: {
    enabled: getBoolEnv('REDIS_ENABLED', false),
    url: getEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: getNumEnv('RATE_LIMIT_WINDOW_MS', 60000),
    maxRequests: getNumEnv('RATE_LIMIT_MAX_REQUESTS', 100),
  },
  
  // Audio
  audio: {
    chunkSizeMs: getNumEnv('AUDIO_CHUNK_SIZE_MS', 100),
    maxSilenceMs: getNumEnv('MAX_SILENCE_MS', 1500),
    vadThresholdBytes: getNumEnv('VAD_THRESHOLD_BYTES', 500),
  },
  
  // Sesiones
  session: {
    maxHistoryMessages: getNumEnv('MAX_HISTORY_MESSAGES', 15),
    timeoutMs: getNumEnv('SESSION_TIMEOUT_MS', 1800000),
  },
  
  // Monitoring
  monitoring: {
    enableMetrics: getBoolEnv('ENABLE_METRICS', true),
    debugAudio: getBoolEnv('DEBUG_AUDIO', false),
  },
};

// Validar configuración al arrancar
export function validateConfig() {
  try {
    console.log('✓ Configuración cargada correctamente');
    console.log(`  - Modo: ${config.enableRealtime ? 'REALTIME (v2)' : 'LEGACY (v1)'}`);
    console.log(`  - Puerto: ${config.port}`);
    console.log(`  - Entorno: ${config.nodeEnv}`);
    
    // Mostrar proveedor STT según el modo
    if (config.enableRealtime) {
      const sttProvider = config.sttProvider === 'groq' ? 'Groq Whisper' : 'Deepgram';
      console.log(`  - STT: ${sttProvider}`);
      
      // Validar que existe la key del proveedor seleccionado
      if (config.sttProvider === 'groq' && !config.groq.apiKey) {
        console.error('  ✗ ERROR: GROQ_API_KEY requerida cuando STT_PROVIDER=groq');
        return false;
      }
      if (config.sttProvider === 'deepgram' && !config.deepgram.apiKey) {
        console.error('  ✗ ERROR: DEEPGRAM_API_KEY requerida cuando STT_PROVIDER=deepgram');
        return false;
      }
    } else {
      console.log(`  - STT: OpenAI Whisper (legacy)`);
    }
    
    console.log(`  - LLM: ${config.openai.model}`);
    console.log(`  - TTS: ElevenLabs ${config.elevenlabs.model}`);
    console.log(`  - Redis: ${config.redis.enabled ? 'HABILITADO' : 'DESHABILITADO'}`);
    return true;
  } catch (error) {
    console.error('✗ Error en configuración:', error.message);
    return false;
  }
}

export default config;
