# syntax=docker/dockerfile:1

# --- Desarrollo (vite dev con hot reload) ---
FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# --- Producción (build + vite preview con proxy al backend) ---
FROM node:22-alpine AS production
WORKDIR /app
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
ENV VITE_PROXY_TARGET=http://backend:3001
EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
