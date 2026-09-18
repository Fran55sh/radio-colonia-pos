# Plan de implementación: Control de caja — MVP

**Repo objetivo:** `Fran55sh/radio-colonia-pos`  
**Repo schema DB (migraciones):** `Fran55sh/RadioColonia` (migrador ecommerce, misma DB)  
**Feature slug:** `implementacion-caja`  
**Archivo en repo:** `features/implementacion-caja.md`  
**Fecha del análisis:** 2026-09-17  
**Modo:** solo análisis / plan — sin código de implementación en este documento  

---

## Alcance MVP (acordado)

Incluye **solo**:

1. Sesión de caja: apertura → movimientos → arqueo de **efectivo** → cierre → diferencias  
2. Saldo inicial **desglosado por medio de pago**  
3. Movimientos con tipos acotados + `source_type` / `source_id`  
4. Movimientos **automáticos** desde ventas POS  
5. Movimientos **manuales básicos**: ingreso, retiro, gasto  
6. Autorización de retiros / cierre con diferencia (rol o PIN admin)  
7. Regla offline explícita  

**Fuera de alcance (fases posteriores — no implementar en este MVP):**

- Cuenta corriente / cobros parciales  
- Notas de crédito / cambios / devoluciones como dominio propio  
- Conciliación de tarjetas / liquidaciones Posnet / comisiones  
- Transferencias entre cajas / caja→banco / caja→MP  
- Medios de pago “finos” (Visa crédito 3 cuotas, terminal, auth code)  
- Libro IVA exportable / reportes de contadora (ya existe contabilidad parcial; no ampliar aquí)  
- Multi-sucursal / multi-caja física real (MVP: una sesión activa por “puesto” lógico, default `Caja 01`)  
- Anulación de ventas / voids (hoy el POS no tiene voids; no mezclar)

---

## Decisiones ya tomadas

| ID | Decisión |
|---|---|
| D-MVP | Norte completo del sistema de caja es válido; **primer corte = MVP de arriba** |
| D-SEP | Caja ≠ cobro ≠ venta ≠ factura; no duplicar comprobantes fiscales |
| D-ARQ | Arqueo físico = **solo efectivo**; electrónicos se listan en resumen pero no se “cuentan en billetes” |
| D-PAY | Medios de caja MVP = los que ya usa la UI: `Efectivo`, `Débito/Crédito`, `Mercado Pago QR` (+ opcional `Transferencia` si se agrega en UI; **DECISIÓN PENDIENTE** menor) |
| D-SRC | Todo movimiento lleva `source_type` + `source_id` nullable |

---

# 1. Resumen de la feature

## Qué se quiere conseguir
Que cada jornada de POS opere dentro de una **sesión de caja** abierta: con fondo inicial desglosado, movimientos trazables (automáticos y manuales), arqueo de efectivo y cierre con diferencias registradas — sin reescribir facturación ARCA ni el carrito.

## Problema que resuelve
Hoy una venta guarda `medio_pago` en `pos_ventas` y listo. No hay apertura, no hay control de efectivo esperado vs contado, no hay retiros/gastos auditables, no hay vínculo “este efectivo entró por la venta #N”.

## Partes involucradas
- Backend POS (`pos`, nuevo módulo `caja`, auth roles)  
- Frontend caja (`Frontend/src/routes/index.tsx`, offline queue)  
- DB compartida (nueva migración en ecommerce)  
- **No** módulo fiscal ARCA (solo se relaciona: la venta sigue emitiendo CAE como hoy)

## Comportamiento actual (HECHO)

```
UI caja → POST /api/v1/pos/ventas { medio_pago, lineas, ... }
  → processSale → pos_ventas + pos_lineas_venta + stock + pos_iva_registro
  → maybeEmitirDespuesDeVenta (ARCA si está on)
  → respuesta { venta_id, total, fiscal? }
```

