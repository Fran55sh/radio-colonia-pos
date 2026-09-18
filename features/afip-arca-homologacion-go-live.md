# Plan de implementación: AFIP/ARCA en POS — homologación y go-live por env

**Repo objetivo:** `Fran55sh/radio-colonia-pos`  
**Repo schema DB (migraciones):** `Fran55sh/RadioColonia` (migrador ecommerce)  
**Feature slug:** `afip-arca-homologacion-go-live`  
**Fecha del análisis:** 2026-09-17  
**Modo:** solo análisis — sin código de implementación en este documento  

---

## Hecho crítico del análisis (leer primero)

**HECHO:** La facturación electrónica ARCA/AFIP **ya está implementada** en el POS (backend + UI de caja + tabla DB). No es una feature greenfield.

Lo que pedís (“primero en desarrollo, listo para activar con una env a `true` y facturar cada pedido”) **coincide en gran parte con el diseño actual**:

| Variable | Rol actual (HECHO) |
|---|---|
| `ARCA_ENABLED=true` | Enciende emisión al completar ventas (si también hay CUIT, PV y certificados) |
| `ARCA_PRODUCTION=false` | Ambiente homologación (`ambiente: "dev"`) |
| `ARCA_PRODUCTION=true` | Ambiente producción (`ambiente: "prod"`) — **además** de `ARCA_ENABLED=true` |

**DECISIÓN RESUELTA:** Se mantienen **ambos** switches. `ARCA_ENABLED` = kill switch total; `ARCA_PRODUCTION` = homo vs prod para pruebas. No unificar.

Este plan es de **cierre de gaps, hardening, documentación de go-live y verificación en homologación**, no de reinventar el módulo fiscal.

---

# 1. Resumen de la feature

## Qué se quiere conseguir
Poder facturar electrónicamente cada venta del POS contra ARCA (ex AFIP WSFE), primero en **homologación**, y dejar el sistema listo para salir a producción cambiando configuración de entorno (sin reescribir la lógica de venta).

## Problema que resuelve
Hoy las ventas POS pueden completarse sin comprobante fiscal autorizado. Se necesita CAE, tipo A/B, QR y persistencia por venta, con un kill-switch operativo.

## Partes del sistema involucradas
- Backend Fastify (`Backend/src/modules/fiscal/*`, `pos`, `clientes`, `config/arca.ts`)
- Frontend TanStack Start (caja `Frontend/src/routes/index.tsx`, diálogos fiscales/cliente)
- PostgreSQL compartida con ecommerce (`pos_comprobantes_fiscales`, columnas fiscales en `pos_clientes`) — migración en repo ecommerce
- Certificados PEM ARCA y variables Coolify/Docker
- Auth por roles PIN (`caja` vs `admin` para endpoints `/fiscal/*`)

## Comportamiento actual (HECHO)

1. Si `ARCA_ENABLED` no es `true` **o** faltan CUIT/PV/cert/key → `isArcaConfigured()` es `false` → `maybeEmitirDespuesDeVenta` retorna `null` → la venta se guarda igual, sin fiscal.
2. Si está configurado → tras `processSale` se llama `emitirComprobanteVenta` → WSFE vía `@ramiidv/arca-facturacion` → se persiste en `pos_comprobantes_fiscales` → la respuesta de venta incluye `fiscal`.
3. La caja muestra `FiscalResultDialog` si `result.fiscal` existe.
4. Ventas offline (`sincronizada_offline=true`) **saltan** emisión en el insert; el batch offline vuelve a llamar `maybeEmitirDespuesDeVenta`.
5. Reintento: `POST /api/v1/fiscal/ventas/:id/reintentar` (rol **admin**).
6. Sin cliente → Factura B consumidor final. Con CUIT + RI → Factura A. Con CUIT (otra condición) → Factura B.

## Comportamiento deseado (según pedido)

- En desarrollo/homologación: emitir CAE de prueba en cada pedido cuando la config homologación esté completa.
- En producción: mismo flujo; solo cambiar env (idealmente un flip claro) para facturar “de verdad”.
- Minimizar trabajo de Cursor: completar lo faltante, no reimplementar.

