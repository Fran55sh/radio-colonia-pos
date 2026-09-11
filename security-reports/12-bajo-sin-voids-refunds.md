# Sin voids/refunds/descuentos post-venta en API (superficie reducida, hueco operativo)

**Severidad:** 🔵 BAJO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Ecommerce
**Prioridad:** P3

## Problema

No hay endpoints de anulación, devolución, descuento manual ni apertura de cajón. El precio de venta lo impone el servidor desde catálogo + tramos (bien). Esto reduce fraude por descuentos arbitrarios, pero no hay flujo controlado de correcciones (puede empujar a workarounds fuera de sistema).

## Evidencia

`Backend/src/modules/pos/routes.ts` / `schemas.ts` / `service.ts` — solo alta de ventas; búsqueda sin void/refund/descuento server-side.

## Impacto

Bajo como vulnerabilidad; medio como control de negocio/auditoría futura.

## Archivos

`Backend/src/modules/pos/*`

## Recomendación

Cuando se implementen, exigir rol admin, motivo, doble aprobación y asiento inverso fiscal.

## Fuente

Código
