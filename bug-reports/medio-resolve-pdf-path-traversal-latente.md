# [🟡 MEDIO] `resolvePdfPath` con prefix check frágil (latente)

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Potencial  
**Fecha auditoría:** 2026-09-11

## Problema
Usa `path.resolve(base, storageKey)` y `resolved.startsWith(base)` sin exigir `base + path.sep`. Patrón clásico de bypass si `storageKey` fuera controlado. Hoy las keys son UUID al escribir y no hay ruta HTTP de download que lo use.

## Evidencia
`Backend/src/modules/compras/importacion/pdf-storage.ts`.

## Reproducción
N/A vía API HTTP actual; unit-call con key crafted adyacente al base dir.

## Causa
Canonicalización incompleta.

## Impacto
Una futura feature de download/admin podría leer fuera del directorio.

## Archivos afectados
- `Backend/src/modules/compras/importacion/pdf-storage.ts`

## Solución propuesta
`resolved === base || resolved.startsWith(base + sep)`; allowlist de filename.

## Tests recomendados
`../`, paths absolutos y prefijos `compras-pdfs-evil` rechazados.