---

# 2. Arquitectura actual relevante

## Stack (HECHO)
- **Backend:** Fastify 5, `pg`, Zod, Vitest, `@ramiidv/arca-facturacion` (^2.0.0 en package.json; lock en 2.1.0)
- **Frontend:** TanStack Start / React 19 / TanStack Query / Vite
- **DB:** PostgreSQL compartida `radiocolonia_db`; POS **no** crea tablas, solo `db:verify`
- **Deploy:** Docker Compose / Coolify (`docker-compose.yaml`)

## Flujo actual venta online con ARCA

```
UI caja (Frontend/src/routes/index.tsx)
  → createSale / api-client (POST /api/v1/pos/ventas)
  → posRoutes → processSale (Backend/src/modules/pos/service.ts)
  → withTransaction(registerSaleInTransaction)  // pos_ventas, pos_lineas_venta, stock, pos_iva_registro
  → maybeEmitirDespuesDeVenta(ventaId)          // Backend/src/modules/fiscal/service.ts
       → getArcaConfig / isArcaConfigured       // Backend/src/config/arca.ts
       → loadVentaFiscalContext                 // fiscal/repository.ts
       → resolverComprobante                    // fiscal/resolver.ts
       → lineasToArcaItems                      // fiscal/mappers.ts
       → ensureComprobantePendiente             // INSERT pos_comprobantes_fiscales
       → getArcaClient().facturar(...)          // fiscal/arca-client.ts → WSFE
       → marcarComprobanteEmitido | marcarComprobanteError
  ← SaleResult { venta_id, total, fiscal }
  → FiscalResultDialog (si fiscal != null)
```

## Flujo offline

```
POST /api/v1/pos/ventas/offline-batch
  → processSale(..., sincronizada_offline: true)  // skipFiscal en maybeEmitir
  → luego maybeEmitirDespuesDeVenta(venta_id)     // emisión diferida
```

## Endpoints fiscales (HECHO)

| Método | Ruta | Auth | Archivo |
|---|---|---|---|
| GET | `/api/v1/fiscal/ventas/:ventaId` | JWT + rol admin | `fiscal/routes.ts` |
| POST | `/api/v1/fiscal/ventas/:ventaId/reintentar` | JWT + rol admin | `fiscal/routes.ts` |
| GET | `/api/v1/fiscal/config` | JWT + rol admin | `fiscal/routes.ts` |

Registro en `Backend/src/app.ts` con `requireRole("admin")` bajo prefijo `/fiscal`.

---

# 3. Archivos involucrados

