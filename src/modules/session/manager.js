import { createModuleLogger, logSession } from '../../utils/logger.js';
import config from '../../config/env.js';

const logger = createModuleLogger('SessionManager');

/**
 * Gestor de sesiones para mantener estado de conversaciones
 * 
 * Cada sesión contiene:
 * - ID único
 * - Historial de mensajes
 * - Metadata (nombre cliente, timestamps, etc.)
 * - Estado de conexión (STT, LLM, TTS)
 */
export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  /**
   * Crear nueva sesión
   * @param {string} sessionId - ID único de sesión
   * @param {Object} metadata - Metadata inicial
   * @returns {Object} - Objeto de sesión creado
   */
  createSession(sessionId, metadata = {}) {
    const session = {
      id: sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      metadata: {
        clientName: metadata.clientName || '',
        ...metadata,
      },
      conversationHistory: [],
      state: {
        isActive: false,
        sttConnected: false,
        llmStreaming: false,
        ttsStreaming: false,
      },
      providers: {
        stt: null,
        llm: null,
        tts: null,
      },
      buffers: {
        audioInput: [],
        audioOutput: [],
        textPending: '',
      },
    };

    this.sessions.set(sessionId, session);
    logSession(sessionId, 'session_created', metadata);
    logger.info(`Nueva sesión creada: ${sessionId}`);

    return session;
  }

  /**
   * Obtener sesión existente
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
    return session;
  }

  /**
   * Actualizar metadata de sesión
   */
  updateMetadata(sessionId, metadata) {
    const session = this.getSession(sessionId);
    if (session) {
      session.metadata = {
        ...session.metadata,
        ...metadata,
      };
      logSession(sessionId, 'metadata_updated', metadata);
    }
  }

  /**
   * Agregar mensaje al historial
   */
  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    if (!session) {
      logger.warn(`Sesión no encontrada: ${sessionId}`);
      return;
    }

    const message = {
      role, // 'user' o 'assistant'
      content,
      timestamp: Date.now(),
    };

    session.conversationHistory.push(message);

    // Limitar historial según configuración
    const maxMessages = config.session.maxHistoryMessages;
    if (session.conversationHistory.length > maxMessages) {
      session.conversationHistory = session.conversationHistory.slice(-maxMessages);
      logger.debug(`Historial truncado a últimos ${maxMessages} mensajes [${sessionId}]`);
    }

    logSession(sessionId, 'message_added', {
      role,
      contentLength: content.length,
      historySize: session.conversationHistory.length,
    });
  }

  /**
   * Obtener historial formateado para LLM
   */
  getFormattedHistory(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return [];

    return session.conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Actualizar estado de sesión
   */
  updateState(sessionId, stateUpdate) {
    const session = this.getSession(sessionId);
    if (session) {
      session.state = {
        ...session.state,
        ...stateUpdate,
      };
    }
  }

  /**
   * Guardar referencia a proveedores (STT, LLM, TTS)
   */
  setProviders(sessionId, providers) {
    const session = this.getSession(sessionId);
    if (session) {
      session.providers = {
        ...session.providers,
        ...providers,
      };
    }
  }

  /**
   * Obtener proveedores de una sesión
   */
  getProviders(sessionId) {
    const session = this.getSession(sessionId);
    return session?.providers || {};
  }

  /**
   * Destruir sesión y limpiar recursos
   */
  async destroySession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return;

    logger.info(`Destruyendo sesión: ${sessionId}`);

    // Desconectar proveedores
    try {
      if (session.providers.stt) {
        await session.providers.stt.disconnect();
      }
      if (session.providers.tts) {
        await session.providers.tts.disconnect();
      }
      if (session.providers.llm) {
        await session.providers.llm.cancel();
      }
    } catch (error) {
      logger.error(`Error al desconectar proveedores [${sessionId}]:`, error);
    }

    // Limpiar buffers
    session.buffers.audioInput = [];
    session.buffers.audioOutput = [];
    session.buffers.textPending = '';

    // Eliminar sesión
    this.sessions.delete(sessionId);
    logSession(sessionId, 'session_destroyed');
  }

  /**
   * Obtener estadísticas de una sesión
   */
  getSessionStats(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const duration = Date.now() - session.createdAt;
    const messageCount = session.conversationHistory.length;
    const lastActivity = Date.now() - session.lastActivityAt;

    return {
      sessionId,
      duration,
      messageCount,
      lastActivity,
      isActive: session.state.isActive,
      clientName: session.metadata.clientName,
    };
  }

  /**
   * Listar todas las sesiones activas
   */
  listActiveSessions() {
    const active = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.state.isActive) {
        active.push(this.getSessionStats(sessionId));
      }
    }
    return active;
  }

  /**
   * Limpiar sesiones inactivas automáticamente
   */
  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeout = config.session.timeoutMs;

      for (const [sessionId, session] of this.sessions.entries()) {
        const inactive = now - session.lastActivityAt;
        
        if (inactive > timeout) {
          logger.info(`Sesión inactiva detectada, limpiando: ${sessionId} (inactiva por ${inactive}ms)`);
          this.destroySession(sessionId).catch(err => {
            logger.error(`Error al limpiar sesión ${sessionId}:`, err);
          });
        }
      }
    }, 60000); // Revisar cada minuto
  }

  /**
   * Detener limpieza automática
   */
  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Obtener total de sesiones
   */
  getSessionCount() {
    return this.sessions.size;
  }
}

// Singleton global
let sessionManagerInstance = null;

export function getSessionManager() {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

export default SessionManager;