- `medio_pago` es `string` libre (`Backend/src/modules/pos/schemas.ts`).  
- UI fija tres botones: `Efectivo`, `Débito/Crédito`, `Mercado Pago QR` (`Frontend/src/routes/index.tsx`, F8/F9/F10).  
- Offline: cola en cliente (`Frontend/src/lib/offline-queue`) + `POST /pos/ventas/offline-batch`.  
- Auth: roles `caja` < `compras` < `admin`; JWT por PIN.  
- UI muestra texto fijo “Caja 01 · Omnicanal” — **no** hay entidad de sesión.  
- **No existen** tablas ni endpoints de apertura/cierre/movimientos/arqueo.

## Comportamiento deseado (MVP)

1. No se puede cobrar una venta online si no hay **sesión de caja abierta** (política offline: ver §9 / D-OFF).  
2. Al abrir: usuario, timestamp, puesto, desglose inicial por medio.  
3. Cada venta genera **un movimiento de ingreso** `type=venta` con `source_type=SALE`, `source_id=venta_id`, `payment_method=medio_pago`, `amount=total`.  
4. Retiros/gastos/ingresos manuales crean movimientos con `source_type=MANUAL`.  
5. Cierre: resumen esperado (apertura efectivo + ingresos efectivo − egresos efectivo), arqueo contado, diferencia persistida, sesión `cerrada`.  
6. Diferencias no modifican ventas.

---

# 2. Arquitectura actual relevante

## Stack (HECHO)
- Backend: Fastify + `pg` + Zod + Vitest  
- Frontend: TanStack Start / React Query  
- DB: Postgres compartida; POS verifica tablas en `Backend/src/db/verify-schema.ts`  
- Migraciones: `RadioColonia/app/src/db/migrations/*.sql`

## Flujo venta hoy

```
Frontend/src/routes/index.tsx  handlePay(method)
  → createSale / syncOfflineVentas (api-client + offline-queue)
  → Backend/src/modules/pos/routes.ts
  → processSale (pos/service.ts)
  → registerSaleInTransaction
  → maybeEmitirDespuesDeVenta (fiscal/service.ts)   // NO tocar en MVP caja
```

## Auth (HECHO)
- `Backend/src/middleware/auth.ts` — `requireAuth`, `requireRole`  
- `Backend/src/app.ts` — montaje de rutas por rol  
- Sesión JWT ≠ sesión de caja (homónimos; en el plan decir siempre **sesión de caja** / `cash_session`)

## Patrones a reutilizar
- Módulo por carpeta (`modules/pos`, `modules/fiscal`) → nuevo `modules/caja`  
- `AppError(code, message)`  
- Zod schemas por módulo  
- Transacciones `withTransaction` del POS  
- Dialogs Radix existentes en `Frontend/src/components/pos/`

---

# 3. Archivos involucrados

| Archivo | Tipo | Rol actual | Cambio necesario | Prioridad |
|---|---|---|---|---|
| `RadioColonia/app/src/db/migrations/00XX_pos_caja_mvp.sql` (**nuevo**, número siguiente al último) | migration | — | Crear tablas MVP | Crítica |
| `Backend/src/db/verify-schema.ts` | verify | Lista `REQUIRED_TABLES` | Agregar tablas caja | Alta |
| `Backend/src/modules/caja/**` (**nuevo**) | module | — | routes/service/repository/schemas/types | Crítica |
| `Backend/src/app.ts` | bootstrap | Monta módulos | Registrar `/api/v1/caja` con roles | Alta |
| `Backend/src/modules/pos/service.ts` | service | `processSale` | Tras insert venta, crear movimiento si hay sesión; rechazar si política lo exige | Crítica |
| `Backend/src/modules/pos/schemas.ts` | schema | venta | Opcional: `cash_session_id` en payload (o resolverlo server-side) | Media |
| `Backend/src/modules/pos/routes.ts` | routes | ventas | Sin cambio mayor; error codes nuevos | Baja |
| `Frontend/src/routes/index.tsx` | UI | Caja | Gate apertura; diálogos retiro/cierre; badge sesión | Crítica |
| `Frontend/src/lib/api-client.ts` | client | API | Endpoints caja | Alta |
| `Frontend/src/lib/offline-queue.ts` | offline | Cola ventas | Incluir `cash_session_id` / política sync | Alta |
| `Frontend/src/components/pos/*` (**nuevos**) | UI | — | `OpenRegisterDialog`, `CashMovementDialog`, `CloseRegisterDialog`, `CashSessionBanner` | Alta |
| `features/implementacion-caja.md` | docs | este plan | Ya creado | — |
| `Backend/src/modules/fiscal/**` | fiscal | ARCA | **NO modificar** | No tocar |
| `Backend/src/modules/compras/**` | compras | — | **NO modificar** | No tocar |

