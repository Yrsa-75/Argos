# ============================================================
# ARGOS Worker — Dockerfile optimisé (multi-stage)
# Objectif : rester sous 4 GB pour Railway plan gratuit
# ============================================================

# ----------------------------------------------------------------
# STAGE 1 — Builder : compile le TypeScript
# On utilise une image complète ici, elle sera jetée après
# ----------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Copier uniquement les fichiers nécessaires à la compilation
COPY package.json package-lock.json ./
COPY tsconfig*.json ./
COPY src/ ./src/
COPY worker/ ./worker/

# Installer TOUTES les dépendances (y compris devDependencies pour tsc)
RUN npm ci

# Compiler TypeScript → JavaScript
RUN npx tsc -p tsconfig.worker.json || true

# ----------------------------------------------------------------
# STAGE 2 — Runtime : image finale légère
# On ne garde que ce qui est nécessaire pour faire tourner le worker
# ----------------------------------------------------------------
FROM node:20-alpine AS runtime

# Alpine est ~50MB vs ~200MB pour debian-slim
# FFmpeg en Alpine est bien plus léger aussi

# Installer FFmpeg + dépendances minimales
RUN apk add --no-cache \
    ffmpeg \
    curl \
    && rm -rf /var/cache/apk/*

# Vérifier FFmpeg
RUN ffmpeg -version 2>&1 | head -1

WORKDIR /app

# Copier package.json pour installer les dépendances de production uniquement
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copier le code compilé depuis le stage builder
COPY --from=builder /app/dist ./dist

# Copier les types (nécessaires au runtime)
COPY --from=builder /app/src/types ./src/types

# ----------------------------------------------------------------
# Configuration runtime
# ----------------------------------------------------------------
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Démarrer le worker
CMD ["node", "dist/worker/index.js"]
