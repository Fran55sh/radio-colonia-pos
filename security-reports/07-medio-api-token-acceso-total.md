# `API_TOKEN` con acceso total y comparación no constant-time

**Severidad:** 🟡 MEDIO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad
**Prioridad:** P2

## Problema

Si `API_TOKEN` está definido, cualquier Bearer igual a ese valor bypassa el JWT y obtiene la misma superficie completa. La comparación es `token === env.API_TOKEN` (no `timingSafeEqual`).

## Evidencia

`Backend/src/middleware/auth.ts` — comparación con `API_TOKEN`.

## Impacto

Token de integración = superusuario API; leak en logs/CI = compromiso total. Timing leak teórico menor vs PIN.

## Archivos

`Backend/src/middleware/auth.ts`, `Backend/src/config/env.ts`

## Recomendación

Comparación timing-safe; scopes; rotación; no usar un único token estático de larga vida.

## Fuente

Código