### Qué contiene / qué no tocar (detalle)

- **`pos/service.ts`:** solo enganchar post-venta (y validación pre-venta). No mover stock ni ARCA.  
- **`fiscal/*`:** la factura sigue igual; el movimiento de caja usa el total de la venta, no el CAE.  
- **UI “Caja 01”:** reemplazar hardcode por datos de sesión abierta.

---

# 4. Dependencias y flujo de datos

## Apertura

```
Usuario (rol ≥ caja)
  → POST /api/v1/caja/sesiones/abrir
  → valida: no hay otra sesión abierta para mismo puesto
  → INSERT pos_caja_sesiones (estado=abierta)
  → INSERT pos_caja_saldos_iniciales (N filas por medio)
  → (opcional) movimiento interno de “fondo” — RECOMENDACIÓN: NO crear movimiento; el saldo inicial vive en tabla propia
```

## Venta online

```
Usuario
  → GET sesión abierta (cache front)
  → POST /pos/ventas
  → processSale TX: venta + stock + iva
  → misma TX o inmediatamente después: INSERT pos_caja_movimientos
        type=venta, direction=ingreso,
        payment_method=medio_pago, amount=total,
        source_type=SALE, source_id=venta_id,
        cash_session_id=sesión abierta
  → maybeEmitirDespuesDeVenta (igual que hoy)
```

**RECOMENDACIÓN:** crear el movimiento **dentro de la misma transacción** que la venta (si falla el movimiento, rollback venta). Evita venta sin movimiento.

## Movimiento manual

```
POST /api/v1/caja/movimientos
  → auth: retiro/gasto pueden exigir rol admin o segundo factor PIN admin (D-AUTH)
  → INSERT movimiento source_type=MANUAL
  → auditoría simple (ver §6)
```

## Cierre

```
GET /api/v1/caja/sesiones/:id/resumen
  → calcula esperado efectivo
POST /api/v1/caja/sesiones/:id/cerrar
  → body: counted_cash, denominations?, reason?, observations?
  → INSERT pos_caja_diferencias si difference != 0
  → UPDATE sesión estado=cerrada, closed_at, closed_by
```

## Datos que fluyen
- **Transformación:** totales venta → amount movimiento (1:1 MVP; split multi-medio = fuera de alcance).  
- **Validación:** sesión abierta; montos > 0; medios en catálogo MVP; una sola sesión abierta por puesto.  
- **Persistencia:** tablas nuevas; no reescribir `pos_ventas.medio_pago`.

---

# 5. Cambios de base de datos

**Sí requiere DB.** Migración nueva en ecommerce (siguiente número libre tras `0015_*`).

## Tablas propuestas (RECOMENDACIÓN de nombres — alinear a prefijo `pos_`)

### `pos_caja_sesiones`
| Columna | Tipo | Notas |
|---|---|---|
| id | SERIAL PK | |
| puesto | VARCHAR(64) NOT NULL | default `'Caja 01'` |
| estado | VARCHAR(16) NOT NULL | `abierta` \| `cerrada` \| `cancelada` |
| opened_at | TIMESTAMPTZ NOT NULL | |
| opened_by | VARCHAR(64) NOT NULL | sub JWT / label |
| closed_at | TIMESTAMPTZ | |
| closed_by | VARCHAR(64) | |
| notes | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

