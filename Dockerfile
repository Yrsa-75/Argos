FROM node:20-bookworm-slim

# System deps: ffmpeg + Python + libs for MediaPipe/OpenCV
RUN apt-get update && apt-get install -y \
    ffmpeg \
        curl \
            python3 \
                python3-pip \
                    python3-dev \
                        libglib2.0-0 \
                            libsm6 \
                                libxext6 \
                                    libxrender1 \
                                        libgomp1 \
                                            && rm -rf /var/lib/apt/lists/*

                                            # Python packages for smart crop
                                            RUN pip3 install --break-system-packages \
                                                mediapipe \
                                                    opencv-python-headless

                                                    WORKDIR /app

                                                    # Utiliser le package.json dédié au worker (sans conflits frontend)
                                                    COPY worker/package.json ./package.json

                                                    # Installation propre sans conflits
                                                    RUN npm install

                                                    # Copier le code
                                                    COPY src/ ./src/
                                                    COPY worker/ ./worker/
                                                    COPY scripts/ ./scripts/
                                                    COPY tsconfig*.json ./

                                                    ENV NODE_ENV=production
                                                    ENV PORT=3001

                                                    EXPOSE 3001

                                                    HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
                                                        CMD curl -f http://localhost:3001/health || exit 1

                                                        CMD ["npx", "tsx", "worker/index.ts"]
