/**
 * Interfaz estándar para proveedores de Text-to-Speech (TTS)
 * 
 * Todos los proveedores (ElevenLabs, OpenAI, Cartesia, etc.) 
 * deben implementar esta interfaz para ser intercambiables
 */

export class TTSProvider {
  /**
   * Conectar al servicio de TTS
   * @param {string} sessionId - ID único de la sesión
   * @param {string} voiceId - ID de la voz a usar
   * @returns {Promise<void>}
   */
  async connect(sessionId, voiceId) {
    throw new Error('connect() debe ser implementado');
  }

  /**
   * Sintetizar texto a audio (streaming)
   * @param {string} text - Texto a sintetizar
   * @param {boolean} flush - Si true, fuerza el envío inmediato (útil para final de frase)
   * @returns {Promise<void>}
   */
  async synthesize(text, flush = false) {
    throw new Error('synthesize() debe ser implementado');
  }

  /**
   * Registrar callback para chunks de audio
   * @param {Function} callback - (audioChunk: Buffer) => void
   */
  onAudioChunk(callback) {
    throw new Error('onAudioChunk() debe ser implementado');
  }

  /**
   * Registrar callback para fin de síntesis
   * @param {Function} callback - () => void
   */
  onComplete(callback) {
    throw new Error('onComplete() debe ser implementado');
  }

  /**
   * Registrar callback para errores
   * @param {Function} callback - (error: Error) => void
   */
  onError(callback) {
    throw new Error('onError() debe ser implementado');
  }

  /**
   * Cancelar síntesis en curso
   * @returns {Promise<void>}
   */
  async cancel() {
    throw new Error('cancel() debe ser implementado');
  }

  /**
   * Desconectar del servicio
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() debe ser implementado');
  }

  /**
   * Verificar si está conectado
   * @returns {boolean}
   */
  isConnected() {
    throw new Error('isConnected() debe ser implementado');
  }

  /**
   * Obtener información del proveedor
   * @returns {Object} { name: string, model: string, latencyMs: number }
   */
  getInfo() {
    throw new Error('getInfo() debe ser implementado');
  }

  /**
   * Estimar coste de síntesis
   * @param {string} text - Texto a sintetizar
   * @returns {number} - Coste estimado en USD
   */
  estimateCost(text) {
    throw new Error('estimateCost() debe ser implementado');
  }
}

export default TTSProvider;