Índice único parcial: **una sola `abierta` por `puesto`**.

### `pos_caja_saldos_iniciales`
| Columna | Tipo |
|---|---|
| id | SERIAL PK |
| sesion_id | FK → pos_caja_sesiones ON DELETE CASCADE |
| payment_method | VARCHAR(64) NOT NULL |
| amount | NUMERIC(14,2) NOT NULL DEFAULT 0 |
| UNIQUE(sesion_id, payment_method) | |

### `pos_caja_movimientos`
| Columna | Tipo | Notas |
|---|---|---|
| id | SERIAL PK | |
| sesion_id | FK | |
| occurred_at | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| tipo | VARCHAR(32) NOT NULL | ver enum MVP abajo |
| direccion | VARCHAR(8) NOT NULL | `ingreso` \| `egreso` |
| amount | NUMERIC(14,2) NOT NULL CHECK (amount > 0) | |
| payment_method | VARCHAR(64) NOT NULL | |
| description | TEXT | |
| source_type | VARCHAR(32) NOT NULL | `SALE` \| `MANUAL` \| `SYSTEM` |
| source_id | INTEGER NULL | venta_id si SALE |
| created_by | VARCHAR(64) NOT NULL | |
| estado | VARCHAR(16) NOT NULL DEFAULT `activo` | `activo` \| `anulado` |
| anulado_at / anulado_by / anulado_motivo | | soft-cancel |
| created_at | TIMESTAMPTZ | |

Índices: `(sesion_id, occurred_at)`, `(source_type, source_id)`, único parcial opcional `(source_type, source_id) WHERE source_type='SALE' AND estado='activo'` para **idempotencia** venta→movimiento.

### `pos_caja_cierres` (o columnas en sesión + tabla diferencias)
MVP puede guardar en sesión + tabla diferencias:

### `pos_caja_diferencias`
| Columna | Tipo |
|---|---|
| id | SERIAL PK |
| sesion_id | FK UNIQUE | |
| expected_cash | NUMERIC(14,2) NOT NULL | |
| counted_cash | NUMERIC(14,2) NOT NULL | |
| difference | NUMERIC(14,2) NOT NULL | |
| categoria | VARCHAR(32) | `faltante` \| `sobrante` \| `error_carga` \| `otro` (MVP reducido) |
| observations | TEXT | |
| approved_by | VARCHAR(64) | si difference != 0 |
| created_at | TIMESTAMPTZ | |

### Enum tipos movimiento MVP (CHECK o app-level)

**Ingresos:** `venta`, `ingreso_manual`  
**Egresos:** `retiro`, `gasto`  

Nada más en MVP.

### Compatibilidad
- No altera `pos_ventas` salvo FK opcional `caja_sesion_id` (**RECOMENDACIÓN:** agregar columna nullable `caja_sesion_id` en `pos_ventas` para reporting; si se quiere mínimo churn, omitir y resolver solo vía `source_id` inverso).  
- **DECISIÓN PENDIENTE D-FK:** ¿columna `caja_sesion_id` en `pos_ventas`? Recomendado: **sí** (nullable para ventas históricas).

### Datos existentes
- Ventas pasadas quedan sin movimiento (OK).  
- No backfill obligatorio en MVP.

---

# 6. Backend

## Nuevo módulo `Backend/src/modules/caja/`

### Endpoints MVP

| Método | Ruta | Rol mín. | Descripción |
|---|---|---|---|
| GET | `/api/v1/caja/sesiones/actual?puesto=` | caja | Sesión abierta o 404 |
| POST | `/api/v1/caja/sesiones/abrir` | caja | Abre sesión + saldos iniciales |
| GET | `/api/v1/caja/sesiones/:id` | caja | Detalle |
| GET | `/api/v1/caja/sesiones/:id/movimientos` | caja | Listado paginado |
| GET | `/api/v1/caja/sesiones/:id/resumen` | caja | Totales por medio + esperado efectivo |
| POST | `/api/v1/caja/movimientos` | caja / admin según tipo | Manual |
| POST | `/api/v1/caja/sesiones/:id/cerrar` | caja (+ admin si diff≠0) | Arqueo + cierre |
| POST | `/api/v1/caja/movimientos/:id/anular` | admin | Soft-cancel manual (no ventas) |

