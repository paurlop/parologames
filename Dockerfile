# syntax=docker/dockerfile:1.7
#
# Imagen de producción de parologames.
#
# Base: node:24-trixie-slim (Debian 13 "slim").
#   - glibc: es plataforma de Tier 1 de Node.js; las builds musl (Alpine) son "experimental".
#   - Debian estable actual con soporte de seguridad completo (bookworm ya está en fase LTS).
#   - Trae GNU tar y gzip, que usa scripts/backup.js, sin instalar nada más.
#   Si prefieres bookworm: --build-arg NODE_IMAGE=node:24-bookworm-slim
#   En producción fija la imagen por digest: NODE_IMAGE=node:24-trixie-slim@sha256:…
#
# Nada de secretos aquí: todo llega en tiempo de ejecución por variables de entorno (.env).

ARG NODE_IMAGE=node:24-trixie-slim

# ---------------------------------------------------------------- dependencias
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: ninguna dependencia de producción necesita scripts de instalación
# (todas son JavaScript puro); así se reduce la superficie de ataque de la cadena de suministro.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime

ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="parologames" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# tini como PID 1: reenvía señales (SIGTERM → apagado ordenado de Node) y recoge zombis.
# Así la imagen se comporta bien también con `docker run` sin `--init`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_VERSION=${VERSION} \
    PORT=3000 \
    GAMES_PORT=3001 \
    DATA_DIR=/var/lib/parolo/data \
    BACKUP_DIR=/var/lib/parolo/backups \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false \
    npm_config_fund=false

WORKDIR /app
# El código pertenece a root y es de solo lectura para el usuario `node`.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Único directorio escribible: /var/lib/parolo (volumen).
#   data/     → DATA_DIR (parolo.db, games/, covers/, downloads/, tmp/)
#   backups/  → BACKUP_DIR
# El volumen se monta en el PADRE de DATA_DIR para que restore.js pueda renombrar
# data/ → data.before-restore-<fecha> de forma atómica (un punto de montaje no se puede renombrar).
RUN mkdir -p /var/lib/parolo/data /var/lib/parolo/backups \
 && chown -R node:node /var/lib/parolo \
 && chmod -R 750 /var/lib/parolo

USER node
VOLUME ["/var/lib/parolo"]
EXPOSE 3000 3001
STOPSIGNAL SIGTERM

# Sin curl: fetch nativo de Node. Solo el puerto del sitio (el origen de juegos no tiene /healthz garantizado).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
# node directamente (no `npm start`): npm no reenvía bien las señales y escribe en $HOME.
CMD ["node", "src/server.js"]
