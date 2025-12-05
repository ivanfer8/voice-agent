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

  ws.on('message', (message) => {
    console.log('Audio chunk recibido, tamaño:', message.byteLength);

    // De momento solo respondemos texto para probar
    ws.send('OK: he recibido audio (' + message.byteLength + ' bytes)');
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
});
