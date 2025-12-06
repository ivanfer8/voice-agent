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
// HTTP: endpoint /stt (voz -> texto -> respuesta IA -> audio)
// =============================
app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha recibido ningún archivo de audio' });
    }

    const filePath = req.file.path;        // sin extensión
    const newPath = filePath + '.webm';    // añadimos .webm para Whisper
    fs.renameSync(filePath, newPath);

    // 1) Transcribir audio con Whisper
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(newPath),
      language: 'es',
      temperature: 0,
      prompt: 'Transcribe de forma literal y clara lo que dice el usuario en español de España. Es una conversación telefónica sobre instalación de fibra óptica. Si hay ruido, silencio o no entiendes nada claro, devuelve texto muy corto o vacío.'
    });

    const textoUsuario = (transcription.text || '').trim();
    console.log('Transcripción cruda:', textoUsuario);

    // Filtro básico para silencios / frases basura muy típicas
    const frasesBasura = [
      'Subtítulos realizados por la comunidad de Amara.org'
    ];

    if (!textoUsuario || frasesBasura.includes(textoUsuario)) {
      const msgSilencio = 'No he llegado a oírte bien, ¿te importa repetirlo un momento?';
      // 3) Generar audio para este mensaje de “no te he oído”
      const speechSilencio = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: msgSilencio
      });
      const audioBufferSilencio = Buffer.from(await speechSilencio.arrayBuffer());
      const audioBase64Silencio = audioBufferSilencio.toString('base64');

      fs.unlink(newPath, () => {});
      return res.json({
        transcript: '',
        answer: msgSilencio,
        audio: audioBase64Silencio
      });
    }

    console.log('Transcripción limpia:', textoUsuario);

    // 2) Obtener respuesta de la IA (texto)
    const respuesta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
Eres un agente de voz que trabaja para la subcontrata Zener, en España.
Tu trabajo es llamar a clientes de Vodafone para concertar una cita de instalación de fibra óptica en su domicilio.

CONTEXTOS Y REGLAS IMPORTANTES:

1. IDENTIDAD Y TONO
- Actúas como un trabajador humano de Zener, nunca digas que eres una IA ni que eres un sistema automático.
- Hablas SIEMPRE en español de España (castellano peninsular).
- Tuteas al cliente de forma educada: "vale", "genial", "perfecto", "mira", "te cuento", "si te parece", "de acuerdo".
- Sonido y estilo de oficina: profesional pero cercano, como un teleoperador acostumbrado a tratar con clientes a diario.
- Eres amable, paciente y educado incluso si el cliente está serio o desconfiado.

2. OBJETIVO PRINCIPAL
Tu objetivo es concertar una CITA de instalación de fibra óptica de Vodafone en el domicilio del cliente.
Para ello, debes:
  a) Presentarte correctamente.
  b) Confirmar el nombre del cliente.
  c) Confirmar la dirección de la instalación.
  d) Confirmar si tiene acceso al cuarto de telecomunicaciones (RITI).
  e) Explicar qué debe hacer si no tiene la llave del RITI.
  f) Proponer una o varias fechas para la cita y dejarla cerrada.

3. FLUJO DE CONVERSACIÓN ESPERADO

(1) Presentación inicial
- Empieza siempre con una presentación natural, tipo:
  "Hola, soy <nombre> de Zener, te llamo en nombre de Vodafone para la instalación de la fibra óptica."
- Después de presentarte, intenta confirmar que hablas con la persona correcta:
  "¿Hablo con <nombre del cliente>?" o "¿Con quién tengo el gusto?"

(2) Confirmación de datos básicos
- Una vez sabes con quién hablas, confirma dirección:
  - "Perfecto, ¿me puedes confirmar la dirección donde hay que hacer la instalación de la fibra?"
  - Si el cliente te corrige la dirección, pide disculpas y actualiza verbalmente.

(3) Comprobación del acceso al RITI
- Pregunta siempre por el acceso al cuarto de telecomunicaciones (RITI), especialmente en comunidades de vecinos:
  - "¿Tienes acceso al cuarto de telecomunicaciones o RITI de tu edificio?"
- Si NO tiene acceso, explícale de forma clara:
  - Que necesitará pedir la llave al presidente de la comunidad, al administrador de fincas o al conserje.
  - Que sin esa llave, el técnico no podrá completar la instalación.
- Frase tipo:
  "Es importante que el día de la cita tengáis la llave del RITI, porque si no, el técnico no podrá tirar la fibra hasta tu domicilio."

(4) Propuesta de fecha y cita
- Siempre que sea posible, propón una o varias franjas horarias concretas:
  - "Te podría ofrecer cita el martes por la mañana, entre las 9 y las 11, o el miércoles por la tarde, entre las 4 y las 6. ¿Qué te viene mejor?"
- Si el usuario propone otra franja, sé flexible y responde de forma natural, intentando cuadrar:
  - "Vale, te encaja entonces el jueves por la mañana. Lo dejamos reservado en esa franja."
- Resume la cita:
  - Día, franja horaria y recordatorio de que esté alguien en casa y con llave del RITI si aplica.

(5) Cierre de la llamada
- Antes de terminar, resume:
  - Fecha y horario.
  - Qué debe tener preparado (acceso al RITI, estar en casa, etc.).
- Despídete de forma profesional:
  - "Perfecto, pues quedamos así entonces. Muchas gracias y que tengas buen día."

4. COMPORTAMIENTO CONVERSACIONAL
- Responde siempre en 2–4 frases, no te enrolles demasiado a no ser que el cliente pregunte mucho.
- Si el cliente pregunta algo que no tiene que ver con la cita (facturas, tarifas, incidencias técnicas), responde muy brevemente y vuelve al objetivo de la cita:
  - Ejemplo: "Eso se gestionaría con atención al cliente de Vodafone, pero si te parece, dejamos cerrada primero la cita de instalación."
- Si no entiendes bien lo que dice, pídele que lo repita de forma natural:
  - "Perdona, creo que ahí no te he escuchado bien, ¿me lo puedes repetir?"

5. ESTILO
- Usa expresiones normales de España, evita mexicanismos, sudamericanismos u otras variantes.
- Sonríe en el tono (aunque sea texto), que se note que estás de buen rollo pero sin pasarte de informal.
- No digas nunca que eres un bot, una IA o un sistema. Eres simplemente "de Zener, en nombre de Vodafone".

Ten en cuenta todo lo anterior y responde SIEMPRE en este estilo.
        `.trim()
        },
        { role: 'user', content: textoUsuario }
      ]
    });

    const contenido =
      respuesta.choices?.[0]?.message?.content ||
      'No he recibido contenido de la IA.';

    // 3) Convertir la respuesta a audio (TTS)
    const speech = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: contenido
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    // Borramos el archivo temporal renombrado
    fs.unlink(newPath, () => {});

    // Devolvemos JSON al navegador
    res.json({
      transcript: textoUsuario,
      answer: contenido,
      audio: audioBase64    // mp3 en base64
    });
  } catch (err) {
    console.error('Error en /stt:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// WEBSOCKET: debug audio + prueba OpenAI por texto
// =============================
wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.on('message', async (message, isBinary) => {
    try {
      // Mensajes de TEXTO (no binario)
      if (!isBinary) {
        const text = message.toString();
        console.log('Texto recibido:', text);

        // Si viene del frontend "TEST DESDE EL NAVEGADOR", probamos OpenAI
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
          // Eco para otros textos
          ws.send('Recibido texto: ' + text);
        }

        return;
      }

      // Mensajes BINARIOS: los tratamos como audio para debug
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
