# Endpoint `/health` público con información de base de datos

**Severidad:** 🟡 MEDIO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Infraestructura
**Prioridad:** P2

## Problema

`GET /health` no requiere auth y devuelve `database`, `database_name`, `schema_ready`, estado del servicio. Útil para ops, pero ayuda a reconocimiento.

## Evidencia

`Backend/src/app.ts` — health público + `current_database()`.

## Impacto

Reconocimiento; confirmación de target y nombre de DB.

## Archivos

`Backend/src/app.ts`

## Recomendación

Health “liveness” mínimo público; detalles solo en red interna o con auth; no exponer `database_name` a Internet.

## Fuente

Código
