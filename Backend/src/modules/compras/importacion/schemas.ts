import { z } from "zod";
import { ALLOWED_IVA_ALICUOTAS } from "./invoice-math.js";

/** DTO normalizado desacoplado del parser PDF (preparado para OCR/IA/manual). */
export const normalizedInvoiceItemSchema = z.object({
  codigo_proveedor: z.string().nullable(),
  descripcion: z.string(),
  cantidad: z.number(),
  precio_unitario: z.number(),
  /** Monto de descuento de línea (calculado desde %). */
  descuento: z.number().default(0),
  /** Porcentaje 0–100. */
  descuento_porcentaje: z.number().min(0).max(100).default(0),
  alicuota_iva: z
    .number()
    .refine((v) => ALLOWED_IVA_ALICUOTAS.some((a) => Math.abs(a - v) < 0.001), {
      message: "Alícuota IVA inválida",
    })
    .default(21),
  /** Neto de línea antes del descuento total (compat). */
  importe: z.number(),
  neto_linea: z.number().nullable().default(null),
  iva_linea: z.number().nullable().default(null),
  total_linea: z.number().nullable().default(null),
  variant_id: z.string().uuid().nullable().default(null),
  sku: z.string().nullable().default(null),
  producto_nombre: z.string().nullable().default(null),
  encontrado: z.boolean().default(false),
  requiere_revision: z.boolean().default(true),
  /** Confirma remapeo si el código proveedor ya apunta a otro SKU. */
  confirmar_cambio_mapeo: z.boolean().optional().default(false),
});

export const normalizedInvoiceSchema = z.object({
  proveedor: z.object({
    cuit: z.string().nullable(),
    razon_social: z.string().nullable(),
    proveedor_id: z.string().uuid().nullable().default(null),
    /** true si aún no existe en DB y se creará al ejecutar. */
    se_creara: z.boolean().optional().default(false),
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
    descuento_total: z.number().nullable().default(0),
    exento: z.number().nullable().optional().default(0),
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

export function emptyManualInvoice(fecha = new Date().toISOString().slice(0, 10)): NormalizedInvoice {
  return {
    proveedor: {
      cuit: null,
      razon_social: null,
      proveedor_id: null,
      se_creara: false,
    },
    factura: {
      tipo: "A",
      punto_venta: null,
      numero: null,
      fecha,
      condicion_iva: null,
    },
    items: [],
    totales: {
      subtotal: 0,
      iva: 0,
      total: 0,
      descuento_total: 0,
      exento: 0,
    },
  };
}
