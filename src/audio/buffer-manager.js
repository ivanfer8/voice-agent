import { createModuleLogger, logAudio } from '../utils/logger.js';

const logger = createModuleLogger('AudioBufferManager');

/**
 * Gestor de buffers de audio
 * 
 * Funciones:
 * - Gestionar cola de entrada (del usuario)
 * - Gestionar cola de salida (hacia el usuario)
 * - Cancelar audio pendiente en caso de interrupción
 * - Sincronizar streams
 */
export class AudioBufferManager {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.inputQueue = [];
    this.outputQueue = [];
    this.isPlaying = false;
    this.currentPlayback = null;
  }

  /**
   * Agregar chunk de audio de entrada (del usuario)
   */
  pushInput(audioChunk) {
    this.inputQueue.push({
      data: audioChunk,
      timestamp: Date.now(),
    });

    logAudio('input_buffered', {
      sessionId: this.sessionId,
      queueSize: this.inputQueue.length,
      chunkSize: audioChunk.length,
    });
  }

  /**
   * Obtener y eliminar siguiente chunk de entrada
   */
  popInput() {
    const chunk = this.inputQueue.shift();
    return chunk?.data;
  }

  /**
   * Limpiar cola de entrada
   */
  clearInput() {
    const cleared = this.inputQueue.length;
    this.inputQueue = [];
    
    if (cleared > 0) {
      logAudio('input_cleared', {
        sessionId: this.sessionId,
        clearedChunks: cleared,
      });
    }
  }

  /**
   * Agregar chunk de audio de salida (hacia el usuario)
   */
  pushOutput(audioChunk) {
    this.outputQueue.push({
      data: audioChunk,
      timestamp: Date.now(),
    });

    logAudio('output_buffered', {
      sessionId: this.sessionId,
      queueSize: this.outputQueue.length,
      chunkSize: audioChunk.length,
    });
  }

  /**
   * Obtener siguiente chunk de salida sin eliminarlo
   */
  peekOutput() {
    return this.outputQueue[0]?.data;
  }

  /**
   * Obtener y eliminar siguiente chunk de salida
   */
  popOutput() {
    const chunk = this.outputQueue.shift();
    return chunk?.data;
  }

  /**
   * Limpiar cola de salida (útil para interrupciones)
   */
  clearOutput() {
    const cleared = this.outputQueue.length;
    this.outputQueue = [];
    this.isPlaying = false;
    
    if (cleared > 0) {
      logAudio('output_cleared', {
        sessionId: this.sessionId,
        clearedChunks: cleared,
      });
      logger.info(`Audio de salida cancelado [${this.sessionId}]: ${cleared} chunks`);
    }
  }

  /**
   * Cancelar reproducción actual (interrupción del usuario)
   */
  cancelPlayback() {
    logger.info(`Cancelando reproducción [${this.sessionId}]`);
    
    this.clearOutput();
    
    if (this.currentPlayback) {
      this.currentPlayback.cancelled = true;
      this.currentPlayback = null;
    }
    
    logAudio('playback_cancelled', { sessionId: this.sessionId });
  }

  /**
   * Marcar inicio de reproducción
   */
  startPlayback() {
    this.isPlaying = true;
    this.currentPlayback = {
      startTime: Date.now(),
      cancelled: false,
    };
    
    logAudio('playback_started', { sessionId: this.sessionId });
  }

  /**
   * Marcar fin de reproducción
   */
  endPlayback() {
    if (this.currentPlayback) {
      const duration = Date.now() - this.currentPlayback.startTime;
      logAudio('playback_ended', {
        sessionId: this.sessionId,
        duration,
      });
    }
    
    this.isPlaying = false;
    this.currentPlayback = null;
  }

  /**
   * Verificar si hay reproducción activa
   */
  isPlaybackActive() {
    return this.isPlaying;
  }

  /**
   * Obtener tamaño de colas
   */
  getQueueSizes() {
    return {
      input: this.inputQueue.length,
      output: this.outputQueue.length,
    };
  }

  /**
   * Obtener estadísticas
   */
  getStats() {
    const inputBytes = this.inputQueue.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const outputBytes = this.outputQueue.reduce((sum, chunk) => sum + chunk.data.length, 0);

    return {
      sessionId: this.sessionId,
      inputQueue: {
        chunks: this.inputQueue.length,
        bytes: inputBytes,
      },
      outputQueue: {
        chunks: this.outputQueue.length,
        bytes: outputBytes,
      },
      isPlaying: this.isPlaying,
    };
  }

  /**
   * Limpiar todos los buffers
   */
  clearAll() {
    this.clearInput();
    this.clearOutput();
    this.endPlayback();
    
    logger.info(`Todos los buffers limpiados [${this.sessionId}]`);
  }
}

export default AudioBufferManager;
