/**
 * Interfaz estándar para proveedores de Large Language Models (LLM)
 * 
 * Todos los proveedores (OpenAI, Anthropic, Groq, etc.) 
 * deben implementar esta interfaz para ser intercambiables
 */

export class LLMProvider {
  /**
   * Generar respuesta en streaming
   * @param {Array} messages - Array de mensajes [{role: 'user'|'assistant', content: string}]
   * @param {string} systemPrompt - System prompt para configurar el comportamiento
   * @returns {AsyncGenerator<string>} - Generator que emite chunks de texto
   */
  async* streamResponse(messages, systemPrompt) {
    throw new Error('streamResponse() debe ser implementado');
  }

  /**
   * Cancelar generación en curso
   * @returns {Promise<void>}
   */
  async cancel() {
    throw new Error('cancel() debe ser implementado');
  }

  /**
   * Registrar callback para errores
   * @param {Function} callback - (error: Error) => void
   */
  onError(callback) {
    throw new Error('onError() debe ser implementado');
  }

  /**
   * Obtener información del proveedor
   * @returns {Object} { name: string, model: string, tokensPerSecond: number }
   */
  getInfo() {
    throw new Error('getInfo() debe ser implementado');
  }

  /**
   * Estimar coste de una llamada
   * @param {Array} messages - Mensajes a enviar
   * @returns {number} - Coste estimado en USD
   */
  estimateCost(messages) {
    throw new Error('estimateCost() debe ser implementado');
  }
}

export default LLMProvider;
