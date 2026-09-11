# `UPDATE` dinámico en clientes (nombres de columna desde Object.entries)

**Severidad:** 🔵 BAJO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Potencial
**Área:** Seguridad
**Prioridad:** P3

## Problema

`updateCliente` arma `SET ${key} = $n` desde keys del objeto. Hoy Zod strippea keys desconocidas (`updateClienteSchema`), por lo que el riesgo real es bajo, pero el patrón es frágil si alguien usa `.passthrough()` o reutiliza la función.

## Evidencia

`Backend/src/modules/clientes/service.ts` + `schemas.ts`.

## Impacto

SQLi de columnas si el contrato de validación se debilita.

## Archivos

`Backend/src/modules/clientes/service.ts`

## Recomendación

Whitelist explícita de columnas permitidas.

## Fuente

Código