| Archivo | Tipo | Rol actual | Cambio necesario | Prioridad |
|---|---|---|---|---|
| `Backend/src/config/arca.ts` | config | Parsea `ARCA_*`, carga PEM | Posible: logging claro si `ENABLED=true` pero config incompleta; no reinventar | Alta (revisar) |
| `Backend/src/modules/fiscal/service.ts` | service | Emisión + retry | Solo si se decide cambios de política (bloqueo venta vs best-effort) | Media |
| `Backend/src/modules/fiscal/arca-client.ts` | client | Singleton Arca | Montaje certs en Docker; tests reset | Media |
| `Backend/src/modules/fiscal/resolver.ts` | domain | A/B/CF | Tests unitarios; validar si hace falta monotributo/etc. | Media |
| `Backend/src/modules/fiscal/mappers.ts` | domain | IVA → ítems ARCA, QR | Tests alícuotas | Media |
| `Backend/src/modules/fiscal/repository.ts` | repo | CRUD comprobantes | Revisar concurrencia/idempotencia | Alta (revisar) |
| `Backend/src/modules/fiscal/routes.ts` | routes | status/retry/config | **Bug:** `ambiente` hardcodeado `"homologacion"` | Alta |
| `Backend/src/modules/fiscal/types.ts` | types | Contrato fiscal | Solo si se amplía API | Baja |
| `Backend/src/modules/pos/service.ts` | service | Venta + hook fiscal | No tocar flujo stock; solo si política skipFiscal cambia | Baja–Media |
| `Backend/src/modules/pos/schemas.ts` | schema | Payload venta | No tocar salvo campos nuevos | No tocar |
| `Backend/src/modules/clientes/*` | module | Datos fiscales cliente | Completar UI/validaciones si faltan condiciones IVA | Media |
| `Backend/src/app.ts` | bootstrap | Monta rutas + roles | Decidir si caja puede retry | **DECISIÓN** |
| `Backend/.env.example` | env | Documenta ARCA_* | Completar comentarios go-live | Alta |
| `.env.coolify.example` | env | **No lista ARCA_*** | Agregar bloque ARCA | Alta |
| `docs/DEPLOY.md` | docs | Deploy | Sección certificados + switches | Alta |
| `Frontend/src/routes/index.tsx` | UI caja | Llama venta + abre dialog | Retry desde caja si se decide | Media |
| `Frontend/src/components/pos/FiscalResultDialog.tsx` | UI | Muestra CAE/error | Botón reintentar opcional | Media |
| `Frontend/src/components/pos/CustomerFormDialog.tsx` | UI | Alta cliente fiscal | Condiciones IVA incompletas vs padrón | Media |
| `Frontend/src/lib/api-client.ts` | client | Tipos FiscalResult | Método `retryFiscal` si UI lo necesita | Media |
| `Fran55sh/RadioColonia` → `app/src/db/migrations/0008_pos_fiscal_invoicing.sql` | migration | Schema fiscal | **Verificar aplicada en cada entorno**; no recrear | Crítica (ops) |
| `Backend/src/db/verify-schema.ts` | verify | Exige `pos_comprobantes_fiscales` | No tocar salvo nuevas tablas | No tocar |
| Tests `Backend/src/modules/fiscal/*.test.ts` | tests | **No existen** | Crear | Alta |
| `docker-compose*.yml` | deploy | No monta `certs/` | Volume/secrets para PEM | Alta |

### Archivos que NO deberían modificarse (aunque parezcan relacionados)
- Módulo **compras** / importación de facturas PDF (`Backend/src/modules/compras/**`) — es crédito fiscal de compras, no emisión de ventas.
- Analytics `facturacion-dia` — suma ventas POS, no CAE.
- Catálogo ecommerce / stock algorithms salvo bugs descubiertos.
- No inventar nuevo cliente SOAP: ya se usa `@ramiidv/arca-facturacion`.

### Ruta de guardado del plan
**HECHO:** No existe `app/auditorías/features/` en `radio-colonia-pos`.  
**RECOMENDACIÓN:** guardar este documento en el POS como `docs/features/afip-arca-homologacion-go-live.md` (crear carpeta `docs/features/` al implementar/documentar), o copiarlo desde el artefacto de análisis. No inventar `app/auditorías` en POS sin decisión explícita.

---

# 4. Dependencias y flujo de datos

## Flujo deseado (homologación)

```
Cajero (rol caja)
  ↓
Selecciona productos + opcional cliente (CUIT/CF)
  ↓
POST /api/v1/pos/ventas { medio_pago, lineas, cliente_id? }
  ↓
Transacción DB: venta + líneas + stock + pos_iva_registro
  ↓
[si ARCA_ENABLED + certs + CUIT + PV]
  resolver tipo comprobante (A/B/CF)
  agrupar netos por alícuota
  INSERT comprobante pendiente
  WSFE facturar (homologación si ARCA_PRODUCTION=false)
  UPDATE emitido (cae, nro, qr) | error
  UPDATE pos_iva_registro.comprobante
  ↓
Response incluye fiscal
  ↓
FiscalResultDialog (banner “Homologación” si ambiente=dev)
```

## Transformaciones / validaciones
- **Cliente:** CUIT 11 dígitos; RI → Factura A (`resolver.ts`, `clientes/service.ts`).
- **Líneas:** solo alícuotas mapeadas (21, 10.5, 27, 5, 2.5, 0); otras → `ALICUOTA_NO_SOPORTADA`.
- **Persistencia:** unique `venta_id`; unique parcial `(ambiente, punto_venta, cbte_tipo, cbte_nro)` emitidos.
- **Idempotencia parcial:** si ya `emitido` con CAE, re-emisión retorna el existente.

