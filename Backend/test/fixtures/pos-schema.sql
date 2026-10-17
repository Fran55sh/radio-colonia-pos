-- Fixture de integración del POS.
-- DDL copiado de las migraciones del ecommerce y del esquema Drizzle de products
-- (products no tiene CREATE en SQL; lo crea drizzle-kit). Idempotente.
-- Fuentes: 0001_bulk_import.sql, 0004_suppliers.sql, 0005_pos_operational_tables.sql,
-- 0008_pos_fiscal_invoicing.sql, 0009_variant_price_tiers.sql,
-- 0010_product_qty_discount_scope.sql, 0016_variant_iva_alicuota.sql, 0017_pos_caja_mvp.sql.
-- La 0031 se agrega en la fase de intentos.

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  price               NUMERIC(10, 2) NOT NULL,
  image               TEXT NOT NULL DEFAULT '/products/placeholder.png',
  stock               INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  qty_discount_scope  TEXT NOT NULL DEFAULT 'per_variant',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_qty_discount_scope_ck
    CHECK (qty_discount_scope IN ('per_variant', 'shared'))
);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_idx ON products (slug);

CREATE TABLE IF NOT EXISTS product_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,
  stock             INTEGER NOT NULL DEFAULT 0,
  attributes        JSONB NOT NULL DEFAULT '{}',
  cost_price        NUMERIC(14, 4),
  sale_price        NUMERIC(10, 2),
  margin_percentage NUMERIC(5, 2),
  iva_alicuota      NUMERIC(4, 1) NOT NULL DEFAULT 21,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pv_iva_alicuota_ck CHECK (iva_alicuota IN (10.5, 21))
);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_idx ON product_variants (sku);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id);

