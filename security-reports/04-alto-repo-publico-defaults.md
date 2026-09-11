# Repositorio público con secretos de ejemplo, PIN/JWT por defecto y host Coolify

**Severidad:** 🟠 ALTO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Infraestructura
**Prioridad:** P1

## Problema

El repo es **público**. Expone arquitectura de deploy, variables, PIN/JWT de ejemplo y en `.env.coolify.example` un `DB_HOST` con forma de hostname interno Coolify. Aunque las passwords de ejemplo son placeholders, facilita reconocimiento y phishing/ops mistakes. `docker-compose.yml` fija PIN `1234` y JWT de desarrollo.

## Evidencia

- `gh repo view` → `visibility: PUBLIC`, `isPrivate: false`.
- `.env.coolify.example` — `DB_HOST` con hostname tipo Coolify, `DB_PASSWORD=cambiar`.
- `Backend/.env.example` — `POS_ACCESS_PIN=1234`, `POS_JWT_SECRET` de desarrollo.
- `docker-compose.yml` — mismos defaults de desarrollo.
- No hay `.env` / `.pem` / `.key` commiteados (solo `Backend/certs/.gitkeep`) — positivo.

## Impacto

Inteligencia para atacantes; riesgo de reutilizar defaults en prod; posible fuga de identificadores de infra.

## Archivos

`.env.coolify.example`, `Backend/.env.example`, `docker-compose.yml`

## Recomendación

Hacer el repo **privado** (o split docs públicos vs ops); sanitizar `DB_HOST` a placeholder genérico; rotar cualquier secreto/host real que se haya pegado; secret scanning + branch protection. **Rotar** PIN/JWT/DB si alguna vez se usaron los valores de ejemplo en un entorno expuesto.

## Fuente

Metadatos GitHub + archivos de ejemplo
