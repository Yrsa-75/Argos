FROM node:20-alpine

RUN apk add --no-cache ffmpeg curl && rm -rf /var/cache/apk/*

WORKDIR /app

# Utiliser le package.json dédié au worker (sans conflits frontend)
COPY worker/package.json ./package.json

# Installation propre sans conflits
RUN npm install

# Copier le code
COPY src/ ./src/
COPY worker/ ./worker/
COPY tsconfig*.json ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["npx", "tsx", "worker/index.ts"]
