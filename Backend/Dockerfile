# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN cp src/db/schema.pos.sql dist/db/schema.pos.sql

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/docker-entrypoint.mjs ./docker-entrypoint.mjs
EXPOSE 3001
ENTRYPOINT ["node", "docker-entrypoint.mjs"]
CMD ["node", "dist/index.js"]
