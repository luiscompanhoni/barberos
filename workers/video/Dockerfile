FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY index.mjs render.mjs ./
RUN mkdir -p /worker/jobs && chown -R node:node /worker
USER node
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe \
    ESTUDIO_WORKER_TMP=/worker/jobs \
    HYPERFRAMES_NO_TELEMETRY=1 \
    DO_NOT_TRACK=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    HYPERFRAMES_NO_AUTO_INSTALL=1
CMD ["node", "index.mjs"]
