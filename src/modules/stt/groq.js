import Groq from 'groq-sdk';
import STTProvider from './interface.js';
import config from '../../config/env.js';
import { createModuleLogger, logLatency, logAudio } from '../../utils/logger.js';

const logger = createModuleLogger('GroqSTT');

/**
 * Implementación de STT usando Groq Whisper
 * 
 * Características:
 * - Streaming en tiempo real
 * - Latencia típica: 100-200ms
 * - API compatible con OpenAI
 * - GRATIS con límites generosos
 * 
 * Limitación: Groq no soporta streaming "chunks" como Deepgram,
 * pero es muy rápido procesando archivos completos.
 * Lo usamos con chunks pequeños (1-2 segundos) para simular streaming.
 */
export class GroqSTT extends STTProvider {
  constructor() {
    super();
    this.client = null;
    this.sessionId = null;
    this.transcriptCallback = null;
    this.errorCallback = null;
    this.isActive = false;
    this.audioBuffer = [];
    this.processingInterval = null;
    this.startTime = null;
  }

  async connect(sessionId) {
    this.sessionId = sessionId;
    this.startTime = Date.now();
    this.isActive = true;

    try {
      // Crear cliente Groq
      this.client = new Groq({
        apiKey: config.groq.apiKey,
      });

      logger.info(`Groq STT conectado [${sessionId}]`);

      // Iniciar procesamiento periódico de buffer
      this.startBufferProcessing();

      const connectTime = Date.now() - this.startTime;
      logLatency('groq_connect', connectTime, { sessionId });

    } catch (error) {
      logger.error(`Error al conectar con Groq [${sessionId}]:`, error);
      throw error;
    }
  }

  /**
   * Iniciar procesamiento periódico del buffer de audio
   * Procesamos cada 2 segundos para acumular suficiente audio
   */
  startBufferProcessing() {
    const PROCESS_INTERVAL_MS = 2000; // Procesar cada 2 segundos

    this.processingInterval = setInterval(async () => {
      if (this.audioBuffer.length > 0) {
        await this.processBufferedAudio();
      }
    }, PROCESS_INTERVAL_MS);

    logger.debug(`Buffer processing iniciado cada ${PROCESS_INTERVAL_MS}ms`);
  }

  /**
   * Procesar audio acumulado en el buffer
   */
  async processBufferedAudio() {
    if (this.audioBuffer.length === 0 || !this.isActive) return;

    try {
      // Combinar todos los chunks en un solo buffer
      const combinedBuffer = Buffer.concat(this.audioBuffer);
      this.audioBuffer = []; // Limpiar buffer

      const audioSize = combinedBuffer.length;
      
      // Solo procesar si hay suficiente audio (mínimo 32KB ~ 1s de audio)
      if (audioSize < 32000) {
        logAudio('buffer_too_small', {
          sessionId: this.sessionId,
          size: audioSize,
        });
        return;
      }

      const transcriptStartTime = Date.now();

      logAudio('sending_to_groq', {
        sessionId: this.sessionId,
        size: audioSize,
      });

      // Crear archivo temporal para Groq
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(tempDir, `audio-${this.sessionId}-${Date.now()}.webm`);
      
      // Escribir buffer a archivo temporal
      fs.writeFileSync(tempFilePath, combinedBuffer);
      
      logger.debug(`Archivo temporal creado: ${tempFilePath} (${audioSize} bytes)`);

      // Transcribir con Groq Whisper
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-large-v3',
        language: 'es',
        response_format: 'json',
        temperature: 0.0,
      });

      // Eliminar archivo temporal
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        logger.warn(`No se pudo eliminar archivo temporal: ${cleanupError.message}`);
      }

      const transcriptTime = Date.now() - transcriptStartTime;
      logLatency('groq_transcription', transcriptTime, { 
        sessionId: this.sessionId,
        audioSize,
      });

      const text = transcription.text?.trim();

      if (!text || text.length === 0) {
        logAudio('empty_transcription', { sessionId: this.sessionId });
        return;
      }

      logger.debug(`Transcripción Groq: "${text}"`);

      logAudio('transcript_received', {
        sessionId: this.sessionId,
        text,
        isFinal: true,
      });

      // Invocar callback con transcripción final
      if (this.transcriptCallback) {
        // Groq siempre devuelve transcripciones completas (isFinal = true)
        this.transcriptCallback(text, true, 1.0); // confidence = 1.0
      }

    } catch (error) {
      // Logging mejorado del error
      const errorDetails = {
        message: error.message,
        type: error.constructor.name,
        status: error.status,
        statusText: error.statusText,
        response: error.response?.data,
      };

      logger.error(`Error transcribiendo con Groq [${this.sessionId}]:`, errorDetails);
      
      // Si es error de archivo muy pequeño, ignorar silenciosamente
      if (error.message?.includes('too small') || 
          error.message?.includes('minimum') ||
          error.message?.includes('duration')) {
        logAudio('audio_chunk_too_small', { sessionId: this.sessionId });
        return;
      }

      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  async sendAudio(audioBuffer) {
    if (!this.isActive) {
      throw new Error('Groq STT no está conectado');
    }

    try {
      // Agregar audio al buffer para procesamiento posterior
      this.audioBuffer.push(audioBuffer);

      logAudio('audio_buffered', {
        sessionId: this.sessionId,
        chunkSize: audioBuffer.length,
        bufferSize: this.audioBuffer.length,
      });

    } catch (error) {
      logger.error(`Error agregando audio al buffer [${this.sessionId}]:`, error);
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
    if (!this.isActive) return;

    try {
      logger.info(`Desconectando Groq STT [${this.sessionId}]`);

      // Detener procesamiento de buffer
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }

      // Procesar audio restante en el buffer
      if (this.audioBuffer.length > 0) {
        logger.debug('Procesando audio restante antes de desconectar...');
        await this.processBufferedAudio();
      }

      // Limpiar estado
      this.isActive = false;
      this.audioBuffer = [];
      this.transcriptCallback = null;
      this.errorCallback = null;
      this.client = null;

      logger.info(`Groq STT desconectado [${this.sessionId}]`);

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
      latencyMs: 150, // latencia típica
      streaming: 'buffered', // no es streaming puro, pero procesamiento rápido
    };
  }
}

export default GroqSTT;