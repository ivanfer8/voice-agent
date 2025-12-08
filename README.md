# 🎙️ Voice Agent Zener - Versión 2.0

Sistema de agente de voz conversacional con **streaming bidireccional en tiempo real** para agendamiento de citas de instalación de fibra óptica.

## 📋 Tabla de Contenidos

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Uso](#uso)
- [Modos de Operación](#modos-de-operación)
- [Despliegue](#despliegue)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## ✨ Características

### Modo Realtime (v2) 🚀
- ✅ **Streaming bidireccional**: Audio fluye en ambas direcciones simultáneamente
- ✅ **Latencia ultra-baja**: <500ms (vs 2-4s del modo legacy)
- ✅ **Interrupciones naturales**: El usuario puede interrumpir al agente
- ✅ **Detección de voz avanzada**: VAD (Voice Activity Detection)
- ✅ **Cancelación inteligente**: El audio pendiente se cancela al interrumpir

### Modo Legacy (v1) 📞
- ✅ **Compatibilidad total**: Mantiene funcionamiento actual
- ✅ **Sin cambios en frontend**: UI actual funciona sin modificaciones
- ✅ **Probado en producción**: Sistema estable y conocido

### Generales
- ✅ **Arquitectura modular**: Componentes STT/LLM/TTS intercambiables
- ✅ **Gestión de sesiones**: Historial conversacional persistente
- ✅ **Logging profesional**: Logs estructurados con Pino
- ✅ **Métricas de latencia**: Tracking de performance en tiempo real
- ✅ **Health checks**: Monitoreo de estado del servicio
- ✅ **Docker ready**: Despliegue con un comando

---

## 🏗️ Arquitectura

### Stack Tecnológico

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                         │
│  - WebSocket bidireccional                          │
│  - AudioContext API                                 │
│  - MediaRecorder                                    │
└───────────────┬─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│              SERVIDOR NODE.JS                       │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │        SESSION MANAGER                       │  │
│  │  - Historial conversacional                  │  │
│  │  - Metadata de sesión                        │  │
│  │  - Gestión de estado                         │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Deepgram │→ │ OpenAI   │→ │  ElevenLabs WS  │ │
│  │   STT    │  │ GPT-4o   │  │      TTS        │ │
│  │ Streaming│  │ Streaming│  │   Streaming     │ │
│  └──────────┘  └──────────┘  └──────────────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │      AUDIO BUFFER MANAGER                    │  │
│  │  - Sincronización                            │  │
│  │  - Cancelación en interrupciones             │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Componentes Principales

#### 1. **STT Module** (Speech-to-Text)
- **Proveedor**: Deepgram Nova 2
- **Latencia**: 100-200ms
- **Características**: Transcripción en español, resultados parciales e interinos

#### 2. **LLM Module** (Language Model)
- **Proveedor**: OpenAI GPT-4o-mini
- **Latencia**: 200-400ms (primer token)
- **Características**: Streaming token-por-token, historial conversacional

#### 3. **TTS Module** (Text-to-Speech)
- **Proveedor**: ElevenLabs WebSocket
- **Modelo**: eleven_turbo_v2_5
- **Latencia**: 130-250ms
- **Características**: Streaming de audio, calidad superior

#### 4. **Session Manager**
- Gestión de sesiones activas
- Historial conversacional (últimos 15 mensajes)
- Limpieza automática de sesiones inactivas

#### 5. **Audio Buffer Manager**
- Gestión de colas de entrada/salida
- Cancelación de audio en interrupciones
- Sincronización de streams

---

## 📦 Requisitos

### Software
- **Node.js**: ≥20.0.0
- **npm**: ≥9.0.0
- **Docker**: ≥20.10 (opcional)

### APIs Requeridas
- **Deepgram API Key**: [https://deepgram.com](https://deepgram.com)
- **OpenAI API Key**: [https://platform.openai.com](https://platform.openai.com)
- **ElevenLabs API Key**: [https://elevenlabs.io](https://elevenlabs.io)
- **ElevenLabs Voice ID**: ID de la voz a utilizar

---

## 🚀 Instalación

### 1. Clonar repositorio
```bash
git clone <tu-repo>
cd voice-agent-v2
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus API keys
```

### 4. Ejecutar en desarrollo
```bash
npm run dev
```

### 5. Ejecutar en producción
```bash
npm start
```

---

## ⚙️ Configuración

### Variables de Entorno Principales

```bash
# Modo de operación
ENABLE_REALTIME=false  # false = v1 (legacy), true = v2 (realtime)

# APIs (REQUERIDAS)
DEEPGRAM_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here

# Configuración de audio
AUDIO_CHUNK_SIZE_MS=100        # Tamaño de chunks (ms)
MAX_SILENCE_MS=1500            # Silencio máximo antes de fin de frase
VAD_THRESHOLD_BYTES=500        # Umbral para detectar voz

# Sesiones
MAX_HISTORY_MESSAGES=15        # Máximo de mensajes en historial
SESSION_TIMEOUT_MS=1800000     # Timeout de sesión inactiva (30 min)

# Monitoring
ENABLE_METRICS=true            # Activar métricas de latencia
DEBUG_AUDIO=false              # Logs detallados de audio
```

---

## 🎮 Uso

### Modo Legacy (v1)

**1. Configurar:**
```bash
ENABLE_REALTIME=false
```

**2. Endpoint:**
```
POST /stt
Content-Type: multipart/form-data

Form Data:
- audio: archivo de audio (webm)
- history: JSON string con historial
- clientName: nombre del cliente
- ttsProvider: "openai" | "elevenlabs"
```

**3. Respuesta:**
```json
{
  "transcript": "texto transcrito",
  "answer": "respuesta del agente",
  "audio": "base64_audio_mp3"
}
```

### Modo Realtime (v2)

**1. Configurar:**
```bash
ENABLE_REALTIME=true
```

**2. Conectar WebSocket:**
```javascript
const ws = new WebSocket('ws://localhost:3000/v2/voice');

// Enviar inicialización
ws.send(JSON.stringify({
  type: 'init',
  metadata: {
    clientName: 'Iván López'
  }
}));

// Recibir eventos
ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const message = JSON.parse(event.data);
    console.log('Evento:', message);
  } else {
    // Audio binario
    const audioChunk = event.data;
    // Reproducir...
  }
};

// Enviar audio
const audioBuffer = ...; // Buffer PCM16
ws.send(audioBuffer);
```

**3. Eventos del servidor:**
```javascript
// Sesión lista
{ type: 'event', event: 'ready', data: {...} }

// Transcripción parcial
{ type: 'event', event: 'transcript_partial', data: { text, confidence } }

// Transcripción final
{ type: 'event', event: 'transcript_final', data: { text, confidence } }

// Chunk de LLM
{ type: 'event', event: 'llm_chunk', data: { chunk } }

// Agente terminó de hablar
{ type: 'event', event: 'agent_finished_speaking' }

// Interrupción procesada
{ type: 'event', event: 'interruption_processed' }

// Error
{ type: 'error', error: 'error_type', message: '...' }
```

---

## 🔄 Modos de Operación

### Cambiar de modo Legacy a Realtime

**1. Actualizar .env:**
```bash
ENABLE_REALTIME=true
```

**2. Reiniciar servidor:**
```bash
npm restart
```

**3. Verificar:**
```bash
curl http://localhost:3000/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "mode": "realtime (v2)",
  ...
}
```

### Rollback a Legacy

**1. Actualizar .env:**
```bash
ENABLE_REALTIME=false
```

**2. Reiniciar servidor**

**No requiere cambios en frontend** - la UI actual sigue funcionando.

---

## 🐳 Despliegue

### Docker (Local)

```bash
# Build
docker build -t voice-agent-v2 .

# Run
docker run -d \
  --name voice-agent \
  -p 3000:3000 \
  --env-file .env \
  voice-agent-v2
```

### Docker Compose

```bash
# Iniciar
docker-compose up -d

# Ver logs
docker-compose logs -f voice-agent

# Parar
docker-compose down
```

### Dokploy

**1. Push a repositorio:**
```bash
git push origin feature/realtime-v2
```

**2. En Dokploy:**
- Crear nueva aplicación o actualizar existente
- Seleccionar branch `feature/realtime-v2`
- Configurar variables de entorno
- Desplegar

**3. Variables en Dokploy:**
```
ENABLE_REALTIME=false  # Empezar con legacy
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

**4. Cuando esté listo, cambiar a realtime:**
```
ENABLE_REALTIME=true
```

---

## 🐛 Troubleshooting

### Error: "Deepgram no está conectado"
- Verificar `DEEPGRAM_API_KEY` en `.env`
- Revisar logs: `docker-compose logs voice-agent`
- Verificar conectividad de red

### Error: "ElevenLabs WebSocket error"
- Verificar `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID`
- Comprobar cuota de ElevenLabs
- Revisar logs detallados con `DEBUG_AUDIO=true`

### Alta latencia
- Verificar network latency: `ping api.deepgram.com`
- Revisar métricas: endpoint `/info`
- Ajustar `AUDIO_CHUNK_SIZE_MS` (valor más bajo = más frecuencia)

### Sesiones no se limpian
- Verificar `SESSION_TIMEOUT_MS` en config
- Revisar logs de SessionManager
- Reiniciar servidor si es necesario

---

## 🗺️ Roadmap

### v2.1 (Próximo)
- [ ] VAD (Voice Activity Detection) con Silero
- [ ] Soporte para Redis (sesiones distribuidas)
- [ ] Dashboard de métricas en tiempo real
- [ ] Tests unitarios y de integración

### v2.2 (Futuro)
- [ ] Soporte multi-idioma
- [ ] Integración con CRM (creación real de citas)
- [ ] Analytics avanzado (coste por llamada, tasa de conversión)
- [ ] Frontend v2 optimizado para streaming

### v3.0 (Long-term)
- [ ] Soporte para otros proveedores STT/TTS
- [ ] Modo híbrido (auto-switch según latencia)
- [ ] Clustering y load balancing
- [ ] WebRTC nativo (sin WebSocket intermedio)

---

## 📊 Métricas y Costes

### Latencia Típica (Modo Realtime)
- STT (Deepgram): 100-200ms
- LLM (GPT-4o-mini): 200-400ms (primer token)
- TTS (ElevenLabs): 130-250ms
- **Total end-to-end**: ~430-850ms

### Coste por Minuto
- STT: $0.0043
- LLM: ~$0.002 (500 tokens)
- TTS: $0.018
- **Total**: ~$0.024/min ($1.44/hora)

**Comparado con VAPI**: $0.05-0.12/min → **Ahorro: 50-80%**

---

## 👥 Equipo

**Desarrollado por**: Zener Telecommunications  
**Versión**: 2.0.0  
**Fecha**: Diciembre 2024  

---

## 📄 Licencia

Propietario - Zener Telecommunications

---

## 🆘 Soporte

Para problemas o preguntas:
1. Revisar esta documentación
2. Verificar logs: `docker-compose logs -f`
3. Consultar `/health` y `/info` endpoints
4. Contactar al equipo de desarrollo

---

**¡Happy coding!** 🚀
