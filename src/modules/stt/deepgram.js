import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import STTProvider from './interface.js';
import config from '../../config/env.js';
import { createModuleLogger, logLatency, logAudio } from '../../utils/logger.js';

const logger = createModuleLogger('DeepgramSTT');

/**
 * Implementación de STT usando Deepgram
 * 
 * Características:
 * - Streaming en tiempo real
 * - Latencia típica: 100-200ms
 * - Soporta español (y otros idiomas)
 * - Transcripciones parciales e interinas
 */
export class DeepgramSTT extends STTProvider {
  constructor() {
    super();
    this.client = null;
    this.connection = null;
    this.sessionId = null;
    this.transcriptCallback = null;
    this.errorCallback = null;
    this.startTime = null;
  }

  async connect(sessionId) {
    this.sessionId = sessionId;
    this.startTime = Date.now();

    try {
      // Crear cliente Deepgram
      this.client = createClient(config.deepgram.apiKey);

      // Configurar conexión de streaming
      this.connection = this.client.listen.live({
        model: config.deepgram.model,
        language: config.deepgram.language,
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      });

      // Registrar eventos
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        const connectTime = Date.now() - this.startTime;
        logLatency('deepgram_connect', connectTime, { sessionId });
        logger.info(`Deepgram conectado [${sessionId}]`);
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel?.alternatives?.[0];
        if (!transcript) return;

        const text = transcript.transcript?.trim();
        if (!text) return;

        const isFinal = data.is_final;
        const confidence = transcript.confidence;

        logAudio('transcript_received', {
          sessionId,
          text,
          isFinal,
          confidence,
        });

        // Invocar callback si existe
        if (this.transcriptCallback) {
          this.transcriptCallback(text, isFinal, confidence);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error) => {
        logger.error(`Error en Deepgram [${sessionId}]:`, error);
        if (this.errorCallback) {
          this.errorCallback(error);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Warning, (warning) => {
        logger.warn(`Advertencia de Deepgram [${sessionId}]:`, warning);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        logger.info(`Deepgram cerrado [${sessionId}]`);
      });

      // Esperar a que se establezca la conexión
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout conectando a Deepgram'));
        }, 5000);

        this.connection.on(LiveTranscriptionEvents.Open, () => {
          clearTimeout(timeout);
          resolve();
        });

        this.connection.on(LiveTranscriptionEvents.Error, (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      logger.error(`Error al conectar con Deepgram [${sessionId}]:`, error);
      throw error;
    }
  }

  async sendAudio(audioBuffer) {
    if (!this.isConnected()) {
      throw new Error('Deepgram no está conectado');
    }

    try {
      // Enviar audio a Deepgram
      this.connection.send(audioBuffer);
      
      logAudio('audio_sent', {
        sessionId: this.sessionId,
        size: audioBuffer.length,
      });
    } catch (error) {
      logger.error(`Error enviando audio [${this.sessionId}]:`, error);
      throw error;
    }
  }

  onTranscript(callback) {
    this.transcriptCallback = callback;
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  async disconnect() {
    if (!this.connection) return;

    try {
      logger.info(`Desconectando Deepgram [${this.sessionId}]`);
      
      // Enviar señal de finalización
      this.connection.finish();
      
      // Limpiar referencias
      this.connection = null;
      this.client = null;
      this.transcriptCallback = null;
      this.errorCallback = null;
    } catch (error) {
      logger.error(`Error al desconectar Deepgram [${this.sessionId}]:`, error);
    }
  }

  isConnected() {
    return this.connection !== null && this.connection.getReadyState() === 1;
  }

  getInfo() {
    return {
      name: 'Deepgram',
      version: 'SDK v3',
      model: config.deepgram.model,
      language: config.deepgram.language,
      latencyMs: 150, // latencia típica
    };
  }
}

export default DeepgramSTT;
