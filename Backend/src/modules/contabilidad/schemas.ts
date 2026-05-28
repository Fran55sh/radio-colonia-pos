import { z } from "zod";

export const createFacturaCompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  numero_comprobante: z.string().min(1),
  fecha_fiscal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  neto_gravado: z.number().nonnegative(),
  iva_total: z.number().nonnegative(),
  exento: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
  alicuota: z.number().nonnegative().default(21),
});
