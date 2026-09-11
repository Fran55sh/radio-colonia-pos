# Ausencia de security headers (CSP, HSTS, X-Frame-Options, etc.)

**Severidad:** 🟡 MEDIO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad
**Prioridad:** P2

## Problema

Ni el backend Fastify ni evidencia en el frontend Nitro configuran `@fastify/helmet` / CSP / frame-guard. Depende 100% del reverse proxy Coolify.

## Evidencia

`Backend/package.json` sin helmet; `Backend/src/app.ts` solo CORS + multipart; `Frontend/vite.config.ts` sin headers de seguridad.

## Impacto

Mayor riesgo XSS/clickjacking si aparece un bug de render; defensa en profundidad débil.

## Archivos

`Backend/src/app.ts`, `Backend/package.json`, `Frontend/vite.config.ts`

## Recomendación

Helmet en API; headers en Nitro/`routeRules` o en Coolify (CSP estricta, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).

## Fuente

Código
