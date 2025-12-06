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

// Multer para subir audio temporalmente
const upload = multer({ dest: 'uploads/' });

// =============================
// STATIC: servir frontend
// =============================
app.use(express.static(path.join(__dirname, 'public')));

// =============================
// HTTP: endpoint /stt (voz -> texto -> respuesta IA)
// =============================
app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha recibido ningún archivo de audio' });
    }

    const filePath = req.file.path;

    // 1) Transcribir audio con Whisper
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(filePath),
      language: 'es'
    });

    const textoUsuario = transcription.text || '';
    console.log('Transcripción:', textoUsuario);

    // 2) Obtener respuesta de la IA en base a lo que has dicho
    const respuesta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Eres un asistente amable y conciso.' },
        { role: 'user', content: textoUsuario }
      ]
    });

    const contenido =
      respuesta.choices?.[0]?.message?.content ||
      'No he recibido contenido de la IA.';

    // Borramos el archivo temporal (no esperamos al callback)
    fs.unlink(filePath, () => {});

    // Devolvemos JSON al navegador
    res.json({
      transcript: textoUsuario,
      answer: contenido
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
              { role: 'system', content: 'Eres un asistente amable y conciso.' },
              { role: 'user', content: 'Responde con una frase corta de saludo para probar la conexión.' }
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
