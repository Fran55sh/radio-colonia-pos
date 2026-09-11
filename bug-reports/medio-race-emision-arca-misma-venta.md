# [🟡 MEDIO] Race de emisión ARCA sobre la misma venta

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Probable  
**Fecha auditoría:** 2026-09-11

## Problema
`ensureComprobantePendiente` es check-then-insert sin `FOR UPDATE` / manejo claro de conflicto en-repo; reintentos paralelos pueden llamar ARCA dos veces.

## Evidencia
`Backend/src/modules/fiscal/repository.ts`, `service.ts`, `routes.ts`.

## Reproducción
`POST /fiscal/ventas/:id/reintentar` en paralelo sobre venta pending/error.

## Causa
Falta lock transaccional / UNIQUE `venta_id` visible aquí.

## Impacto
Requests AFIP duplicados / estado local inconsistente.

## Archivos afectados
- `Backend/src/modules/fiscal/repository.ts`
- `Backend/src/modules/fiscal/service.ts`
- `Backend/src/modules/fiscal/routes.ts`

## Solución propuesta
`UNIQUE(venta_id)`, row lock o advisory lock alrededor de la emisión.

## Tests recomendados
Retry paralelo → una sola fila CAE.
