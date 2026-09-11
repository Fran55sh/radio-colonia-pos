# Un solo PIN otorga privilegios de cajero + compras + stock + contabilidad + fiscal + PII

**Severidad:** 🔴 CRÍTICO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad
**Prioridad:** P0 — diseño antes de más superficie de negocio

## Problema

No hay roles, usuarios ni separación de privilegios. Cualquier poseedor del PIN (o del JWT / `API_TOKEN`) puede: cobrar ventas, importar facturas de compra y **subir stock** en `product_variants`, consultar rentabilidad/costos, libros IVA, reintentar emisión ARCA y leer/modificar clientes con CUIT/DNI/domicilio. El JWT siempre lleva `sub: "pos"` — no hay identidad de operador ni auditoría de “quién hizo qué”.

## Evidencia

- `Backend/src/modules/auth/service.ts` — `signToken()` fija `sub: "pos"`; login solo valida PIN.
- `Backend/src/middleware/auth.ts` — un único `requireAuth` para toda `/api/`.
- `Backend/src/modules/compras/importacion/execute.ts` — `lockAndIncrementForPurchase` / ofertas proveedor.
- `Backend/src/modules/analytics/routes.ts`, `contabilidad/routes.ts`, `fiscal/routes.ts`, `clientes/routes.ts` — mismos privilegios que caja.

## Impacto

Compromiso del PIN (filtración, PIN débil, dispositivo compartido, ex-empleado) equivale a control operativo completo del POS y a manipulación de inventario/catálogo del ecommerce. Fraude interno difícil de atribuir.

## Archivos

`Backend/src/middleware/auth.ts`, `Backend/src/modules/auth/service.ts`, `Backend/src/modules/compras/importacion/execute.ts`, `Backend/src/modules/analytics/routes.ts`, `Backend/src/modules/contabilidad/routes.ts`, `Backend/src/modules/clientes/routes.ts`, `Backend/src/modules/fiscal/routes.ts`

## Recomendación

Introducir usuarios staff (o SSO) con RBAC mínimo: `caja`, `compras`, `admin`, `solo_lectura`. Exigir rol elevado para importaciones/ejecutar compras, contabilidad y reintentos fiscales. Auditar `actor_id` en ventas, importaciones y ajustes de stock. Separar `API_TOKEN` con scopes.

## Fuente

Revisión estática de código (`main`)
