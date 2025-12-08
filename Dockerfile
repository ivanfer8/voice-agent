# ============================================
# STAGE 1: Dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copiar package files
COPY package.json package-lock.json* ./

# Instalar dependencias (incluyendo devDependencies para build)
RUN npm ci

# ============================================
# STAGE 2: Builder (opcional - para compilación)
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar dependencias del stage anterior
COPY --from=deps /app/node_modules ./node_modules

# Copiar código fuente
COPY . .

# Aquí podrías ejecutar builds si fuera necesario (ej: TypeScript)
# RUN npm run build

# ============================================
# STAGE 3: Runner (producción)
# ============================================
FROM node:20-alpine AS runner

# Instalar ffmpeg para conversión de audio WebM → MP3
RUN apk add --no-cache ffmpeg

# Metadata
LABEL maintainer="Zener Dev Team"
LABEL description="Voice Agent con streaming realtime"
LABEL version="2.0.0"

WORKDIR /app

# Crear usuario no-root para seguridad
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copiar solo dependencias de producción
COPY --from=deps /app/node_modules ./node_modules

# Copiar código de aplicación
COPY --chown=nodejs:nodejs . .

# Crear carpeta uploads con permisos
RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

# Cambiar a usuario no-root
USER nodejs

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Variables de entorno por defecto (se sobrescriben con .env o docker-compose)
ENV NODE_ENV=production \
    PORT=3000

# Comando de inicio
CMD ["node", "server.js"]