### Request/response (contratos conceptuales)

**Abrir**
- In: `{ puesto?, saldos: [{ payment_method, amount }], notes? }`  
- Out: `{ sesion, saldos }`  
- Validar: suma amounts ≥ 0; methods ∈ catálogo MVP; no otra abierta.

**Movimiento manual**
- In: `{ tipo, amount, payment_method, description? }`  
- Out: movimiento  
- `retiro`/`gasto`: **DECISIÓN D-AUTH** — exigir `admin` o body `{ admin_pin }` verificado contra `POS_ADMIN_PIN`.

**Cerrar**
- In: `{ counted_cash, categoria?, observations?, admin_pin? }`  
- Server calcula `expected_cash`  
- Si `|difference| > 0` (o > umbral): exigir autorización admin  
- Out: `{ sesion, diferencia }`

### Integración `processSale`
1. Resolver sesión abierta para puesto default (o header/body).  
2. Si no hay sesión y `POS_CAJA_REQUIRE_SESSION=true` (env nueva, default `true` en prod / **DECISIÓN**): `409 CAJA_SIN_SESION`.  
3. Insert movimiento SALE idempotente por `venta_id`.  
4. Offline batch: al sincronizar, asociar a sesión **abierta al momento del sync** o a `caja_sesion_id` enviado por el cliente — ver D-OFF.

### Errores
- `CAJA_SIN_SESION`  
- `CAJA_YA_ABIERTA`  
- `CAJA_YA_CERRADA`  
- `CAJA_DIFF_REQUIERE_ADMIN`  
- `CAJA_MOVIMIENTO_ANULADO`  
- `CAJA_TIPO_INVALIDO`

### Concurrencia
- Unique parcial sesión abierta por puesto.  
- Unique venta→movimiento activo.  
- Cerrar: `UPDATE ... WHERE estado='abierta'` y chequear rowcount.

### Logging
- Logger Fastify en abrir/cerrar/anular/retiro; no loguear PINs.

### Compatibilidad
- Con `POS_CAJA_REQUIRE_SESSION=false` (dev escape hatch) el POS viejo sigue vendiendo sin caja — útil para no romper demos. Default recomendado: `true` cuando el módulo está deployado.

---

# 7. Frontend

## Pantalla caja (`routes/index.tsx`)
1. Al montar: `GET /caja/sesiones/actual`.  
2. Si no hay sesión: bloquear cobro; modal **Abrir caja** (desglose inicial; efectivo obligatorio de foco, otros medios default 0).  
3. Banner: puesto, abierta desde, usuario, botón Retiro / Cerrar.  
4. Tras venta OK: no hace falta UI extra si el backend creó el movimiento; opcional toast “registrado en caja”.  
5. Diálogo **Retiro/Gasto/Ingreso**: monto, medio (default Efectivo), descripción; retiro pide PIN admin si D-AUTH.  
6. Diálogo **Cerrar**: muestra resumen esperado efectivo + ingresos/egresos; input contado; si diff ≠ 0, motivo + PIN admin.

## Componentes nuevos (patrón Dialog existente)
- `OpenRegisterDialog.tsx`  
- `CashMovementDialog.tsx`  
- `CloseRegisterDialog.tsx`  
- `CashSessionBanner.tsx`

## Estados UI
- Loading sesión  
- Empty: sin sesión  
- Error: sin permiso / red  
- Offline: ver D-OFF — mostrar aviso “caja offline: las ventas se encolan; movimientos de caja se aplican al sync”  

## No hacer
- No nueva arquitectura de routing compleja; rutas bajo `/` o `/caja/cierre` solo si hace falta resumen largo (MVP puede ser 100% dialogs en index).

