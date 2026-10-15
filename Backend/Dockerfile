# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY patches ./patches
COPY scripts/ensure-arca-common-patch.mjs ./scripts/ensure-arca-common-patch.mjs
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY patches ./patches
COPY scripts/ensure-arca-common-patch.mjs ./scripts/ensure-arca-common-patch.mjs
RUN npm ci --omit=dev && node scripts/ensure-arca-common-patch.mjs
COPY --from=builder /app/dist ./dist
COPY scripts/arca-wsaa-check.mjs ./scripts/arca-wsaa-check.mjs
COPY src/docker-entrypoint.mjs ./docker-entrypoint.mjs
EXPOSE 3001
ENTRYPOINT ["node", "docker-entrypoint.mjs"]
CMD ["node", "dist/index.js"]
