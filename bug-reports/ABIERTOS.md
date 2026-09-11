# Abiertos — radio-colonia-pos

**Repo:** Fran55sh/radio-colonia-pos  
**Actualizado:** 2026-09-11 (reauditoría `ac4f80e`)

Solo pendientes accionables. Cursor: fixes desde acá, no desde informes viejos.

---

## [🟠 ALTO] TOCTOU idempotencia `client_sale_id`

**Estado:** Probable (sigue abierto)

**Problema:** `findVentaByClientSaleId` corre antes de la TX de venta. Concurrentes con el mismo id pueden doble-insertar / doble-descontar stock si no hay `UNIQUE` en DB (DDL en ecommerce).

**Archivos:** `Backend/src/modules/pos/service.ts` (+ migraciones POS en RadioColonia)

**Solución:** `UNIQUE(client_sale_id)` + manejo de conflicto en la misma TX / `ON CONFLICT`.

**Tests:** 2 requests paralelos mismo `client_sale_id` → un 201 y un 409; stock −1 sola vez.

---

## [🟠 ALTO] API abierta si `NODE_ENV ≠ production` y no hay PIN

**Estado:** Parcial — prod exige PIN; footgun de deploy sigue

**Problema:** Sin PIN y sin `NODE_ENV=production`, `requireAuth` abre `/api/*` (dev). Un deploy que olvide `NODE_ENV=production` queda expuesto.

**Archivos:** `Backend/src/middleware/auth.ts`, `Backend/src/config/env.ts`

**Solución:** Fail closed salvo flag explícito tipo `AUTH_OPEN=true`; health/deploy checks de `auth_required`.

---

## [🟡 MEDIO] JWT secret: mínimo 16 + fallback de desarrollo conocido

**Estado:** Parcial

**Problema:** `POS_JWT_SECRET` min 16; non-prod sigue con fallback `dev-pos-jwt-secret-change-me`.

**Archivos:** `Backend/src/config/env.ts`, `Backend/src/modules/auth/service.ts`

**Solución:** ≥32 bytes random; rechazar secrets de ejemplo; sin fallback fuera de test.

---

## [🟡 MEDIO] `API_TOKEN` comparado con `===`

**Estado:** Confirmado (sigue)

**Problema:** No usa `timingSafeEqual` (el PIN sí).

**Archivo:** `Backend/src/middleware/auth.ts`

**Solución:** Length-check + `timingSafeEqual` en buffers.

---

## [🟡 MEDIO] `resolvePdfPath` prefix check frágil

**Estado:** Potencial (sigue)

**Problema:** `resolved.startsWith(base)` sin `base + path.sep`. Keys UUID mitigan hoy.

**Archivo:** `Backend/src/modules/compras/importacion/pdf-storage.ts`

**Solución:** `resolved === base || resolved.startsWith(base + sep)` + allowlist filename.

---

## [🔵 BAJO] CORS env-driven sin rechazar `*`

**Estado:** Potencial

**Archivo:** `Backend/src/app.ts`

**Solución:** Validar origins absolutos; refuse `*`.

---

## [🔵 BAJO] PIN como SHA-256 sin KDF

**Estado:** Confirmado

**Archivo:** `Backend/src/modules/auth/service.ts`

**Solución:** timing-safe vs secret de env, o argon2id de secret fuerte.
