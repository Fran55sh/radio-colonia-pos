# [🟠 ALTO] Login PIN sin rate limit

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
`POST /auth/login` es público; no hay rate-limit/lockout. PIN mínimo 4 caracteres; examples usan valores débiles.

## Evidencia
`Backend/src/modules/auth/routes.ts`; `env.ts` `POS_ACCESS_PIN.min(4)`; `package.json` sin plugin de rate-limit.

## Reproducción
Intentos paralelos de PIN contra `/api/v1/auth/login` hasta 200.

## Causa
Secreto compartido corto + intentos online ilimitados.

## Impacto
Brute force del PIN local → JWT con acceso total a la API.

## Archivos afectados
- `Backend/src/modules/auth/routes.ts`
- `Backend/src/modules/auth/service.ts`
- `Backend/src/config/env.ts`

## Solución propuesta
Rate limit por IP (+ global); backoff; política de PIN más fuerte; considerar códigos por dispositivo.

## Tests recomendados
N fallos → 429; login válido sigue funcionando.
