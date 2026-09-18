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
| `DB_*` | Copiadas del ecommerce **o** usuario `pos_app` least-privilege (ver abajo) |
| `CORS_ORIGIN` | URL pública del frontend POS |
| `POS_ACCESS_PIN` | PIN de caja (**obligatorio**; alfanumérico largo en prod; no `1234`) |
| `POS_ADMIN_PIN` | PIN con rol admin (recomendado; compras+analytics+contabilidad+clientes+fiscal) |
| `POS_COMPRAS_PIN` | Opcional; rol compras |
| `POS_DEFAULT_ROLE` | Rol del PIN de caja: `caja` (default), `compras` o `admin` |
| `POS_JWT_SECRET` | Secreto JWT (**obligatorio**, mín. 16 chars; rotar si se filtró) |
| `POS_SESSION_HOURS` | Duración sesión (default 12) |
| `API_TOKEN` | Opcional (scripts → rol admin). Vacío si no se usa |

### 3b. Usuario Postgres least-privilege (`pos_app`)

El POS y el ecommerce comparten la misma base (stock/costos). **No** separar bases. Mitigá el blast radius con un rol de app dedicado:

```sql
-- Como superuser / owner de la DB
CREATE ROLE pos_app LOGIN PASSWORD '<fuerte>';
GRANT CONNECT ON DATABASE postgres TO pos_app;  -- o el DB_NAME real
GRANT USAGE ON SCHEMA public TO pos_app;

-- Tablas operativas POS
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
-- Idealmente restringí a: pos_ventas, pos_lineas_venta, pos_iva_registro,
-- pos_clientes, pos_compras_*, pos_comprobantes_fiscales, etc.

-- Catálogo compartido: solo lo que el POS necesita escribir/leer
GRANT SELECT ON products, categories, global_attributes TO pos_app;
GRANT SELECT, UPDATE (stock, cost_price) ON product_variants TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_supplier_offers, suppliers TO pos_app;
```

En Coolify: `DB_USER=pos_app` y el password propio. Si hoy usás el mismo user que el ecommerce, documentá la migración y rotá cuando puedas.

**Rotación:** si el repo público o un ejemplo de compose se usó en deploy, rotá `POS_ACCESS_PIN`, `POS_ADMIN_PIN`, `POS_JWT_SECRET` y passwords de DB.

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


## Facturación ARCA / AFIP (WSFE)

El módulo fiscal del POS **ya está implementado**. Homologación y go-live son configuración + certificados.

### Switches

| Variable | Rol |
|----------|-----|
| `ARCA_ENABLED` | Kill switch. `false` = nunca emite. |
| `ARCA_PRODUCTION` | `false` = homologación (`ambiente: "dev"`). `true` = producción (`ambiente: "prod"`). |
| `ARCA_CUIT` / `ARCA_PTO_VTA` | CUIT emisor y punto de venta. |
| `ARCA_CERT` / `ARCA_KEY` | PEM inline (recomendado en Coolify). |
| `ARCA_CERT_PATH` / `ARCA_KEY_PATH` | Rutas a PEM (local / volume `./certs`). |

Homologación: `ARCA_ENABLED=true` + `ARCA_PRODUCTION=false` + certs homo.

Producción: `ARCA_ENABLED=true` + `ARCA_PRODUCTION=true` + certs prod.

Emergencia: solo `ARCA_ENABLED=false`.

### Schema DB

`pos_comprobantes_fiscales` y columnas fiscales de clientes vienen de la migración del ecommerce (`0008_*fiscal*`). El POS no crea tablas; al arrancar verifica schema.

Checklist:

1. Migrador ecommerce aplicado.
2. `db:verify` OK.
3. Variables `ARCA_*` cargadas.
4. Certificados correctos para el ambiente (PEM inline en Coolify: saltos de línea reales o `\\n`; no mezclar `ARCA_CERT` vacío con paths).
5. `GET /api/v1/fiscal/config` → `pem_cert_ok` / `pem_key_ok` true, `hints` vacío, `cuit_matches_cert` true.
6. En el contenedor backend: `npm run arca:check` → WSAA OK.
7. Smoke venta CF → CAE (banner homologación si `ambiente=dev`).
8. Reintento desde caja ante `error`.

Si WSAA responde **HTTP 500**: casi siempre cert de homo en prod (o al revés), cert sin servicio **wsfe**, cert vencido, o CUIT distinto al del certificado — ver `hints` en `/fiscal/config`.

### Roles

`/api/v1/fiscal/*` requiere rol **caja** o superior.