---

# 5. Cambios de base de datos

## ¿Requiere DB nueva?
**En principio NO** para el flujo pedido, **si** la migración `0008_pos_fiscal_invoicing.sql` ya está aplicada en el entorno.

### HECHO — ya existe
Archivo (ecommerce): `RadioColonia/app/src/db/migrations/0008_pos_fiscal_invoicing.sql`

- Columnas en `pos_clientes`: `documento_tipo_afip`, `condicion_iva_receptor_id`, `razon_social`, `domicilio_fiscal`, `padron_checked_at`, `padron_raw`
- Tabla `pos_comprobantes_fiscales` con estados `pendiente|emitido|error|anulado`
- Índices de estado y unicidad de número emitido por ambiente

### Acción operativa
1. Verificar en cada DB (dev/staging/prod) que exista `pos_comprobantes_fiscales` y columnas fiscales de clientes.
2. Si falta: correr migrador del **ecommerce** (no inventar migración duplicada en el POS).
3. POS: `npm run db:verify` debe pasar.

### No proponer
- Tablas nuevas “por si acaso”
- Duplicar schema en Backend POS

### Fuera de alcance salvo decisión
- Flujo `anulado` (columna existe; no hay servicio de anulación/NC encontrado)
- Consumo de `padron_*` (columnas existen; no hay integración padrón AFIP encontrada en POS)

---

# 6. Backend

## Ya implementado (no reescribir)
- Emisión post-venta, retry, status, client ARCA, mapeo IVA, resolución A/B, persistencia, actualización libro IVA.

## Cambios recomendados (gaps)

### 6.1 Config / ops
- Documentar y propagar `ARCA_*` a Coolify (`.env.coolify.example` hoy **no** las incluye).
- Asegurar carga de certs en contenedor (`ARCA_CERT_PATH`/`KEY_PATH` o `ARCA_CERT`/`ARCA_KEY` inline).
- Al boot: si `ARCA_ENABLED=true` pero `getArcaConfig()` es null, log **warn** explícito (hoy falla “silencioso” hacia no-facturar).

### 6.2 Bug a corregir
En `fiscal/routes.ts` `GET /config`:
```
ambiente: isArcaConfigured() ? "homologacion" : null
```
**HECHO:** ignora `ARCA_PRODUCTION`. Debe reflejar `dev`/`prod` (o `homologacion`/`produccion`) desde `getArcaConfig().ambiente`.

### 6.3 Política de error en venta (DECISIÓN PENDIENTE)
Hoy: si ARCA falla, la venta **ya committeó**; se guarda comprobante en `error` y se devuelve `fiscal` con error. La caja no revierte stock.
- Mantener (caja no se bloquea) vs fallar venta si fiscal falla → impacto fuerte en UX y transacciones.

### 6.4 Auth retry
Retry fiscal exige **admin**. Cajero con rol `caja` no puede llamar `/fiscal/.../reintentar` ni `/fiscal/config`.
- Si se quiere reintento desde el dialog de caja → bajar permiso o exponer retry autenticado a `caja` solo para ventas propias (DECISIÓN).

### 6.5 Concurrencia / idempotencia
- Unique por `venta_id` evita doble fila.
- Dos retries concurrentes podrían llamar WSFE dos veces antes de marcar emitido → riesgo de huecos/números; mitigar con lock por `venta_id` o estado `pendiente` atómico (recomendado antes de prod).

### 6.6 Logging
- Ya hay `console.log("[ARCA]", ...)` en client. Preferir logger Fastify y no loguear PEM ni respuestas completas con datos sensibles en prod.

### 6.7 No hacer
- No agregar endpoints SOAP propios.
- No mezclar con importación de facturas de compra.

---

# 7. Frontend

## Ya implementado
- `FiscalResultDialog`: CAE, vencimiento, QR, banner homologación si `ambiente === "dev"`.
- Caja abre dialog tras venta si hay `fiscal`.
- `CustomerFormDialog`: CF / CUIT / DNI + condición IVA (RI vs default 5) para Factura A.

