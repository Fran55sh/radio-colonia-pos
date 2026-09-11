# [🔴 CRÍTICO] `sincronizada_offline` en venta normal saltea ARCA

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Cualquier cliente autenticado puede enviar `sincronizada_offline: true` en `POST /pos/ventas` y el servidor saltea la emisión fiscal de esa venta (salvo un reintento manual posterior).

## Evidencia
`createSaleSchema` permite el flag; `processSale` hace `skipFiscal = input.sincronizada_offline === true` y lo pasa a `maybeEmitirDespuesDeVenta`. El offline-batch fuerza el flag y emite aparte; el path de venta simple no restringe el flag al batch.

## Reproducción
`POST /api/v1/pos/ventas` con Bearer válido y `"sincronizada_offline": true` → 201, sin comprobante / fiscal null.

## Causa
Flag controlado por el cliente reutilizado como bypass fiscal, no limitado al pipeline batch.

## Impacto
Evasión / libros fiscales incompletos mientras stock y `pos_ventas` sí se confirman.

## Archivos afectados
- `Backend/src/modules/pos/schemas.ts`
- `Backend/src/modules/pos/service.ts`
- `Backend/src/modules/fiscal/service.ts`

## Solución propuesta
Ignorar `sincronizada_offline` en `/pos/ventas`; setearlo solo dentro de `processOfflineBatch`. O política server-side que fuerce emit/cola fiscal.

## Tests recomendados
`/pos/ventas` siempre intenta emit cuando ARCA está configurado; batch sigue deduplicando y emitiendo una vez.