## Responsive / a11y
- Misma caja mobile (`MobileStep`); apertura/cierre usables en coarse pointer.

---

# 8. Tipos, contratos y API

## Nuevos tipos TS (backend + api-client)
- `CashSession`, `CashOpeningBalance`, `CashMovement`, `CashSummary`, `CashDifference`  
- Unions: `CashMovementTipo`, `CashDirection`, `CashSourceType`, `CashSessionEstado`

## Cambios a contratos existentes
- `CreateSaleResult`: opcional `caja_movimiento_id`  
- `CreateSalePayload`: opcional `caja_sesion_id` / `puesto`  
- **No romper** `medio_pago: string` — seguir aceptando los tres strings actuales

## Consumidores
- Solo Frontend POS.  
- Scripts con `API_TOKEN` (admin) pueden abrir/cerrar — documentar.

---

# 9. Casos borde y posibles problemas

| Caso | Manejo MVP |
|---|---|
| Venta sin sesión | 409 `CAJA_SIN_SESION` (si require on) |
| Doble apertura | 409 `CAJA_YA_ABIERTA` |
| Doble click venta | `client_sale_id` + unique movimiento SALE |
| Venta ARCA error | Caja igual registra cobro (plata entró); fiscal independiente |
| Offline sin sesión | **D-OFF** |
| Sync offline después de cierre | Asociar a sesión abierta *ahora* o rechazar lote — debe decidirse |
| Retiro mayor al efectivo esperado | Permitir con warning o bloquear — **DECISIÓN D-RETIRO**; recomendación: permitir + warning (faltante aparecerá al cierre) |
| Anular movimiento de venta | Prohibido; solo admin anula MANUAL |
| Diff = 0 | Cierre sin approved_by |
| Diff ≠ 0 sin admin | 403 |
| Reinicio server mid-sesión | Sesión sigue en DB |
| Cambio de puesto | MVP un puesto; ignorar multi |

### D-OFF — Offline (DECISIÓN PENDIENTE, crítica)

Alternativas:

- **A (recomendada MVP):** Exigir sesión abierta **antes** de operar; en offline, permitir encolar ventas solo si el cliente cacheó `caja_sesion_id` de una sesión ya abierta; al sync, crear movimientos contra esa sesión si sigue `abierta`, si está `cerrada` → movimientos quedan en cola de excepción / admin reasigna (complejo).  
- **B:** En offline no exigir caja; al sync, si hay sesión abierta, generar movimientos; si no, ventas quedan sin movimiento (deuda).  
- **C:** Bloquear offline hasta tener caja online (duro para el local).

Marcar D-OFF antes de codear el front offline.

---

# 10. Regresiones potenciales

| Funcionalidad | Riesgo | Archivos | Verificar |
|---|---|---|---|
| Venta online | Alto | `pos/service.ts` | Stock, total, fiscal igual con require session off |
| Offline batch | Alto | `processOfflineBatch`, offline-queue | Sync no duplica movimientos |
| ARCA | Medio | solo orden post-venta | CAE sigue saliendo |
| Auth roles | Medio | `app.ts` | caja puede abrir; admin cierra con diff |
| Performance listado | Bajo | índices sesión | |

---

# 11. Tests

### Unit
- Cálculo `expected_cash` = inicial efectivo + ingresos efectivo − egresos efectivo (solo movimientos `activo`)  
- Mapeo tipo → dirección  
- Validación catálogo medios  

### Integration
- Abrir → vender Efectivo → resumen esperado  
- Vender sin sesión → 409  
- Idempotencia: misma venta no crea 2 movimientos  
- Cerrar con diff exige admin  
- Anular manual no borra fila  

### API
- Happy paths endpoints tabla §6  
- Roles: caja no anula; admin sí  

### E2E
- Manual: abrir, 3 ventas (uno por medio), retiro, cerrar con faltante  

### Manual
- Coolify/staging con migración aplicada  
- Offline según D-OFF  

---

# 12. Orden exacto de implementación

