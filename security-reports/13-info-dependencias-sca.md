# Dependencias (manifests) — revisión sin lock audit ejecutado

**Severidad:** ⚪ INFO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Potencial
**Área:** Seguridad / Infraestructura
**Prioridad:** P2 (proceso continuo)

## Problema

Backend: `fastify@^5.3.3`, `@fastify/cors`, `@fastify/multipart`, `pg`, `zod`, `pdf-parse`/`legacy-pdf-parse`, `pdfjs-dist`, `@ramiidv/arca-facturacion`. Frontend: TanStack Start/Router/Query, React 19, Vite 7, Nitro beta, Radix, etc. No se ejecutó `npm audit` ni se corrió la app.

## Evidencia

`Backend/package.json`, `Frontend/package.json` (+ lockfiles presentes).

## Impacto

CVEs posibles en PDF parsers / Nitro beta / transitive deps.

## Archivos

`Backend/package.json`, `Frontend/package.json`, lockfiles

## Recomendación

`npm audit` / Dependabot / Renovate en CI; pinnear Nitro estable cuando sea posible; aislar parsers PDF.

## Fuente

Manifests
