# Diferidos — radio-colonia-pos

Aplazados **a propósito** (ARCA / no en producción).  
Al activar facturación, mover a `ABIERTOS.md`.

---

## [🔴 CRÍTICO] `sincronizada_offline` en `/pos/ventas` saltea ARCA

**Estado:** Diferido · código **sin cambio** al 2026-09-11  
**Archivos:** `Backend/src/modules/pos/schemas.ts`, `service.ts`, fiscal service

**Cuando activar ARCA:** ignorar el flag fuera de `processOfflineBatch`; forzar emit/cola.

---

## [🟡 MEDIO] Race emisión ARCA misma venta

**Estado:** Diferido  
**Archivos:** `Backend/src/modules/fiscal/repository.ts`, `service.ts`

**Cuando activar:** `UNIQUE(venta_id)` / row lock / advisory lock.

---

## [🔵 BAJO] `/fiscal/config` siempre reporta “homologacion”

**Estado:** Diferido  
**Archivo:** `Backend/src/modules/fiscal/routes.ts`

**Cuando activar:** devolver `ambiente` real desde config (`ARCA_PRODUCTION`).
