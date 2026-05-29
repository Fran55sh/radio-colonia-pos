# syntax=docker/dockerfile:1

# --- Desarrollo (vite dev con hot reload) ---
FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# --- Build (devDependencies: vite, nitro, lovable config) ---
FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=/api/v1
ARG VITE_PROXY_TARGET=http://backend:3001
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PROXY_TARGET=${VITE_PROXY_TARGET}
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# --- Producción (solo artefacto Nitro; sin node_modules) ---
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=builder /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
