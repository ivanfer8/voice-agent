import WebSocket from 'ws';
import TTSProvider from './interface.js';
import config from '../../config/env.js';
import { createModuleLogger, logLatency, logCost, logAudio } from '../../utils/logger.js';

const logger = createModuleLogger('ElevenLabsTTS');

/**
 * Implementación de TTS usando ElevenLabs WebSocket API
 * 
 * Características:
 * - Streaming ultra-bajo latencia (130-250ms)
 * - Calidad de voz superior
 * - Soporte multiidioma
 * - eleven_turbo_v2_5 para mínima latencia
 * 
 * FIX: cancel() ya NO cierra la conexión WebSocket
 */
export class ElevenLabsTTS extends TTSProvider {
  constructor() {
    super();
    this.ws = null;
    this.sessionId = null;
    this.voiceId = null;
    this.audioCallback = null;
    this.completeCallback = null;
    this.errorCallback = null;
    this.startTime = null;
    this.isReady = false;
    this.isCancelled = false;
  }

  async connect(sessionId, voiceId = null) {
    this.sessionId = sessionId;
    this.voiceId = voiceId || config.elevenlabs.voiceId;
    this.startTime = Date.now();

    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=${config.elevenlabs.model}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl, {
          headers: {
            'xi-api-key': config.elevenlabs.apiKey,
          },
        });

        // Configurar eventos
        this.ws.on('open', () => {
          const connectTime = Date.now() - this.startTime;
          logLatency('elevenlabs_connect', connectTime, { sessionId });
          logger.info(`ElevenLabs conectado [${sessionId}]`);

          // Enviar configuración inicial (BOS - Beginning of Stream)
          const bosMessage = {
            text: ' ',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              style: 0.0,
              use_speaker_boost: true,
            },
            generation_config: {
              chunk_length_schedule: [120, 160, 250, 290],
            },
            xi_api_key: config.elevenlabs.apiKey,
          };

          this.ws.send(JSON.stringify(bosMessage));
          this.isReady = true;
          this.isCancelled = false;
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const response = JSON.parse(data.toString());

            // Si está cancelado, ignorar audio
            if (this.isCancelled) {
              logger.debug('Audio ignorado (cancelado)');
              return;
            }

            // Audio chunk recibido
            if (response.audio) {
              const audioBuffer = Buffer.from(response.audio, 'base64');
              
              logAudio('tts_chunk_received', {
                sessionId,
                size: audioBuffer.length,
              });

              if (this.audioCallback) {
                this.audioCallback(audioBuffer);
              }
            }

            // Alineación de texto (para debugging)
            if (response.alignment) {
              logger.debug(`Alignment: ${JSON.stringify(response.alignment)}`);
            }

            // Fin de generación
            if (response.isFinal) {
              logger.info(`Síntesis completada [${sessionId}]`);
              this.isCancelled = false; // Reset para próxima síntesis
              if (this.completeCallback) {
                this.completeCallback();
              }
            }

            // Normalización de texto
            if (response.normalizedAlignment) {
              logger.debug(`Normalized: ${JSON.stringify(response.normalizedAlignment)}`);
            }

          } catch (parseError) {
            // Si no es JSON, asumir que es audio binario directo
            if (Buffer.isBuffer(data)) {
              // Si está cancelado, ignorar audio
              if (this.isCancelled) {
                return;
              }

              logAudio('tts_binary_chunk', {
                sessionId,
                size: data.length,
              });

              if (this.audioCallback) {
                this.audioCallback(data);
              }
            }
          }
        });

        this.ws.on('error', (error) => {
          logger.error(`Error en ElevenLabs WS [${sessionId}]:`, error);
          if (this.errorCallback) {
            this.errorCallback(error);
          }
          reject(error);
        });

        this.ws.on('close', () => {
          logger.info(`ElevenLabs cerrado [${sessionId}]`);
          this.isReady = false;
        });

      } catch (error) {
        logger.error(`Error al crear WebSocket de ElevenLabs [${sessionId}]:`, error);
        reject(error);
      }
    });
  }

  async synthesize(text, flush = false) {
    if (!this.isConnected()) {
      throw new Error('ElevenLabs no está conectado');
    }

    if (!text || text.trim().length === 0) {
      logger.warn('Texto vacío enviado a ElevenLabs, ignorando');
      return;
    }

    try {
      // Reset cancel flag al empezar nueva síntesis
      this.isCancelled = false;

      const message = {
        text: text,
        try_trigger_generation: flush,
      };

      this.ws.send(JSON.stringify(message));

      logAudio('text_sent_to_tts', {
        sessionId: this.sessionId,
        textLength: text.length,
        flush,
      });

      logger.debug(`Texto enviado: "${text.substring(0, 50)}..."`);

    } catch (error) {
      logger.error(`Error enviando texto a ElevenLabs [${this.sessionId}]:`, error);
      throw error;
    }
  }

  onAudioChunk(callback) {
    this.audioCallback = callback;
  }

  onComplete(callback) {
    this.completeCallback = callback;
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  async cancel() {
  if (this.isConnected()) {
    const flushMessage = {
      text: ' ',      // ✅ Espacio (no vacío)
      flush: true     // ✅ Flush sin cerrar
    };
    this.ws.send(JSON.stringify(flushMessage));
  }
}

  async disconnect() {
    if (!this.ws) return;

    try {
      logger.info(`Desconectando ElevenLabs [${this.sessionId}]`);

      // Enviar EOS (End of Stream)
      if (this.isConnected()) {
        const eosMessage = {
          text: '',
        };
        this.ws.send(JSON.stringify(eosMessage));

        // Esperar un momento antes de cerrar
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Cerrar WebSocket
      this.ws.close();
      
      // Limpiar referencias
      this.ws = null;
      this.audioCallback = null;
      this.completeCallback = null;
      this.errorCallback = null;
      this.isReady = false;
      this.isCancelled = false;

    } catch (error) {
      logger.error(`Error al desconectar ElevenLabs [${this.sessionId}]:`, error);
    }
  }

  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isReady;
  }

  getInfo() {
    return {
      name: 'ElevenLabs',
      model: config.elevenlabs.model,
      voiceId: this.voiceId,
      latencyMs: 200, // latencia típica
    };
  }

  estimateCost(text) {
    // ElevenLabs cobra por caracteres
    // Turbo v2.5: ~$0.03 per 1000 chars
    const charCount = text.length;
    const costPerChar = 0.00003;
    return charCount * costPerChar;
  }
}

export default ElevenLabsTTS;