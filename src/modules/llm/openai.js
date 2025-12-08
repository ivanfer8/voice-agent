import OpenAI from 'openai';
import LLMProvider from './interface.js';
import config from '../../config/env.js';
import { createModuleLogger, logLatency, logCost } from '../../utils/logger.js';

const logger = createModuleLogger('OpenAI_LLM');

/**
 * Implementación de LLM usando OpenAI GPT-4o-mini
 * 
 * Características:
 * - Streaming de respuestas token por token
 * - Latencia típica: 200-400ms para primer token
 * - Soporte de function calling (futuro)
 * - Historial de conversación
 */
export class OpenAILLM extends LLMProvider {
  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.abortController = null;
    this.errorCallback = null;
  }

  /**
   * System prompt específico para agente de Zener/Vodafone
   */
  getSystemPrompt(clientName = '') {
    return `
Eres un agente de voz que trabaja para la subcontrata Zener, en España.
Tu trabajo es hablar con clientes de Vodafone para concertar una cita de instalación de fibra óptica en su domicilio.

IDENTIDAD Y TONO
- Te comportas como un trabajador HUMANO de Zener, nunca digas que eres una IA ni que eres un sistema automático.
- Hablas SIEMPRE en español de España (castellano peninsular).
- Tuteas al cliente de forma educada: "vale", "genial", "perfecto", "mira", "te cuento", "si te parece", "de acuerdo", "venga".
- Tono: profesional pero cercano, como un teleoperador de oficina en España.
- Evita expresiones claramente latinoamericanas (ahorita, chévere, ustedes, etc.).
- Si el cliente está nervioso o perdido, mantén la calma y explica las cosas con claridad.

NOMBRE DEL CLIENTE
- El nombre del cliente es: "${clientName || 'desconocido'}".
- Si el nombre está informado, utilízalo en el saludo inicial y en la conversación ("señor ${clientName}", "Perfecto, ${clientName}").
- Si NO se ha informado nombre, en lugar de usar un nombre inventado, di: "¿Hablo con el titular de la línea?".

OBJETIVO PRINCIPAL DE LA LLAMADA
A lo largo de la conversación, tu objetivo es dejar cerrada una cita de instalación de fibra. Para ello debes:

  1) Confirmar el nombre del cliente si aún no ha quedado claro.
  2) Confirmar la dirección de la instalación.
  3) Preguntar si tiene acceso al cuarto de telecomunicaciones (RITI) del edificio.
  4) Si NO tiene acceso al RITI:
     - Explica que debe pedir la llave al presidente de la comunidad, al administrador de fincas o al conserje.
     - Recalca que sin esa llave el técnico no podrá completar la instalación.

FRANJAS HORARIAS PARA AGENDAR
- Trabajamos siempre con días laborables.
- En condiciones normales, ofreces CITA en:
  - Lunes, miércoles y viernes laborables,
  - En la franja de 12:00 a 14:00.
- Si el cliente pide una cita que esté CLARAMENTE a más de 6 días en el futuro:
  - En ese caso, SOLO puedes ofrecer:
    - Lunes por la tarde (entre las 16:00 y las 18:00),
    - Y jueves por la tarde (entre las 16:00 y las 18:00).
- Indica siempre de forma clara día y franja horaria cuando propongas o cierres la cita.

COMPORTAMIENTO CONVERSACIONAL
- Usa frases cortas y claras (2-4 frases por turno).
- Puedes usar alguna pequeña muletilla natural de vez en cuando: "vale", "a ver", "mira", "pues", "mmm".
- Si el cliente te da datos, reconócelos: "Perfecto, Iván", "Vale, entonces en Calle Habana 1, ¿verdad?".
- Si no entiendes algo, pide que repita: "Perdona, ahí no te he escuchado bien, ¿me lo puedes repetir?".

IMPORTANTE: Responde SOLO con tu mensaje, sin metadatos ni explicaciones adicionales.
    `.trim();
  }

  async* streamResponse(messages, clientName = '') {
    const startTime = Date.now();
    this.abortController = new AbortController();

    try {
      const systemPrompt = this.getSystemPrompt(clientName);
      
      const allMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];

      // Crear stream
      const stream = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: allMessages,
        stream: true,
        temperature: 0.8,
        max_tokens: 200, // respuestas cortas y naturales
      }, {
        signal: this.abortController.signal,
      });

      let firstTokenTime = null;
      let tokenCount = 0;
      let fullResponse = '';

      // Iterar sobre el stream
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content;

        if (content) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            const ttft = firstTokenTime - startTime;
            logLatency('llm_first_token', ttft);
          }

          tokenCount++;
          fullResponse += content;
          yield content;
        }
      }

      // Métricas finales
      const totalTime = Date.now() - startTime;
      logLatency('llm_complete', totalTime, { tokenCount });

      // Estimar coste (aproximado para GPT-4o-mini)
      const inputTokens = JSON.stringify(allMessages).length / 4; // aproximación
      const outputTokens = tokenCount;
      const cost = (inputTokens * 0.00000015) + (outputTokens * 0.0000006);
      logCost('openai_llm', cost, { inputTokens, outputTokens });

      logger.debug(`Respuesta completa generada: "${fullResponse.substring(0, 100)}..."`);

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.info('Generación LLM cancelada por el usuario');
        return;
      }

      logger.error('Error en OpenAI LLM:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
      throw error;
    }
  }

  async cancel() {
    if (this.abortController) {
      logger.info('Cancelando generación LLM...');
      this.abortController.abort();
      this.abortController = null;
    }
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  getInfo() {
    return {
      name: 'OpenAI',
      model: config.openai.model,
      tokensPerSecond: 50, // típico para GPT-4o-mini
    };
  }

  estimateCost(messages) {
    // Estimación muy aproximada
    const totalChars = JSON.stringify(messages).length;
    const estimatedTokens = totalChars / 4;
    const inputCost = estimatedTokens * 0.00000015;
    const outputCost = 100 * 0.0000006; // asumimos ~100 tokens de salida
    return inputCost + outputCost;
  }
}

export default OpenAILLM;
