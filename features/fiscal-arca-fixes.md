# Plan de implementación: correcciones fiscales POS → ARCA (pre-producción)

**Feature slug:** `fiscal-arca-fixes`
**Repo principal:** `Fran55sh/radio-colonia-pos` (base: `main` @ `3a64f93`)
**Repo secundario (solo migración SQL):** `Fran55sh/RadioColonia` (`app/src/db/migrations/`)
**Destino del documento:** `features/fiscal-arca-fixes.md` (carpeta existente en el POS, junto a `features/afip-arca-homologacion-go-live.md`)
**Estado ARCA:** homologación (`ARCA_PRODUCTION=false`). No hay historial fiscal real que reparar.
**Objetivo:** dejar el flujo venta → comprobante ARCA correcto y a prueba de fallos ANTES de pasar a producción.

> Convención: **HECHO** = verificado en el código de `3a64f93`. **RECOMENDACIÓN** = propuesta. **DECISIONES**: D1–D14 cerradas el 2026-10-17 con la opción recomendada (sección 15).

---

## 1. Resumen de la feature

### Problema (HECHO, verificado con código y con scripts que importan las funciones reales)
| # | Defecto | Estado en `main` | Severidad |
|---|---|---|---|
| A1 | Importe enviado a ARCA ≠ importe cobrado ($100 @21% → $100,43; $100 @10,5% → $99,45; 3×$100 → $301,29). El QR usa el total de caja | Confirmado | Alta |
| A2 | Un comprobante con CAE puede quedar en `error` y volver a emitirse con otro número (factura duplicada). Sin conciliación con `consultarComprobante` | Confirmado (también con `pendiente`) | Alta impacto / baja probabilidad |
| A3 | Venta confirmada (stock + caja) que devuelve error; al volver a cobrar se genera otro `client_sale_id` → venta duplicada | Confirmado | Alta |
| A4 | `pos_iva_registro` guarda una sola fila al 21% aunque la venta sea 10,5% o mixta | Confirmado | Alta (contable) |
| A5 | `fecha_cbte`/QR en UTC vs `CbteFch` en hora AR → día distinto entre 21:00 y 23:59 | Confirmado | Media |
| A6 | Reintentos que mezclan datos viejos y nuevos | Parcial: en `main` hay `ON CONFLICT DO UPDATE`, pero no se persiste cada intento | Media |
| X1 | Lock por venta, no por punto de venta + tipo: dos cajas a la vez piden el mismo número → ARCA rechaza una | Confirmado | Media |
| X2 | La ruta de venta duplicada (409) vuelve a emitir si la fila está `pendiente` | Confirmado | Media |
| X3 | Sin timeout en el fetch del frontend; SDK hasta ~134 s por llamada SOAP; el lock retiene una conexión; pool sin `connectionTimeoutMillis` | Confirmado (teórico para 1 local) | Media/Baja |
| X4 | `VENTA_SIN_IMPORTES` (venta de $0) lanzado fuera del try, después del commit | Confirmado | Media |
| X5 | El loop de reintento por deadlock envuelve la emisión: un 40P01/40001 después del commit registraría la venta otra vez | Confirmado (baja probabilidad) | Baja |
| X6 | `pos_iva_registro.fecha_fiscal = CURRENT_DATE` depende de la TZ de Postgres | Confirmado (TZ de la DB no verificada) | Media |

### Comportamiento deseado
1. **Contrato único de importes**: total cobrado = `ImpTotal` enviado = total del QR = `pos_ventas.total` = Σ filas del libro IVA. Neto e IVA calculados en centavos por alícuota y enviados **explícitos** (el SDK no recalcula).
2. **Máquina de estados explícita** (`pendiente → enviando → emitido | rechazado | desconocido`, más `error` local). Un comprobante con CAE es inmutable. Un resultado desconocido se concilia antes de cualquier nueva emisión.
3. **Venta idempotente de punta a punta**: el frontend conserva el `client_sale_id` hasta conocer el resultado, y el backend nunca devuelve error después del commit.
4. **Libro IVA correcto**: una fila por alícuota y fecha fiscal en hora argentina.
5. **Concurrencia acotada**: lock por (ambiente, PV, tipo), con timeouts en el frontend, el SDK y el pool.
6. **Tests de integración** con Postgres y fallos simulados de WSFE.

---

## 2. Arquitectura actual relevante (HECHO)

### Flujo de venta online
```
Frontend routes/index.tsx handlePay (414-549)
  └─ generateClientSaleId() NUEVO en cada clic (438; lib/offline-queue.ts:57-59)
  └─ createVenta → POST /api/v1/pos/ventas (lib/api-client.ts:214; apiFetch 104-149 sin timeout)
       error ≠ stock/fetch → flash(msg), carrito NO se vacía (528-530)
Backend pos/routes.ts:17-23 → processSale (pos/service.ts:242-345)
  ├─ client_sale_id existente → ensureSaleMovimiento + maybeEmitirDespuesDeVenta (271) + throw 409 (274)
  └─ loop deadlock x3 (286-341) envuelve:
       withTransaction(registerSaleInTransaction + ensureSaleMovimiento) (288-314)  ← COMMIT
       maybeEmitirDespuesDeVenta(ventaId) (316)  ← fuera de la TX, DENTRO del loop
registerSaleInTransaction (87-231)
  ├─ alicuota = variant.alicuota_iva ?? 21 (123); splitPriceWithIva (125) → lib/iva.ts:16 neto en pesos enteros
  ├─ INSERT pos_ventas (157-174), pos_lineas_venta (177-201), ledger (203-219)
  └─ INSERT pos_iva_registro UNA fila, alicuota DEFAULT_IVA_ALICUOTA, fecha CURRENT_DATE (222-228)
fiscal/service.ts emitirComprobanteVenta (33-63)
  └─ withVentaFiscalLock (repository.ts:154-170): pool.connect + pg_advisory_lock(8421001, ventaId), conexión retenida
       ├─ loadVentaFiscalContext (repository.ts:21-82) con pool.query (otras conexiones)
       ├─ skip solo si estado==='emitido' && cae (48); error+forceRetry (54) y pendiente+forceRetry (61) reemiten
       └─ ejecutarEmision (65-177)
            ├─ resolverComprobante en try (80-101)
            ├─ lineasToArcaItems (103) FUERA del try
            ├─ ensureComprobantePendiente (105-117; repository.ts:94-151)
            └─ try: arca.facturar (120) → SDK siguienteComprobante + calcularTotales (IVA round2)
                 fechaCbte = toISOString (138, UTC); buildQrUrl(total: ctx.total) (139-149)
                 marcarComprobanteEmitido (153; repository.ts:172-220) UPDATE+SELECT+UPDATE sin TX
               catch → marcarComprobanteError (173; repository.ts:222-238) sin filtro por CAE
Frontend FiscalResultDialog.tsx:38 canRetry = error|pendiente aunque haya CAE
  → POST /fiscal/ventas/:id/reintentar (fiscal/routes.ts:20-27) → forceRetry
```

### Flujo offline (HECHO)
`tryEnqueueOffline` (routes/index.tsx:461-486) guarda el payload con el **mismo** `client_sale_id`; `syncOfflineQueue` (217-235) → `POST /pos/ventas/offline-batch` → `processOfflineBatch` (pos/service.ts:347-420): `processSale(skipFiscal)` y luego `maybeEmitirDespuesDeVenta`; las duplicadas se detectan por el 409 capturado (391-411).

