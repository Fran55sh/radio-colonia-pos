# Auditoría de seguridad, privacidad y cumplimiento — radio-colonia-pos

| Campo | Valor |
|-------|--------|
| **Repositorio** | [Fran55sh/radio-colonia-pos](https://github.com/Fran55sh/radio-colonia-pos) |
| **Visibilidad** | **Público** |
| **Rama analizada** | `main` |
| **Fecha** | 2026-09-11 |
| **Alcance** | READ-ONLY (GitHub MCP + `gh`); sin clonar, sin modificar, sin ejecutar la app |
| **Equipo** | RC Security & Compliance (en nombre de Franco / Fran55sh) |
| **Producto** | POS / caja Radio Colonia (API Fastify + UI TanStack Start) |

---

## 1. Resumen ejecutivo

El POS es un stack TypeScript (Backend Fastify + Frontend TanStack Start/Vite/Nitro) que **comparte la misma PostgreSQL del ecommerce** (`products` / `product_variants` + tablas `pos_*`). La autenticación es un **PIN compartido del local** que emite un JWT genérico (`sub: "pos"`), sin usuarios, roles ni registro de caja/sucursal.

Hay controles positivos (precios recalculados en servidor, SQL parametrizado en flujos principales, fail-fast de auth en producción, CORS configurable, protección de path traversal en PDFs, certificados ARCA no commiteados). Los riesgos más graves son de **modelo de autorización** (un cajero = privilegios de compras/stock/contabilidad/fiscal/PII), **fuerza bruta del PIN**, **radio de explosión por DB compartida** y **exposición pública del diseño/operación** del sistema.

| Severidad | Cantidad |
|-----------|----------|
| 🔴 CRÍTICO | 1 |
| 🟠 ALTO | 4 |
| 🟡 MEDIO | 5 |
| 🔵 BAJO | 2 |
| ⚪ INFO | 2 |
| ⚖️ REVISIÓN LEGAL | 1 |

---

## 2. Visión de arquitectura

```
┌─────────────────────┐     Bearer JWT / API_TOKEN      ┌──────────────────────────┐
│ Frontend (Nitro)    │  /api/** proxy → backend:3001   │ Backend Fastify          │
│ TanStack Start      │────────────────────────────────▶│ /api/v1/{auth,pos,fiscal,│
│ sessionStorage JWT  │                                 │  compras,contabilidad,   │
│ localStorage offline│                                 │  clientes,analytics}     │
└─────────────────────┘                                 └────────────┬─────────────┘
                                                                     │
                                                                     ▼
                                                        ┌──────────────────────────┐
                                                        │ PostgreSQL compartida    │
                                                        │ (ecommerce + pos_*)       │
                                                        │ stock en product_variants │
                                                        └──────────────────────────┘
                                                                     │
                                                          (opcional ARCA WSFE)
```

**Módulos API (todos bajo el mismo `requireAuth`):**

| Prefijo | Capacidad |
|---------|-----------|
| `/api/v1/auth` | Login PIN, config, sesión |
| `/api/v1/pos` | Catálogo caja, ventas, batch offline |
| `/api/v1/fiscal` | Estado / reintento comprobantes ARCA |
| `/api/v1/compras` | Proveedores, OC, importación PDF → **incremento de stock** |
| `/api/v1/contabilidad` | Libros IVA ventas/compras, alta facturas compra |
| `/api/v1/clientes` | CRUD + historial (PII fiscal) |
| `/api/v1/analytics` | Facturación día, ranking, stock crítico, rentabilidad |
| `GET /health` | Público |

**Deploy:** Coolify vía `docker-compose.yaml` (sin Postgres propio); frontend proxy Nitro a backend.

---

## 3. Hallazgos

### ## [🔴 CRÍTICO] Un solo PIN otorga privilegios de cajero + compras + stock + contabilidad + fiscal + PII

**Estado:** Confirmado  
**Área:** Seguridad  
**Problema:** No hay roles, usuarios ni separación de privilegios. Cualquier poseedor del PIN (o del JWT / `API_TOKEN`) puede: cobrar ventas, importar facturas de compra y **subir stock** en `product_variants`, consultar rentabilidad/costos, libros IVA, reintentar emisión ARCA y leer/modificar clientes con CUIT/DNI/domicilio. El JWT siempre lleva `sub: "pos"` — no hay identidad de operador ni auditoría de “quién hizo qué”.  
**Evidencia:**
- `Backend/src/modules/auth/service.ts` — `signToken()` fija `sub: "pos"`; login solo valida PIN.
- `Backend/src/middleware/auth.ts` — un único `requireAuth` para toda `/api/`.
- `Backend/src/modules/compras/importacion/execute.ts` — `lockAndIncrementForPurchase` / ofertas proveedor.
- `Backend/src/modules/analytics/routes.ts`, `contabilidad/routes.ts`, `fiscal/routes.ts`, `clientes/routes.ts` — mismos privilegios que caja.
**Impacto:** Compromiso del PIN (filtración, PIN débil, dispositivo compartido, ex-empleado) equivale a control operativo completo del POS y a manipulación de inventario/catálogo del ecommerce. Fraude interno difícil de atribuir.  
**Archivos:** `Backend/src/middleware/auth.ts`, `Backend/src/modules/auth/service.ts`, `Backend/src/modules/compras/importacion/execute.ts`, `Backend/src/modules/analytics/routes.ts`, `Backend/src/modules/contabilidad/routes.ts`, `Backend/src/modules/clientes/routes.ts`, `Backend/src/modules/fiscal/routes.ts`  
**Recomendación:** Introducir usuarios staff (o SSO) con RBAC mínimo: `caja`, `compras`, `admin`, `solo_lectura`. Exigir rol elevado para importaciones/ejecutar compras, contabilidad y reintentos fiscales. Auditar `actor_id` en ventas, importaciones y ajustes de stock. Separar `API_TOKEN` con scopes.  
**Prioridad:** P0 — diseño antes de más superficie de negocio  
**Fuente:** Revisión estática de código (`main`)

---

### ## [🟠 ALTO] Login por PIN sin rate limiting / lockout (fuerza bruta)

**Estado:** Confirmado  
**Área:** Seguridad  
**Problema:** `POST /api/v1/auth/login` es público y no hay `@fastify/rate-limit`, backoff, CAPTCHA ni bloqueo temporal. El PIN acepta desde 4 caracteres; ejemplos de desarrollo usan `1234`. Comparación del PIN sí usa `timingSafeEqual` (bien), pero no mitiga enumeración por volumen.  
**Evidencia:**
- `Backend/src/modules/auth/routes.ts` — login sin throttling.
- `Backend/src/app.ts` — no registra rate-limit ni helmet.
- `docker-compose.yml` — `POS_ACCESS_PIN: "1234"`.
- Búsqueda: sin `@fastify/rate-limit` / `helmet` en dependencias (`Backend/package.json`).
**Impacto:** Ataque online contra el endpoint de login (si la API es alcanzable) hasta descubrir el PIN compartido → acceso total (ver hallazgo crítico).  
**Archivos:** `Backend/src/modules/auth/routes.ts`, `Backend/src/app.ts`, `Backend/package.json`, `docker-compose.yml`  
**Recomendación:** Rate limit estricto por IP + dispositivo; lockout tras N fallos; PIN largo/alfanumérico o mejor reemplazar por usuarios+MFA en admin; WAF/Coolify rate limits; alertas.  
**Prioridad:** P0  
**Fuente:** Código + manifests

---

### ## [🟠 ALTO] Misma base PostgreSQL que el ecommerce — radio de explosión elevado

**Estado:** Confirmado  
**Área:** Seguridad / Infraestructura / Ecommerce  
**Problema:** El POS escribe en tablas compartidas del catálogo (`product_variants.stock`, `product_supplier_offers`, `suppliers`). Un compromiso del proceso POS o de sus credenciales DB afecta el ecommerce (stock, costos, mapeos proveedor). No hay evidencia de DB user con privilegios mínimos (solo `pos_*` + columnas necesarias).  
**Evidencia:**
- `README.md`, `docs/DEPLOY.md` — “misma PostgreSQL del ecommerce”.
- `Backend/src/lib/catalog.ts` — `UPDATE product_variants … SET stock = stock - $1` / `stock + $1`.
- `Backend/src/modules/compras/importacion/execute.ts` — upsert en `product_supplier_offers`, create proveedor.
**Impacto:** Lateral movement POS → ecommerce; corrupción de stock online; manipulación de costos.  
**Archivos:** `README.md`, `docs/DEPLOY.md`, `Backend/src/lib/catalog.ts`, `Backend/src/modules/compras/importacion/execute.ts`, `Backend/src/config/db.ts`  
**Recomendación:** Usuario PostgreSQL dedicado con GRANT mínimo; RLS si multi-sucursal; considerar cola/API del ecommerce para ajustes de stock en lugar de DML directo; monitoreo de cambios de stock.  
**Prioridad:** P0  
**Fuente:** Documentación + código

---

### ## [🟠 ALTO] Repositorio público con secretos de ejemplo, PIN/JWT por defecto y host Coolify

**Estado:** Confirmado  
**Área:** Seguridad / Infraestructura  
**Problema:** El repo es **público**. Expone arquitectura de deploy, variables, PIN/JWT de ejemplo y en `.env.coolify.example` un `DB_HOST` con forma de hostname interno Coolify (`qi0lrwpywbfez94gy9vfjbyf`). Aunque las passwords de ejemplo son placeholders, facilita reconocimiento y phishing/ops mistakes. `docker-compose.yml` fija PIN `1234` y JWT `dev-pos-jwt-secret-change-me`.  
**Evidencia:**
- `gh repo view` → `visibility: PUBLIC`, `isPrivate: false`.
- `.env.coolify.example` — `DB_HOST=qi0lrwpywbfez94gy9vfjbyf`, `DB_PASSWORD=cambiar`.
- `Backend/.env.example` — `POS_ACCESS_PIN=1234`, `POS_JWT_SECRET=dev-pos-jwt-secret-change-me`.
- `docker-compose.yml` — mismos defaults de desarrollo.
- No hay `.env` / `.pem` / `.key` commiteados (solo `Backend/certs/.gitkeep`) — positivo.
**Impacto:** Inteligencia para atacantes; riesgo de reutilizar defaults en prod; posible fuga de identificadores de infra.  
**Archivos:** `.env.coolify.example`, `Backend/.env.example`, `docker-compose.yml`  
**Recomendación:** Hacer el repo **privado** (o split docs públicos vs ops); sanitizar `DB_HOST` a placeholder genérico; rotar cualquier secreto/host real que se haya pegado; secret scanning + branch protection. **Rotar** PIN/JWT/DB si alguna vez se usaron los valores de ejemplo en un entorno expuesto.  
**Prioridad:** P1  
**Fuente:** Metadatos GitHub + archivos de ejemplo

---

### ## [🟠 ALTO] Cola offline en localStorage + ventas sobre stock sin control de caja

**Estado:** Confirmado  
**Área:** Seguridad / Ecommerce / Privacidad  
**Problema:** Las ventas offline se guardan en `localStorage` (`radio-colonia-pos-offline-queue`) con payload de venta (incl. `cliente_id`, líneas, medio de pago). El frontend permite encolar aunque se supere stock. Al sincronizar, el servidor sí bloquea stock insuficiente en online (`lockAndDecrementForSale`), pero el flujo offline puede acumular inconsistencias y deja datos de negocio/PII en el navegador de un dispositivo compartido de caja.  
**Evidencia:**
- `Frontend/src/lib/offline-queue.ts` — persistencia en `localStorage`.
- `Frontend/src/routes/index.tsx` — `enqueueSale` ante fallos / stock; mensajes de “supera stock… guardada offline”.
- `Backend/src/modules/pos/service.ts` — batch offline marca `sincronizada_offline: true` y difiere fiscal.
**Impacto:** Robo físico/acceso al browser → cola de ventas y referencias a clientes; discrepancias de inventario ecommerce; ventanas de fraude antes de sync.  
**Archivos:** `Frontend/src/lib/offline-queue.ts`, `Frontend/src/routes/index.tsx`, `Backend/src/modules/pos/service.ts`  
**Recomendación:** Cifrar cola con clave de sesión; no persistir PII innecesaria; política clara “no vender sin stock” también offline; limpiar cola al logout; considerar IndexedDB con partición por dispositivo registrado.  
**Prioridad:** P1  
**Fuente:** Código frontend/backend

---

### ## [🟡 MEDIO] Ausencia de security headers (CSP, HSTS, X-Frame-Options, etc.)

**Estado:** Confirmado  
**Área:** Seguridad  
**Problema:** Ni el backend Fastify ni evidencia en el frontend Nitro configuran `@fastify/helmet` / CSP / frame-guard. Depende 100% del reverse proxy Coolify.  
**Evidencia:** `Backend/package.json` sin helmet; `Backend/src/app.ts` solo CORS + multipart; `Frontend/vite.config.ts` sin headers de seguridad.  
**Impacto:** Mayor riesgo XSS clickjacking si aparece un bug de render; defensa en profundidad débil.  
**Archivos:** `Backend/src/app.ts`, `Backend/package.json`, `Frontend/vite.config.ts`  
**Recomendación:** Helmet en API; headers en Nitro/`routeRules` o en Coolify (CSP estricta, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).  
**Prioridad:** P2  
**Fuente:** Código

---

### ## [🟡 MEDIO] `API_TOKEN` con acceso total y comparación no constant-time

**Estado:** Confirmado  
**Área:** Seguridad  
**Problema:** Si `API_TOKEN` está definido, cualquier Bearer igual a ese valor bypassa el JWT y obtiene la misma superficie completa. La comparación es `token === env.API_TOKEN` (no `timingSafeEqual`).  
**Evidencia:** `Backend/src/middleware/auth.ts` líneas de comparación con `API_TOKEN`.  
**Impacto:** Token de integración = superusuario API; leak en logs/CI = compromiso total. Timing leak teórico menor vs PIN.  
**Archivos:** `Backend/src/middleware/auth.ts`, `Backend/src/config/env.ts`  
**Recomendación:** Comparación timing-safe; scopes; rotación; no usar un único token estático de larga vida.  
**Prioridad:** P2  
**Fuente:** Código

---

### ## [🟡 MEDIO] Endpoint `/health` público con información de base de datos

**Estado:** Confirmado  
**Área:** Seguridad / Infraestructura  
**Problema:** `GET /health` no requiere auth y devuelve `database`, `database_name`, `schema_ready`, estado del servicio. Útil para ops, pero ayuda a reconocimiento.  
**Evidencia:** `Backend/src/app.ts` — health público + `current_database()`.  
**Impacto:** Reconocimiento; confirmación de target y nombre de DB.  
**Archivos:** `Backend/src/app.ts`  
**Recomendación:** Health “liveness” mínimo público; detalles solo en red interna o con auth; no exponer `database_name` a Internet.  
**Prioridad:** P2  
**Fuente:** Código

---

### ## [🟡 MEDIO] Upload PDF de compras: validación por extensión/MIME, procesamiento local (OCR/poppler)

**Estado:** Probable  
**Área:** Seguridad  
**Problema:** `validatePdfUpload` valida `.pdf`, MIME y tamaño ≤10MB, pero no magic bytes `%PDF`. El pipeline usa poppler/tesseract (`Dockerfile` instala ambos). Path traversal al leer está mitigado (`resolvePdfPath`). Un PDF malicioso podría intentar DoS/crash del worker OCR.  
**Evidencia:** `Backend/src/modules/compras/importacion/pdf-storage.ts`, `service.ts` (`createImportacionFromPdf`), `Backend/Dockerfile` (poppler + tesseract).  
**Impacto:** DoS del backend POS; posible abuso de CPU en caja.  
**Archivos:** `pdf-storage.ts`, `importacion/service.ts`, `Backend/Dockerfile`  
**Recomendación:** Verificar magic bytes; sandbox/timeouts al parsear; cuotas por usuario; antivirus opcional; procesar en worker aislado.  
**Prioridad:** P2  
**Fuente:** Código

---

### ## [🟡 MEDIO] Sesión JWT en sessionStorage + auth “required” cacheada en el cliente

**Estado:** Confirmado  
**Área:** Seguridad / Privacidad  
**Problema:** Token en `sessionStorage` (`pos-session`); XSS futuro lo exfiltra. Flag `pos-auth-required` también en sessionStorage. Duración default 12h (`POS_SESSION_HOURS`). No hay refresh token ni revocación server-side (bastaría rotar `POS_JWT_SECRET`).  
**Evidencia:** `Frontend/src/lib/auth-session.ts`, `Backend/src/config/env.ts`.  
**Impacto:** En dispositivo compartido de caja, sesión larga = ventana amplia; sin logout forzado centralizado.  
**Archivos:** `Frontend/src/lib/auth-session.ts`, `Backend/src/modules/auth/service.ts`  
**Recomendación:** Reducir TTL en producción; logout remoto por versión de secreto/jti en denylist; HttpOnly cookie con CSRF si mismo sitio; CSP estricta.  
**Prioridad:** P2  
**Fuente:** Código

---

### ## [🔵 BAJO] `UPDATE` dinámico en clientes (nombres de columna desde Object.entries)

**Estado:** Potencial  
**Área:** Seguridad  
**Problema:** `updateCliente` arma `SET ${key} = $n` desde keys del objeto. Hoy Zod strippea keys desconocidas (`updateClienteSchema`), por lo que el riesgo real es bajo, pero el patrón es frágil si alguien usa `.passthrough()` o reutiliza la función.  
**Evidencia:** `Backend/src/modules/clientes/service.ts` + `schemas.ts`.  
**Impacto:** SQLi de columnas si el contrato de validación se debilita.  
**Archivos:** `Backend/src/modules/clientes/service.ts`  
**Recomendación:** Whitelist explícita de columnas permitidas.  
**Prioridad:** P3  
**Fuente:** Código

---

### ## [🔵 BAJO] Sin voids/refunds/descuentos post-venta en API (superficie reducida, hueco operativo)

**Estado:** Confirmado  
**Área:** Seguridad / Ecommerce  
**Problema:** No hay endpoints de anulación, devolución, descuento manual ni apertura de cajón. El precio de venta lo impone el servidor desde catálogo + tramos (bien). Esto reduce fraude por descuentos arbitrarios, pero no hay flujo controlado de correcciones (puede empujar a workarounds fuera de sistema).  
**Evidencia:** `Backend/src/modules/pos/routes.ts` / `schemas.ts` / `service.ts` — solo alta de ventas; búsqueda sin void/refund/descuento server-side.  
**Impacto:** Bajo como vulnerabilidad; medio como control de negocio/auditoría futura.  
**Archivos:** `Backend/src/modules/pos/*`  
**Recomendación:** Cuando se implementen, exigir rol admin, motivo, doble aprobación y asiento inverso fiscal.  
**Prioridad:** P3  
**Fuente:** Código

---

### ## [⚪ INFO] Controles positivos observados

**Estado:** Confirmado  
**Área:** Seguridad  
**Problema:** N/A (fortalezas).  
**Evidencia:**
- Precios autoritativos en servidor (`processSale` ignora desviaciones de caja salvo warn).
- SQL parametrizado en ventas/clientes list/historial.
- Producción exige `POS_ACCESS_PIN` + `POS_JWT_SECRET` (`env.ts` fail-fast).
- CORS por allowlist (`CORS_ORIGIN`).
- Certificados ARCA no en git; carga por path/env.
- Multipart con límite 10MB / 1 archivo.
- Idempotencia offline vía `client_sale_id`.
**Impacto:** Reduce varias clases de ataque clásicas de POS.  
**Archivos:** varios citados  
**Recomendación:** Mantener y documentar como baseline.  
**Prioridad:** —  
**Fuente:** Código

---

### ## [⚪ INFO] Dependencias (manifests) — revisión sin lock audit ejecutado

**Estado:** Potencial  
**Área:** Seguridad / Infraestructura  
**Problema:** Backend: `fastify@^5.3.3`, `@fastify/cors`, `@fastify/multipart`, `pg`, `zod`, `pdf-parse`/`legacy-pdf-parse`, `pdfjs-dist`, `@ramiidv/arca-facturacion`. Frontend: TanStack Start/Router/Query, React 19, Vite 7, Nitro beta, Radix, etc. No se ejecutó `npm audit` ni se corrió la app.  
**Evidencia:** `Backend/package.json`, `Frontend/package.json` (+ lockfiles presentes).  
**Impacto:** CVEs posibles en PDF parsers / Nitro beta / transitive deps.  
**Archivos:** `Backend/package.json`, `Frontend/package.json`, lockfiles  
**Recomendación:** `npm audit` / Dependabot / Renovate en CI; pinnear Nitro estable cuando sea posible; aislar parsers PDF.  
**Prioridad:** P2 (proceso continuo)  
**Fuente:** Manifests

---

### ## [⚖️ REVISIÓN LEGAL] PII fiscal de clientes y datos AFIP/ARCA

**Estado:** Revisión legal  
**Área:** Legal / Privacidad  
**Problema:** Se almacenan y exponen vía API (con solo PIN) nombre, documento (CUIT/DNI), condición IVA, razón social, domicilio fiscal, email, teléfono e historial de compras. Emisión ARCA implica tratamiento de datos fiscales. Dispositivos de caja compartidos + `localStorage`/`sessionStorage` aumentan riesgo de acceso no autorizado. Repo público describe el tratamiento.  
**Evidencia:** `Backend/src/modules/clientes/*`, fiscal/ARCA, offline queue, visibilidad pública del repo.  
**Impacto:** Posible incumplimiento de principios de Ley 25.326 (AR) / deberes de seguridad y minimización; obligaciones AFIP por comprobantes.  
**Archivos:** módulos `clientes`, `fiscal`, frontend auth/offline  
**Recomendación:** Minimizar PII en cliente; acceso por rol; registro de accesos; política de retención; evaluación con asesor legal; privacidad del repo de ops.  
**Prioridad:** P1 (compliance)  
**Fuente:** Código + marco AR (revisión no constituye dictamen legal)

---

## 4. Top 5 acciones recomendadas

1. **RBAC + identidad de operador** (dejar de usar un PIN único con privilegios totales).  
2. **Rate limit / lockout en login** + PIN fuerte o reemplazo por credenciales individuales.  
3. **Hardening de DB compartida** (usuario least-privilege; auditar DML a `product_variants`).  
4. **Privatizar repo / sanitizar ejemplos** y rotar cualquier secreto/host que haya sido real.  
5. **Proteger cola offline y PII** (cifrado, TTL de sesión corto, headers de seguridad, health mínimo).

---

## 5. Lo que no se pudo verificar sin ejecutar la app

- Comportamiento real en Coolify (TLS, headers del proxy, exposición pública del puerto 3001).
- Si `POS_ACCESS_PIN` / JWT / DB / ARCA en producción usan defaults o valores fuertes.
- `npm audit` / SCA con base CVE actualizada sobre lockfiles.
- Pruebas dinámicas: fuerza bruta, IDOR cross-tenant (no hay multi-store en código), XSS almacenado en nombres de producto/proveedor, DoS por PDF.
- Configuración real de PostgreSQL roles/RLS en el stack ecommerce.
- Integridad end-to-end offline→sync bajo contención de stock.
- Emisión ARCA homologación/producción y manejo de claves en runtime (solo paths/env).
- Logs en producción (si imprimen tokens, CUIT, URLs con password — `logDbTarget` redacta URL en verify-schema, no revisamos todos los logs Fastify).
- Cumplimiento legal formal (requiere abogado / DPO).

---

## 6. Método y limitaciones

- Acceso remoto read-only: `gh` + GitHub MCP (`get_file_contents`, listados, metadatos).
- **No** se clonó el repo, **no** se modificó código, **no** PRs/push/deploy.
- Code search de GitHub devolvió resultados incompletos/0 en varias queries; la evidencia principal son contenidos de archivo.
- Hallazgos priorizan problemas reales con evidencia en `main` al 2026-09-11.

---

*Informe generado para RC Security & Compliance. Clasificación sugerida: uso interno.*