1. **Migración `00XX_pos_caja_mvp.sql`** en RadioColonia + deploy migrador  
   - Criterio: tablas existen; unique sesión abierta OK  
2. **`verify-schema.ts`** agrega tablas  
   - Criterio: `db:verify` OK  
3. **Módulo caja** repository + service + schemas (sin UI)  
   - Criterio: tests unitarios cálculo resumen  
4. **Routes `/caja`** + registro en `app.ts`  
   - Criterio: smoke API con JWT  
5. **Enganche `processSale`** + env `POS_CAJA_REQUIRE_SESSION`  
   - Criterio: venta crea movimiento; flag false no bloquea  
6. **api-client** tipos + métodos  
7. **UI: banner + OpenRegisterDialog** + gate cobro  
8. **UI: movimientos manuales**  
9. **UI: CloseRegisterDialog + diferencias**  
10. **Offline según D-OFF**  
11. **Tests integration + checklist manual**  

Cada paso: no romper ventas con flag require=false hasta que UI de apertura esté lista.

---

# 13. Estrategia específica para Cursor

## Leer PRIMERO
1. `Backend/src/modules/pos/service.ts` / `schemas.ts` / `routes.ts`  
2. `Backend/src/app.ts` + `middleware/auth.ts`  
3. `Frontend/src/routes/index.tsx` (handlePay) + `lib/offline-queue.ts` + `lib/api-client.ts`  
4. `Backend/src/db/verify-schema.ts`  
5. Últimas migraciones en `RadioColonia/app/src/db/migrations/`  
6. Este archivo `features/implementacion-caja.md`  

## Leer DESPUÉS
- `components/pos/FiscalResultDialog.tsx` solo como patrón Dialog (no copiar lógica fiscal)  
- Tests Vitest en `compras/importacion/*.test.ts` como patrón  

## Copiar patrones
- Módulo `fiscal` (carpeta routes/service/repository/types) como esqueleto estructural  
- `AppError`, Zod, `withTransaction`  

## NO reinventar
- No nuevo motor de pagos  
- No duplicar IVA/factura en tablas de caja  
- No multi-caja real en MVP  

## NO modificar
- `modules/fiscal/**`, `modules/compras/**`, parsers PDF  

## Decisiones que Cursor NO debe tomar solo
- D-OFF (offline)  
- D-AUTH (PIN admin en retiro/cierre)  
- D-FK (`caja_sesion_id` en `pos_ventas`)  
- D-RETIRO (bloquear retiro > esperado)  
- Agregar medios nuevos más allá de los 3 UI  

## Comandos
- Tras migración: verify en POS  
- `cd Backend && npm test`  
- Smoke: abrir → venta → resumen → cerrar  

## Batch
- Migración + verify juntos  
- Backend módulo + enganche venta juntos  
- UI dialogs en PR separado o mismo PR si chico  

---

# 14. Riesgos técnicos

### 🔴 Alto
- Offline vs sesión (datos huérfanos o bloqueo de local) — mitigar: cerrar D-OFF antes de codear.  
- Exigir sesión antes de tener UI de apertura en prod — mitigar: feature flag `POS_CAJA_REQUIRE_SESSION`.  
- Migración no aplicada — mitigar: verify + docs deploy.  

### 🟡 Medio
- Doble movimiento por race en offline sync — unique SALE.  
- Confusión JWT “sesión” vs caja — naming claro en API (`/caja/sesiones`).  
- Retiros sin control — D-AUTH.  

### 🟢 Bajo
- Texto hardcode “Caja 01” — se reemplaza.  
- Analytics `facturacion-dia` sigue siendo ventas, no caja — OK MVP.  

---

# 15. Decisiones que deben definirse ANTES de programar

