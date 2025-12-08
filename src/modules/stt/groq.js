import Groq from 'groq-sdk';
import STTProvider from './interface.js';
import config from '../../config/env.js';
import { createModuleLogger, logLatency, logAudio } from '../../utils/logger.js';
import { convertWebMBufferToMP3 } from '../../utils/audio-converter.js';

const logger = createModuleLogger('GroqSTT');

/**
 * Implementación de STT usando Groq Whisper con conversión a MP3
 * 
 * Flujo:
 * 1. Recibe audio WebM del navegador
 * 2. Convierte a MP3 usando ffmpeg
 * 3. Envía MP3 a Groq Whisper
 * 4. Retorna transcripción
 */
class GroqSTT extends STTProvider {
  constructor() {
    super();
    this.client = null;
    this.sessionId = null;
    this.transcriptCallback = null;
    this.errorCallback = null;
    this.isActive = false;
  }

  async connect(sessionId) {
    this.sessionId = sessionId;

    try {
      if (!config.groq || !config.groq.apiKey) {
        throw new Error('Groq API key no configurada. Define GROQ_API_KEY en .env');
      }

      this.client = new Groq({
        apiKey: config.groq.apiKey,
      });

      this.isActive = true;
      logger.info(`Groq STT conectado [${sessionId}]`);

      const connectTime = Date.now();
      logLatency('groq_connect', connectTime, { sessionId });

    } catch (error) {
      logger.error(`Error al conectar con Groq [${sessionId}]:`, error);
      throw error;
    }
  }

  /**
   * Recibe audio WebM, convierte a MP3 y transcribe
   */
  async sendAudio(audioBuffer) {
    if (!this.isActive) {
      throw new Error('Groq STT no está conectado');
    }

    try {
      if (!audioBuffer || audioBuffer.length === 0) {
        logAudio('empty_chunk', {
          sessionId: this.sessionId,
        });
        return;
      }

      // Threshold mínimo para evitar ruidos
      if (audioBuffer.length < 10000) {
        logAudio('chunk_too_small', {
          sessionId: this.sessionId,
          size: audioBuffer.length,
        });
        return;
      }

      await this.transcribeChunk(audioBuffer);
    } catch (error) {
      logger.error(`Error procesando audio [${this.sessionId}]:`, error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  /**
   * Transcribe un chunk de audio WebM convirtiéndolo primero a MP3
   */
  async transcribeChunk(audioBuffer) {
    if (!this.isActive) return;

    let mp3Path = null;
    let cleanup = null;

    try {
      const audioSize = audioBuffer.length;

      logAudio('converting_to_mp3', {
        sessionId: this.sessionId,
        size: audioSize,
      });

      const conversionStartTime = Date.now();

      // Convertir WebM a MP3
      const result = await convertWebMBufferToMP3(audioBuffer, this.sessionId);
      mp3Path = result.mp3Path;
      cleanup = result.cleanup;

      const conversionTime = Date.now() - conversionStartTime;
      logLatency('webm_to_mp3_conversion', conversionTime, {
        sessionId: this.sessionId,
        originalSize: audioSize,
      });

      logger.debug(`Audio convertido a MP3: ${mp3Path}`);

      logAudio('sending_to_groq', {
        sessionId: this.sessionId,
        mp3Path,
      });

      const transcriptStartTime = Date.now();

      // Importar fs para crear stream
      const fs = await import('fs');

      // Transcribir con Groq Whisper
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(mp3Path),
        model: 'whisper-large-v3',
        language: 'es',
        response_format: 'json',
        temperature: 0.0,
      });

      const transcriptTime = Date.now() - transcriptStartTime;
      logLatency('groq_transcription', transcriptTime, {
        sessionId: this.sessionId,
        audioSize,
      });

      // Limpiar archivos temporales
      if (cleanup) {
        await cleanup();
      }

      const text = (transcription.text || '').trim();

      if (!text) {
        logAudio('empty_transcription', { sessionId: this.sessionId });
        return;
      }

      logger.debug(`Transcripción Groq: "${text}"`);

      logAudio('transcript_received', {
        sessionId: this.sessionId,
        text,
        isFinal: true,
      });

      if (this.transcriptCallback) {
        this.transcriptCallback(text, true, 1.0);
      }

    } catch (error) {
      // Logging detallado del error
      console.error('=================================');
      console.error('ERROR EN GROQ STT');
      console.error('Session:', this.sessionId);
      console.error('Error Message:', error?.message || String(error));
      console.error('Error Name:', error?.name || 'Error');
      console.error('Error Status:', error?.status || 'N/A');
      console.error('=================================');

      logger.error({
        module: 'GroqSTT',
        sessionId: this.sessionId,
        errorMessage: error?.message || String(error),
        errorName: error?.name || 'Error',
        errorStatus: error?.status || 'N/A',
      }, `GROQ ERROR: ${error?.message || String(error)}`);

      // Limpiar archivos en caso de error
      if (cleanup) {
        try {
          await cleanup();
        } catch (cleanupError) {
          logger.warn(`Error limpiando archivos: ${cleanupError.message}`);
        }
      }

      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  onTranscript(callback) {
    this.transcriptCallback = callback;
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  async disconnect() {
    if (!this.isActive) return;

    try {
      logger.info(`Desconectando Groq STT [${this.sessionId}]`);

      this.isActive = false;
      this.client = null;
      this.sessionId = null;
      this.transcriptCallback = null;
      this.errorCallback = null;

      logger.info('Groq STT desconectado correctamente');
    } catch (error) {
      logger.error(`Error al desconectar Groq STT [${this.sessionId}]:`, error);
    }
  }

  isConnected() {
    return this.isActive && this.client !== null;
  }

  getInfo() {
    return {
      name: 'Groq',
      version: 'Whisper Large V3',
      model: 'whisper-large-v3',
      language: 'es',
      format: 'MP3 (convertido desde WebM)',
      latencyMs: 200, // incluye conversión
      streaming: 'buffered',
    };
  }
}

export default GroqSTT;