### SDK `@ramiidv/arca-facturacion` 2.1.0 (HECHO)
- `facturar()` (`dist/arca.js:116-126`): `siguienteComprobante` → `buildInvoiceDetail` → `calcularTotales` (`dist/facturacion.js:33-114`, IVA = `round2(neto*rate/100)`) → `crearFactura`.
- `crearFactura(request)` (`dist/arca.js:85-89`): API cruda con `ImpTotal/ImpNeto/ImpIVA/Iva[]` explícitos. Solo valida campos requeridos (`dist/validation.js:85-106`) y devuelve el resultado crudo de `FECAESolicitar`. `parseFacturaResult` no se exporta.
- `consultarComprobante(cbteTipo, ptoVta, cbteNro)` (`dist/arca.js:169-172`, `dist/wsfe.js:55-62`): `ResultGet` con `CodAutorizacion`, `ImpTotal`, `CbteFch`, `DocNro` (`dist/types.d.ts:175-194`).
- `toDateString` usa `America/Argentina/Buenos_Aires` (`dist/facturacion.js:9-20`).
- SOAP (`@ramiidv/arca-common/dist/soap-client.js:60-160`): reintenta timeout, red y 5xx. Config POS: `retries: 3`, `retryDelayMs: 2000` (`fiscal/arca-client.ts:11-27`), timeout por defecto 30 s (`requestTimeoutMs`, `dist/arca.js:26`). Reenviar el mismo número y payload es seguro (WSFE lo trata como reproceso y devuelve el mismo CAE).
- Errores: `ArcaAuthError` (WSAA), `ArcaSoapError` (transporte/HTTP), `ArcaWSFEError` (ARCA respondió con `Errors`).

### Base de datos (HECHO)
- **Las tablas `pos_*` las crea el migrador del ecommerce**:
  - `Backend/src/db/schema.sql` está DEPRECADO.
  - `Backend/src/db/migrate.ts` solo verifica (`verify-schema.ts:5-25, 60-107`).
  - `docker-entrypoint.mjs` hace la verificación "solo lectura, sin DDL".
- Migraciones en `RadioColonia/app/src/db/migrations/*.sql`. **Todas se re-ejecutan en cada deploy** (`app/src/db/apply-sql-migrations.ts`, pasos 1 y 3 de `app/migrate.sh`), así que deben ser idempotentes. `pos_*` está excluido de `drizzle-kit push`. La última es `0030_variant_images.sql` → **próxima `0031`**.
- `pos_comprobantes_fiscales` (`0008_pos_fiscal_invoicing.sql`): CHECK `estado IN ('pendiente','emitido','error','anulado')`, `UNIQUE(venta_id)`, índice único `(ambiente, punto_venta, cbte_tipo, cbte_nro) WHERE cbte_nro IS NOT NULL AND estado='emitido'`.
- `pos_iva_registro` (`0005_pos_operational_tables.sql:52-67`): sin unicidad; `fecha_fiscal DATE DEFAULT CURRENT_DATE`.
- `pos_ventas` y `pos_lineas_venta`: `NUMERIC(14,2)` (soportan centavos).
- Alícuotas: `product_variants.iva_alicuota`; el POS solo acepta 21 o 10,5 (`lib/catalog.ts:81-84, 96, 243`). El admin permite elegir 10,5 por variante (`ProductVariantsEditor.tsx:892`, `PreciosSkusTable.tsx:247`). Nunca llega 0%, así que la rama exento hoy es inalcanzable.
- Ni el ecommerce ni el frontend POS leen `pos_iva_registro` o `pos_comprobantes_fiscales`, salvo `verify-schema`. El libro sale por `GET /api/v1/contabilidad/iva/ventas` (rol admin).

### Tests actuales (HECHO)
- `Backend/vitest.config.ts` incluye `src/**/*.test.ts`. Los 38 tests fiscales pasan.
- `fiscal/service.test.ts:33-57` mockea repositorio, cliente ARCA, config, resolver y mappers.
- No hay tests con Postgres ni CI en el POS. El frontend no tiene tests.
- Patrón a copiar: `RadioColonia/app/src/server/compras/execute.integration.test.ts` (`describe.skipIf` según env de DB).

---

## 3. Archivos involucrados

### Repo `radio-colonia-pos`
| Archivo | Tipo | Rol actual | Cambio necesario | Prioridad |
|---|---|---|---|---|
| `Backend/src/lib/iva.ts` | lib | `splitPriceWithIva` (neto entero) | Deprecar o eliminar cuando no queden usos | Alta |
| `Backend/src/lib/fiscal-importes.ts` | **nuevo** | — | Cálculo único en centavos: grupos por alícuota, distribución a líneas, totales `ImpTotal/ImpNeto/ImpIVA/Iva[]` | Alta |
| `Backend/src/lib/fecha-ar.ts` | **nuevo** | — | `hoyAR()` (YYYY-MM-DD en `America/Argentina/Buenos_Aires`), `toCbteFch()`; reloj inyectable | Alta |
| `Backend/src/modules/pos/service.ts` | service | venta + emisión | Importes nuevos; libro IVA por alícuota con fecha explícita; loop solo en la TX; emisión no lanzante; replay sin emitir; validación $0 | Alta |
| `Backend/src/modules/pos/routes.ts` | routes | 201 | Replay → 200 + `duplicada` (D2) | Media |
| `Backend/src/modules/pos/schemas.ts` | schema | `client_sale_id` opcional | Obligatorio online (D14) | Baja |
| `Backend/src/modules/fiscal/service.ts` | service | emisión | Máquina de estados, intento persistido, `crearFactura` explícito, clasificación de errores, QR con importes y fecha enviados | Alta |
| `Backend/src/modules/fiscal/repository.ts` | repo | CRUD + lock | Guardas por CAE, TX, intentos, lock PV+tipo, client dedicado | Alta |
| `Backend/src/modules/fiscal/estado.ts` | **nuevo** | — | Estados y transiciones permitidas (puro) | Alta |
| `Backend/src/modules/fiscal/conciliacion.ts` | **nuevo** | — | `conciliarIntento` + barrido periódico | Alta |
| `Backend/src/modules/fiscal/mappers.ts` | mapper | items + QR | `buildFECAEDetRequest`, parser de `FECAESolicitar`, `buildQrUrl(ImpTotal, fecha del intento)` | Alta |
| `Backend/src/modules/fiscal/arca-client.ts` | client | singleton | `requestTimeoutMs`/`retries` por env; `setArcaClientForTests()` | Media |
| `Backend/src/modules/fiscal/types.ts` | types | 4 estados | Estados nuevos, `IntentoFiscal`, flags de respuesta | Alta |
| `Backend/src/modules/fiscal/routes.ts` | routes | status/retry/ping/config | `reintentar` concilia; `GET /pendientes` (D12); config muestra timeouts | Media |
| `Backend/src/config/db.ts` | config | pool max 20 | `connectionTimeoutMillis` 5 s | Media |
| `Backend/src/config/env.ts` | config | env | `ARCA_REQUEST_TIMEOUT_MS`, `ARCA_RETRIES`, `FISCAL_EMISION_BUDGET_MS`, `FISCAL_LOCK_TIMEOUT_MS`, `FISCAL_CONCILIACION_INTERVAL_MS` | Media |
| `Backend/src/app.ts` / `Backend/src/index.ts` | bootstrap | arranque | Iniciar el barrido (D4) | Media |
| `Backend/src/db/verify-schema.ts` | verify | tablas | Exigir `pos_comprobantes_fiscales_intentos` y columnas de la `0031` | Alta |
| `Backend/src/modules/contabilidad/service.ts` | service | libro IVA | Sin cambio de query (N filas por venta) | Baja |
| `Backend/src/modules/fiscal/*.test.ts` | tests | unit mockeados | Adaptar y ampliar | Alta |
| `Backend/src/**/*.integration.test.ts` | **nuevos** | — | Integración con Postgres + ARCA falso | Alta |
| `Backend/test/fixtures/pos-schema.sql` | **nuevo** | — | DDL de tablas necesarias copiado de las migraciones ecommerce (incl. `0031`) (D13) | Alta |
| `Backend/vitest.integration.config.ts` + script `test:integration` | **nuevo** | — | Separar unit e integración | Media |
| `.github/workflows/ci.yml` | **nuevo** | — | Postgres como servicio + unit + integración (D13) | Media |
| `Frontend/src/lib/api-client.ts` | api | fetch sin timeout | `ApiError` tipado, `timeoutMs`, estados nuevos, `duplicada` | Alta |
| `Frontend/src/lib/offline-queue.ts` | lib | cola + id | Venta en curso persistida (`pos-pending-sale`) | Alta |
| `Frontend/src/routes/index.tsx` | route | `handlePay` | Reuso de id, clasificación de respuesta, banner Verificar/Descartar, indicador de pendientes | Alta |
| `Frontend/src/components/pos/FiscalResultDialog.tsx` | component | diálogo | Acciones por estado; nunca reintentar con CAE | Alta |
| `docs/DEPLOY.md` | doc | env ARCA | Nuevas env y orden de deploy | Baja |

