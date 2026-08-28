import { z } from "zod";

export const saleLineSchema = z.object({
  codigo_interno: z.string().min(1).max(64),
  cantidad: z.number().int().positive(),
  /** Precio mostrado en caja (referencia; el servidor recalcula desde catálogo + tramos). */
  precio_unitario: z.number().positive().optional(),
});

export const createSaleSchema = z.object({
  client_sale_id: z.string().max(64).optional(),
  cliente_id: z.number().int().positive().optional(),
  medio_pago: z.string().min(1).max(64),
  lineas: z.array(saleLineSchema).min(1),
  sincronizada_offline: z.boolean().optional().default(false),
});

export const offlineBatchSchema = z.object({
  ventas: z.array(createSaleSchema.extend({ client_sale_id: z.string().min(1).max(64) })).min(1),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type OfflineBatchInput = z.infer<typeof offlineBatchSchema>;
