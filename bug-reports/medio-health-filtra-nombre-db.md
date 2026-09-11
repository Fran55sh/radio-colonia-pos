# [🟡 MEDIO] `/health` público filtra detalles de DB

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Health sin auth devuelve `database`, `database_name`, `schema_ready`.

## Evidencia
`Backend/src/app.ts` ruta `/health`.

## Reproducción
`GET /health` sin token.

## Causa
Detalle operativo en probe público.

## Impacto
Ayuda a reconocimiento (nombre DB, readiness).

## Archivos afectados
- `Backend/src/app.ts`

## Solución propuesta
Liveness público mínimo; health detallado detrás de auth o red interna.

## Tests recomendados
Body público sin `database_name`.
