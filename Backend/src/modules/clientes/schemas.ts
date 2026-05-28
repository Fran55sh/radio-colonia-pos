import { z } from "zod";

export const createClienteSchema = z.object({
  nombre: z.string().min(1),
  documento: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  telefono: z.string().optional(),
});

export const updateClienteSchema = createClienteSchema.partial();
