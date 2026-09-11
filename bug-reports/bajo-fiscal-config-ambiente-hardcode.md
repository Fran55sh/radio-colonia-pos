# [🔵 BAJO] `/fiscal/config` siempre reporta ambiente homologación

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Cuando ARCA está enabled, la config siempre dice ambiente `"homologacion"` y no refleja `ARCA_PRODUCTION`.

## Evidencia
`Backend/src/modules/fiscal/routes.ts` vs `getArcaConfig().ambiente`.

## Reproducción
Habilitar ARCA production → config sigue diciendo homologación.

## Causa
String hardcodeado.

## Impacto
Confusión operativa / supuestos fiscales incorrectos (integridad, no exploit directo).

## Archivos afectados
- `Backend/src/modules/fiscal/routes.ts`

## Solución propuesta
Devolver el `ambiente` real de la config.

## Tests recomendados
Flags prod/dev mapean correctamente.
