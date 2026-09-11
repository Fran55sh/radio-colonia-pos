# [🔵 BAJO] PIN almacenado/comparado como SHA-256 sin KDF

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
`hashPin` = SHA-256(pin) con compare timing-safe. Débil ante leak de `.env` + PIN corto (diccionario offline rápido).

## Evidencia
`Backend/src/modules/auth/service.ts`.

## Reproducción
Offline crack del hash tras leak de config con PIN corto.

## Causa
PIN compartido tratado como password hash sin KDF.

## Impacto
Acelera recuperación offline del PIN si hay leak de env.

## Archivos afectados
- `Backend/src/modules/auth/service.ts`

## Solución propuesta
Comparar contra el secret de env con timing-safe, o guardar argon2id de un secret fuerte.

## Tests recomendados
PIN incorrecto rechazado; path timing-safe cubierto.
