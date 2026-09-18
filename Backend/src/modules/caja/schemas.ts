import { z } from "zod";

export const DEFAULT_PUESTO = "Caja 01";

export const PAYMENT_METHODS = [
  "Efectivo",
  "Débito/Crédito",
  "Mercado Pago QR",
] as const;

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const openingBalanceSchema = z.object({
  payment_method: paymentMethodSchema,
  amount: z.number().min(0),
});

export const openSessionSchema = z.object({
  puesto: z.string().min(1).max(64).optional().default(DEFAULT_PUESTO),
  saldos: z.array(openingBalanceSchema).min(1),
  notes: z.string().max(2000).optional(),
});

export const manualMovementSchema = z.object({
  sesion_id: z.number().int().positive(),
  tipo: z.enum(["ingreso_manual", "retiro", "gasto"]),
  amount: z.number().positive(),
  payment_method: paymentMethodSchema,
  description: z.string().max(500).optional(),
  admin_pin: z.string().min(4).optional(),
});

export const closeSessionSchema = z.object({
  counted_cash: z.number().min(0),
  categoria: z.string().max(64).optional(),
  observations: z.string().max(2000).optional(),
  admin_pin: z.string().min(4).optional(),
});

export const listMovimientosQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const actualQuerySchema = z.object({
  puesto: z.string().min(1).max(64).optional().default(DEFAULT_PUESTO),
});

export type OpenSessionInput = z.infer<typeof openSessionSchema>;
export type ManualMovementInput = z.infer<typeof manualMovementSchema>;
export type CloseSessionInput = z.infer<typeof closeSessionSchema>;
