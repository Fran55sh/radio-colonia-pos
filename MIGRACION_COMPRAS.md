# Migración: eliminación del módulo de compras del POS

## Contexto

La carga de facturas de compra vive ahora en el admin del ecommerce
(`Fran55sh/RadioColonia`, PRs #18 y #19; plan `features/mover-facturas-a-admin.md` paso 6).

Este repo (POS) deja de exponer:

- la ruta/pantalla `/compras` y su navegación
- el rol `compras` y el PIN `POS_COMPRAS_PIN`
- los endpoints `/api/v1/compras/*` (órdenes, proveedores, importación PDF)

Ventas, caja, fiscal, clientes y el stock ledger del POS **no cambian**.

## Base de datos: sin borrados

**No borrar tablas ni migraciones `pos_compras*`.** El ecommerce las usa:

- `pos_ordenes_compra`
- `pos_ordenes_compra_lineas`
- `pos_facturas_compra`
- `pos_compras_importaciones`
- `pos_comprobantes_fiscales` (fiscal; no es exclusiva de compras)
- `suppliers`
- `product_supplier_offers`

El verificador de schema del POS sigue exigiendo esas tablas porque comparte la misma DB.

## Usuarios que tenían el rol de compras

El POS no tiene una tabla de usuarios: el “rol” sale del PIN. **No hay filas que borrar.**

| Situación | Qué hacer |
|-----------|-----------|
| Solo cargaba facturas con `POS_COMPRAS_PIN` | Sacarle el PIN del POS. Darle acceso al **admin del ecommerce** (ahí está la carga). |
| Usaba compras **y** caja | Que entre con `POS_ACCESS_PIN` (rol `caja`). Las facturas, en el admin del ecommerce. |
| `POS_DEFAULT_ROLE=compras` en el entorno | Cambiar a `caja` (el backend también lo interpreta como `caja` si quedó el valor viejo). |
| JWT de sesión ya emitido con `role=compras` | Sigue valiendo como **caja** hasta que expire. Pedir re-login con PIN de caja o admin. |

**No intentes un mapeo automático masivo.** Revisá quién necesita caja y quién solo admin ecommerce.

## Variables de entorno

Dejá de usar (ya no tienen efecto; sacalas del compose/Coolify):

```bash
POS_COMPRAS_PIN=
COMPRAS_PDF_DIR=
```

Mantené:

- `POS_ACCESS_PIN` — PIN de caja
- `POS_ADMIN_PIN` — PIN admin (analytics, contabilidad, clientes, fiscal, caja)
- `POS_DEFAULT_ROLE` — `caja` (default) o `admin`

## Ledger de stock

`StockLedgerTipo` incluye `reverso_compra_factura` para alinearse con el ecommerce.
El POS no escribe reversos de compra: eso lo hace el admin. El ledger POS solo corre
si `POS_STOCK_LEDGER_ENABLED=true` (ventas).

## Verificación

1. POS: login con PIN de caja. No debe haber botón ni ruta `/compras`.
2. `POST /api/v1/compras/*` debe responder 404.
3. Ecommerce admin: carga / reverso de facturas sigue funcionando.
4. Tablas `pos_compras*` siguen existiendo.