## Gaps / mejoras (no reinventar UI)
1. **Reintento en UI:** no hay botón que llame `POST /fiscal/ventas/:id/reintentar` (y además requiere admin).
2. **Cuando `fiscal` es null** (ARCA off): no hay mensaje “venta OK sin factura” — puede ser intencional.
3. **Condiciones IVA:** formulario solo expone subset; validar si monotributo/exento/etc. son necesarios (DECISIÓN).
4. **Alta cliente:** módulo clientes es admin; desde caja se crea vía dialog — verificar permisos reales del endpoint `POST /clientes` (admin) vs creación embebida en caja (seguir cadena en implementación).
5. Copiar patrones existentes: Dialogs Radix, `api-client`, toasts sonner si ya se usan en caja.

## Responsive / a11y
Reusar Dialog existente; asegurar foco y labels (ya hay Label en CustomerForm).

---

# 8. Tipos, contratos y API

## Contratos existentes (HECHO)
- `ComprobanteFiscalResponse` / `FiscalResult`: estado, comprobante, cbte_*, cae, qr_url, error_message, ambiente
- `CreateSaleResult.fiscal?: FiscalResult | null`
- Env Zod en `arca.ts`
- Cliente: `documento_tipo_afip`, `condicion_iva_receptor_id`

## Cambios de contrato sugeridos
- `GET /fiscal/config` response: `ambiente: "dev" | "prod" | null` (o homologacion/produccion) **alineado** con DB `ambiente`
- Opcional: `arca_enabled` ya existe; agregar `production: boolean` sin romper clientes

## Consumidores que podrían romperse
- Solo UI interna POS hoy. No se observó SDK externo.
- Si algún cliente asume `ambiente === "homologacion"` string literal del endpoint config, corregir a la vez frontend.

---

# 9. Casos borde y posibles problemas

| Caso | Manejo actual / recomendado |
|---|---|
| ARCA off | Venta OK, `fiscal: null` |
| ENABLED sin certs | `isArcaConfigured()` false → no emite (mejorar warn) |
| Venta sin cliente | Factura B CF doc 0 |
| Factura A sin CUIT/RI | Resolver no elige A; `validarClienteParaFacturaA` existe pero no se vio llamada en emisión (solo resolver) |
| Alícuota no mapeada | Error 400 `ALICUOTA_NO_SOPORTADA` durante emisión (venta ya guardada) |
| Rechazo ARCA | estado `error` + mensaje |
| Doble click venta | Depende de UI; `client_sale_id` mitiga offline |
| Offline sync | Emisión diferida post-insert |
| Duplicate offline | 409 + intenta fiscal |
| Retry admin | `forceRetry` en error |
| Retry sin force en pendiente | Reintenta emisión |
| Ya emitido | Retorna existente |
| Refresh mid-flight | Venta puede existir sin CAE → retry |
| Permiso caja en /fiscal | 403 |
| Cert vencido / WSAA | Error WSFE → estado error |
| Producción con cert de homo | Fallará / inválido — checklist ops |
| Números concurrentes | Riesgo — lock recomendado |
| Anulación | No implementada (`anulado` sin flujo) |
| Migración 0008 ausente | `db:verify` / queries fallan |

---

# 10. Regresiones potenciales

| Funcionalidad | Riesgo | Archivos | Verificar |
|---|---|---|---|
| Venta POS online | Medio si se envuelve fiscal dentro de la transacción | `pos/service.ts` | Stock descuenta, total correcto, respuesta estable con ARCA off |
| Offline batch | Medio | `processOfflineBatch` | Duplicados + emisión posterior |
| Libro IVA ventas | Medio | `marcarComprobanteEmitido` actualiza `pos_iva_registro` | `comprobante` se completa solo tras CAE |
| Clientes | Bajo | schemas clientes | Alta CF/CUIT sigue OK |
| Compras PDF | Bajo si no se toca | `compras/**` | No regresar |
| Auth roles | Medio si se abre /fiscal a caja | `app.ts` | Caja no gana admin por accidente |
| Deploy Coolify | Alto si se setea ENABLED sin certs | compose/env | API no crashea al boot (hoy `readFileSync` solo si ENABLED y paths set) |