### Repo `RadioColonia`
| Archivo | Cambio | Prioridad |
|---|---|---|
| `app/src/db/migrations/0031_pos_fiscal_intentos.sql` (**nuevo**) | Sección 5; idempotente | Alta |
| `app/src/db/verify-schema.ts` | Agregar `pos_comprobantes_fiscales_intentos` | Media |

### NO tocar
`Backend/src/lib/catalog.ts`; `Backend/src/modules/caja/*`; `fiscal/cbte-tipo.ts`, `resolver.ts`, `iva-condiciones.ts` (lógica A/B del PR #10); `Backend/src/db/schema.sql`; `patches/@ramiidv+arca-common+0.2.0.patch`; `node_modules/@ramiidv/*`; migraciones existentes del ecommerce.

---

## 4. Dependencias y flujo de datos (deseado)
```
handlePay
  ├─ pending = loadPendingSale() ?? createPendingSale(cart)   // id estable hasta resolver
  └─ createVenta(pending.payload, timeout 45 s)
POST /pos/ventas → processSale
  ├─ validaciones (sesión, cliente, total > 0 si ARCA activo) ANTES de tocar stock
  ├─ replay → venta + estado fiscal actual (sin emitir) + duplicada:true
  ├─ loop deadlock SOLO sobre la TX:
  │    calcularImportesVenta (fiscal-importes) → pos_ventas, pos_lineas_venta
  │    pos_iva_registro: 1 fila por alícuota, fecha_fiscal = hoyAR()
  │    ensureSaleMovimiento(total)                      ← COMMIT
  └─ emitirSeguro(ventaId, presupuesto) → nunca lanza
emitirComprobanteVenta
  ├─ client dedicado; lock venta (lock_timeout)
  ├─ emitido → devolver | enviando/desconocido → conciliar | pendiente/rechazado/error → intento nuevo
  ├─ recalcular importes desde pos_lineas_venta; comparar con pos_ventas.total
  ├─ lock (ambiente, pv, tipo) → nro = ultimoComprobante+1
  │    INSERT intento 'enviando' (nro, fecha AR, receptor, importes, payload) ← ANTES de enviar
  │    crearFactura(importes explícitos)
  │    A → TX: intento+comprobante emitido, QR(ImpTotal, fecha intento), libro.comprobante
  │    R / ArcaWSFEError → rechazado | ArcaAuthError → error | timeout/red/5xx → desconocido
  └─ liberar locks
```
- Importes: solo `fiscal-importes.ts`. Fecha: solo `fecha-ar.ts`. Receptor: snapshot por intento. Campos fiscales de un emitido: inmutables.

---

## 5. Cambios de base de datos
**Necesarios**: los estados nuevos y el historial de intentos no entran en el modelo actual (`UNIQUE(venta_id)`, CHECK de 4 estados).
**Dónde**: repo ecommerce, `app/src/db/migrations/0031_pos_fiscal_intentos.sql` (el POS no ejecuta DDL; HECHO). Tiene que ser idempotente porque se re-ejecuta en cada deploy, y no puede fallar con los datos existentes.

### 5.1 `pos_comprobantes_fiscales`
- CHECK de `estado` → `('pendiente','enviando','desconocido','emitido','rechazado','error','anulado')`. Se hace en un bloque `DO $$`, reemplazando `pos_comprobantes_fiscales_estado_check` **solo si** su definición en `pg_constraint` no incluye `'enviando'`, para no tomar un lock exclusivo en cada deploy.
- `ADD COLUMN IF NOT EXISTS`: `intento_actual_id INTEGER` (FK condicional a intentos, `ON DELETE SET NULL`), `iva_detalle JSONB`, `imp_total_enviado NUMERIC(14,2)`.
- Normalización idempotente de homologación: `UPDATE ... SET estado='emitido' WHERE cae IS NOT NULL AND estado <> 'emitido'` (D10).

### 5.2 Nueva `pos_comprobantes_fiscales_intentos`
| Columna | Tipo / nota |
|---|---|
| `id` | SERIAL PK |
| `comprobante_id` | INTEGER NOT NULL FK → `pos_comprobantes_fiscales(id)` ON DELETE CASCADE |
| `venta_id` | INTEGER NOT NULL |
| `nro_intento` | INTEGER NOT NULL; `UNIQUE(comprobante_id, nro_intento)` |
| `estado` | VARCHAR(16) CHECK IN (`'enviando','emitido','rechazado','desconocido','no_autorizado','error'`) |
| `ambiente`, `emisor_cuit`, `punto_venta`, `cbte_tipo` | snapshot |
| `cbte_nro` | INTEGER NULL (número reservado) |
| `fecha_cbte` | DATE NULL (fecha AR enviada) |
| `doc_tipo`, `doc_nro`, `condicion_iva_receptor_id` | snapshot del receptor |
| `imp_total`, `imp_neto`, `imp_iva`, `imp_op_ex` | NUMERIC(14,2) |
| `iva_detalle`, `request_payload`, `response_raw` | JSONB (sin Auth) |
| `cae` VARCHAR(20), `cae_vencimiento` DATE | NULL |
| `error_code` VARCHAR(32), `error_message` TEXT | NULL |
| `created_at`, `sent_at`, `resolved_at` | TIMESTAMPTZ |

Índices:
- `UNIQUE (ambiente, punto_venta, cbte_tipo, cbte_nro) WHERE cbte_nro IS NOT NULL AND estado IN ('enviando','desconocido','emitido')`.
- `UNIQUE (comprobante_id) WHERE estado IN ('enviando','desconocido')`: como máximo un intento abierto por comprobante.
- `(estado, created_at)` para el barrido.

### 5.3 `pos_iva_registro`
- Sin columnas nuevas: N filas por venta.
- Índice `UNIQUE (referencia_tipo, referencia_id, alicuota) WHERE tipo='venta'`, creado solo si no hay duplicados. Si los hay, `RAISE NOTICE` y no se crea, para no trabar el deploy. Hoy hay una fila por venta.
- El código siempre manda `fecha_fiscal` explícita.

### 5.4 `pos_ventas` / `pos_lineas_venta`
Sin cambios de esquema. Las ventas viejas de homologación conservan el neto entero (D8).

### 5.5 Orden de deploy
1. `0031` en el ecommerce. Es aditiva y compatible con el POS actual.
2. POS Fase 4. `verify-schema` exige la `0031` y aborta con un mensaje claro si falta.

---

## 6. Backend

### 6.1 Máquina de estados (`fiscal/estado.ts`)
| Estado | Significado | ¿Enviar a ARCA? |
|---|---|---|
| `pendiente` | Fila creada, nada enviado | Sí |
| `enviando` | Intento persistido con número reservado; envío en curso o proceso caído | No: conciliar |
| `desconocido` | Enviado sin respuesta interpretable (timeout, red, HTTP ≥500) | No: conciliar |
| `emitido` | CAE persistido. Terminal e inmutable (salvo `anulado` futuro vía NC) | No |
| `rechazado` | ARCA respondió `Resultado=R` o `Errors` | Sí (intento nuevo) |
| `error` | Falla local antes de enviar (config, WSAA, receptor, importes inconsistentes, pool) | Sí (intento nuevo) |
| `anulado` | Reservado | No |

Transiciones:
- `pendiente|rechazado|error → enviando`, bajo lock PV+tipo y después de persistir el intento.
- `enviando → emitido | rechazado | desconocido | error`. Pasa a `error` solo si la falla es demostrablemente previa al envío (`ArcaAuthError`).
- `enviando|desconocido → emitido`: la conciliación encontró el comprobante y coincide.
- `enviando|desconocido → rechazado`: el comprobante no existe **y** `ultimoComprobante < nro`; el intento queda `no_autorizado`.
- `enviando|desconocido` se mantiene si ARCA no responde.
- **Prohibido**: salir de `emitido`, y escribir `error/rechazado/pendiente` sobre una fila con `cae`.

Toda escritura es `UPDATE ... WHERE venta_id=$1 AND estado = ANY($permitidos)` con chequeo de `rowCount`. Si da 0, se relee y se devuelve el estado real.

### 6.2 Contrato de importes (`lib/fiscal-importes.ts`)
Todo en centavos enteros:
1. `total_linea_c = round(precio_unitario × cantidad × 100)`.
2. Agrupar por alícuota: `T_g = Σ total_linea_c`.
3. `neto_g = round(T_g / (1 + a/100))`, `iva_g = T_g − neto_g`. Por construcción `neto_g + iva_g = T_g`.
4. Distribuir `neto_g` entre las líneas por mayor resto: base `floor(total_linea_c / (1+a))`, el resto a los mayores restos y desempate por orden de línea. `iva_linea = total_linea − neto_linea`.
5. Alícuota 0 → exento (hoy inalcanzable).
6. `ImpTotal = Σ T_g` = cobrado; `ImpNeto = Σ neto_g`; `ImpIVA = Σ iva_g`; `Iva[] = [{Id, BaseImp: neto_g, Importe: iva_g}]`; `ImpTotConc = ImpOpEx = ImpTrib = 0`.

Verificado por script (barrido de 1 centavo a $100.000, alícuotas 21 y 10,5): `|iva_g − round2(neto_g × a)| ≤ $0,01`. Falta confirmar en homologación que ARCA acepta esa diferencia de 1 centavo (**D1, gate de la Fase 3**).

### 6.3 Emisión
- **Client dedicado**: una sola conexión toma los dos locks y hace todas las escrituras fiscales. No se usa `pool.query` dentro de la sección con lock.
- **Locks**:
  - Venta: `pg_advisory_lock(8421001, venta_id)`.
  - PV+tipo: `pg_advisory_lock(8421002, (ambiente==='prod' ? 1_000_000_000 : 0) + punto_venta*1000 + cbte_tipo)`.
  - Orden fijo: siempre venta y después PV.
  - `SET lock_timeout` (rec. 20 s). Si da 55P03 → devolver el estado actual sin emitir.
  - Liberar en `finally` y resetear la sesión antes de devolver la conexión.
- **Número**: `ultimoComprobante(pv, tipo) + 1` bajo lock. Si choca con un intento local abierto o emitido (índice único), conciliar ese primero.
- **Envío**: `arca.crearFactura({PtoVta, CbteTipo, invoices:[detalle]})` con `Concepto=1`, `DocTipo/DocNro`, `CondicionIVAReceptorId`, `CbteDesde=CbteHasta=nro`, `CbteFch`, los importes de 6.2, `MonId='PES'` y `MonCotiz=1`. La respuesta (`FeDetResp.FECAEDetResponse`: Resultado, CAE, CAEFchVto, Observaciones) se parsea con un mapper propio basado en `parseFacturaResult` del SDK.
- **Clasificación**:
  - `A` con CAE → emitido (las observaciones se guardan).
  - `R` o `ArcaWSFEError` → rechazado (con error de numeración, el próximo intento recalcula).
  - `ArcaAuthError` → error.
  - `ArcaSoapError`, AbortError, red o HTTP ≥500 → desconocido.
  - Cualquier otra excepción después de iniciar el envío → desconocido.
- **Post-CAE en una transacción**: intento y comprobante emitidos (`cbte_nro`, `fecha_cbte` = fecha del intento, `cae`, `cae_vencimiento` = `CAEFchVto` sin fallback a hoy, `qr_url`, `iva_detalle`, `imp_total_enviado`) y `pos_iva_registro.comprobante`. Si falla, se reintenta la persistencia (3 veces con backoff corto). Si sigue fallando, el intento queda `enviando` y se loguea `CRITICAL` con venta, número y CAE. **Nunca `error`.**
- **QR**: fecha e importe del intento (`ImpTotal`), y `docTipo/docNro` del intento.
- **Tiempos**: SDK con `requestTimeoutMs` (rec. 10 s) y `retries` (rec. 1). La emisión dentro de `POST /pos/ventas` tiene un presupuesto (rec. 25 s). Si se excede, se responde con el estado actual (`enviando`) y la emisión sigue en el proceso. Ver D3.

### 6.4 Conciliación (`fiscal/conciliacion.ts`)
`conciliarIntento(intento)`, bajo lock PV+tipo:
1. `consultarComprobante(tipo, pv, nro)`:
   - **Existe** → comparar `ImpTotal`, `DocTipo/DocNro` y `CbteFch`.
     - Coincide → emitido con `CodAutorizacion` y `FchVto`.
     - No coincide → `error` `CONFLICTO_NUMERACION`, manual y sin reemitir.
   - **No existe** (código a confirmar en homologación, típicamente 602) → `ultimoComprobante`:
     - `< nro` → `no_autorizado` y comprobante `rechazado`: se puede reemitir.
     - `>= nro` → `error` `CONCILIACION_INCONSISTENTE`, manual.
   - **Sin respuesta** → sin cambios.
2. Disparadores:
   - `POST /fiscal/ventas/:id/reintentar`.
   - Barrido (D4): al arrancar y cada 5 min, sobre `enviando|desconocido` con más de 2 min, con `pg_try_advisory_lock` (seguro multi-instancia).
   - La ruta de replay de venta solo **lee** el estado.

### 6.5 Venta (`pos/service.ts`)
- Validación previa a la TX: con ARCA configurado y alguna línea o el total ≤ 0 → `400 VENTA_SIN_IMPORTES` (D7).
- El loop de deadlock envuelve solo `withTransaction`; la emisión va después del loop.
- `emitirSeguro()` atrapa todo y devuelve un `fiscal` de error/estado. `processSale` nunca lanza después del COMMIT.
- **Replay**:
  - `ensureSaleMovimiento` como hoy, y `getFiscalStatus` **sin emitir**.
  - Excepción: si no hay fila de comprobante, o está en `pendiente`, **y** el lock de venta está libre (`pg_try_advisory_lock`), se puede emitir (es el caso del offline batch).
  - Respuesta `200 duplicada:true` (D2). `processOfflineBatch` cuenta las duplicadas por ese flag.
- Libro IVA: una fila por grupo con la alícuota real y `fecha_fiscal = hoyAR()`.
- El movimiento de caja sigue siendo el total (no cambia).

### 6.6 Endpoints
| Método | Ruta | Cambio |
|---|---|---|
| POST | `/api/v1/pos/ventas` | 201 normal; replay 200 + `duplicada`; nunca 5xx después del commit |
| POST | `/api/v1/pos/ventas/offline-batch` | Igual contrato; duplicadas por flag |
| GET | `/api/v1/fiscal/ventas/:ventaId` | Estados nuevos + `puede_reintentar`, `requiere_conciliacion` |
| POST | `/api/v1/fiscal/ventas/:ventaId/reintentar` | Concilia antes. Emitido → lo devuelve. Lock tomado → 200 con el estado actual |
| GET | `/api/v1/fiscal/pendientes` | **Nuevo** (D12), rol caja |
| GET | `/api/v1/fiscal/config` | Suma los timeouts y reintentos efectivos |

Se mantienen los scopes de auth de `app.ts:87-92`.

### 6.7 Logging
Un log por transición: `venta_id`, `intento_id`, pv, tipo, nro, estado anterior → nuevo, `duracion_ms` y `error_code`. Los casos "CAE obtenido y persistencia fallida" y `CONFLICTO_NUMERACION` van con nivel CRITICAL. Nunca loguear cert, key ni Auth.

---

## 7. Frontend

### 7.1 Venta idempotente
- **Venta en curso** en localStorage (`pos-pending-sale`): `{client_sale_id, payload, cart_fingerprint, created_at}`, creada una vez por cobro.
- **Reuso**:
  - Misma huella de carrito → reusar el id y el payload.
  - Otra huella con una venta en curso sin resolver → no cobrar. Banner "Hay una venta anterior sin confirmar" con **Verificar** (reenvía el payload original) y **Descartar** (solo si hubo un 4xx previo al commit).
- **Respuestas**:
  - `2xx` (incluido `duplicada`) → limpiar la venta en curso, `patchCatalogStock` solo si no es duplicada, `resetAfterSale` y abrir el diálogo fiscal.
  - `4xx` previo al commit (stock, `VENTA_SIN_IMPORTES`, sesión de caja, cliente) → limpiar la venta en curso, mantener el carrito y mostrar el mensaje.
  - Red, timeout o `5xx` → desconocido: conservar todo y mostrar "No sabemos si la venta se registró. Tocá Verificar". Si se está offline, encolar con el **mismo** id (como hoy).
- `apiFetch`: `timeoutMs` con AbortController y `ApiError extends Error {status, code, details}`. Los consumidores actuales siguen funcionando.
- `createVenta`: timeout de 45 s.

### 7.2 `FiscalResultDialog.tsx`
- `emitido` → datos y QR.
- `rechazado`/`error` sin CAE → **Reintentar**.
- `enviando`/`desconocido` → "Verificando con ARCA…" y botón **Verificar** (llama a `reintentar`, que concilia), con polling opcional de 5 s por hasta 1 min.
- `pendiente` → **Emitir**.
- Si llega un `cae`, siempre se muestra como emitido.
- Se mantiene el banner de homologación.
- `aria-busy` en los botones y `aria-live="polite"` en el estado.

### 7.3 Pendientes (D12)
Contador en el header, junto a `connectionBadge`, que abre una lista de `GET /fiscal/pendientes` con Verificar/Reintentar por fila, reutilizando el diálogo.

### 7.4 Tipos
`FiscalResult.estado` con 7 valores, más `puede_reintentar` y `requiere_conciliacion`; `CreateSaleResult.duplicada?`.

---

## 8. Tipos, contratos y API
- `FiscalEstado` se amplía en el backend (`fiscal/types.ts:1`) y en el frontend (`api-client.ts:40-52`). **Se rompen** `FiscalResultDialog` (`canRetry`), `service.ts:48-61` y cualquier `switch` sobre el estado.
- `ComprobanteFiscalResponse` suma `puede_reintentar`, `requiere_conciliacion`, `imp_total_enviado` e `intento {nro_intento, estado, cbte_nro}`.
- Nuevos `IntentoFiscal` e `ImportesVenta {lineas, grupos, neto, iva, exento, total}`.
- `SaleResult` (`pos/service.ts:29-35`) suma `duplicada?`.
- **Cambio intencional**: el replay online deja de responder 409 (D2). Backend y frontend se despliegan juntos.
- `libroIvaVentas`: misma forma de fila, N filas por venta, sin consumidores en el frontend.

---

## 9. Casos borde
| Caso | Manejo |
|---|---|
| Timeout y ARCA autorizó | `desconocido` → conciliación → emitido con el mismo número |
| Caída entre persistir el intento y enviar | `enviando` → no existe y `ultimo < nro` → `no_autorizado` → reemitir |
| Caída después del CAE y antes de persistir | `enviando` → existe y coincide → emitido |
| DB caída justo después del CAE | Reintento de persistencia; si falla, `enviando` y lo resuelve el barrido |
| Dos cajas, mismo PV+tipo | Lock PV serializa; números consecutivos |
| PV usado fuera del POS | Rechazo por numeración → recalcular; datos distintos al conciliar → `CONFLICTO_NUMERACION` manual |
| Cliente corregido entre intentos | Permitido solo si el intento anterior fue `rechazado/error/no_autorizado`; snapshot por intento |
| Cambio B→A entre intentos | Igual que el anterior; distinta numeración y lock |
| Reintento al día siguiente o sync offline tardía | `CbteFch` = hoy AR (D6) |
| 23:30 AR | Todas las fechas en el mismo día AR |
| Venta $0 | 400 antes de la TX (D7) |
| Precio con más de 2 decimales (tramos) | Redondeo a centavos por línea |
| Venta mixta | 2 `Iva[]` y 2 filas en el libro |
| Aprobado con observaciones | Emitido; observaciones guardadas y mostradas |
| Sin `CAEFchVto` | `NULL` + log |
| Pool saturado | `connectionTimeoutMillis` → `error` reintentable antes de enviar |
| Lock de venta tomado | Devolver `enviando`; el frontend ofrece Verificar |
| `ARCA_ENABLED=false` | `fiscal=null`; sin validación de $0 |
| Varias instancias | Advisory locks + `pg_try_advisory_lock` en el barrido |

---

## 10. Regresiones potenciales
| Área | Riesgo | Verificar |
|---|---|---|
| Venta online | 409→200 y manejo de errores | Venta normal, sin stock, sin sesión, doble clic |
| Offline sync | `processOfflineBatch` dependía del 409 | Cola con duplicados se vacía y cuenta bien |
| Caja | Monto del movimiento | Arqueo con ventas mixtas = Σ totales |
| Precios/tramos | Redondeo a centavos | Total cobrado = total mostrado |
| Libro IVA | N filas | Σ período = Σ `pos_ventas` |
| Factura A monotributo (PR #10) | Reescritura de la emisión | Test `service.test.ts:143` adaptado y verde |
| Diagnóstico ARCA | `wsaa-ping`, `arca:check` | Siguen funcionando |
| Deploy | `verify-schema` exige `0031` | Orden de deploy y mensaje claro |
| Migración | Re-ejecución en cada deploy | Segunda corrida sin cambios ni locks largos |

---

## 11. Tests

### Unit (`npm test`)
| Escenario | Esperado |
|---|---|
| $100 @21% | neto 82,64; IVA 17,36; total 100,00; `Iva=[{5, 82,64, 17,36}]` |
| $100 @10,5% | 90,50 / 9,50 / 100,00; `Id 4` |
| 3 productos distintos de $100 @21% | grupo 247,93 / 52,07 / 300,00; netos de línea 82,65 + 82,64 + 82,64; IVA 17,35 + 17,36 + 17,36 |
| $121 @21% + $110,50 @10,5% | 100,00/21,00 y 100,00/10,50; total 231,50 |
| $100 @21% + $100 @10,5% | 82,64/17,36 + 90,50/9,50 = 173,14 / 26,86 / 200,00 |
| $1.500 / $12.345 / $999,99 @21% | netos 1.239,67 / 10.202,48 / 826,44; totales exactos |
| Propiedad (barrido) | `neto+iva=total`; `|iva − round2(neto·a)| ≤ 0,01`; Σ líneas = grupo |
| Fecha 23:30 AR (02:30Z del día siguiente) | `hoyAR()` = día AR; `toCbteFch` YYYYMMDD del mismo día |
| Transiciones | Según 6.1; salir de `emitido` siempre prohibido |
| Clasificación | Auth → error; WSFE → rechazado; Soap 500 / Abort → desconocido; R → rechazado; A → emitido |
| `buildFECAEDetRequest` | B CF, A RI, A monotributo correctos |
| `buildQrUrl` | importe = `ImpTotal` del intento; fecha del intento |

### Integración (Postgres + ARCA falso; `npm run test:integration`, `describe.skipIf(!TEST_DATABASE_URL)`)
El ARCA falso se inyecta con `setArcaClientForTests()` y mantiene un "libro ARCA" en memoria con fallos programables. El esquema sale de `Backend/test/fixtures/pos-schema.sql`.

| Escenario | Esperado |
|---|---|
| Venta $100 @21% | Emitido, `imp_total_enviado=100.00`, QR importe 100, 1 fila de libro 21% 82,64/17,36 |
| Venta mixta | 2 filas de libro; `Iva[]` de 2 elementos; Σ = total |
| Falla la persistencia post-CAE | Persistencia reintentada; con falla total → `enviando` → barrido → emitido con el mismo número; 1 sola autorización en el falso |
| Respuesta perdida | `desconocido` → `reintentar` → emitido; `crearFactura` llamado 1 vez |
| Envío nunca llegó | `desconocido` → `no_autorizado` → reemite con el mismo número |
| Rechazo | `rechazado` → intento 2 con número recalculado |
| `marcarError` sobre emitido | Sigue emitido |
| 5 ventas en paralelo, mismo PV+tipo | Números 1..5 consecutivos, sin rechazos |
| 2 `reintentar` simultáneos | 1 sola llamada a `crearFactura` |
| Replay durante la emisión | `duplicada` + `enviando`; sin segunda emisión ni venta |
| Doble POST con el mismo id | 1 venta, 1 movimiento de caja, stock descontado una vez |
| 40P01 inyectado en la emisión | 1 venta; 201 con fiscal en error |
| `VENTA_SIN_IMPORTES` | 400; sin venta; stock intacto |
| Pool `max:3` + 10 emisiones con ARCA lento | Ninguna se cuelga; las que no consiguen conexión terminan en `error` reintentable |
| Reloj 23:30 AR | `fecha_cbte`, `CbteFch`, QR y `fecha_fiscal` del mismo día |
| Offline batch con duplicados | Conteo correcto; se emite solo donde no hay comprobante |

### API
Fastify `inject`: `POST /pos/ventas` (201, 200 duplicada, 400), `reintentar` en cada estado, `GET /fiscal/pendientes`.

### Manual / homologación
Ver la sección 17.

---

## 12. Orden exacto de implementación
> Un PR por fase, desplegable y con tests verdes. Las Fases 1 a 3 no requieren migración. **No pasar a producción antes de completar la Fase 4.**

**Fase 0 (recomendada): infraestructura de tests de integración.** Fixture SQL, ARCA falso, `test:integration`, `vitest.integration.config.ts`. Así cada fase trae sus escenarios.

**Fase 1: guardas (POS, sin migración)**
1. `marcarComprobanteError` con `WHERE cae IS NULL AND estado <> 'emitido'`.
2. `emitirComprobanteVenta`: si `existing?.cae` → devolver como emitido.
3. `marcarComprobanteEmitido` en una TX.
4. `ejecutarEmision`: mover `lineasToArcaItems` dentro del manejo de errores; separar las fallas previas a `facturar` de las posteriores al CAE. Una falla posterior al CAE nunca marca `error`: reintenta y loguea CRITICAL.
5. `processSale`: loop solo en la TX; emisión después con try/catch; replay sin emitir si ya existe comprobante; validación $0 (D7).
6. `db.ts`: `connectionTimeoutMillis: 5000`. `arca-client.ts`: timeout y reintentos por env (10 s / 1).
7. `FiscalResultDialog`: `canRetry` con `!cae`.
- Hueco conocido hasta la Fase 4: un `pendiente` que quedó por una caída a mitad de envío todavía puede reemitirse.

**Fase 2: `client_sale_id` estable**
1. `api-client.ts`: `ApiError`, `timeoutMs`, `duplicada`.
2. `offline-queue.ts`: `loadPendingSale/savePendingSale/clearPendingSale/cartFingerprint`.
3. `handlePay`: reuso, clasificación y banner.
4. Backend: replay 200 `duplicada` (D2); `processOfflineBatch` por flag; `client_sale_id` obligatorio online (D14).
- Hecho cuando: doble clic o error después del commit → 1 venta y 1 movimiento de caja.

**Fase 3: contrato de importes explícitos**
0. **Gate D1** en homologación: con un script manual (fuera de los tests y del deploy), enviar una Factura B de $100 @21% con 82,64/17,36 usando `crearFactura`. Si ARCA la rechaza, aplicar el plan B aprobado (D1-b: neto ±1 centavo para que `Importe = round2(BaseImp×a)` y el centavo restante como `ImpTotConc`) y reportarlo para revisión contable.
1. `fiscal-importes.ts` + unit.
2. `registerSaleInTransaction` con los importes nuevos.
3. `mappers.ts`: `buildFECAEDetRequest`, parser y QR con el intento.
4. `service.ts`: `ultimoComprobante` + `crearFactura`; recalcular desde líneas y comparar con `pos_ventas.total` (`IMPORTES_INCONSISTENTES`).
5. Eliminar `splitPriceWithIva` y `lineasToArcaItems` si quedan sin uso.
- Hecho cuando: los casos de la sección 16 dan iguales en venta, líneas, caja, `ImpTotal` y QR.

**Fase 4: intentos persistidos, conciliación y lock PV**
1. Repo ecommerce: `0031` + `verify-schema.ts`; dos corridas en una copia de staging; desplegar.
2. `verify-schema.ts` del POS exige la `0031`.
3. `estado.ts` y `types.ts` (backend y frontend).
4. `repository.ts`: client dedicado, lock PV, intentos y escrituras condicionadas.
5. `service.ts` según 6.3.
6. `conciliacion.ts` + barrido (D4) + `reintentar` concilia + `GET /pendientes` (D12).
7. Frontend: diálogo por estado + indicador de pendientes.
- Hecho cuando: pasan los escenarios de respuesta perdida, caída post-CAE y concurrencia.

**Fase 5: libro IVA por alícuota + fecha AR única**
1. `fecha-ar.ts` + unit.
2. N filas en `pos_iva_registro` con `fecha_fiscal` explícita.
3. Fecha del intento en `CbteFch`, `fecha_cbte` y QR. Si se aprueba D5, `fecha_fiscal` pasa a `fecha_cbte` al emitir.
- Se puede unir con la Fase 3.

**Fase 6: CI**
`.github/workflows/ci.yml` con Postgres 16 como servicio: typecheck, unit e integración (D13). Completar los escenarios que falten.

---

## 13. Estrategia para Cursor
- **Leer primero**:
  - `Backend/src/modules/fiscal/{service,repository,mappers,arca-client,types}.ts`.
  - `Backend/src/modules/pos/service.ts`, `Backend/src/lib/iva.ts`.
  - `Frontend/src/routes/index.tsx` (414-549, 1152-1160) y `Frontend/src/components/pos/FiscalResultDialog.tsx`.
  - Después, el SDK en `Backend/node_modules/@ramiidv/arca-facturacion/dist/{arca.js,facturacion.js,wsfe.js,types.d.ts}` y `@ramiidv/arca-common/dist/soap-client.js`.
- **Patrones a copiar**:
  - `withTransaction` (`config/db.ts:14-29`).
  - `withVentaFiscalLock` (`repository.ts:154-170`).
  - `AppError`.
  - `RadioColonia/app/src/server/compras/execute.integration.test.ts`.
  - Bloques `DO $$ ... IF NOT EXISTS` de `0008_pos_fiscal_invoicing.sql`.
- **No reinventar**: resolución A/B, cola offline, `ensureSaleMovimiento`, `config/arca.ts`.
- **No tocar**: ver sección 3.
- **Decisiones**: D1–D14 ya están cerradas (sección 15); aplicarlas tal cual. Si el gate D1 falla, aplicar el plan B (b) aprobado y reportarlo; cualquier otra decisión nueva se consulta.
- **Reglas duras**:
  - Nunca `estado='error'` sin la guarda de CAE.
  - Nunca llamar a ARCA dentro de una TX de DB.
  - Nunca `pool.query` dentro de la sección con lock.
  - Nunca `toISOString()` para fechas fiscales.
  - Nunca reemitir un `enviando/desconocido` sin conciliar.
- **Después de cada fase**:
  - `Backend/`: `npx tsc --noEmit`, `npm test`, `npm run test:integration` (con `TEST_DATABASE_URL`).
  - `Frontend/`: `npm run build` y lint.
- La `0031` va en un PR del repo ecommerce, mergeado y desplegado antes del PR de la Fase 4.
- Cursor usa su propia rama + PR. No crear ramas adicionales.

---

## 14. Riesgos técnicos
- 🔴 **ARCA rechaza la diferencia de 1 centavo de IVA.** Mitigación: gate D1 y plan B (D1-b) ya aprobado.
- 🔴 **Conciliación que marca `no_autorizado` algo autorizado.** Generaría duplicados. Mitigación: exigir "no existe" **y** `ultimo < nro`; tests de respuesta perdida; ante la duda, error manual.
- 🔴 **Ir a producción antes de la Fase 4.** Mitigación: el checklist de go-live lo bloquea.
- 🟡 **`0031` traba deploys.** Mitigación: todo condicional; el índice del libro solo se crea sin duplicados; probar dos corridas.
- 🟡 **Deadlock entre locks.** Mitigación: orden fijo, `lock_timeout`, client dedicado.
- 🟡 **409→200 con frontends viejos.** Mitigación: deploy conjunto; el frontend nuevo tolera ambos.
- 🟡 **Emisión en segundo plano cortada por un reinicio.** Mitigación: el barrido.
- 🟢 **Ventas viejas de homologación con neto entero.** Sin impacto fiscal.
- 🟢 **N filas por venta en el libro.** Sin consumidores en la UI.

---

## 15. Decisiones (todas cerradas el 2026-10-17)

Franco aprobó las 14 recomendaciones el 2026-10-17. No queda ninguna decisión pendiente. D1 sigue requiriendo el **gate técnico** en homologación al inicio de la Fase 3: si ARCA rechaza la diferencia de 1 centavo, se aplica la alternativa (b) ya aprobada como plan B, con revisión contable.

| # | Decisión | Alternativas consideradas | Decisión cerrada (2026-10-17) |
|---|---|---|---|
| D1 | Si ARCA no acepta 1 centavo de diferencia de IVA por alícuota | (a) Gate en homologación y seguir si acepta. (b) Si rechaza: neto ±1 centavo para que `Importe=round2(BaseImp×a)` y el centavo restante como `ImpTotConc`. (c) Aceptar `ImpTotal` ±0,01 del cobrado y registrar el redondeo | ✅ CERRADA 2026-10-17 — (a); si falla, (b) con revisión contable |
| D2 | Respuesta al replay de `client_sale_id` | (a) 200 + `duplicada`. (b) Mantener 409 con `details` | ✅ CERRADA 2026-10-17 — (a) |
| D3 | Tiempos | Valores | ✅ CERRADA 2026-10-17 — SDK 10 s / 1 reintento; presupuesto de emisión 25 s; frontend 45 s; pool 5 s; `lock_timeout` 20 s; todo por env |
| D4 | Conciliación automática | (a) Barrido al arrancar y cada 5 min. (b) Solo manual | ✅ CERRADA 2026-10-17 — (a) |
| D5 | Fecha del libro IVA | (a) Fecha AR de la venta, actualizada a `fecha_cbte` al emitir. (b) Siempre fecha de venta | ✅ CERRADA 2026-10-17 — (a) |
| D6 | `CbteFch` en reintentos de días posteriores | (a) Hoy AR. (b) Fecha de venta | ✅ CERRADA 2026-10-17 — (a) (ARCA exige ≥ última autorizada del PV/tipo) |
| D7 | Ventas de $0 con ARCA activo | (a) Rechazar antes de registrar. (b) Registrar sin comprobante. (c) Registrar con `error` | ✅ CERRADA 2026-10-17 — (a) (el ecommerce ya exige precio > 0 en activos) |
| D8 | Datos de homologación | (a) Dejarlos. (b) Limpiar | ✅ CERRADA 2026-10-17 — (a) + normalización de filas con CAE |
| D9 | Lock de numeración | (a) (ambiente, PV, tipo). (b) Lock global | ✅ CERRADA 2026-10-17 — (a) |
| D10 | Filas con CAE y estado ≠ emitido en la `0031` | (a) Normalizar a emitido. (b) No tocar | ✅ CERRADA 2026-10-17 — (a) |
| D11 | Quién reintenta/verifica | (a) Rol caja. (b) Solo admin | ✅ CERRADA 2026-10-17 — (a) |
| D12 | Lista de pendientes en el POS | (a) Indicador + lista. (b) Diferir | ✅ CERRADA 2026-10-17 — (a) |
| D13 | Esquema para integración y CI | (a) Fixture SQL en el POS + workflow con Postgres. (b) CI con checkout del repo ecommerce (token cruzado). (c) Solo local | ✅ CERRADA 2026-10-17 — (a) |
| D14 | `client_sale_id` obligatorio online | (a) Obligatorio. (b) Opcional | ✅ CERRADA 2026-10-17 — (a) |

---

## 16. Criterios de aceptación
**Importes** (ImpTotal = cobrado = QR = `pos_ventas.total` = Σ libro):
- [ ] $100 @21% → 82,64 / 17,36 / 100,00; `Iva=[{5, 82,64, 17,36}]`; QR importe 100.
- [ ] $100 @10,5% → 90,50 / 9,50 / 100,00; `Iva=[{4, 90,50, 9,50}]`.
- [ ] 3 productos distintos de $100 @21% → 247,93 / 52,07 / 300,00; netos de línea 82,65/82,64/82,64; Σ líneas = cabecera.
- [ ] $121 @21% + $110,50 @10,5% → `Iva=[{5,100,00,21,00},{4,100,00,10,50}]`, total 231,50; libro con 2 filas.
- [ ] $100 @21% + $100 @10,5% → 173,14 / 26,86 / 200,00.
- [ ] Movimiento de caja = total cobrado.

**Recuperación fiscal**
- [ ] Una fila con CAE nunca sale de `emitido`.
- [ ] Respuesta perdida → conciliación → emitido con el mismo número; 1 sola autorización.
- [ ] Caída antes de enviar → `no_autorizado` → reemisión con el mismo número.
- [ ] Reintentos concurrentes → 1 sola llamada a `crearFactura`.
- [ ] 5 emisiones concurrentes del mismo PV+tipo → números consecutivos.
- [ ] Cada intento persistido antes de enviar.

**Venta idempotente**
- [ ] Doble clic, timeout o error después del commit → 1 venta, 1 movimiento de caja, stock descontado 1 vez.
- [ ] `processSale` no lanza después del commit (incluido 40P01 y $0).
- [ ] El replay no emite con una emisión en curso o un comprobante existente.

**Fechas y libro**
- [ ] 23:30 AR → todas las fechas en el mismo día AR.
- [ ] Una fila por alícuota real.

**Infra**
- [ ] `connectionTimeoutMillis` configurado; pool chico sin cuelgues.
- [ ] El frontend corta a los 45 s y queda en Verificar.
- [ ] `0031` corre dos veces sin error.
- [ ] Unit + integración verdes en CI.

---

## 17. Checklist final para Cursor
**Antes**: D1–D14 cerradas el 2026-10-17 (sección 15); leer lo indicado en la sección 13; Postgres local con `TEST_DATABASE_URL`.
**Backend**: guardas; `fiscal-importes` + `fecha-ar`; `crearFactura` + parser; estados + intentos + lock PV + client dedicado; conciliación + barrido + `/pendientes`; `processSale` no lanzante; timeouts.
**Database (ecommerce)**: `0031` idempotente; ambos `verify-schema`; dos corridas en una copia de staging.
**Frontend**: `ApiError` + timeout; venta en curso + banner; diálogo por estado; indicador de pendientes.
**Tests**: unit + integración (sección 11) + CI.

**Homologación** (`ARCA_ENABLED=true`, `ARCA_PRODUCTION=false`, certs homo):
- [ ] `GET /api/v1/fiscal/config` → `ambiente: dev` y timeouts.
- [ ] `GET /api/v1/fiscal/wsaa-ping` ok.
- [ ] Gate D1: Factura B $100 @21% con 82,64/17,36 aceptada.
- [ ] Factura B CF: $100 @21%, $100 @10,5%, 3×$100 y mixta; `FECompConsultar` coincide con caja y QR.
- [ ] Factura A a RI y a monotributista (regresión PR #10).
- [ ] Venta a las 23:30 AR (o reloj simulado): fechas coinciden; QR validado en el sitio de ARCA.
- [ ] Cortar la red durante `FECAESolicitar` → `desconocido` → Verificar → emitido sin número nuevo.
- [ ] Matar el backend a mitad de una emisión → el barrido lo resuelve al reiniciar.
- [ ] Dos cajas cobrando a la vez → números consecutivos.
- [ ] Doble clic y recarga a mitad de cobro → 1 venta.
- [ ] Venta offline + sync → 1 comprobante.
- [ ] Libro IVA del día = Σ ventas, una fila por alícuota.
- [ ] Intentos: uno por envío, ninguno abierto colgado.

**Go-live**: Fases 1 a 6 desplegadas y checklist de homologación completo → recién entonces certs de producción y `ARCA_PRODUCTION=true`.

---

## 18. Resumen ejecutivo
- **Cambian (POS)**:
  - Backend: `lib/iva.ts`, `pos/{service,routes,schemas}.ts`, `fiscal/{service,repository,mappers,arca-client,types,routes}.ts`, `config/{db,env}.ts`, `db/verify-schema.ts`, bootstrap, tests.
  - Frontend: `lib/api-client.ts`, `lib/offline-queue.ts`, `routes/index.tsx`, `components/pos/FiscalResultDialog.tsx`.
  - Docs: `docs/DEPLOY.md`.
- **Nuevos (POS)**: `lib/fiscal-importes.ts`, `lib/fecha-ar.ts`, `fiscal/{estado,conciliacion}.ts`, tests de integración, `test/fixtures/pos-schema.sql`, `vitest.integration.config.ts`, `.github/workflows/ci.yml`.
- **Migración**: una, en el repo **ecommerce**: `app/src/db/migrations/0031_pos_fiscal_intentos.sql`. Se despliega antes de la Fase 4 del POS.
- **Endpoints**: cambian `POST /pos/ventas` (replay 200) y `POST /fiscal/ventas/:id/reintentar` (concilia); nuevo `GET /fiscal/pendientes`.
- **Componentes**: diálogo fiscal por estado, banner de venta sin confirmar, indicador de pendientes.
- **Riesgos**: tolerancia de ARCA al centavo (D1), conciliación correcta, no ir a producción antes de la Fase 4.
- **Decisiones**: D1–D14 cerradas el 2026-10-17 con la opción recomendada.
- **Orden**: (0) infraestructura de tests → 1 guardas → 2 `client_sale_id` → 3 importes explícitos (gate D1) → 4 intentos + conciliación + lock PV (`0031` antes) → 5 libro por alícuota + fecha AR → 6 CI.

### Fuera de alcance / mejoras futuras
- Notas de crédito y anulación (`anulado`).
- PDF del comprobante (`iva_detalle` lo facilita).
- Tope de Factura B a consumidor final sin identificar (no verificado).
- Tests de integración en el CI del ecommerce.
- Test que compare las listas de alícuotas entre ecommerce y POS.
