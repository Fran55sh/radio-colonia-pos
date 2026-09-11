# [🟠 ALTO] JWT / `API_TOKEN` con privilegio total (un solo rol)

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Un solo rol (`sub: "pos"`). Cualquier Bearer válido puede crear ventas, mutar stock vía compras, leer/editar clientes, leer IVA, reintentar ARCA. No hay ACL por objeto más allá de “tiene token”.

## Evidencia
Payload JWT mínimo; rutas de `clientes`, `fiscal`, `compras`, `contabilidad`, `analytics` sin ACL adicional. Frontend guarda JWT en `sessionStorage`.

## Reproducción
Robar/adivinar PIN o leer JWT de `sessionStorage` → llamar endpoints sensibles.

## Causa
Credencial compartida de local sin controles de blast-radius.

## Impacto
Sesión robada = control operativo y fiscal sobre la superficie POS de la DB compartida.

## Archivos afectados
- `Backend/src/middleware/auth.ts`
- `Backend/src/modules/auth/service.ts`
- módulos `routes.ts` de pos/clientes/fiscal/compras/contabilidad/analytics
- `Frontend/src/lib/auth-session.ts`

## Solución propuesta
Roles (caja vs admin compras/fiscal); tokens de corta vida; binding de dispositivo; 2º factor / PIN admin en rutas de alto riesgo.

## Tests recomendados
Token de caja no puede ejecutar importaciones ni escrituras de contabilidad.
