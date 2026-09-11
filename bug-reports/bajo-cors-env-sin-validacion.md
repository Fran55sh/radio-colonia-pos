# [🔵 BAJO] CORS enteramente env-driven (riesgo de misconfig)

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Potencial  
**Fecha auditoría:** 2026-09-11

## Problema
`CORS_ORIGIN` se parsea por comas y se pasa a `@fastify/cors` sin validar/rechazar `*`.

## Evidencia
`Backend/src/app.ts`, `Backend/src/config/env.ts`.

## Reproducción
Setear `CORS_ORIGIN` a orígenes no deseados; con token robado (o auth abierta) el browser desde ese origen puede pegarle a la API.

## Causa
Sin allowlist estricta.

## Impacto
Amplifica XSS/robo de token y el footgun de auth abierta.

## Archivos afectados
- `Backend/src/app.ts`
- `Backend/src/config/env.ts`

## Solución propuesta
Validar origins https absolutos; rechazar `*`.

## Tests recomendados
Parser rechaza `*`.
