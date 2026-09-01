import { z } from "zod";

/** DTO normalizado desacoplado del parser PDF (preparado para OCR/IA). */
export const normalizedInvoiceItemSchema = z.object({
  codigo_proveedor: z.string().nullable(),
  descripcion: z.string(),
  cantidad: z.number(),
  precio_unitario: z.number(),
  descuento: z.number().default(0),
  importe: z.number(),
  variant_id: z.string().uuid().nullable().default(null),
  sku: z.string().nullable().default(null),
  producto_nombre: z.string().nullable().default(null),
  encontrado: z.boolean().default(false),
  requiere_revision: z.boolean().default(true),
});

export const normalizedInvoiceSchema = z.object({
  proveedor: z.object({
    cuit: z.string().nullable(),
    razon_social: z.string().nullable(),
    proveedor_id: z.string().uuid().nullable().default(null),
  }),
  factura: z.object({
    tipo: z.string().nullable(),
    punto_venta: z.string().nullable(),
    numero: z.string().nullable(),
    fecha: z.string().nullable(),
    condicion_iva: z.string().nullable().optional(),
  }),
  items: z.array(normalizedInvoiceItemSchema),
  totales: z.object({
    subtotal: z.number().nullable(),
    iva: z.number().nullable(),
    total: z.number().nullable(),
  }),
});

export type NormalizedInvoiceItem = z.infer<typeof normalizedInvoiceItemSchema>;
export type NormalizedInvoice = z.infer<typeof normalizedInvoiceSchema>;

export const patchImportacionSchema = z.object({
  review_json: normalizedInvoiceSchema,
});

export const createImportacionTextSchema = z.object({
  text: z.string().min(20, "El texto es demasiado corto"),
  label: z.string().max(200).optional(),
});

export const ROUNDING_TOLERANCE = 0.05;
