# [🟠 ALTO] Idempotencia `client_sale_id` fuera de la transacción (TOCTOU)

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Probable  
**Fecha auditoría:** 2026-09-11

## Problema
`findVentaByClientSaleId` corre antes de `withTransaction(registerSale…)`. Dos requests concurrentes con el mismo `client_sale_id` pueden pasar el check y doble-insertar / doble-descontar stock si no hay UNIQUE en DB. El UNIQUE no está definido en este repo (DDL en migrador del ecommerce).

## Evidencia
`Backend/src/modules/pos/service.ts`; schema local stub apunta a migraciones del ecommerce.

## Reproducción
`POST /pos/ventas` o offline-batch en paralelo con el mismo `client_sale_id`.

## Causa
Check a nivel aplicación sin upsert/UNIQUE visible en este repo.

## Impacto
Ventas duplicadas, doble descuento de stock, fiscal inconsistente.

## Archivos afectados
- `Backend/src/modules/pos/service.ts`
- Migraciones POS en Fran55sh/RadioColonia (externo a este repo)

## Solución propuesta
`UNIQUE(client_sale_id)` + capturar violación como 409; o `INSERT … ON CONFLICT` dentro de la misma TX que actualiza stock. Verificar constraint en migraciones del ecommerce.

## Tests recomendados
Concurrentes con mismo `client_sale_id` → un 201 y un 409; delta de stock = una venta.