| ID | Tema | Alternativas | Recomendación |
|---|---|---|---|
| D-OFF | Offline | A/B/C en §9 | A atenuada o B documentada |
| D-AUTH | Retiro / cierre con diff | Solo rol admin vs PIN admin en body | PIN admin en body (caja sigue logueada como caja) |
| D-FK | `caja_sesion_id` en `pos_ventas` | Sí / No | Sí, nullable |
| D-RETIRO | Retiro > efectivo esperado | Bloquear / permitir+warn | Permitir+warn |
| D-MEDIO | ¿Agregar Transferencia al MVP UI? | Sí / No | No (solo 3 actuales) salvo que Franco lo pida |
| D-DENOM | Arqueo por denominaciones de billetes | Sí / solo monto total | Solo monto total en MVP; denominaciones fase 2 |

---

# 16. Criterios de aceptación

- [ ] Se puede abrir una sesión con desglose inicial por medio (al menos Efectivo).  
- [ ] No hay dos sesiones `abierta` para el mismo puesto.  
- [ ] Con require session on, venta sin sesión → error claro; no descuenta stock.  
- [ ] Cada venta online genera exactamente un movimiento `venta` con `source_type=SALE` y `source_id=venta_id`.  
- [ ] Reintento/idempotencia no duplica movimiento de la misma venta.  
- [ ] Ingreso/retiro/gasto manual quedan registrados con usuario y descripción.  
- [ ] Retiro respeta D-AUTH.  
- [ ] Resumen de cierre calcula esperado de **efectivo** correctamente.  
- [ ] Cierre persiste contado, diferencia y categoría si aplica.  
- [ ] Diff ≠ 0 no altera `pos_ventas`.  
- [ ] ARCA/fiscal sigue comportándose igual.  
- [ ] Compras PDF no regresionan.  
- [ ] `db:verify` incluye nuevas tablas.  
- [ ] Flag `POS_CAJA_REQUIRE_SESSION=false` permite vender sin caja (escape).  
- [ ] Offline cumple la política D-OFF documentada.  

---

# 17. Checklist final para Cursor

## Antes de modificar código
- [ ] Leer §13  
- [ ] Confirmar D-OFF, D-AUTH, D-FK  
- [ ] No implementar CC/NC/conciliación tarjetas  

## Database
- [ ] Migración en RadioColonia  
- [ ] verify-schema POS  

## Backend
- [ ] Módulo caja  
- [ ] Enganche processSale  
- [ ] Env flag require session  
- [ ] Tests  

## Frontend
- [ ] Gate + abrir  
- [ ] Manuales  
- [ ] Cerrar + diff  
- [ ] Offline según D-OFF  

## Tests / verificación
- [ ] Unit + integration  
- [ ] Manual abrir→vender→retirar→cerrar  
- [ ] Fiscal smoke  
- [ ] Compras smoke  

---

# 18. Resumen ejecutivo

| Ítem | Detalle |
|---|---|
| Archivos nuevos | `modules/caja/**`, dialogs POS, migración `00XX_pos_caja_mvp.sql` |
| Archivos que cambian | `pos/service.ts`, `app.ts`, `verify-schema.ts`, `index.tsx`, `api-client.ts`, `offline-queue.ts` |
| No tocar | fiscal, compras |
| Migraciones | 1 nueva en ecommerce |
| Endpoints | `/api/v1/caja/*` + side-effect en `POST /pos/ventas` |
| Riesgos | Offline, flag de require, migración |
| Decisiones abiertas | D-OFF, D-AUTH, D-FK, D-RETIRO, D-MEDIO, D-DENOM |
| Orden | DB → backend caja → enganche venta → UI → offline → tests |

## Fuera de alcance / mejoras futuras
- Denominaciones de billetes en arqueo  
- Multi-medio por una venta (split payment)  
- CC, NC, cambios, conciliación tarjetas, transferencias internas  
- Reportes gerenciales ricos del “norte” completo  
- Auditoría genérica append-only de todo el POS (MVP: campos created_by + anulación)

---

## Ambigüedades residuales
1. Política offline (D-OFF) — **bloquear implementación front offline hasta decidir**.  
2. Puesto único vs varios — MVP asume `Caja 01`.  
3. Umbral de diferencia que exige admin (¿cualquier centavo o tolerancia?) — default: cualquier `difference !== 0`.
