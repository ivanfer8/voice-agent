import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger, logSession } from '../utils/logger.js';
import { getSessionManager } from '../modules/session/manager.js';
import DeepgramSTT from '../modules/stt/deepgram.js';
import OpenAILLM from '../modules/llm/openai.js';
import ElevenLabsTTS from '../modules/tts/elevenlabs.js';
import AudioBufferManager from '../audio/buffer-manager.js';

const logger = createModuleLogger('WebSocketHandler');
const sessionManager = getSessionManager();

/**
 * Orquestador principal de conversación en tiempo real
 * 
 * Flujo:
 * 1. Cliente envía audio → Deepgram STT
 * 2. STT devuelve texto → acumula hasta frase completa
 * 3. Frase completa → OpenAI LLM (streaming)
 * 4. LLM genera tokens → ElevenLabs TTS (streaming)
 * 5. TTS genera audio → Cliente reproduce
 * 
 * Características:
 * - Detección de interrupciones
 * - Cancelación de respuestas
 * - Sincronización de streams
 */
export class VoiceConversationHandler {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.session = null;
    this.sttProvider = null;
    this.llmProvider = null;
    this.ttsProvider = null;
    this.audioBuffer = null;
    
    this.currentTranscript = '';
    this.isAgentSpeaking = false;
    this.pendingLLMResponse = '';
  }

  /**
   * Inicializar conexión y proveedores
   */
  async initialize(metadata = {}) {
    try {
      logger.info(`Inicializando conversación [${this.sessionId}]`);

      // Crear sesión
      this.session = sessionManager.createSession(this.sessionId, metadata);
      
      // Crear buffer manager
      this.audioBuffer = new AudioBufferManager(this.sessionId);

      // Inicializar proveedores
      this.sttProvider = new DeepgramSTT();
      this.llmProvider = new OpenAILLM();
      this.ttsProvider = new ElevenLabsTTS();

      // Conectar STT
      await this.sttProvider.connect(this.sessionId);
      sessionManager.updateState(this.sessionId, { sttConnected: true });

      // Configurar callbacks STT
      this.sttProvider.onTranscript((text, isFinal, confidence) => {
        this.handleTranscript(text, isFinal, confidence);
      });

      this.sttProvider.onError((error) => {
        logger.error(`Error en STT [${this.sessionId}]:`, error);
        this.sendError('stt_error', error.message);
      });

      // Conectar TTS
      await this.ttsProvider.connect(this.sessionId);
      sessionManager.updateState(this.sessionId, { ttsConnected: true });

      // Configurar callbacks TTS
      this.ttsProvider.onAudioChunk((audioChunk) => {
        this.handleTTSAudioChunk(audioChunk);
      });

      this.ttsProvider.onComplete(() => {
        logger.info(`TTS completado [${this.sessionId}]`);
        this.isAgentSpeaking = false;
        this.sendEvent('agent_finished_speaking');
      });

      this.ttsProvider.onError((error) => {
        logger.error(`Error en TTS [${this.sessionId}]:`, error);
        this.sendError('tts_error', error.message);
      });

      // Guardar proveedores en sesión
      sessionManager.setProviders(this.sessionId, {
        stt: this.sttProvider,
        llm: this.llmProvider,
        tts: this.ttsProvider,
      });

      sessionManager.updateState(this.sessionId, { isActive: true });
      
      // Enviar confirmación al cliente
      this.sendEvent('ready', {
        sessionId: this.sessionId,
        providers: {
          stt: this.sttProvider.getInfo(),
          llm: this.llmProvider.getInfo(),
          tts: this.ttsProvider.getInfo(),
        },
      });

      logger.info(`Conversación lista [${this.sessionId}]`);

    } catch (error) {
      logger.error(`Error inicializando conversación [${this.sessionId}]:`, error);
      this.sendError('init_error', error.message);
      throw error;
    }
  }

  /**
   * Procesar audio entrante del usuario
   */
  async handleIncomingAudio(audioBuffer) {
    try {
      // Si el agente está hablando y el usuario interrumpe, cancelar
      if (this.isAgentSpeaking) {
        logger.info(`Usuario interrumpe al agente [${this.sessionId}]`);
        await this.handleUserInterruption();
      }

      // Enviar audio a STT
      await this.sttProvider.sendAudio(audioBuffer);

    } catch (error) {
      logger.error(`Error procesando audio [${this.sessionId}]:`, error);
      this.sendError('audio_processing_error', error.message);
    }
  }

  /**
   * Manejar transcripción del STT
   */
  handleTranscript(text, isFinal, confidence) {
    try {
      // Acumular transcripción
      if (!isFinal) {
        // Transcripción parcial (interim)
        this.sendEvent('transcript_partial', { text, confidence });
        return;
      }

      // Transcripción final
      this.currentTranscript += text + ' ';
      
      // Enviar al cliente para mostrar en UI
      this.sendEvent('transcript_final', { text, confidence });

      // Detectar fin de frase (basado en pausas largas de Deepgram)
      // o simplemente procesar cada transcripción final
      this.processUserMessage(this.currentTranscript.trim());
      this.currentTranscript = '';

    } catch (error) {
      logger.error(`Error manejando transcripción [${this.sessionId}]:`, error);
    }
  }

  /**
   * Procesar mensaje completo del usuario
   */
  async processUserMessage(userText) {
    if (!userText || userText.length === 0) return;

    try {
      logger.info(`Procesando mensaje del usuario [${this.sessionId}]: "${userText}"`);

      // Agregar al historial
      sessionManager.addMessage(this.sessionId, 'user', userText);

      // Obtener historial formateado
      const history = sessionManager.getFormattedHistory(this.sessionId);

      // Obtener nombre de cliente de metadata
      const clientName = this.session.metadata.clientName || '';

      // Generar respuesta con LLM (streaming)
      sessionManager.updateState(this.sessionId, { llmStreaming: true });
      this.pendingLLMResponse = '';

      let accumulatedText = '';
      const sentenceDelimiters = ['.', '!', '?', '\n'];
      
      for await (const chunk of this.llmProvider.streamResponse(history, clientName)) {
        accumulatedText += chunk;
        this.pendingLLMResponse += chunk;

        // Enviar chunk al cliente para mostrar en UI
        this.sendEvent('llm_chunk', { chunk });

        // Detectar fin de frase para enviar a TTS
        const lastChar = accumulatedText[accumulatedText.length - 1];
        if (sentenceDelimiters.includes(lastChar)) {
          // Enviar frase completa a TTS
          await this.synthesizeSentence(accumulatedText.trim());
          accumulatedText = '';
        }
      }

      // Enviar resto si quedó algo
      if (accumulatedText.trim().length > 0) {
        await this.synthesizeSentence(accumulatedText.trim(), true);
      }

      // Agregar respuesta completa al historial
      sessionManager.addMessage(this.sessionId, 'assistant', this.pendingLLMResponse);
      
      sessionManager.updateState(this.sessionId, { llmStreaming: false });
      
      logger.info(`Respuesta LLM completada [${this.sessionId}]`);

    } catch (error) {
      logger.error(`Error procesando mensaje [${this.sessionId}]:`, error);
      this.sendError('message_processing_error', error.message);
      sessionManager.updateState(this.sessionId, { llmStreaming: false });
    }
  }

  /**
   * Sintetizar frase con TTS
   */
  async synthesizeSentence(text, flush = false) {
    try {
      if (!text || text.trim().length === 0) return;

      this.isAgentSpeaking = true;
      sessionManager.updateState(this.sessionId, { ttsStreaming: true });

      await this.ttsProvider.synthesize(text, flush);

      if (flush) {
        sessionManager.updateState(this.sessionId, { ttsStreaming: false });
      }

    } catch (error) {
      logger.error(`Error en síntesis [${this.sessionId}]:`, error);
      this.sendError('synthesis_error', error.message);
    }
  }

  /**
   * Manejar chunk de audio del TTS
   */
  handleTTSAudioChunk(audioChunk) {
    try {
      // Enviar audio al cliente
      this.sendAudio(audioChunk);
    } catch (error) {
      logger.error(`Error enviando audio TTS [${this.sessionId}]:`, error);
    }
  }

  /**
   * Manejar interrupción del usuario
   */
  async handleUserInterruption() {
    try {
      logger.info(`Procesando interrupción del usuario [${this.sessionId}]`);

      // Cancelar TTS
      if (this.ttsProvider) {
        await this.ttsProvider.cancel();
      }

      // Cancelar LLM
      if (this.llmProvider) {
        await this.llmProvider.cancel();
      }

      // Limpiar buffers
      this.audioBuffer.cancelPlayback();

      // Resetear estado
      this.isAgentSpeaking = false;
      this.pendingLLMResponse = '';

      sessionManager.updateState(this.sessionId, {
        llmStreaming: false,
        ttsStreaming: false,
      });

      // Notificar al cliente
      this.sendEvent('interruption_processed');

    } catch (error) {
      logger.error(`Error manejando interrupción [${this.sessionId}]:`, error);
    }
  }

  /**
   * Enviar evento al cliente
   */
  sendEvent(eventType, data = {}) {
    if (this.ws.readyState !== 1) return; // WebSocket.OPEN = 1

    const message = {
      type: 'event',
      event: eventType,
      data,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Enviar error al cliente
   */
  sendError(errorType, message) {
    if (this.ws.readyState !== 1) return;

    const errorMessage = {
      type: 'error',
      error: errorType,
      message,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(errorMessage));
  }

  /**
   * Enviar audio al cliente
   */
  sendAudio(audioBuffer) {
    if (this.ws.readyState !== 1) return;

    // Enviar como binario
    this.ws.send(audioBuffer);
  }

  /**
   * Limpiar y cerrar conexión
   */
  async cleanup() {
    try {
      logger.info(`Limpiando conversación [${this.sessionId}]`);

      // Desconectar proveedores
      if (this.sttProvider) {
        await this.sttProvider.disconnect();
      }
      if (this.ttsProvider) {
        await this.ttsProvider.disconnect();
      }
      if (this.llmProvider) {
        await this.llmProvider.cancel();
      }

      // Limpiar buffers
      if (this.audioBuffer) {
        this.audioBuffer.clearAll();
      }

      // Destruir sesión
      await sessionManager.destroySession(this.sessionId);

      logger.info(`Conversación cerrada [${this.sessionId}]`);

    } catch (error) {
      logger.error(`Error en cleanup [${this.sessionId}]:`, error);
    }
  }
}

/**
 * Inicializar WebSocket Server
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/v2/voice' });

  logger.info('WebSocket Server iniciado en /v2/voice');

  wss.on('connection', (ws, req) => {
    const sessionId = uuidv4();
    logger.info(`Nueva conexión WebSocket: ${sessionId}`);

    let handler = null;

    ws.on('message', async (message, isBinary) => {
      try {
        // Mensaje de inicialización (JSON)
        if (!isBinary) {
          const data = JSON.parse(message.toString());

          if (data.type === 'init') {
            // Inicializar conversación
            handler = new VoiceConversationHandler(ws, sessionId);
            await handler.initialize(data.metadata || {});
          } else if (data.type === 'metadata') {
            // Actualizar metadata
            if (handler && handler.session) {
              sessionManager.updateMetadata(sessionId, data.metadata);
            }
          }
        } else {
          // Audio binario (Buffer)
          if (handler) {
            await handler.handleIncomingAudio(Buffer.from(message));
          }
        }
      } catch (error) {
        logger.error(`Error procesando mensaje WebSocket [${sessionId}]:`, error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'message_processing_error',
          message: error.message,
        }));
      }
    });

    ws.on('close', async () => {
      logger.info(`WebSocket cerrado: ${sessionId}`);
      if (handler) {
        await handler.cleanup();
      }
    });

    ws.on('error', (error) => {
      logger.error(`Error en WebSocket [${sessionId}]:`, error);
    });
  });

  return wss;
}

export default { initWebSocketServer, VoiceConversationHandler };