Nota: `loadPem` usa `readFileSync` — si ENABLED=true y path inválido, **puede tirar excepción al import/config** según cuándo se llame `getArcaConfig`. Verificar comportamiento al primer request fiscal.

---

# 11. Tests

**HECHO:** No hay tests del módulo fiscal. Hay Vitest en compras/importación como patrón a copiar.

### Unit tests
- `resolverComprobante`: null → B CF; CUIT+RI → A; CUIT+otra → B; DNI → B CF
- `mapAlicuotaToIvaTipo` / `lineasToArcaItems`: agrupa, exento, alícuota inválida
- `formatComprobanteNumero`, parse fechas CAE
- `getArcaConfig` con env matrices (ENABLED false; incompleto; prod true)

### Integration tests
- `processSale` con ARCA mockeado: se llama facturar; respuesta incluye fiscal emitido
- ARCA off: fiscal null, venta OK
- Retry desde error → emitido
- Idempotencia: segunda emisión no llama WSFE si ya CAE

### API tests
- `GET /fiscal/ventas/:id` 404 sin comprobante; 200 con
- `POST .../reintentar` 503 si disabled; 403 rol caja; 200 admin
- `GET /fiscal/config` ambiente coherente con `ARCA_PRODUCTION`

### E2E tests
- (Si existe Playwright/similar — **no encontrado en Frontend package.json**) manual preferible por ahora

### Tests manuales
1. Homologación: cert homo, `ARCA_ENABLED=true`, `ARCA_PRODUCTION=false`, venta CF → CAE + banner homo
2. Venta RI → Factura A
3. Cert mal → error visible, venta existe
4. Flip `ARCA_PRODUCTION=true` solo en staging con cert prod (o documentar que no probar prod en local)
5. Offline: venta offline luego sync obtiene CAE
6. Coolify: variables presentes, container lee PEM

---

# 12. Orden exacto de implementación

1. **Ops — verificar migración 0008** en DB target  
   - Criterio: `\d pos_comprobantes_fiscales` OK; `db:verify` OK  
   - Depende: acceso DB ecommerce

2. **Documentar env go-live**  
   - Archivos: `Backend/.env.example`, `.env.coolify.example`, `docs/DEPLOY.md`  
   - Criterio: checklist ARCA_ENABLED / PRODUCTION / CERT claros

3. **Montaje certificados en Docker/Coolify**  
   - Criterio: proceso con ENABLED=true carga client sin crash

4. **Fix `GET /fiscal/config` ambiente**  
   - Archivo: `fiscal/routes.ts`  
   - Criterio: refleja prod/dev real

5. **Warn boot/config incompleta**  
   - Archivo: `arca.ts` o `startServer`  
   - Criterio: log visible si ENABLED sin certs

6. **Tests unitarios fiscal** (resolver, mappers, config)  
   - Criterio: `npm test` verde

7. **Tests integración con mock Arca**  
   - Criterio: processSale + fiscal cubiertos

8. **Hardening concurrencia retry** (si se acepta)  
   - Criterio: dos retries no duplican CBTE

9. **UI reintento** (solo si se decide rol)  
   - Criterio: cajero o admin puede recuperar error

10. **Homologación real end-to-end** (manual)  
    - Criterio: CAE homo en DB + dialog

11. **Checklist producción** (cert prod, PV, CUIT, `ARCA_PRODUCTION=true`)  
    - Criterio: documento firmado ops; no código

**No** empezar por “crear módulo fiscal nuevo”.

---

# 13. Estrategia específica para Cursor

## Leer PRIMERO
1. `Backend/src/config/arca.ts`
2. `Backend/src/modules/fiscal/service.ts`
3. `Backend/src/modules/pos/service.ts` (hook `maybeEmitirDespuesDeVenta`)
4. `Backend/src/modules/fiscal/repository.ts`
5. `Backend/src/app.ts` (roles)
6. Migración `RadioColonia/app/src/db/migrations/0008_pos_fiscal_invoicing.sql`
7. `Frontend/src/components/pos/FiscalResultDialog.tsx` + tramo fiscal en `routes/index.tsx`

