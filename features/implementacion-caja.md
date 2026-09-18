# Plan de implementación: Control de caja — MVP

**Repo objetivo:** `Fran55sh/radio-colonia-pos`  
**Repo schema DB (migraciones):** `Fran55sh/RadioColonia` (migrador ecommerce, misma DB)  
**Feature slug:** `implementacion-caja`  
**Archivo en repo:** `features/implementacion-caja.md`  
**Fecha del análisis:** 2026-09-17  
**Última actualización decisiones:** 2026-09-17  
**Modo:** solo análisis / plan — sin código de implementación en este documento  

---

## Alcance MVP (acordado)

Incluye **solo**:

1. Sesión de caja **server-side**: apertura → movimientos → arqueo de **efectivo** → cierre → diferencias  
2. Saldo inicial **desglosado por medio de pago**  
3. Movimientos con tipos acotados + `source_type` / `source_id`  
4. Movimientos **automáticos** desde ventas POS (misma TX que la venta)  
5. Movimientos **manuales básicos**: ingreso, retiro, gasto  
6. Autorización de retiros / cierre con diferencia vía **PIN admin en body**  
7. **1 sesión abierta por puesto / N dispositivos** venden contra esa sesión  
8. Reglas offline A2 (ver decisiones)

**Fuera de alcance (fases posteriores):**

- Cuenta corriente / cobros parciales  
- Notas de crédito / cambios / devoluciones como dominio propio  
- Conciliación de tarjetas / Posnet / comisiones  
- Transferencias entre cajas / caja→banco / caja→MP  
- Medios de pago “finos” (marca, cuotas, terminal, auth)  
- Libro IVA exportable / reportes de contadora ampliados  
- Multi-puesto / multi-gaveta real (varios `puesto` con efectivo separado)  
- Cola de “ventas pendientes de aprobación” por PC principal (**no MVP**)  
- Sesión provisional 100% local sin server  
- Anulación de ventas / voids  

---

## Decisiones RESUELTAS (trabadas)

| ID | Decisión |
|---|---|
| D-MVP | Primer corte = MVP de arriba; norte completo queda para fases |
| D-SEP | Caja ≠ cobro ≠ venta ≠ factura; no duplicar comprobantes fiscales |
| D-ARQ | Arqueo físico = **solo efectivo** |
| D-PAY | Medios MVP = UI actual: `Efectivo`, `Débito/Crédito`, `Mercado Pago QR` |
| D-SRC | Todo movimiento: `source_type` + `source_id` nullable |
| D-TX | Movimiento `SALE` se inserta en la **misma transacción** que `registerSaleInTransaction`; ARCA sigue **fuera** del commit |
| D-AUTH | JWT para operar; **PIN admin en body** para retiro y para cierre con `difference !== 0`. No hay `user_id` real (`JWT.sub` = `"pos"`): auditoría con `role` / `actor_label` |
| D-OFF | **A2:** no vender sin `caja_sesion_id` de una sesión abierta en server (obtenida online al menos una vez en ese browser). Offline encola con ese id congelado. Sync siempre contra ese id (no “sesión actual”). **No cerrar** si hay cola offline pendiente en el dispositivo. Sin sesión provisional local |
| D-MULTI | **1 sesión server / N dispositivos.** PC principal (o quien tenga UI) abre/cierra/retiros. Satélites (2ª PC, cel) solo venden/facturan contra `GET /caja/sesiones/actual`. Sin hub de aprobación en MVP |
| D-FK | Sí: columna nullable `caja_sesion_id` en `pos_ventas` |
| D-RETIRO | Permitir retiro > efectivo esperado + warning (el faltante aparece al cierre) |
| D-DENOM | Arqueo MVP = monto total contado; sin denominaciones de billetes |
| D-FLAG | `POS_CAJA_REQUIRE_SESSION`: `false` al deployar backend sin UI; `true` cuando el front ya gatea cobro |

### Tradeoff D-OFF (explícito)

