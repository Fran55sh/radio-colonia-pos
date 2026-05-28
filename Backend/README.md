# radio-colonia-pos — Backend API

API modular Fastify + PostgreSQL para POS omnicanal.

## Requisitos

- Node.js 20+ o Bun
- PostgreSQL 14+

## Configuración

```bash
cd Backend
cp .env.example .env
# Editar DATABASE_URL y CORS_ORIGIN
bun install   # o npm install
```

## Base de datos

```bash
bun run db:migrate
bun run db:seed
```

## Desarrollo

```bash
bun run dev
```

Servidor en `http://localhost:3001` (por defecto).

## Endpoints principales

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| POS | `GET /api/v1/pos/productos` | Catálogo para caja |
| POS | `POST /api/v1/pos/ventas` | Venta con descuento atómico de stock |
| POS | `POST /api/v1/pos/ventas/offline-batch` | Sincronización offline |
| Compras | `POST /api/v1/compras/ordenes` | Orden con códigos de proveedor |
| Contabilidad | `GET /api/v1/contabilidad/iva/ventas` | Libro IVA ventas |
| Contabilidad | `POST /api/v1/contabilidad/iva/compras/facturas` | Crédito fiscal compras |
| Clientes | `GET /api/v1/clientes` | CRUD clientes |
| Analytics | `GET /api/v1/analytics/facturacion-dia` | Facturación del día |

## Docker

Desde la raíz del monorepo:

```bash
docker compose up --build
```

El contenedor `backend` ejecuta migración y seed al iniciar (entrypoint Node, sin scripts `.sh`). Ver [README.md](../README.md) en la raíz.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL |
| `PORT` | Puerto API (default 3001) |
| `CORS_ORIGIN` | Origen del frontend Lovable |
| `API_TOKEN` | Opcional: Bearer token para escrituras |
