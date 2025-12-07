const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =============================
// Helpers TTS
// =============================

async function ttsOpenAI(text) {
  // TTS con OpenAI
  const speech = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: text
  });

  const audioBuffer = Buffer.from(await speech.arrayBuffer());
  return audioBuffer.toString('base64'); // mp3 base64
}

async function ttsElevenLabs(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    throw new Error('Falta ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en las variables de entorno');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  // Node 18+ trae fetch global. Si diera error de "fetch is not defined", lo vemos.
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
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
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
  return audioBuffer.toString('base64'); // mp3 base64
}

// =============================
// Asegurar carpeta uploads
// =============================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Carpeta uploads creada:', uploadsDir);
}

// Multer para subir audio temporalmente
const upload = multer({ dest: uploadsDir });

// =============================
// STATIC: servir frontend
// =============================
app.use(express.static(path.join(__dirname, 'public')));

// =============================
// HTTP: /stt  (voz -> texto -> respuesta IA -> audio)
// =============================
app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha recibido ningún archivo de audio' });
    }

    // Historial de conversación recibido del frontend (string JSON)
    let history = [];
    if (req.body && req.body.history) {
      try {
        history = JSON.parse(req.body.history);
        if (!Array.isArray(history)) history = [];
      } catch {
        history = [];
      }
    }

    // Limitar historial a los últimos 10 mensajes
    if (history.length > 10) {
      history = history.slice(history.length - 10);
    }

    const filePath = req.file.path;        // sin extensión
    const newPath = filePath + '.webm';    // añadimos .webm para Whisper
    fs.renameSync(filePath, newPath);

    // 1) Transcripción con Whisper
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(newPath),
      language: 'es',
      temperature: 0,
      prompt:
        'Transcribe de forma literal y clara lo que dice el usuario en español de España. ' +
        'Es una conversación telefónica para concertar una cita de instalación de fibra óptica. ' +
        'Si hay ruido, silencio o no entiendes nada claro, devuelve texto muy corto o vacío.'
    });

    const textoUsuario = (transcription.text || '').trim();
    console.log('Transcripción cruda:', textoUsuario);

    // Filtro de silencios / frases basura
    const frasesBasura = [
      'Subtítulos realizados por la comunidad de Amara.org'
    ];

    if (!textoUsuario || frasesBasura.includes(textoUsuario)) {
      const msgSilencio =
        'No he llegado a oírte bien, ¿te importa repetirlo un momento?';

      // Elegimos proveedor TTS también para este mensaje
      const providerFromRequest = req.body?.ttsProvider;
      const providerDefault = process.env.TTS_PROVIDER_DEFAULT || 'openai';
      const ttsProvider = (providerFromRequest || providerDefault).toLowerCase();

      let audioBase64Silencio;
      if (ttsProvider === 'elevenlabs') {
        console.log('Usando ElevenLabs TTS (silencio)');
        audioBase64Silencio = await ttsElevenLabs(msgSilencio);
      } else {
        console.log('Usando OpenAI TTS (silencio)');
        audioBase64Silencio = await ttsOpenAI(msgSilencio);
      }

      fs.unlink(newPath, () => {});

      return res.json({
        transcript: '',
        answer: msgSilencio,
        audio: audioBase64Silencio
      });
    }

    console.log('Transcripción limpia:', textoUsuario);

    // 2) Construir mensajes con MEMORIA
    const messages = [
      {
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

CUÁNDO PRESENTARTE
- SOLO te presentas con la frase típica de apertura si el contexto suena a inicio de conversación
  (primer intercambio, saludos tipo "hola", "buenos días", "me habéis llamado", etc.).
- La presentación puedes hacerla así:
  "Hola, soy de Zener, te llamo en nombre de Vodafone por la instalación de la fibra óptica."
- Si el historial muestra que ya os habéis presentado y estáis hablando de detalles (nombre, dirección, horarios, RITI),
  NO repitas la presentación. Continúa la conversación de forma natural.

OBJETIVO PRINCIPAL
A lo largo de la conversación, tu objetivo es dejar cerrada una cita de instalación de fibra. Para ello debes:

  1) Confirmar el nombre del cliente si aún no ha quedado claro.
  2) Confirmar la dirección de la instalación.
  3) Preguntar si tiene acceso al cuarto de telecomunicaciones (RITI) del edificio.
  4) Si NO tiene acceso al RITI:
     - Explica que debe pedir la llave al presidente de la comunidad, al administrador de fincas o al conserje.
     - Recalca que sin esa llave el técnico no podrá completar la instalación.
  5) Proponer una o varias fechas/franjas horarias para la cita.
  6) Confirmar la franja elegida y hacer un pequeño resumen al cerrar.