- **Gana:** nada de ventas huérfanas, nada de plata del día A en caja B, nada de cajas fantasma por browser, retiros/cierres siempre online.  
- **Pierde:** un dispositivo que **nunca** habló con el server ese día no puede vender offline hasta abrir/adjuntar sesión online. Sin red al arrancar en ese browser = no opera. (Un cel con 5G es otro cliente: puede abrir/usar la sesión server si tiene red; no hereda el `localStorage` de la PC.)

### Tradeoff D-MULTI (explícito)

- Facturación multi-dispositivo **ya existe** hoy (cualquier JWT puede `POST /pos/ventas` + ARCA).  
- Control de caja pasa a ser **uno**: una gaveta / un cierre / una sesión.  
- No se implementa “enviar venta a la PC principal para aprobar”.

---

# 1. Resumen de la feature

## Qué se quiere conseguir
Operar la jornada dentro de una **sesión de caja server-side** compartida por todos los dispositivos del puesto: fondo inicial desglosado, movimientos trazables, arqueo de efectivo y cierre con diferencias — sin reescribir ARCA ni el carrito, y sin cola de aprobación.

## Problema que resuelve
Hoy solo existe `medio_pago` en `pos_ventas`. No hay apertura, control de efectivo, retiros auditables ni vínculo venta→movimiento de caja. Con 2 PCs + cel, sin sesión compartida cada browser inventaría su realidad.

## Partes involucradas
- Backend: `pos`, nuevo `caja`, auth  
- Frontend: caja, offline-queue, dialogs  
- DB compartida (migración ecommerce)  
- Fiscal ARCA: sin cambios de contrato; solo orden relativo (sigue post-commit)

## Comportamiento actual (HECHO)

```
UI → POST /api/v1/pos/ventas
  → processSale → TX (stock + venta + iva)
  → maybeEmitirDespuesDeVenta (fuera de TX)
```

- `medio_pago` string libre; UI: Efectivo / Débito/Crédito / Mercado Pago QR.  
- Offline: `localStorage` por browser + `offline-batch`.  
- Auth: PIN → JWT roles `caja|compras|admin`; `/pos` no exige rol extra.  
- No hay tablas/endpoints de sesión de caja.  
- Multi-dispositivo: todos pueden vender al server; colas offline aisladas.

## Comportamiento deseado (MVP)

1. Existe a lo sumo **una** sesión `abierta` por `puesto` (default `Caja 01`).  
2. Dispositivos satélite leen esa sesión y venden contra ella.  
3. Toda venta (online o sync offline) genera **un** movimiento `SALE` idempotente en la misma TX.  
4. Retiros/gastos/ingresos manuales según D-AUTH.  
5. Cierre con arqueo efectivo + diferencia; no muta ventas.  
6. Offline solo si el browser ya tiene `caja_sesion_id` válido cacheado.

---

# 2. Arquitectura actual relevante

## Stack (HECHO)
Fastify + `pg` + Zod + Vitest; TanStack Start; Postgres compartida; migraciones en `RadioColonia/app/src/db/migrations/`.

## Flujo venta hoy
`Frontend/src/routes/index.tsx` `handlePay` → `api-client` / `offline-queue` → `pos/routes.ts` → `processSale` → `registerSaleInTransaction` → `maybeEmitirDespuesDeVenta`.

## Auth (HECHO)
`middleware/auth.ts`: `requireAuth`, `requireRole`.  
`auth/service.ts`: `resolveRoleForPin`, `POS_ADMIN_PIN`. **No** hay revalidación de PIN mid-session hoy → el MVP agrega `assertAdminPin(pin)` reutilizando el mismo comparador.

## Patrones a reutilizar
Módulos por carpeta (`fiscal` como esqueleto), `AppError`, Zod, `withTransaction`, Dialogs en `components/pos/`.

---

# 3. Archivos involucrados

