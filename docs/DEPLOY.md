# Deploy POS (Docker / Coolify)

## Requisito previo

El POS usa la **misma PostgreSQL** que el ecommerce (`radiocolonia_db`). En esa base deben existir:

- Schema ecommerce (`products`, `product_variants`, `suppliers`, …)
- Tablas POS (`pos_ventas`, `pos_lineas_venta`, …) vía migración `0005_pos_operational_tables.sql` del repo **Radio Colonia/app**

Aplicá las migraciones del ecommerce **antes** del primer deploy del POS (recurso `migrator` o `migrate.sh` en Coolify).

---

## Coolify (recomendado)

### Archivo Compose y campos en Coolify

Usá **`docker-compose.yaml`** en la raíz del repo `radio-colonia-pos`.

En la UI de Coolify (Build Pack → Docker Compose):

| Campo | Valor correcto |
|-------|----------------|
| **Base Directory** | `/` (raíz del repo; vacío si tu repo es solo `radio-colonia-pos`) |
| **Docker Compose Location** | `/docker-compose.yaml` |

Formato válido: empieza con `/`, solo letras, números, guiones y barras. Ejemplos válidos: `/docker-compose.yaml`, `/docker-compose.yml`.

**No uses** (suelen dar error *format is invalid* o no encontrar el archivo):

- `docker-compose.coolify.yml` (nombre con punto extra; la UI no lo acepta)
- Rutas de Windows (`G:\...`, `C:\...`)
- Rutas sin barra inicial (`docker-compose.yaml` sin `/` al principio, según versión de Coolify)

- **No** uses `docker-compose.yml` para Coolify (ese es el stack de **desarrollo** con Postgres local).
- **No** uses solo `docker-compose.prod.yml` (solo override del frontend).

Si el monorepo tiene la carpeta `radio-colonia-pos` dentro de otro repo:

| Campo | Valor |
|-------|--------|
| Base Directory | `/radio-colonia-pos` |
| Docker Compose Location | `/docker-compose.yaml` |

### Postgres

**No** levantes el servicio `postgres` del compose de desarrollo. Creá o reutilizá el recurso **Database** del ecommerce y copiá las variables de conexión al stack del POS.

| Variable     | Ejemplo                          |
|--------------|----------------------------------|
| `DB_HOST`    | Hostname interno Coolify del Postgres del ecommerce |
| `DB_USER`    | `radiocolonia`                   |
| `DB_PASSWORD`| (secreto del recurso Database)   |
| `DB_NAME`    | `radiocolonia_db`                |
| `DB_PORT`    | `5432`                           |

### Variables del stack POS

| Variable        | Obligatoria | Descripción |
|-----------------|-------------|-------------|
| `DB_HOST`       | Sí          | Postgres ecommerce |
| `DB_USER`       | Sí          | |
| `DB_PASSWORD`   | Sí          | |
| `DB_NAME`       | Sí          | `radiocolonia_db` |
| `CORS_ORIGIN`   | Sí          | URL pública del frontend POS (ej. `https://pos.tudominio.com`) |
| `API_TOKEN`     | No          | Bearer para proteger POST/PATCH en producción |
| `VITE_API_URL`  | No          | Default `/api/v1` (mismo dominio que el UI vía proxy). Si API y UI están en dominios distintos: `https://api-pos.tudominio.com/api/v1` |

`POS_SEED_DEMO` queda en `false` en el compose (sin catálogo dummy).

### Dominios en Coolify

Asigná dominios en la UI (formato con puerto interno, según docs de Coolify):

| Servicio   | Puerto interno | Uso |
|------------|----------------|-----|
| `frontend` | `3000`         | **Pantalla de caja** (Nitro node-server) — dominio principal del POS |
| `backend`  | `3001`         | Opcional (API directa). El UI hace proxy de `/api` y `/health` al backend |

Ejemplo UI en Coolify: dominio en servicio `frontend`, puerto **interno** `3000` (ej. `https://pos.tudominio.com:3000` en la UI de Coolify).

No publiques `3000:3000` en el host si el ecommerce ya usa el puerto 3000; el `docker-compose.yaml` usa solo `expose` y la red `coolify`.

`CORS_ORIGIN` debe incluir la URL pública del frontend (sin path).

### Arranque

El `Dockerfile` del frontend usa **dos etapas**: `builder` (`npm ci` con devDependencies) y `production` (solo copia `.output/`). No poner `NODE_ENV=production` antes del build o fallará con `@lovable.dev/vite-tanstack-config` not found.

El backend ejecuta al iniciar:

1. `schema.pos.sql` (tablas `pos_*`, idempotente)
2. Sin seed de catálogo en producción
3. API en puerto `3001`

### Healthchecks

- API: `GET /health`
- UI: `GET /` en puerto `4173`

### Checklist

- [ ] Migraciones ecommerce aplicadas (incl. `0005`)
- [ ] Compose: `docker-compose.coolify.yml`
- [ ] `DB_*` apuntan al Postgres del ecommerce
- [ ] Dominio en servicio `frontend`
- [ ] `CORS_ORIGIN` = URL del frontend
- [ ] `POS_SEED_DEMO` no activado en producción

---

## Local (desarrollo)

```bash
docker compose up --build
```

## Local (producción simulada)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Incluye Postgres local; no usar para producción real.