## Leer DESPUÉS
- `resolver.ts`, `mappers.ts`, `arca-client.ts`, `clientes/*`, `docs/DEPLOY.md`, compose files
- Tests de compras como patrón Vitest

## Patrones a copiar
- Errores `AppError(code, message)`
- Zod env parsing
- Dialogs POS existentes
- `resetArcaClientForTests` ya existe — usarlo en tests

## NO reinventar
- Cliente WSFE propio
- Nueva tabla de facturas
- Nuevo flujo de checkout paralelo
- Duplicar migración en repo POS

## NO modificar
- `compras/importacion/**` salvo dependencia accidental
- Lógica de stock en `registerSaleInTransaction` sin necesidad

## Decisiones que Cursor NO debe tomar solo
- ¿Fallar la venta si falla ARCA?
- ¿Caja puede reintentar fiscal?
- ¿`ARCA_ENABLED` vs `ARCA_PRODUCTION` como “el” switch de go-live?
- Condiciones IVA adicionales / padrón
- Notas de crédito / anulación

## Comandos tras etapas
- `cd Backend && npm test`
- `npm run db:verify`
- Smoke manual POST venta con env homo

## Batch vs separado
- Docs env + coolify juntos
- Fix config ambiente solo
- Tests en PR separado o mismo PR chico
- UI retry separado (depende decisión)

---

# 14. Riesgos técnicos

### 🔴 Alto
- **Salir a prod con cert/PV/CUIT incorrectos** → comprobantes inválidos o rechazos masivos. Mitigar: checklist + prueba staging.
- **Migración 0008 no aplicada en prod** → API rota al emitir/verificar. Mitigar: verify en deploy.
- **Doble emisión concurrente** → inconsistencias de numeración. Mitigar: lock/idempotencia fuerte.

### 🟡 Medio
- Venta OK + fiscal error sin UX de recovery para caja.
- `GET /fiscal/config` miente el ambiente.
- Secrets PEM en env mal escapados en Coolify.
- Offline + ARCA latency.

### 🟢 Bajo
- Banner homologación solo chequea `ambiente === "dev"` (alineado con config actual).
- Analytics “facturación” no es fiscal AFIP (naming confuso, no bloqueante).

---

# 15. Decisiones que deben definirse ANTES de programar

## D1. ¿Qué variable es el “TRUE” de go-live? — **RESUELTA (2026-09-17)**
- **Decisión de Franco:** ambas variables.
  - `ARCA_ENABLED` = **kill switch total** (`false` → no emite nunca).
  - `ARCA_PRODUCTION` = **conmutador homo/prod** (`false` = desarrollo/homologación; `true` = facturación real).
- Homologación típica: `ARCA_ENABLED=true` + `ARCA_PRODUCTION=false` (+ certs homo).
- Producción: `ARCA_ENABLED=true` + `ARCA_PRODUCTION=true` (+ certs prod, CUIT, PV).
- Apagado de emergencia: solo `ARCA_ENABLED=false` (sin tocar el resto).
- **Impacto:** docs/Coolify deben explicar los dos switches; Cursor no debe unificarlos en uno.

## D2. ¿La venta debe fallar si falla ARCA?
- **Alt A (actual):** best-effort; venta commitida.  
- **Alt B:** fiscal dentro de política de negocio (complejo; no meter WSFE dentro de la misma TX DB sin outbox).  
- **Recomendación análisis:** mantener A + cola/retry; outbox si se exige garantía fuerte.

## D3. ¿Quién reintenta?
- Solo admin (actual) vs caja desde dialog.

## D4. ¿Alcance de tipos de comprobante?
- Solo A/B/CF (actual) vs monotributo, NC, Factura C, etc.

## D5. ¿Dónde vive el documento del plan en git?
- `docs/features/...` en POS vs crear `app/auditorías/features` (no existe hoy).

## D6. Certificados
- Path files vs `ARCA_CERT`/`ARCA_KEY` inline en Coolify.

---

# 16. Criterios de aceptación

