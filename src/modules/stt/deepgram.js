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
 * - FORMATO: WebM/Opus desde el navegador
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
    this.isActive = false;
  }

  async connect(sessionId) {
    this.sessionId = sessionId;
    this.startTime = Date.now();

    try {
      logger.info(`Iniciando conexión Deepgram [${sessionId}]`);

      // Crear cliente Deepgram
      this.client = createClient(config.deepgram.apiKey);

      logger.debug(`Cliente Deepgram creado [${sessionId}]`);

      // Configurar conexión de streaming
      // IMPORTANTE: NO especificar encoding/sample_rate para WebM
      // Deepgram detectará automáticamente el formato
      this.connection = this.client.listen.live({
        model: config.deepgram.model || 'nova-2',
        language: config.deepgram.language || 'es',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        // NO especificar encoding ni sample_rate
        // Deepgram detecta automáticamente WebM/Opus
      });

      logger.debug(`Conexión live creada [${sessionId}]`);

      // Registrar eventos
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        const connectTime = Date.now() - this.startTime;
        logLatency('deepgram_connect', connectTime, { sessionId });
        this.isActive = true;
        logger.info(`✅ Deepgram WebSocket ABIERTO [${sessionId}]`);
        console.log(`=== DEEPGRAM CONECTADO [${sessionId}] ===`);
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        console.log('=== DEEPGRAM TRANSCRIPT RECIBIDO ===');
        console.log('Data:', JSON.stringify(data, null, 2));

        const transcript = data.channel?.alternatives?.[0];
        if (!transcript) {
          logger.debug('Transcript sin alternativas');
          return;
        }

        const text = transcript.transcript?.trim();
        if (!text) {
          logger.debug('Transcript vacío');
          return;
        }

        const isFinal = data.is_final;
        const confidence = transcript.confidence;

        logger.info(`📝 Transcripción Deepgram [${isFinal ? 'FINAL' : 'parcial'}]: "${text}" (${confidence})`);
        console.log(`=== TRANSCRIPCIÓN: "${text}" (final: ${isFinal}) ===`);

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

      this.connection.on(LiveTranscriptionEvents.Metadata, (data) => {
        console.log('=== DEEPGRAM METADATA ===');
        console.log('Metadata:', JSON.stringify(data, null, 2));
        logger.debug(`Metadata recibida [${sessionId}]:`, data);
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error) => {
        console.error('=================================');
        console.error('ERROR EN DEEPGRAM');
        console.error('Session:', sessionId);
        console.error('Error:', error);
        console.error('=================================');
        
        logger.error(`Error en Deepgram [${sessionId}]:`, error);
        
        if (this.errorCallback) {
          this.errorCallback(error);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Warning, (warning) => {
        console.warn('=== DEEPGRAM WARNING ===');
        console.warn('Warning:', warning);
        logger.warn(`Advertencia de Deepgram [${sessionId}]:`, warning);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log(`=== DEEPGRAM CERRADO [${sessionId}] ===`);
        logger.info(`Deepgram cerrado [${sessionId}]`);
        this.isActive = false;
      });

      // Esperar a que se establezca la conexión
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout conectando a Deepgram (5s)'));
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

      logger.info(`✅ Deepgram conectado y listo [${sessionId}]`);

    } catch (error) {
      console.error('=================================');
      console.error('ERROR CONECTANDO DEEPGRAM');
      console.error('Session:', sessionId);
      console.error('Error:', error);
      console.error('=================================');
      
      logger.error(`Error al conectar con Deepgram [${sessionId}]:`, error);
      throw error;
    }
  }

  async sendAudio(audioBuffer) {
    if (!this.isConnected()) {
      console.error('=== DEEPGRAM NO CONECTADO - No se puede enviar audio ===');
      throw new Error('Deepgram no está conectado');
    }

    try {
      // Log cada 10 chunks para no saturar
      const shouldLog = Math.random() < 0.1; // 10% de probabilidad
      
      if (shouldLog) {
        console.log(`=== ENVIANDO AUDIO A DEEPGRAM: ${audioBuffer.length} bytes ===`);
        logger.debug(`📤 Enviando audio a Deepgram: ${audioBuffer.length} bytes [${this.sessionId}]`);
      }

      // Enviar audio a Deepgram
      this.connection.send(audioBuffer);
      
      logAudio('audio_sent_to_deepgram', {
        sessionId: this.sessionId,
        size: audioBuffer.length,
      });
    } catch (error) {
      console.error('=================================');
      console.error('ERROR ENVIANDO AUDIO A DEEPGRAM');
      console.error('Session:', this.sessionId);
      console.error('Buffer size:', audioBuffer.length);
      console.error('Error:', error);
      console.error('=================================');
      
      logger.error(`Error enviando audio [${this.sessionId}]:`, error);
      throw error;
    }
  }

  onTranscript(callback) {
    this.transcriptCallback = callback;
    logger.debug(`Callback de transcripción registrado [${this.sessionId}]`);
  }

  onError(callback) {
    this.errorCallback = callback;
    logger.debug(`Callback de error registrado [${this.sessionId}]`);
  }

  async disconnect() {
    if (!this.connection) {
      logger.debug('No hay conexión para desconectar');
      return;
    }

    try {
      logger.info(`Desconectando Deepgram [${this.sessionId}]`);
      console.log(`=== DESCONECTANDO DEEPGRAM [${this.sessionId}] ===`);
      
      // Enviar señal de finalización
      this.connection.finish();
      
      this.isActive = false;
      
      // Limpiar referencias
      this.connection = null;
      this.client = null;
      this.transcriptCallback = null;
      this.errorCallback = null;
    } catch (error) {
      console.error('Error desconectando Deepgram:', error);
      logger.error(`Error al desconectar Deepgram [${this.sessionId}]:`, error);
    }
  }

  isConnected() {
    const connected = this.connection !== null && 
                     this.connection.getReadyState() === 1 &&
                     this.isActive;
    return connected;
  }

  getInfo() {
    return {
      name: 'Deepgram',
      version: 'SDK v3',
      model: config.deepgram.model || 'nova-2',
      language: config.deepgram.language || 'es',
      format: 'WebM/Opus (auto-detect)',
      latencyMs: 150,
    };
  }
}

export default DeepgramSTT;