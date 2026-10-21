import { describe, expect, it } from "vitest";
import {
  aplicarPlantilla,
  enviarFacturaEmail,
  enmascararEmail,
  leerEmailConfig,
  mensajeEmailSeguro,
  type EmailConfig,
} from "./email.js";

const config: EmailConfig = {
  host: "smtp.test",
  port: 587,
  secure: false,
  user: "facturas",
  pass: "supersecret",
  from: "Radio Colonia <facturas@radio.test>",
  subjectTemplate: "Factura {{numero}}",
  bodyTemplate: "CAE {{cae}}",
};

describe("email de factura", () => {
  it("no está configurado si faltan host o remitente", () => {
    expect(leerEmailConfig({})).toBeNull();
    expect(leerEmailConfig({ INVOICE_SMTP_HOST: "smtp.test" })).toBeNull();
    expect(
      leerEmailConfig({ INVOICE_SMTP_HOST: "smtp.test", INVOICE_EMAIL_FROM: "a@b.c" })?.from,
    ).toBe("a@b.c");
  });

  it("aplica la plantilla y enmascara el destinatario", () => {
    expect(aplicarPlantilla("Factura {{numero}} CAE {{cae}}", { numero: "0002-00001234", cae: "1" })).toBe(
      "Factura 0002-00001234 CAE 1",
    );
    expect(enmascararEmail("cliente@acme.test")).toBe("c***@acme.test");
  });

  it("un fallo de SMTP no conserva la contraseña", async () => {
    await expect(
      enviarFacturaEmail({
        config,
        to: "cliente@acme.test",
        subject: "Factura",
        text: "cuerpo",
        filename: "Factura-B-0002-00001234.pdf",
        pdf: Buffer.from("%PDF"),
        transport: {
          sendMail: async () => {
            throw new Error("535 auth password=supersecret user=facturas");
          },
        },
      }),
    ).rejects.toThrow(/535/);

    try {
      await enviarFacturaEmail({
        config,
        to: "cliente@acme.test",
        subject: "Factura",
        text: "cuerpo",
        filename: "Factura-B-0002-00001234.pdf",
        pdf: Buffer.from("%PDF"),
        transport: {
          sendMail: async () => {
            throw new Error("535 auth password=supersecret user=facturas");
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      expect(message).not.toContain("supersecret");
      expect(message).not.toContain("facturas");
      expect(message).toBe(mensajeEmailSeguro(new Error("535 auth password=supersecret user=facturas"), ["supersecret", "facturas"]));
    }
  });

  it("adjunta el PDF y no cambia el contenido", async () => {
    const pdf = Buffer.from("%PDF-1.4 factura");
    let attached: Buffer | null = null;
    await enviarFacturaEmail({
      config,
      to: "cliente@acme.test",
      subject: "Asunto",
      text: "Cuerpo",
      filename: "Factura-B-0002-00001234.pdf",
      pdf,
      transport: {
        sendMail: async (message) => {
          attached = message.attachments[0]?.content ?? null;
          expect(message.attachments[0]?.filename).toBe("Factura-B-0002-00001234.pdf");
          expect(message.from).toBe(config.from);
          expect(message.to).toBe("cliente@acme.test");
        },
      },
    });
    expect(attached?.equals(pdf)).toBe(true);
  });
});
