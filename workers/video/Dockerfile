FROM node:24-bookworm-slim
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
RUN chown node:node /worker
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node index.mjs render.mjs templates.mjs templates.json tempos.mjs ./
RUN mkdir -p /worker/jobs
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe \
    ESTUDIO_WORKER_TMP=/worker/jobs \
    TMPDIR=/worker/jobs \
    HYPERFRAMES_NO_TELEMETRY=1 \
    DO_NOT_TRACK=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    HYPERFRAMES_NO_AUTO_INSTALL=1
CMD ["node", "index.mjs"]
