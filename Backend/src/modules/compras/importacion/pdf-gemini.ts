import { env } from "../../../config/env.js";
import { AppError } from "../../../middleware/errors.js";

export function isGeminiExtractionEnabled(): boolean {
  return Boolean(env.COMPRAS_GEMINI_API_KEY);
}

export async function extractWithGemini(buffer: Buffer): Promise<string> {
  const apiKey = env.COMPRAS_GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      503,
      "GEMINI_NOT_CONFIGURED",
      "Extracción con Gemini no configurada en el servidor.",
    );
  }

  const model = env.COMPRAS_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Extraé TODO el texto visible de esta factura argentina (comprobante AFIP/ARCA). " +
                "Respondé únicamente con el texto plano del documento, sin markdown, sin comentarios.",
            },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: buffer.toString("base64"),
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new AppError(
      502,
      "GEMINI_ERROR",
      `Gemini no pudo leer el PDF (HTTP ${res.status}).`,
      errBody.slice(0, 300),
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new AppError(502, "GEMINI_EMPTY", "Gemini no devolvió texto para este PDF.");
  }

  return text;
}
