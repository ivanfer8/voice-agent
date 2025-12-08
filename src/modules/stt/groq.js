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
 * Este módulo implementa una estrategia de streaming "buffered":
 * - El cliente envía chunks de audio binario por WebSocket (~1s)
 * - Cada chunk se guarda como un archivo temporal .webm
 * - Se envía a Groq Whisper para obtener transcripción
 * - Se usa callback para notificar a la capa superior
 */
class GroqSTT extends STTProvider {
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

    try {
      if (!config.groq || !config.groq.apiKey) {
        throw new Error('Groq API key no configurada. Define GROQ_API_KEY en .env');
      }

      this.client = new Groq({
        apiKey: config.groq.apiKey,
      });

      this.isActive = true;
      logger.info(`Groq STT conectado [${sessionId}]`);

      // Iniciar procesamiento periódico del buffer de audio
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

    logger.debug('Procesamiento de buffer de Groq STT iniciado');
  }

  /**
   * Recibe un chunk de audio desde el WebSocket y lo transcribe directamente.
   * Cada chunk (~1s) que llega del navegador se trata como un fichero WebM completo.
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

      // Evitar enviar a Groq ruidos mínimos o buffers muy pequeños
      if (audioBuffer.length < 30000) { // ~1s de audio orientativo
        logAudio('chunk_too_small', {
          sessionId: this.sessionId,
          size: audioBuffer.length,
        });
        return;
      }

      await this.transcribeChunk(audioBuffer);
    } catch (error) {
      logger.error(`Error agregando audio al buffer [${this.sessionId}]:`, error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
      throw error;
    }
  }

  /**
   * Transcribe un único chunk de audio (Buffer) con Groq Whisper.
   * Asumimos que el buffer contiene un WebM/Opus válido generado por MediaRecorder.
   */
  async transcribeChunk(audioBuffer) {
    if (!this.isActive) return;

    try {
      const audioSize = audioBuffer.length;

      logAudio('sending_to_groq', {
        sessionId: this.sessionId,
        size: audioSize,
      });

      const transcriptStartTime = Date.now();

      // Guardar el chunk en un archivo temporal .webm
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const tempDir = os.tmpdir();
      const tempFilePath = path.join(
        tempDir,
        `chunk-${this.sessionId}-${Date.now()}.webm`
      );

      await fs.promises.writeFile(tempFilePath, audioBuffer);

      logger.debug(`Archivo temporal creado: ${tempFilePath} (${audioSize} bytes)`);

      // Llamada a la API de Groq (Whisper)
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-large-v3',
        language: 'es',
        response_format: 'json',
        temperature: 0.0,
      });

      // Limpiar archivo temporal
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupError) {
        logger.warn(`No se pudo eliminar archivo temporal: ${cleanupError.message}`);
      }

      const transcriptTime = Date.now() - transcriptStartTime;
      logLatency('groq_transcription', transcriptTime, {
        sessionId: this.sessionId,
        audioSize,
      });

      const text =
        (typeof transcription.text === 'string'
          ? transcription.text
          : transcription?.results?.[0]?.alternatives?.[0]?.text || ''
        ).trim();

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
        // De Groq sólo tenemos finales, marcamos isFinal = true
        await this.transcriptCallback(text, true, 1.0);
      }
    } catch (error) {
      // LOGGING EXPLÍCITO - Siempre se verá
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

      const errorMessage =
        error?.status
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
        },
        `GROQ ERROR: ${errorMessage}`
      );

      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  /**
   * Procesar audio acumulado en el buffer
   * (queda como mecanismo alternativo, pero ya no es imprescindible
   *  porque ahora hacemos transcripción por chunk en sendAudio).
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
      const tempFilePath = path.join(
        tempDir,
        `audio-${this.sessionId}-${Date.now()}.webm`
      );

      // Guardar buffer como archivo .webm temporal
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

      // Obtener texto de la transcripción
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
      // LOGGING EXPLÍCITO - Siempre se verá
      console.error('=================================');
      console.error('ERROR EN GROQ STT');
      console.error('Session:', this.sessionId);
      console.error('Error Message:', error.message);
      console.error('Error Name:', error.name);
      console.error('Error Status:', error.status || 'N/A');
      console.error('Error Code:', error.code || 'N/A');
      console.error('Full Error:', JSON.stringify(error, null, 2));
      console.error('=================================');
      
      // También con logger (por si console no se ve)
      logger.error({
        sessionId: this.sessionId,
        errorMessage: error.message,
        errorName: error.name,
        errorStatus: error.status,
        errorCode: error.code,
      }, `Error en Groq STT: ${error.message}`);

      // Si hay callback de error, notificar
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
      this.client = null;
      this.sessionId = null;
      this.transcriptCallback = null;
      this.errorCallback = null;
      this.audioBuffer = [];

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
      latencyMs: 150, // latencia típica
      streaming: 'buffered', // no es streaming puro, pero procesamiento rápido
    };
  }
}

export default GroqSTT;
