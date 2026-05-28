-- Tablas operativas POS (catálogo en products / product_variants del ecommerce).
-- Requiere que el schema ecommerce ya esté aplicado (suppliers, product_variants).

CREATE TABLE IF NOT EXISTS pos_clientes (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(255) NOT NULL,
  documento   VARCHAR(50),
  email       VARCHAR(255),
  telefono    VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_ventas (
  id                    SERIAL PRIMARY KEY,
  client_sale_id        VARCHAR(64) UNIQUE,
  cliente_id            INTEGER REFERENCES pos_clientes (id),
  canal                 VARCHAR(32) NOT NULL DEFAULT 'pos',
  medio_pago            VARCHAR(64) NOT NULL,
  estado                VARCHAR(32) NOT NULL DEFAULT 'completada',
  neto_gravado          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  iva_total             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  exento                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sincronizada_offline  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_ventas_created_at ON pos_ventas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_ventas_client_sale_id ON pos_ventas (client_sale_id);

CREATE TABLE IF NOT EXISTS pos_lineas_venta (
  id                      SERIAL PRIMARY KEY,
  venta_id                INTEGER NOT NULL REFERENCES pos_ventas (id) ON DELETE CASCADE,
  variant_id              UUID REFERENCES product_variants (id) ON DELETE SET NULL,
  sku_snapshot            VARCHAR(128) NOT NULL,
  name_snapshot           VARCHAR(255) NOT NULL,
  cantidad                INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario         NUMERIC(14, 2) NOT NULL,
  cost_price_snapshot     NUMERIC(14, 2),
  supplier_id_snapshot    UUID,
  supplier_code_snapshot  TEXT,
  alicuota_iva            NUMERIC(5, 2) NOT NULL DEFAULT 21,
  neto_linea              NUMERIC(14, 2) NOT NULL,
  iva_linea               NUMERIC(14, 2) NOT NULL,
  exento_linea            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_linea             NUMERIC(14, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pos_lineas_venta_venta ON pos_lineas_venta (venta_id);
CREATE INDEX IF NOT EXISTS idx_pos_lineas_venta_sku ON pos_lineas_venta (sku_snapshot);

CREATE TABLE IF NOT EXISTS pos_iva_registro (
  id               SERIAL PRIMARY KEY,
  tipo             VARCHAR(16) NOT NULL CHECK (tipo IN ('venta', 'compra')),
  referencia_tipo  VARCHAR(32) NOT NULL,
  referencia_id    INTEGER NOT NULL,
  fecha_fiscal     DATE NOT NULL DEFAULT CURRENT_DATE,
  alicuota         NUMERIC(5, 2) NOT NULL DEFAULT 0,
  neto_gravado     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  iva              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  exento           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  comprobante      VARCHAR(64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_iva_registro_fecha ON pos_iva_registro (fecha_fiscal DESC, tipo);

CREATE TABLE IF NOT EXISTS pos_ordenes_compra (
  id              SERIAL PRIMARY KEY,
  proveedor_id    UUID NOT NULL REFERENCES suppliers (id),
  estado          VARCHAR(32) NOT NULL DEFAULT 'borrador',
  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_ordenes_compra_lineas (
  id                SERIAL PRIMARY KEY,
  orden_id          INTEGER NOT NULL REFERENCES pos_ordenes_compra (id) ON DELETE CASCADE,
  variant_id        UUID REFERENCES product_variants (id) ON DELETE SET NULL,
  sku_snapshot      VARCHAR(128) NOT NULL,
  codigo_proveedor  VARCHAR(128) NOT NULL,
  cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario    NUMERIC(14, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pos_facturas_compra (
  id                  SERIAL PRIMARY KEY,
  proveedor_id        UUID NOT NULL REFERENCES suppliers (id),
  numero_comprobante  VARCHAR(64) NOT NULL,
  fecha_fiscal        DATE NOT NULL,
  neto_gravado        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  iva_total           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  exento              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total               NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proveedor_id, numero_comprobante)
);
