# Login por PIN sin rate limiting / lockout (fuerza bruta)

**Severidad:** 🟠 ALTO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad
**Prioridad:** P0

## Problema

`POST /api/v1/auth/login` es público y no hay `@fastify/rate-limit`, backoff, CAPTCHA ni bloqueo temporal. El PIN acepta desde 4 caracteres; ejemplos de desarrollo usan `1234`. Comparación del PIN sí usa `timingSafeEqual` (bien), pero no mitiga enumeración por volumen.

## Evidencia

- `Backend/src/modules/auth/routes.ts` — login sin throttling.
- `Backend/src/app.ts` — no registra rate-limit ni helmet.
- `docker-compose.yml` — `POS_ACCESS_PIN: "1234"`.
- Búsqueda: sin `@fastify/rate-limit` / `helmet` en dependencias (`Backend/package.json`).

## Impacto

Ataque online contra el endpoint de login (si la API es alcanzable) hasta descubrir el PIN compartido → acceso total (ver hallazgo crítico de privilegios).

## Archivos

`Backend/src/modules/auth/routes.ts`, `Backend/src/app.ts`, `Backend/package.json`, `docker-compose.yml`

## Recomendación

Rate limit estricto por IP + dispositivo; lockout tras N fallos; PIN largo/alfanumérico o mejor reemplazar por usuarios+MFA en admin; WAF/Coolify rate limits; alertas.

## Fuente

Código + manifests
