import { z } from "zod";

export const createProveedorSchema = z.object({
  razon_social: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
  cuit: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  telefono: z.string().optional(),
});

export const mapProductoProveedorSchema = z.object({
  proveedor_id: z.string().uuid(),
  codigo_interno: z.string().min(1),
  codigo_proveedor: z.string().min(1),
  costo_proveedor: z.number().nonnegative(),
  es_preferido: z.boolean().optional(),
});

export const createOrdenCompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  observaciones: z.string().optional(),
  lineas: z
    .array(
      z.object({
        codigo_interno: z.string().min(1),
        cantidad: z.number().int().positive(),
      }),
    )
    .min(1),
});
