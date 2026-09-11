# [🔴 CRÍTICO] API abierta si falta `NODE_ENV=production` y PIN

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
`NODE_ENV` default `development`. El fail-fast por PIN/JWT secret ausente solo corre cuando `NODE_ENV === "production"`. `requireAuth` abre toda `/api/*` si no hay PIN y el env no es production. `GET /auth/config` publica `auth_required: false`.

## Evidencia
`Backend/src/config/env.ts`; `Backend/src/middleware/auth.ts` early-return; rutas auth públicas de config.

## Reproducción
Deploy sin `NODE_ENV=production` y sin `POS_ACCESS_PIN` → llamadas sin token a productos, ventas, compras, contabilidad, etc.

## Causa
Gate de conveniencia de desarrollo atado a `NODE_ENV` con default inseguro.

## Impacto
Compromiso operativo completo del POS y de la DB compartida con el ecommerce (stock, ventas, clientes, IVA, ARCA).

## Archivos afectados
- `Backend/src/config/env.ts`
- `Backend/src/middleware/auth.ts`
- `Backend/src/app.ts`
- `Backend/src/modules/auth/routes.ts`

## Solución propuesta
Fail closed salvo `AUTH_OPEN=true` explícito para local; exigir PIN fuera de development; checks de deploy/health para `auth_required`.

## Tests recomendados
Boot sin PIN y sin production → no escucha o rechaza API; config refleja auth requerida.