| Archivo | Tipo | Rol actual | Cambio necesario | Prioridad |
|---|---|---|---|---|
| `RadioColonia/.../migrations/00XX_pos_caja_mvp.sql` | migration | — | Tablas MVP + `pos_ventas.caja_sesion_id` | Crítica |
| `Backend/src/db/verify-schema.ts` | verify | REQUIRED_TABLES | Incluir tablas caja | Alta |
| `Backend/src/modules/caja/**` | module nuevo | — | routes/service/repository/schemas | Crítica |
| `Backend/src/app.ts` | bootstrap | monta APIs | `/api/v1/caja` + `requireRole("caja")` | Alta |
| `Backend/src/modules/pos/service.ts` | service | processSale | Sesión + movimiento en TX; pasar auth context | Crítica |
| `Backend/src/modules/pos/schemas.ts` | schema | venta | `caja_sesion_id` opcional en payload | Media |
| `Backend/src/modules/pos/routes.ts` | routes | ventas | Pasar `request.authContext` al service | Media |
| `Backend/src/modules/auth/service.ts` | auth | PINs | Exportar helper `assertAdminPin` | Alta |
| `Frontend/src/routes/index.tsx` | UI | caja | Gate sesión; banner; ocultar abrir/cerrar en satélite | Crítica |
| `Frontend/src/lib/api-client.ts` | client | API | Endpoints caja | Alta |
| `Frontend/src/lib/offline-queue.ts` | offline | cola | Persistir `caja_sesion_id`; bloquear enqueue sin id | Crítica |
| `Frontend/src/components/pos/OpenRegisterDialog.tsx` etc. | UI nuevos | — | Abrir / movimiento / cierre / banner | Alta |
| `Backend/src/modules/fiscal/**` | — | ARCA | **NO tocar** | No tocar |
| `Backend/src/modules/compras/**` | — | — | **NO tocar** | No tocar |

---

# 4. Dependencias y flujo de datos

## 4.1 Arranque (online) — PC principal

```
Login PIN caja/admin
  → GET /caja/sesiones/actual?puesto=Caja%2001
  → si 404: OpenRegisterDialog → POST /caja/sesiones/abrir { saldos[] }
  → cachear caja_sesion_id (sessionStorage + memoria)
  → UI full: vender + retiro + cerrar
```

## 4.2 Arranque (online) — satélite (2ª PC / cel)

```
Login PIN caja
  → GET /caja/sesiones/actual
  → si 404: mensaje “La caja no está abierta en el puesto” (no abrir desde satélite, o permitir abrir solo si flag/rol — RECOMENDACIÓN MVP: solo UI principal muestra Abrir; satélite espera)
  → si 200: cachear mismo caja_sesion_id
  → UI: solo vender (+ tal vez ver resumen read-only)
```

**DECISIÓN UI satélite:** ocultar Abrir / Cerrar / Retiro en clientes marcados como satélite (`localStorage` `pos-caja-modo=satelite` o query `?modo=satelite`) — simple, sin rol nuevo en MVP. Alternativa: rol `vendedor` (fase 1.1).

## 4.3 Venta ONLINE

```
handlePay(method)
  → require caja_sesion_id en front
  → POST /pos/ventas { ..., caja_sesion_id? }
  → processSale:
       resolve sesión abierta (body id o puesto)
       si POS_CAJA_REQUIRE_SESSION && !sesión → 409 CAJA_SIN_SESION (antes de stock)
       withTransaction:
         registerSaleInTransaction
         INSERT movimiento SALE idempotente
       maybeEmitirDespuesDeVenta  // fuera
```

## 4.4 Venta OFFLINE

```
Sin red / fetch fail
  → si !caja_sesion_id cacheado → BLOQUEAR (no enqueue)
  → enqueue { client_sale_id, medio_pago, lineas, caja_sesion_id, queued_at } sin cliente_id
  → clear cart
```

Retiro / cierre / abrir: **solo online**.

## 4.5 Sync offline → online

