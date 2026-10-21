import nodemailer from "nodemailer";
import { z } from "zod";

export const emailFacturaSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
});

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  subjectTemplate: string;
  bodyTemplate: string;
};

const SUBJECT_DEFAULT = "Factura {{numero}} — Radio Colonia";
const BODY_DEFAULT = "Adjuntamos la factura {{numero}} autorizada con CAE {{cae}}.";

export function leerEmailConfig(source: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const host = source.INVOICE_SMTP_HOST?.trim();
  const from = source.INVOICE_EMAIL_FROM?.trim();
  if (!host || !from) return null;
  const portRaw = source.INVOICE_SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    host,
    port,
    secure: source.INVOICE_SMTP_SECURE === "true" || port === 465,
    user: source.INVOICE_SMTP_USER?.trim() || undefined,
    pass: source.INVOICE_SMTP_PASS,
    from,
    subjectTemplate: source.INVOICE_EMAIL_SUBJECT?.trim() || SUBJECT_DEFAULT,
    bodyTemplate: source.INVOICE_EMAIL_BODY?.trim() || BODY_DEFAULT,
  };
}

export function aplicarPlantilla(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function enmascararEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

export function mensajeEmailSeguro(err: unknown, secretos: Array<string | undefined>): string {
  let text = err instanceof Error ? err.message : "error de envío";
  for (const secret of secretos) {
    if (secret && secret.length >= 3) text = text.split(secret).join("***");
  }
  return text.slice(0, 300);
}

export type EmailSender = {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<unknown>;
};

export function crearTransporteSmtp(config: EmailConfig): EmailSender {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
  });
}

export async function enviarFacturaEmail(input: {
  config: EmailConfig;
  to: string;
  subject: string;
  text: string;
  filename: string;
  pdf: Buffer;
  transport?: EmailSender;
}): Promise<void> {
  const transport = input.transport ?? crearTransporteSmtp(input.config);
  try {
    await transport.sendMail({
      from: input.config.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: [
        {
          filename: input.filename,
          content: input.pdf,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    throw new Error(mensajeEmailSeguro(err, [input.config.pass, input.config.user]));
  }
}
