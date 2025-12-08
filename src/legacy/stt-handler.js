/**
 * LEGACY HANDLER - Código original (v1)
 * 
 * Mantiene la funcionalidad actual POST /stt
 * para garantizar compatibilidad mientras se migra a v2
 */

import OpenAI from 'openai';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../config/env.js';
import { createModuleLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createModuleLogger('LegacyHandler');
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Configurar uploads
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

// =============================
// TTS Helpers
// =============================

async function ttsOpenAI(text) {
  const speech = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: text
  });

  const audioBuffer = Buffer.from(await speech.arrayBuffer());
  return audioBuffer.toString('base64');
}

async function ttsElevenLabs(text) {
  const apiKey = config.elevenlabs.apiKey;
  const voiceId = config.elevenlabs.voiceId;

  if (!apiKey || !voiceId) {
    throw new Error('Falta configuración de ElevenLabs');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.8,
        style: 0.7,
        use_speaker_boost: true
      }
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Error ElevenLabs: ${resp.status} - ${txt}`);
  }

  const arrayBuf = await resp.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuf);
  return audioBuffer.toString('base64');
}

// =============================
// Ruta POST /stt (LEGACY)
// =============================

export function setupLegacyRoutes(app) {
  logger.info('Configurando rutas legacy (v1)...');

  app.post('/stt', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se ha recibido ningún archivo de audio' });
      }

      // Historial de conversación
      let history = [];
      if (req.body && req.body.history) {
        try {
          history = JSON.parse(req.body.history);
          if (!Array.isArray(history)) history = [];
        } catch {
          history = [];
        }
      }

      // Limitar historial
      if (history.length > 10) {
        history = history.slice(history.length - 10);
      }

      const clientName = (req.body?.clientName || '').trim();

      const filePath = req.file.path;
      const newPath = filePath + '.webm';
      
      // Verificar que el archivo existe antes de renombrar
      if (!fs.existsSync(filePath)) {
        logger.error(`Archivo no encontrado: ${filePath}`);
        return res.status(400).json({ error: 'Archivo de audio no encontrado' });
      }
      
      try {
        fs.renameSync(filePath, newPath);
        logger.debug(`Archivo renombrado: ${filePath} -> ${newPath}`);
      } catch (renameError) {
        logger.error(`Error al renombrar archivo: ${renameError.message}`);
        return res.status(500).json({ error: 'Error procesando archivo de audio' });
      }

      // 1) Transcripción con Whisper
      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: fs.createReadStream(newPath),
        language: 'es',
        temperature: 0,
        prompt: 'Transcribe de forma literal y clara lo que dice el usuario en español de España.'
      });

      const textoUsuario = (transcription.text || '').trim();
      logger.info(`Transcripción: "${textoUsuario}"`);

      // Filtro de silencios
      const frasesBasura = ['Subtítulos realizados por la comunidad de Amara.org'];

      if (!textoUsuario || frasesBasura.includes(textoUsuario)) {
        const msgSilencio = 'No he llegado a oírte bien, ¿te importa repetirlo un momento?';

        const providerFromRequest = req.body?.ttsProvider;
        const providerDefault = process.env.TTS_PROVIDER_DEFAULT || 'openai';
        const ttsProvider = (providerFromRequest || providerDefault).toLowerCase();

        let audioBase64Silencio;
        if (ttsProvider === 'elevenlabs') {
          audioBase64Silencio = await ttsElevenLabs(msgSilencio);
        } else {
          audioBase64Silencio = await ttsOpenAI(msgSilencio);
        }

        fs.unlink(newPath, () => {});

        return res.json({
          transcript: '',
          answer: msgSilencio,
          audio: audioBase64Silencio
        });
      }

      // 2) System prompt
      const systemMessage = {
        role: 'system',
        content: `
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
- El nombre del cliente recibido desde la aplicación es: "${clientName || 'desconocido'}".
- Si el nombre está informado, utilízalo en el saludo inicial y en la conversación ("señor ${clientName}", "Perfecto, ${clientName}").
- Si NO se ha informado nombre, en lugar de usar un nombre inventado, di: "¿Hablo con el titular de la línea?".

PRIMERA INTERVENCIÓN (DESPUÉS DE LOS TONOS)
- Si en el historial NO hay todavía ningún mensaje de asistente (es decir, es la primera vez que hablas con el cliente en esta llamada),
  DEBES empezar SIEMPRE con un saludo muy concreto:
  - Si hay nombre de cliente: "Hola, buenos días, le llamo del servicio técnico de Vodafone. ¿Hablo con ${clientName || 'el titular de la línea'}?"
  - Si no hay nombre: "Hola, buenos días, le llamo del servicio técnico de Vodafone. ¿Hablo con el titular de la línea?"
- Este saludo solo se usa en tu PRIMER mensaje de la conversación. En el resto de turnos NO debes repetirlo.

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
- Si el cliente pide una cita que esté CLARAMENTE a más de 6 días en el futuro (por ejemplo "dentro de dos semanas", "para la siguiente semana", etc.):
  - En ese caso, SOLO puedes ofrecer:
    - Lunes por la tarde (por ejemplo entre las 16:00 y las 18:00),
    - Y jueves por la tarde (por ejemplo entre las 16:00 y las 18:00).
- Indica siempre de forma clara día y franja horaria cuando propongas o cierres la cita.
- Si el cliente te propone un día/hora fuera de estas reglas, intenta adaptarlo a la opción más parecida que cumpla las restricciones y explícaselo con naturalidad.

COMPORTAMIENTO CONVERSACIONAL
- Usa frases cortas y claras (2-4 frases por turno).
- Puedes usar alguna pequeña muletilla natural de vez en cuando, como:
  "vale", "a ver", "mira", "pues", "mmm", "déjame que lo piense un segundo", siempre en cantidades moderadas.
- Si el cliente te da datos (nombre, dirección, disponibilidad…), reconócelos de forma natural:
  "Perfecto, Iván", "Vale, entonces en Calle Habana 1, ¿verdad?".
- Apóyate en el historial de la conversación (mensajes anteriores) para no repetir preguntas innecesarias.
- Si el cliente pregunta por temas fuera de tu ámbito (facturas, tarifas, incidencias de red), responde muy brevemente
  y redirige: "Eso lo llevan desde atención al cliente de Vodafone, pero si te parece dejamos primero cerrada la cita de instalación."
- Si no entiendes algo, pídele que repita: "Perdona, ahí no te he escuchado bien, ¿me lo puedes repetir?".

REMATE DE LA CITA
- Cuando ya tengáis un día y franja más o menos claros, repite el resumen:
  "Entonces quedamos el [día] a las [hora/franja], en la dirección que hemos comentado. Acuérdate de tener la llave del RITI."
- Despídete de forma sencilla y profesional:
  "Genial, pues muchas gracias, que tengas buen día."

Ten en cuenta todo el historial de mensajes (user/assistant) que te envío y responde de forma coherente con él.
        `.trim()
      };

      const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: textoUsuario }
      ];

      // 3) Respuesta GPT
      const respuesta = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages
      });

      const contenido = respuesta.choices?.[0]?.message?.content || 'No he recibido contenido de la IA.';

      // 4) TTS
      const providerFromRequest = req.body?.ttsProvider;
      const providerDefault = process.env.TTS_PROVIDER_DEFAULT || 'openai';
      const ttsProvider = (providerFromRequest || providerDefault).toLowerCase();

      let audioBase64;
      if (ttsProvider === 'elevenlabs') {
        audioBase64 = await ttsElevenLabs(contenido);
      } else {
        audioBase64 = await ttsOpenAI(contenido);
      }

      // Borrar archivo temporal
      fs.unlink(newPath, () => {});

      // Respuesta
      res.json({
        transcript: textoUsuario,
        answer: contenido,
        audio: audioBase64
      });

    } catch (err) {
      logger.error('Error en /stt:', err);
      res.status(500).json({ error: err.message });
    }
  });

  logger.info('✓ Ruta legacy POST /stt configurada');
}
