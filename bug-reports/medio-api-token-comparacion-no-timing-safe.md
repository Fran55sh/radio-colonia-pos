# [🟡 MEDIO] `API_TOKEN` comparado con `===` (no timing-safe)

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Bearer igual a `env.API_TOKEN` usa `===`, no `timingSafeEqual`. El path del PIN sí usa comparación timing-safe.

## Evidencia
`Backend/src/middleware/auth.ts`.

## Reproducción
Side-channel teórico sobre token de integración de larga vida.

## Causa
Inconsistencia con el path del PIN.

## Impacto
Menor frente a otros hallazgos; acceso total a la API si el token se recupera.

## Archivos afectados
- `Backend/src/middleware/auth.ts`

## Solución propuesta
Length-check + `timingSafeEqual` sobre buffers.

## Tests recomendados
Tokens de largo incorrecto fallan cerrado; token válido pasa.
