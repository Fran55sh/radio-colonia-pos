# Misma base PostgreSQL que el ecommerce — radio de explosión elevado

**Severidad:** 🟠 ALTO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Infraestructura / Ecommerce
**Prioridad:** P0

## Problema

El POS escribe en tablas compartidas del catálogo (`product_variants.stock`, `product_supplier_offers`, `suppliers`). Un compromiso del proceso POS o de sus credenciales DB afecta el ecommerce (stock, costos, mapeos proveedor). No hay evidencia de DB user con privilegios mínimos (solo `pos_*` + columnas necesarias).

## Evidencia

- `README.md`, `docs/DEPLOY.md` — “misma PostgreSQL del ecommerce”.
- `Backend/src/lib/catalog.ts` — `UPDATE product_variants … SET stock = stock - $1` / `stock + $1`.
- `Backend/src/modules/compras/importacion/execute.ts` — upsert en `product_supplier_offers`, create proveedor.

## Impacto

Lateral movement POS → ecommerce; corrupción de stock online; manipulación de costos.

## Archivos

`README.md`, `docs/DEPLOY.md`, `Backend/src/lib/catalog.ts`, `Backend/src/modules/compras/importacion/execute.ts`, `Backend/src/config/db.ts`

## Recomendación

Usuario PostgreSQL dedicado con GRANT mínimo; RLS si multi-sucursal; considerar cola/API del ecommerce para ajustes de stock en lugar de DML directo; monitoreo de cambios de stock.

## Fuente

Documentación + código