CREATE TABLE IF NOT EXISTS product_variant_price_tiers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  min_qty    INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pvpt_min_qty_ck CHECK (min_qty >= 2),
  CONSTRAINT pvpt_unit_price_ck CHECK (unit_price > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pvpt_variant_min_qty_idx
  ON product_variant_price_tiers (variant_id, min_qty);

CREATE TABLE IF NOT EXISTS product_price_tiers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  min_qty    INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppt_min_qty_ck CHECK (min_qty >= 2),
  CONSTRAINT ppt_unit_price_ck CHECK (unit_price > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ppt_product_min_qty_idx
  ON product_price_tiers (product_id, min_qty);

CREATE TABLE IF NOT EXISTS suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_slug_idx ON suppliers (slug);

CREATE TABLE IF NOT EXISTS product_supplier_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    UUID NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,
  cost_price    NUMERIC(10, 2),
  stock         INTEGER NOT NULL DEFAULT 0,
  is_preferred  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_supplier_offers_variant_idx
  ON product_supplier_offers (variant_id);

CREATE TABLE IF NOT EXISTS pos_clientes (
  id                         SERIAL PRIMARY KEY,
  nombre                     VARCHAR(255) NOT NULL,
  documento                  VARCHAR(50),
  email                      VARCHAR(255),
  telefono                   VARCHAR(50),
  documento_tipo_afip        VARCHAR(16),
  condicion_iva_receptor_id  INTEGER,
  razon_social               VARCHAR(255),
  domicilio_fiscal           TEXT,
  padron_checked_at          TIMESTAMPTZ,
  padron_raw                 JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE INDEX IF NOT EXISTS idx_pos_iva_registro_fecha
  ON pos_iva_registro (fecha_fiscal DESC, tipo);

CREATE TABLE IF NOT EXISTS pos_comprobantes_fiscales (
  id                          SERIAL PRIMARY KEY,
  venta_id                    INTEGER NOT NULL REFERENCES pos_ventas (id) ON DELETE CASCADE,
  estado                      VARCHAR(16) NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente', 'emitido', 'error', 'anulado')),
  ambiente                    VARCHAR(8) NOT NULL DEFAULT 'dev',
  emisor_cuit                 VARCHAR(11) NOT NULL,
  punto_venta                 INTEGER NOT NULL,
  cbte_tipo                   INTEGER NOT NULL,
  cbte_nro                    INTEGER,
  fecha_cbte                  DATE,
  cae                         VARCHAR(20),
  cae_vencimiento             DATE,
  qr_url                      TEXT,
  doc_tipo                    INTEGER,
  doc_nro                     BIGINT,
  condicion_iva_receptor_id   INTEGER,
  neto_gravado                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  iva_total                   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  exento                      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total                       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  error_code                  VARCHAR(32),
  error_message               TEXT,
  raw_response                JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venta_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_comprobantes_fiscales_numero
  ON pos_comprobantes_fiscales (ambiente, punto_venta, cbte_tipo, cbte_nro)
  WHERE cbte_nro IS NOT NULL AND estado = 'emitido';

CREATE TABLE IF NOT EXISTS pos_caja_sesiones (
  id                SERIAL PRIMARY KEY,
  puesto            VARCHAR(64) NOT NULL DEFAULT 'Caja 01',
  estado            VARCHAR(16) NOT NULL DEFAULT 'abierta'
                      CHECK (estado IN ('abierta', 'cerrada', 'cancelada')),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_by_label   VARCHAR(128),
  closed_at         TIMESTAMPTZ,
  closed_by_label   VARCHAR(128),
  notes             TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_caja_sesiones_abierta_puesto
  ON pos_caja_sesiones (puesto)
  WHERE estado = 'abierta';

CREATE TABLE IF NOT EXISTS pos_caja_movimientos (
  id                  SERIAL PRIMARY KEY,
  sesion_id           INTEGER NOT NULL REFERENCES pos_caja_sesiones (id) ON DELETE CASCADE,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo                VARCHAR(32) NOT NULL
                        CHECK (tipo IN ('venta', 'ingreso_manual', 'retiro', 'gasto')),
  direccion           VARCHAR(16) NOT NULL
                        CHECK (direccion IN ('ingreso', 'egreso')),
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method      VARCHAR(64) NOT NULL,
  description         TEXT,
  source_type         VARCHAR(16) NOT NULL
                        CHECK (source_type IN ('SALE', 'MANUAL', 'SYSTEM')),
  source_id           VARCHAR(64),
  created_by_label    VARCHAR(128),
  approved_by_label   VARCHAR(128),
  estado              VARCHAR(16) NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo', 'anulado')),
  anulado_at          TIMESTAMPTZ,
  anulado_by_label    VARCHAR(128),
  anulado_motivo      TEXT,
  post_cierre_offline BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_caja_movimientos_sale_activo
  ON pos_caja_movimientos (source_type, source_id)
  WHERE source_type = 'SALE' AND estado = 'activo';

ALTER TABLE pos_ventas
  ADD COLUMN IF NOT EXISTS caja_sesion_id INTEGER REFERENCES pos_caja_sesiones (id);

-- Incluye 0031_pos_fiscal_intentos.sql

-- 0031: intentos fiscales del POS. Idempotente: el migrador re-ejecuta todos los SQL.

DO $$
DECLARE
  rec record;
  has_enviando boolean := false;
BEGIN
  FOR rec IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'pos_comprobantes_fiscales'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%estado%'
  LOOP
    IF rec.def ILIKE '%enviando%' THEN
      has_enviando := true;
    END IF;
  END LOOP;

  IF NOT has_enviando THEN
    FOR rec IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'pos_comprobantes_fiscales'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%estado%'
    LOOP
      EXECUTE format('ALTER TABLE pos_comprobantes_fiscales DROP CONSTRAINT %I', rec.conname);
    END LOOP;

    ALTER TABLE pos_comprobantes_fiscales
      ADD CONSTRAINT pos_comprobantes_fiscales_estado_check
      CHECK (estado IN (
        'pendiente', 'enviando', 'desconocido', 'emitido', 'rechazado', 'error', 'anulado'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_comprobantes_fiscales_intentos (
  id                          SERIAL PRIMARY KEY,
  comprobante_id              INTEGER NOT NULL REFERENCES pos_comprobantes_fiscales (id) ON DELETE CASCADE,
  venta_id                    INTEGER NOT NULL,
  nro_intento                 INTEGER NOT NULL,
  estado                      VARCHAR(16) NOT NULL
                              CHECK (estado IN (
                                'enviando', 'emitido', 'rechazado', 'desconocido', 'no_autorizado', 'error'
                              )),
  ambiente                    VARCHAR(8) NOT NULL,
  emisor_cuit                 VARCHAR(11) NOT NULL,
  punto_venta                 INTEGER NOT NULL,
  cbte_tipo                   INTEGER NOT NULL,
  cbte_nro                    INTEGER,
  fecha_cbte                  DATE,
  doc_tipo                    INTEGER,
  doc_nro                     BIGINT,
  condicion_iva_receptor_id   INTEGER,
  imp_total                   NUMERIC(14, 2),
  imp_neto                    NUMERIC(14, 2),
  imp_iva                     NUMERIC(14, 2),
  imp_op_ex                   NUMERIC(14, 2),
  iva_detalle                 JSONB,
  request_payload             JSONB,
  response_raw                JSONB,
  cae                         VARCHAR(20),
  cae_vencimiento             DATE,
  error_code                  VARCHAR(32),
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at                     TIMESTAMPTZ,
  resolved_at                 TIMESTAMPTZ,
  UNIQUE (comprobante_id, nro_intento)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_fiscal_intentos_numero
  ON pos_comprobantes_fiscales_intentos (ambiente, punto_venta, cbte_tipo, cbte_nro)
  WHERE cbte_nro IS NOT NULL AND estado IN ('enviando', 'desconocido', 'emitido');

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_fiscal_intentos_abierto
  ON pos_comprobantes_fiscales_intentos (comprobante_id)
  WHERE estado IN ('enviando', 'desconocido');

CREATE INDEX IF NOT EXISTS idx_pos_fiscal_intentos_barrido
  ON pos_comprobantes_fiscales_intentos (estado, created_at);

ALTER TABLE pos_comprobantes_fiscales
  ADD COLUMN IF NOT EXISTS intento_actual_id INTEGER,
  ADD COLUMN IF NOT EXISTS iva_detalle JSONB,
  ADD COLUMN IF NOT EXISTS imp_total_enviado NUMERIC(14, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_comprobantes_fiscales_intento_actual_id_fkey'
  ) THEN
    ALTER TABLE pos_comprobantes_fiscales
      ADD CONSTRAINT pos_comprobantes_fiscales_intento_actual_id_fkey
      FOREIGN KEY (intento_actual_id)
      REFERENCES pos_comprobantes_fiscales_intentos (id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE pos_comprobantes_fiscales
SET estado = 'emitido',
    updated_at = NOW()
WHERE cae IS NOT NULL
  AND estado <> 'emitido';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_pos_iva_registro_venta_alicuota'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pos_iva_registro
    WHERE tipo = 'venta'
    GROUP BY referencia_tipo, referencia_id, alicuota
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'pos_iva_registro tiene duplicados de venta; no se crea el índice único';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX uq_pos_iva_registro_venta_alicuota
    ON pos_iva_registro (referencia_tipo, referencia_id, alicuota)
    WHERE tipo = 'venta';
END $$;