- [ ] Con `ARCA_ENABLED=false`, las ventas completan y `fiscal` es null/ausente.
- [ ] Con homologación completa (`ENABLED=true`, `PRODUCTION=false`, CUIT, PV, cert homo), cada venta online genera fila en `pos_comprobantes_fiscales` y CAE cuando ARCA aprueba.
- [ ] El dialog de caja muestra tipo, CAE, vencimiento y aviso de homologación en `ambiente=dev`.
- [ ] Factura B CF sin cliente funciona.
- [ ] Factura A con cliente CUIT + RI funciona.
- [ ] Rechazo ARCA deja venta intacta y comprobante en `error` con mensaje.
- [ ] `POST /fiscal/ventas/:id/reintentar` (admin) puede recuperar desde `error`.
- [ ] Idempotencia: no se obtiene un segundo CAE distinto para la misma venta ya `emitido`.
- [ ] `GET /fiscal/config` reporta ambiente coherente con `ARCA_PRODUCTION`.
- [ ] `.env.coolify.example` y `DEPLOY.md` documentan ARCA y certificados.
- [ ] `db:verify` pasa con schema 0008.
- [ ] Tests unitarios fiscales nuevos pasan.
- [ ] Módulo compras/PDF no regresa.
- [ ] Para producción: checklist ops ejecutado; `ARCA_PRODUCTION=true` + cert prod; smoke controlado.

---

# 17. Checklist final para Cursor

## Antes de modificar código
- [ ] Leer archivos de la sección 13
- [ ] Confirmar decisiones D1–D4 con Franco
- [ ] Verificar migración 0008 en la DB del entorno
- [ ] No crear módulo fiscal nuevo

## Backend
- [ ] Fix ambiente en `/fiscal/config`
- [ ] Warn si ENABLED incompleto
- [ ] (Opcional) lock concurrencia
- [ ] (Opcional) permisos retry

## Database
- [ ] Solo verificar/aplicar 0008 vía migrador ecommerce
- [ ] No duplicar SQL en POS

## Frontend
- [ ] Solo si D3 lo pide: retry + api-client
- [ ] No rediseñar caja

## Tests
- [ ] Unit resolver/mappers/config
- [ ] Integration mock Arca + processSale

## Verificación
- [ ] `npm test`
- [ ] `npm run db:verify`
- [ ] Venta real en homologación
- [ ] Revisar que compras no se rompió

---

# 18. Resumen ejecutivo

| Ítem | Detalle |
|---|---|
| Estado | Feature **ya construida**; falta go-live ops + gaps chicos |
| Archivos que probablemente cambian | `fiscal/routes.ts`, `.env.coolify.example`, `Backend/.env.example`, `docs/DEPLOY.md`, tests nuevos, posiblemente `arca.ts` / dialog retry |
| Archivos nuevos | `Backend/src/modules/fiscal/*.test.ts`; opcional `docs/features/afip-arca-homologacion-go-live.md` |
| Migraciones | Ninguna nueva; asegurar `0008_pos_fiscal_invoicing.sql` (repo ecommerce) |
| Endpoints | Existentes: venta + `/fiscal/*`; no requeridos nuevos salvo producto lo pida |
| Componentes | `FiscalResultDialog`, `CustomerFormDialog`, caja `index.tsx` |
| Principales riesgos | Certs/PV mal en prod; migración ausente; doble emisión; UX error sin retry caja |
| Decisiones pendientes | D1–D6 arriba |
| Orden recomendado | Verify DB → docs/env/certs → fix config → tests → hardening → homologación E2E → checklist prod |

---

## Fuera de alcance / mejoras futuras
- Notas de crédito / anulación (`estado=anulado` sin flujo)
- Consulta padrón AFIP (`padron_*` sin uso)
- Impresión térmica de ticket fiscal
- Facturación del ecommerce (este plan es **solo POS**)
- Refactors grandes del POS o unificación de naming “facturación” analytics vs fiscal

---

## Ambigüedades del pedido (señaladas)
1. “Variable a TRUE” — ¿`ARCA_ENABLED` o `ARCA_PRODUCTION`?
2. “Solo POS” — schema fiscal vive en migraciones del ecommerce (inevitable para DB compartida).
3. No se especificó si un fallo de ARCA debe bloquear la venta (hoy no bloquea).

