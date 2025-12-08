/**
 * Interfaz estándar para proveedores de Speech-to-Text (STT)
 * 
 * Todos los proveedores (Deepgram, Groq, AssemblyAI, etc.) 
 * deben implementar esta interfaz para ser intercambiables
 */

export class STTProvider {
  /**
   * Conectar al servicio de STT
   * @param {string} sessionId - ID único de la sesión
   * @returns {Promise<void>}
   */
  async connect(sessionId) {
    throw new Error('connect() debe ser implementado');
  }

  /**
   * Enviar chunk de audio para transcripción
   * @param {Buffer} audioBuffer - Buffer con audio PCM16 o formato soportado
   * @returns {Promise<void>}
   */
  async sendAudio(audioBuffer) {
    throw new Error('sendAudio() debe ser implementado');
  }

  /**
   * Registrar callback para transcripciones
   * @param {Function} callback - (text: string, isFinal: boolean) => void
   */
  onTranscript(callback) {
    throw new Error('onTranscript() debe ser implementado');
  }

  /**
   * Registrar callback para errores
   * @param {Function} callback - (error: Error) => void
   */
  onError(callback) {
    throw new Error('onError() debe ser implementado');
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
   * @returns {Object} { name: string, version: string, latencyMs: number }
   */
  getInfo() {
    throw new Error('getInfo() debe ser implementado');
  }
}

export default STTProvider;
