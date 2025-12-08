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
  // Si no hay audio o el STT está parado, no hacemos nada
  if (!this.isActive || this.audioBuffer.length === 0) return;

  try {
    // 👉 Nos quedamos SOLO con el último chunk recibido.
    // Cada chunk debería ser ~1s de audio WebM generado por MediaRecorder.
    const lastChunk = this.audioBuffer[this.audioBuffer.length - 1];
    this.audioBuffer = []; // limpiamos el buffer para el siguiente ciclo

    if (!lastChunk) return;

    const combinedBuffer = lastChunk;
    const audioSize = combinedBuffer.length;

    // Umbral mínimo: si es demasiado pequeño, no mandamos nada a Groq
    if (audioSize < 8000) {
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

    // Guardamos el buffer en un fichero temporal .webm
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(
      tempDir,
      `audio-${this.sessionId}-${Date.now()}.webm`
    );

    await fs.promises.writeFile(tempFilePath, combinedBuffer);

    logger.debug(
      `Archivo temporal creado: ${tempFilePath} (${audioSize} bytes)`
    );

    // Llamada a la API de Groq (Whisper)
    const transcription = await this.client.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'json',
      temperature: 0.0,
    });

    // Limpiamos el fichero temporal
    try {
      await fs.promises.unlink(tempFilePath);
    } catch (cleanupError) {
      logger.warn(
        `No se pudo eliminar archivo temporal: ${cleanupError.message}`
      );
    }

    // Distintas posibles formas en las que venga el texto de Groq
    const transcriptText =
      (typeof transcription.text === 'string'
        ? transcription.text
        : transcription?.results?.[0]?.alternatives?.[0]?.text || ''
      ).trim();

    const durationMs = Date.now() - transcriptStartTime;

    logAudio('groq_transcription_success', {
      sessionId: this.sessionId,
      durationMs,
      text: transcriptText,
    });

    if (transcriptText && this.transcriptionCallback) {
      await this.transcriptionCallback(transcriptText);
    }
  } catch (error) {
    // Logs “bonitos” en consola (como los que ya veías)
    console.log('=================================');
    console.log('ERROR EN GROQ STT');
    console.log('Session:', this.sessionId);
    console.log(
      'Error Message:',
      error?.status
        ? `${error.status} ${JSON.stringify(error.error || error)}`
        : error?.message || String(error)
    );
    console.log('Error Name:', error?.name || 'Error');
    console.log('Error Status:', error?.status || 'N/A');
    console.log('Error Code:', error?.code || 'N/A');
    console.log('Full Error:', JSON.stringify(error, null, 2));
    console.log('=================================');

    // Log estructurado con pino
    const errorMessage = error?.status
      ? `${error.status} ${JSON.stringify(error.error || error)}`
      : error?.message || String(error);

    logger.error(
      {
        module: 'GroqSTT',
        sessionId: this.sessionId,
        errorMessage,
        errorName: error?.name || 'Error',
        errorStatus: error?.status || 'N/A',
        errorType: typeof error,
        audioBufferLength: this.audioBuffer.length,
      },
      `GROQ ERROR: ${errorMessage}`
    );
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