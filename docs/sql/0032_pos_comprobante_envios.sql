-- Registro de distribución de facturas (email / enlace).
-- El POS no ejecuta este archivo. Va en el ecommerce, que re-corre todas las
-- migraciones: tiene que ser idempotente.
--
-- Número propuesto: 0032, siguiente a 0031_pos_fiscal_intentos según este repo
-- al 2026-10-19. Confirmar el directorio app/src/db/migrations del ecommerce
-- antes de copiarlo. Si ya existe una 0032, renumerar y no pisar esa migración.
-- Sin esta tabla el POS igual genera el PDF y deja el resultado en el log.

CREATE TABLE IF NOT EXISTS pos_comprobante_envios (
  id          BIGSERIAL PRIMARY KEY,
  venta_id    INTEGER NOT NULL REFERENCES pos_ventas (id) ON DELETE CASCADE,
  canal       VARCHAR(16) NOT NULL CHECK (canal IN ('email', 'enlace')),
  resultado   VARCHAR(16) NOT NULL CHECK (resultado IN ('enviado', 'error', 'generado')),
  destino     VARCHAR(255),
  detalle     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_comprobante_envios_venta
  ON pos_comprobante_envios (venta_id, created_at DESC);
