import { z } from "zod";
import { CONDICION_IVA_IDS } from "../fiscal/iva-condiciones.js";

const documentoTipoAfipSchema = z.enum(["CUIT", "DNI", "CF"]).optional();

const condicionIvaSchema = z
  .number()
  .int()
  .refine((n) => CONDICION_IVA_IDS.includes(n as (typeof CONDICION_IVA_IDS)[number]), {
    message: "Condición IVA inválida",
  })
  .optional();

export const createClienteSchema = z.object({
  nombre: z.string().min(1),
  documento: z.string().optional(),
  documento_tipo_afip: documentoTipoAfipSchema,
  condicion_iva_receptor_id: condicionIvaSchema,
  razon_social: z.string().optional(),
  domicilio_fiscal: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  telefono: z.string().optional(),
});

export const updateClienteSchema = createClienteSchema.partial();

export const listClientesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});
