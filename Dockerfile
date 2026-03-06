FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig*.json ./
COPY src/ ./src/
COPY worker/ ./worker/
RUN npm ci --legacy-peer-deps
RUN npx tsc -p tsconfig.worker.json || true

FROM node:20-alpine AS runtime
RUN apk add --no-cache ffmpeg curl && rm -rf /var/cache/apk/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/types ./src/types
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/worker/index.js"]
