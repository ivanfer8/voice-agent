# 🚀 Quick Start - Voice Agent v2

## Inicio Rápido en 5 Minutos

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
```

Editar `.env` con tus API keys:
```bash
DEEPGRAM_API_KEY=tu_key_aqui
OPENAI_API_KEY=tu_key_aqui
ELEVENLABS_API_KEY=tu_key_aqui
ELEVENLABS_VOICE_ID=tu_voice_id_aqui
```

### 3. Elegir modo de operación

#### Opción A: Modo Legacy (tu código actual)
```bash
# En .env
ENABLE_REALTIME=false
```

```bash
npm start
```

Abre: `http://localhost:3000`

✅ **Funciona exactamente igual que tu versión actual**

---

#### Opción B: Modo Realtime (nueva versión streaming)
```bash
# En .env
ENABLE_REALTIME=true
```

```bash
npm start
```

✅ **Conversación en tiempo real con latencia <500ms**

---

### 4. Verificar que funciona

```bash
# Health check
curl http://localhost:3000/health

# Info del servicio
curl http://localhost:3000/info
```

---

## 🔄 Cambiar entre modos

### De Legacy a Realtime:
1. Cambiar en `.env`: `ENABLE_REALTIME=true`
2. Reiniciar: `npm restart`
3. ✅ Listo

### De Realtime a Legacy:
1. Cambiar en `.env`: `ENABLE_REALTIME=false`
2. Reiniciar: `npm restart`
3. ✅ Listo

---

## 🐳 Con Docker

```bash
# Build
docker-compose build

# Run (modo legacy)
ENABLE_REALTIME=false docker-compose up -d

# Run (modo realtime)
ENABLE_REALTIME=true docker-compose up -d

# Ver logs
docker-compose logs -f

# Parar
docker-compose down
```

---

## 🧪 Testing

### Test Legacy (POST /stt)
```bash
# Usar Postman o curl con un archivo de audio
curl -X POST http://localhost:3000/stt \
  -F "audio=@test-audio.webm" \
  -F "clientName=Iván" \
  -F "ttsProvider=elevenlabs" \
  -F "history=[]"
```

### Test Realtime (WebSocket)
```javascript
// En el navegador (consola)
const ws = new WebSocket('ws://localhost:3000/v2/voice');

ws.onopen = () => {
  console.log('Conectado');
  ws.send(JSON.stringify({
    type: 'init',
    metadata: { clientName: 'Iván' }
  }));
};

ws.onmessage = (e) => {
  if (typeof e.data === 'string') {
    console.log('Evento:', JSON.parse(e.data));
  }
};
```

---

## 🐛 Problemas Comunes

### "Cannot find module..."
```bash
rm -rf node_modules package-lock.json
npm install
```

### "DEEPGRAM_API_KEY not found"
- Verificar que `.env` existe
- Verificar que las variables están bien escritas
- Reiniciar el servidor después de editar `.env`

### Puerto 3000 ocupado
```bash
# En .env
PORT=3001

# O matar el proceso
lsof -ti:3000 | xargs kill -9
```

---

## 📚 Más Información

- **Documentación completa**: Ver `README.md`
- **Arquitectura**: Ver sección "Arquitectura" en README
- **Despliegue**: Ver sección "Despliegue" en README

---

## ✅ Checklist de Verificación

- [ ] Dependencias instaladas (`npm install`)
- [ ] `.env` configurado con API keys
- [ ] Servidor arrancado sin errores
- [ ] `/health` responde OK
- [ ] `/info` muestra el modo correcto
- [ ] Frontend carga correctamente
- [ ] Audio se procesa correctamente

---

**¿Listo? ¡A probarlo!** 🎉