```
POST /pos/ventas/offline-batch
  cada ítem trae caja_sesion_id de la cola
  processSale usa ESE id (aunque la sesión ya esté cerrada: insertar movimiento histórico + flag/alerta post_cierre)
  unique SALE evita duplicados
```

Operativa: **no cerrar** en el principal mientras algún dispositivo del puesto tenga cola > 0 (al menos: no cerrar en el browser que tiene cola; documentar “sincronizar todos los dispositivos antes de cerrar”).

## 4.6 Retiro

```
POST /caja/movimientos { tipo: retiro, amount, payment_method, description?, admin_pin }
  JWT rol ≥ caja
  assertAdminPin(admin_pin)
  INSERT MANUAL
```

## 4.7 Cierre

```
pendingOffline > 0 → UI bloquea
GET resumen → expected_cash
POST cerrar { counted_cash, categoria?, observations?, admin_pin? }
  si difference !== 0 → require admin_pin
  INSERT diferencia; sesión = cerrada
```

---

# 5. Cambios de base de datos

Migración nueva en ecommerce (siguiente `00XX_pos_caja_mvp.sql`).

### `pos_caja_sesiones`
- `id`, `puesto` (default `Caja 01`), `estado` (`abierta|cerrada|cancelada`)  
- `opened_at`, `opened_by_label`, `closed_at`, `closed_by_label`, `notes`  
- Unique parcial: una `abierta` por `puesto`

### `pos_caja_saldos_iniciales`
- `sesion_id`, `payment_method`, `amount`, UNIQUE(sesion_id, payment_method)

### `pos_caja_movimientos`
- `sesion_id`, `occurred_at`, `tipo` (`venta|ingreso_manual|retiro|gasto`), `direccion` (`ingreso|egreso`)  
- `amount > 0`, `payment_method`, `description`  
- `source_type` (`SALE|MANUAL|SYSTEM`), `source_id`  
- `created_by_label`, `approved_by_label` nullable  
- `estado` (`activo|anulado`), campos anulación  
- Unique parcial: `(source_type, source_id) WHERE source_type='SALE' AND estado='activo'`  
- Índice `(sesion_id, occurred_at)`  
- Flag opcional `post_cierre_offline boolean default false`

### `pos_caja_diferencias`
- `sesion_id` UNIQUE, `expected_cash`, `counted_cash`, `difference`, `categoria`, `observations`, `approved_by_label`

### `pos_ventas`
- `caja_sesion_id INTEGER NULL REFERENCES pos_caja_sesiones(id)`

Sin backfill obligatorio.

---

# 6. Backend

## Endpoints `/api/v1/caja` (`requireRole("caja")`)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/sesiones/actual?puesto=` | 200 sesión abierta o 404 |
| POST | `/sesiones/abrir` | Falla si ya hay abierta |
| GET | `/sesiones/:id` | Detalle |
| GET | `/sesiones/:id/movimientos` | Paginado |
| GET | `/sesiones/:id/resumen` | Totales + expected_cash |
| POST | `/movimientos` | Manual; retiro exige `admin_pin` |
| POST | `/sesiones/:id/cerrar` | Diff≠0 exige `admin_pin`; rechazar si política server-side de cola (opcional) |
| POST | `/movimientos/:id/anular` | `requireRole("admin")`; solo MANUAL |

## `processSale` (detalle)

1. Recibir `authContext` + `caja_sesion_id` opcional.  
2. Resolver sesión: id del body o única abierta del puesto.  
3. Si require on y no hay → `CAJA_SIN_SESION`.  
4. Si id apunta a sesión `cerrada` y request **no** es offline-sync → error `CAJA_YA_CERRADA`.  
5. Si offline-sync (`sincronizada_offline`) y sesión cerrada → permitir movimiento con `post_cierre_offline=true` + log warn.  
6. TX: venta + movimiento.  
7. Fiscal afuera.  
8. En `DUPLICATE_OFFLINE_SALE`: ensure movimiento existe (idempotent upsert).