COMPORTAMIENTO CONVERSACIONAL
- Usa frases cortas y claras (2–4 frases por turno).
- Si el cliente te da datos (nombre, dirección, disponibilidad…), reconócelos de forma natural:
  "Perfecto, Iván", "Vale, entonces en Calle Habana 1, ¿verdad?".
- Apóyate en el historial de la conversación (mensajes anteriores) para no repetir preguntas innecesarias.
- Si el cliente pregunta por temas fuera de tu ámbito (facturas, tarifas, incidencias de red), responde muy brevemente
  y redirige: "Eso lo llevan desde atención al cliente de Vodafone, pero si te parece dejamos primero cerrada la cita de instalación."
- Si no entiendes algo, pídele que repita: "Perdona, ahí no te he escuchado bien, ¿me lo puedes repetir?".

REMATE DE LA CITA
- Cuando ya tengáis un día y franja más o menos claros, repite el resumen:
  "Entonces quedamos el lunes de dentro de tres semanas, por la tarde, entre las 4 y las 6, en Calle X; acuérdate de tener la llave del RITI."
- Despídete de forma sencilla y profesional:
  "Genial, pues muchas gracias, que tengas buen día."

Ten en cuenta todo el historial de mensajes (user/assistant) que te envío y responde de forma coherente con él.
        `.trim()
      },
      ...history,
      { role: 'user', content: textoUsuario }
    ];

    const respuesta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });

    const contenido =
      respuesta.choices?.[0]?.message?.content ||
      'No he recibido contenido de la IA.';

    // 3) Elegir proveedor de TTS
    const providerFromRequest = req.body?.ttsProvider;
    const providerDefault = process.env.TTS_PROVIDER_DEFAULT || 'openai';
    const ttsProvider = (providerFromRequest || providerDefault).toLowerCase();

    let audioBase64;
    if (ttsProvider === 'elevenlabs') {
      console.log('Usando ElevenLabs TTS');
      audioBase64 = await ttsElevenLabs(contenido);
    } else {
      console.log('Usando OpenAI TTS');
      audioBase64 = await ttsOpenAI(contenido);
    }

    // Borrar archivo temporal
    fs.unlink(newPath, () => {});

    // Devolver transcript + respuesta + audio
    res.json({
      transcript: textoUsuario,
      answer: contenido,
      audio: audioBase64
    });
  } catch (err) {
    console.error('Error en /stt:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// WEBSOCKET: debug audio
// =============================
wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.on('message', async (message, isBinary) => {
    try {
      if (!isBinary) {
        const text = message.toString();
        console.log('Texto recibido:', text);

        if (text.startsWith('TEST DESDE EL NAVEGADOR')) {
          const respuesta = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'Eres un asistente amable y conciso que responde en español de España.'
              },
              {
                role: 'user',
                content: 'Pon un saludo muy corto para probar la conexión.'
              }
            ]
          });

          const contenido =
            respuesta.choices?.[0]?.message?.content ||
            'No he recibido contenido de la IA.';

          console.log('Respuesta IA (WS):', contenido);
          ws.send('Respuesta IA: ' + contenido);
        } else {
          ws.send('Recibido texto: ' + text);
        }

        return;
      }

      const buf = Buffer.from(message);
      console.log('Audio chunk recibido, tamaño:', buf.length);
      ws.send('OK: he recibido audio (' + buf.length + ' bytes)');
    } catch (err) {
      console.error('Error procesando mensaje WS:', err);
      ws.send('Error en servidor: ' + err.message);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

// =============================
// ARRANQUE DEL SERVIDOR
// =============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
});
