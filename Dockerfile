# Builds stac-x into a small production image. The workflow in
# .github/workflows/docker.yml publishes it to ghcr.io/dewberry/stac-x.
#
# Run it with the same variables as .env.example, for example:
#   docker run -p 3000:3000 --env-file .env ghcr.io/dewberry/stac-x
# The STAC_SOURCES_* variables have no defaults, so an environment left unset
# loads empty. Local sources (./data/sandbox, ./data/prod) live under
# /app/data; mount a volume there to keep promoted collections and QC edits
# across restarts.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked in at build time, so they come in as build
# args. Unset, the defaults in src/components/map-core.tsx apply.
ARG NEXT_PUBLIC_MAP_STYLE_LIGHT
ARG NEXT_PUBLIC_MAP_STYLE_DARK
ARG NEXT_PUBLIC_MAP_TERRAIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs \
 && mkdir -p data/sandbox data/test data/prod \
 && chown -R nextjs:nodejs /app
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Area files for STAC_MAP_AREA. Mount over /app/areas to use your own.
COPY --from=build --chown=nextjs:nodejs /app/areas ./areas
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