## Env
- `POS_CAJA_REQUIRE_SESSION` (`true`/`false`)  
- Reusar `POS_ADMIN_PIN`

## Errores
`CAJA_SIN_SESION`, `CAJA_YA_ABIERTA`, `CAJA_YA_CERRADA`, `CAJA_DIFF_REQUIERE_ADMIN`, `CAJA_RETIRO_REQUIERE_ADMIN`, `CAJA_PIN_INVALIDO`, `CAJA_TIPO_INVALIDO`

---

# 7. Frontend

## Principal vs satélite
- Setting local `pos-caja-modo`: `principal` | `satelite` (default principal en primera PC; satélite en las otras).  
- Satélite: sin botones Abrir/Cerrar/Retiro; sí banner “Sesión #… abierta”.  
- Principal: UI completa.

## Gate cobro
- Sin `caja_sesion_id` y sin sesión actual fetchable → bloquear F8/F9/F10.  
- Offline sin id cacheado → mensaje explícito.

## Componentes
`OpenRegisterDialog`, `CashMovementDialog`, `CloseRegisterDialog`, `CashSessionBanner`.

## Cierre
Bloquear si `loadOfflineQueue().length > 0`. Texto: sincronizar este dispositivo (y avisar de otros).

## Offline queue
Campo obligatorio `caja_sesion_id` en `QueuedSale`.

---

# 8. Tipos, contratos y API

- Tipos: `CashSession`, `CashOpeningBalance`, `CashMovement`, `CashSummary`, `CashDifference`.  
- `CreateSalePayload.caja_sesion_id?: number`.  
- `CreateSaleResult.caja_movimiento_id?: number`.  
- `medio_pago` string sin breaking change.  
- Body retiro/cierre: `admin_pin?: string`.

---

# 9. Casos borde

| Caso | Manejo |
|---|---|
| Satélite sin sesión abierta | UI espera; no inventa sesión |
| Cel 5G | Usa sesión server si hay red; storage propio |
| Offline sin id | Bloqueo |
| Sync con sesión cerrada | Movimiento `post_cierre_offline` + alerta |
| Cerrar con cola > 0 | UI bloquea |
| Doble venta client_sale_id | 409 + ensure movimiento |
| Retiro > esperado | Allow + warn |
| Diff = 0 | Sin PIN admin |
| Diff ≠ 0 | PIN admin |
| Require session false | Venta legacy sin caja (escape deploy) |

---

# 10. Regresiones potenciales

| Área | Riesgo | Mitigación |
|---|---|---|
| Venta online | Alto | Flag require; tests TX |
| Offline batch | Alto | Unique SALE; tests sync |
| ARCA | Medio | Sigue post-commit |
| Multi-device UX | Medio | Modo satélite documentado |
| Compras/fiscal | Bajo | No tocar |

---

# 11. Tests

### Unit
- `expected_cash`  
- `assertAdminPin`  
- Resolver sesión / estados  

### Integration
- Abrir → venta online → movimiento en TX  
- Venta sin sesión + require on → 409 sin stock move  
- Offline batch con `caja_sesion_id`  
- Idempotencia SALE  
- Retiro sin pin / pin ok  
- Cierre con diff  

### Manual
- PC principal + satélite misma sesión  
- Offline en satélite tras haber cacheado id  
- Intento offline en browser limpio sin red → bloqueo  
- No cerrar con cola  

---

# 12. Orden exacto de implementación

1. Migración + verify  
2. Módulo caja (abrir/actual/resumen) + tests unit  
3. Enganche `processSale` + flag require (default false)  
4. Movimientos manuales + assertAdminPin  
5. Cerrar + diferencias  
6. api-client + banner + OpenRegister + gate  
7. Modo satélite UI  
8. offline-queue + D-OFF  
9. CloseRegister + bloqueo cola  
10. require=true en staging + checklist multi-dispositivo  

---

# 13. Estrategia Cursor

