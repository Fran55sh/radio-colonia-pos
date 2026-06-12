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

El schema lo administra el **migrador del ecommerce**. El POS solo verifica al arrancar:

```bash
bun run db:verify
bun run db:seed   # solo desarrollo
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
| Clientes | `GET /api/v1/clientes` | CRUD clientes (búsqueda `?search=`) |
| Fiscal | `GET /api/v1/fiscal/ventas/:id` | Estado comprobante ARCA |
| Fiscal | `POST /api/v1/fiscal/ventas/:id/reintentar` | Reintento emisión CAE |
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
| `ARCA_ENABLED` | `true` para emitir en homologación |
| `ARCA_CUIT` | CUIT emisor (11 dígitos) |
| `ARCA_PTO_VTA` | Punto de venta ARCA |
| `ARCA_PRODUCTION` | `false` en desarrollo |
| `ARCA_CERT_PATH` / `ARCA_KEY_PATH` | Certificado y clave PEM (homologación) |
