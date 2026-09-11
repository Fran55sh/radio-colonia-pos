# [🟠 ALTO] JWT secret débil y fallback de desarrollo conocido

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
En production, `POS_JWT_SECRET` exige mínimo 16 caracteres. En non-production, si falta, hay fallback a un string fijo conocido. El `.env.example` documenta ese sample.

## Evidencia
`Backend/src/config/env.ts`; `getJwtSecret()` en auth service; `.env.example`.

## Reproducción
Forjar HS256 JWT con secret corto o el fallback de ejemplo → API completa.

## Causa
Mínimo de entropía bajo + fallback predecible.

## Impacto
Falsificación offline de sesiones si el secret es débil o se copia del example.

## Archivos afectados
- `Backend/src/config/env.ts`
- `Backend/src/modules/auth/service.ts`
- `Backend/.env.example`

## Solución propuesta
Exigir ≥32 bytes random; rechazar secrets de ejemplo conocidos; sin fallback fuera de tests.

## Tests recomendados
Boot rechaza secrets cortos/conocidos en production.
