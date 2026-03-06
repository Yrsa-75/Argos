FROM node:20-alpine

RUN apk add --no-cache ffmpeg curl && rm -rf /var/cache/apk/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && npm cache clean --force

# Installer les dépendances manquantes du worker
RUN npm install --no-save \
    tsx \
    @anthropic-ai/sdk \
    @aws-sdk/client-s3 \
    @aws-sdk/s3-request-presigner \
    @supabase/supabase-js \
    express \
    cors \
    openai

COPY src/ ./src/
COPY worker/ ./worker/
COPY tsconfig*.json ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["npx", "tsx", "worker/index.ts"]