## Leer primero
`pos/service.ts`, `pos/schemas.ts`, `offline-queue.ts`, `index.tsx` handlePay, `auth/service.ts`, `app.ts`, `verify-schema.ts`, migraciones RadioColonia, **este archivo**.

## No reinventar
Cliente ARCA, aprobación de ventas, multi-gaveta, user_id real.

## No modificar
`fiscal/**`, `compras/**`.

## No decidir solo
Nada de lo ya trabado arriba; umbral de centavos para diff = cualquier `!== 0`.

## Comandos
`db:verify`, `npm test`, smoke 2 browsers misma sesión.

---

# 14. Riesgos técnicos

### 🔴 Alto
- Cerrar con colas pendientes en *otro* dispositivo (mitigar: checklist operativo + futuro endpoint “ventas offline huérfanas”).  
- Deploy require=true antes de UI (mitigar: flag).  

### 🟡 Medio
- Modo satélite solo por localStorage (alguien puede cambiarlo) — aceptable MVP.  
- Sync post-cierre offline distorsiona auditoría del arqueo ya hecho.  

### 🟢 Bajo
- Naming sesión JWT vs sesión caja.  

---

# 15. Decisiones ANTES de programar

| ID | Estado |
|---|---|
| D-OFF, D-AUTH, D-TX, D-MULTI, D-FK, D-RETIRO, D-DENOM, D-FLAG | **RESUELTAS** |
| D-SAT-UI | **RECOMENDADA:** `pos-caja-modo` localStorage; confirmar al implementar |
| D-OPEN-WHO | **RECOMENDADA:** solo modo principal puede `POST .../abrir`; satélite 403 o UI hidden |

Ninguna decisión bloqueante abierta para empezar DB + backend core.

---

# 16. Criterios de aceptación

- [ ] Una sola sesión `abierta` por puesto.  
- [ ] N dispositivos online venden a la misma sesión y generan movimientos.  
- [ ] Satélite no necesita (ni debe) abrir otra caja para facturar.  
- [ ] Movimiento SALE en misma TX; ARCA post-commit.  
- [ ] Idempotencia por venta.  
- [ ] Offline sin `caja_sesion_id` bloqueado.  
- [ ] Offline con id synca contra esa sesión.  
- [ ] No cerrar con cola local > 0.  
- [ ] Retiro y cierre con diff exigen PIN admin válido.  
- [ ] Diff no altera ventas.  
- [ ] Fiscal y compras sin regresión.  
- [ ] Flag require permite escape en deploy.  

---

# 17. Checklist final Cursor

## Antes
- [ ] Leer este doc completo (decisiones trabadas)  
- [ ] No implementar cola de aprobación ni sesión provisional  

## DB / Backend / Frontend / Tests
- [ ] Según §12  

## Verificación multi-dispositivo
- [ ] Browser A abre; browser B vende; mismos movimientos  
- [ ] Browser limpio offline sin sesión → no vende  

---

# 18. Resumen ejecutivo

| Ítem | Detalle |
|---|---|
| Modelo | 1 sesión server / N dispositivos; principal opera caja; satélites facturan |
| Enganche venta | Misma TX + idempotencia SALE |
| Offline | A2 estricto; id congelado; no cierre con cola |
| Auth | JWT + PIN admin puntual |
| Migración | 1 en ecommerce |
| No MVP | Aprobación hub, CC, NC, Posnet, multi-gaveta |
| PR docs | `features/implementacion-caja.md` |

## Fuera de alcance / mejoras futuras
- Rol `vendedor` formal  
- Panel “dispositivos con cola pendiente”  
- Denominaciones billetes  
- Cola de aprobación cel→PC  
- Multi-puesto con efectivo separado  

## Flujos de referencia (acordados)

**Online principal:** Abrir → vender (TX) → retiro+PIN → sync colas → cerrar (±PIN si diff).  
**Online satélite:** Adjuntar sesión actual → solo vender.  
**Offline:** Solo si ya hay id cacheado → enqueue → al volver sync a ese id → no retirar/cerrar offline.
