const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});




const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.on('message', async (message, isBinary) => {
    try {
      if (!isBinary) {
        const text = message.toString();
        console.log('Texto recibido:', text);

        // Si es el mensaje de prueba, llamamos a OpenAI
        if (text.startsWith('TEST DESDE EL NAVEGADOR')) {
          // Llamada simple a OpenAI en modo chat
          const respuesta = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // o el modelo que uses
            messages: [
              { role: 'system', content: 'Eres un asistente amable y conciso.' },
              { role: 'user', content: 'Responde con una frase corta de saludo para probar la conexión.' }
            ]
          });

          const contenido = respuesta.choices[0]?.message?.content || 'No he recibido contenido de la IA.';
          console.log('Respuesta IA:', contenido);

          ws.send('Respuesta IA: ' + contenido);
        } else {
          // Para cualquier otro texto, solo devolvemos eco
          ws.send('Recibido texto: ' + text);
        }

        return;
      }

      // Si es binario, lo tratamos como audio y solo debug
      const buf = Buffer.from(message);
      console.log('Audio chunk recibido, tamaño:', buf.length);
      ws.send('OK: he recibido audio (' + buf.length + ' bytes)');
    } catch (err) {
      console.error('Error procesando mensaje:', err);
      ws.send('Error en servidor: ' + err.message);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
});
