# Deploy POS (Docker / Coolify)

## Principio

- **Una sola autoridad de esquema:** migrador del ecommerce ([Radio Colonia/app/migrate.sh](../Radio%20Colonia/app/migrate.sh)).
- **POS solo DML:** nunca crea tablas en runtime.
- **Fail-fast:** si faltan tablas, el deploy del POS falla al arrancar (no en plena venta).

## Requisito previo

El POS usa la **misma PostgreSQL** que el ecommerce (mismas `DB_*`). En Coolify la base suele llamarse `postgres`.

Tablas requeridas (creadas por el migrador del ecommerce, incl. `0005_pos_operational_tables.sql`):

- Ecommerce: `products`, `product_variants`, `suppliers`, `product_supplier_offers`, …
- POS: `pos_ventas`, `pos_lineas_venta`, `pos_iva_registro`, …

**Orden de deploy:** ecommerce (migrador) → POS.

---

## Coolify (recomendado)

### 1. Migrador del ecommerce (automático)

En el stack del **ecommerce**, configurá el servicio `migrator` (target `migrator` del Dockerfile) como paso que corre en cada deploy:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

O en Coolify: **Pre/Post Deploy Command** en el servicio web del ecommerce que ejecute el migrator y falle si no termina OK.

El migrador aplica SQL idempotente (incl. `pos_*`) y valida que existan antes de continuar.

### 2. Postgres managed (persistente)

Usá el recurso **Database** de Coolify del ecommerce. Los managed conservan volumen entre deploys.

Copiá al stack POS **exactamente** las mismas variables:

| Variable | Descripción |
|----------|-------------|
| `DB_HOST` | Host interno del Postgres del ecommerce |
| `DB_USER` | Igual que ecommerce (ej. `postgres`) |
| `DB_PASSWORD` | Igual que ecommerce |
| `DB_NAME` | Igual que ecommerce (ej. `postgres`) |
| `DB_PORT` | `5432` |

**No** definas `DATABASE_URL` en el POS si contradice `DB_*`.

### 3. Stack POS

Usá **`docker-compose.yaml`** en la raíz del repo.

| Campo Coolify | Valor |
|---------------|-------|
| Base Directory | `/` |
| Docker Compose Location | `/docker-compose.yaml` |

Variables obligatorias del POS:

| Variable | Descripción |
|----------|-------------|
| `DB_*` | Copiadas del ecommerce |
| `CORS_ORIGIN` | URL pública del frontend POS |
| `API_TOKEN` | Opcional |

### 4. Arranque del backend POS

Al iniciar el contenedor:

1. **Verificación de schema** (`npm run db:verify` / `dist/db/migrate.js`) — solo lectura, **exit 1** si falta alguna tabla.
2. Sin seed en producción (`POS_SEED_DEMO=false`).
3. API en puerto `3001`.

Log esperado:

```text
[POS] DB=postgres pos_ventas=sí url=postgresql://...
Verificación de schema POS completada.
```

Si falta el esquema, el contenedor **no arranca** → deploy falla en Coolify.

### 5. Dominios

| Servicio | Puerto interno | Uso |
|----------|----------------|-----|
| `frontend` | `3000` | Pantalla de caja (dominio principal) |
| `backend` | `3001` | API (proxy vía frontend en `/api`) |

### Checklist

- [ ] Migrador ecommerce corre en cada deploy del ecommerce
- [ ] `DB_*` del POS = mismas que ecommerce
- [ ] Sin `DATABASE_URL` conflictiva en POS
- [ ] Deploy ecommerce antes que POS
- [ ] Log: `Verificación de schema POS completada`

---

## Local (desarrollo)

1. Levantá Postgres y migrá con el **ecommerce**:

```bash
cd "Radio Colonia/app"
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml run --rm migrate
```

2. POS apuntando a la misma base:

```bash
cd radio-colonia-pos
docker compose up --build
```

Verificación manual:

```bash
cd Backend
npm run db:verify
```
