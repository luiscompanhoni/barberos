# BarberOS - imagem de producao (Next.js standalone + Prisma)
FROM node:24-alpine AS base
# CA opcional do executor: montada só durante o build, sem desabilitar TLS.
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt \
    export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt && npx prisma generate && npm run build

FROM base AS runner
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
ENV BARBEROS_REVISAO=$VCS_REF
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# CLI do Prisma (mesma versao do projeto) para aplicar as migracoes na subida
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt npm install -g prisma@6.19.3 && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# O standalone local pode carregar .env; a imagem recebe segredos apenas em runtime.
RUN rm -f /app/.env /app/.env.* && mkdir -p /app/media && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -Y off -qO- http://127.0.0.1:3000/api/saude || exit 1
# Aplica migracoes pendentes e sobe o servidor
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
