# Cola offline en localStorage + ventas sobre stock sin control de caja

**Severidad:** 🟠 ALTO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Ecommerce / Privacidad
**Prioridad:** P1

## Problema

Las ventas offline se guardan en `localStorage` (`radio-colonia-pos-offline-queue`) con payload de venta (incl. `cliente_id`, líneas, medio de pago). El frontend permite encolar aunque se supere stock. Al sincronizar, el servidor sí bloquea stock insuficiente en online (`lockAndDecrementForSale`), pero el flujo offline puede acumular inconsistencias y deja datos de negocio/PII en el navegador de un dispositivo compartido de caja.

## Evidencia

- `Frontend/src/lib/offline-queue.ts` — persistencia en `localStorage`.
- `Frontend/src/routes/index.tsx` — `enqueueSale` ante fallos / stock; mensajes de “supera stock… guardada offline”.
- `Backend/src/modules/pos/service.ts` — batch offline marca `sincronizada_offline: true` y difiere fiscal.

## Impacto

Robo físico/acceso al browser → cola de ventas y referencias a clientes; discrepancias de inventario ecommerce; ventanas de fraude antes de sync.

## Archivos

`Frontend/src/lib/offline-queue.ts`, `Frontend/src/routes/index.tsx`, `Backend/src/modules/pos/service.ts`

## Recomendación

Cifrar cola con clave de sesión; no persistir PII innecesaria; política clara “no vender sin stock” también offline; limpiar cola al logout; considerar IndexedDB con partición por dispositivo registrado.

## Fuente

Código frontend/backend
