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
   * Procesamos cada 1 segundo para simular streaming
   */
  startBufferProcessing() {
    const PROCESS_INTERVAL_MS = 1000; // Procesar cada segundo

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
      
      // Solo procesar si hay suficiente audio (mínimo 16KB ~ 0.5s de audio)
      if (audioSize < 16000) {
        logAudio('buffer_too_small', {
          sessionId: this.sessionId,
          size: audioSize,
        });
        return;
      }

      const transcriptStartTime = Date.now();

      // Crear blob de audio en formato webm
      const audioBlob = new Blob([combinedBuffer], { type: 'audio/webm' });
      
      // Convertir a File (Groq espera un File object)
      const audioFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

      logAudio('sending_to_groq', {
        sessionId: this.sessionId,
        size: audioSize,
      });

      // Transcribir con Groq Whisper
      const transcription = await this.client.audio.transcriptions.create({
        file: audioFile,
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
      // Si es error de archivo muy pequeño, ignorar silenciosamente
      if (error.message?.includes('too small') || error.message?.includes('minimum')) {
        logAudio('audio_chunk_too_small', { sessionId: this.sessionId });
        return;
      }

      logger.error(`Error transcribiendo con Groq [${this.sessionId}]:`, error);
      
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
