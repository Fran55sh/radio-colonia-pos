# radio-colonia-pos

Sistema POS y gestión comercial para Radio Colonia. **Comparte la base PostgreSQL del ecommerce** (`radiocolonia_db`): el catálogo y el stock viven en `products` / `product_variants`; el POS solo usa tablas `pos_*` para ventas, IVA, clientes y compras.

Ver también: [DB_UNIFICATION.md](../Radio%20Colonia/app/docs/DB_UNIFICATION.md) en el repo del ecommerce.

## Estructura

```
radio-colonia-pos/
├── Backend/     # API Fastify
└── Frontend/    # UI TanStack Start
```

## Inicio rápido (desarrollo)

### 1. Base de datos ecommerce + tablas POS

Primero aplicá el schema del ecommerce (desde `Radio Colonia/app`):

```bash
cd "../Radio Colonia/app"
cp .env.example .env.local
docker compose up -d --wait
npm install
npm run db:push
npm run db:seed
```

Luego el POS (verifica schema; no crea tablas):

```bash
cd ../../radio-colonia-pos/Backend
cp .env.example .env
npm install
npm run db:verify
npm run dev
```

`DATABASE_URL` debe apuntar a la **misma** base (`radiocolonia_db`, puerto host `5433` si usás el Postgres del compose del ecommerce o del POS unificado).

### 2. Frontend

```bash
cd Frontend
npm install
npm run dev
```

## Docker (stack unificado)

```bash
docker compose up --build
```

| Servicio   | URL                   |
|------------|-----------------------|
| POS (UI) dev | http://localhost:5173 |
| POS (UI) prod local | http://localhost:3000 (tras `npm run build` + `npm run start`) |
| API        | http://localhost:3001 |
| PostgreSQL | localhost:5433 (`radiocolonia_db`) |

**Importante:** en producción el POS debe usar la instancia Postgres del ecommerce. No se ejecuta seed de catálogo dummy (`POS_SEED_DEMO=false`).

## Producción / Coolify

Usá **[`docker-compose.yaml`](docker-compose.yaml)** (sin Postgres propio; misma DB que el ecommerce).

En Coolify: **Docker Compose Location** = `/docker-compose.yaml` (no `docker-compose.coolify.yml`).

Guía completa: **[docs/DEPLOY.md](docs/DEPLOY.md)**

Resumen:

1. Migraciones ecommerce aplicadas (incl. `0005_pos_operational_tables.sql`).
2. En Coolify: Base Directory `/` y Compose Location `/docker-compose.yaml`.
3. Variables `DB_*` del recurso Database del ecommerce.
4. Dominio en servicio **`frontend`** (puerto interno `3000`, Nitro node-server).
5. `CORS_ORIGIN` = URL pública del POS.

Variables de ejemplo: [`.env.coolify.example`](.env.coolify.example)
