import { createPrivateKey, X509Certificate } from "node:crypto";

const PEM_BEGIN = /^-----BEGIN [A-Z0-9 ]+-----$/;
const PEM_END = /^-----END [A-Z0-9 ]+-----$/;

/** Normaliza PEM pegado en Coolify (.env inline con \\n, comillas, CRLF, una sola línea). */
export function normalizePem(value: string): string {
  let s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }
  s = s.replace(/\r\n/g, "\n");

  const lines = s
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length >= 2 && PEM_BEGIN.test(lines[0]!) && PEM_END.test(lines[lines.length - 1]!)) {
    const begin = lines[0]!;
    const end = lines[lines.length - 1]!;
    const body = lines.slice(1, -1).join("").replace(/\s+/g, "");
    if (body.length > 0) {
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      return `${begin}\n${wrapped}\n${end}`;
    }
  }

  const oneLine = s.replace(/\s+/g, " ").trim();
  const match = oneLine.match(
    /^(-----BEGIN [A-Z0-9 ]+-----)\s*(.+?)\s*(-----END [A-Z0-9 ]+-----)$/,
  );
  if (match) {
    const [, begin, body, end] = match;
    const cleaned = body.replace(/\s+/g, "");
    const wrapped = cleaned.match(/.{1,64}/g)?.join("\n") ?? cleaned;
    return `${begin}\n${wrapped}\n${end}`;
  }

  return s;
}

export type PemValidation = {
  certOk: boolean;
  keyOk: boolean;
  certError: string | null;
  keyError: string | null;
  certValidFrom: string | null;
  certValidTo: string | null;
  certExpired: boolean | null;
  certSubject: string | null;
  certSerial: string | null;
};

export function validateArcaPem(cert: string, key: string): PemValidation {
  let certOk = false;
  let keyOk = false;
  let certError: string | null = null;
  let keyError: string | null = null;
  let certValidFrom: string | null = null;
  let certValidTo: string | null = null;
  let certExpired: boolean | null = null;
  let certSubject: string | null = null;
  let certSerial: string | null = null;

  try {
    createPrivateKey(key);
    keyOk = true;
  } catch (err) {
    keyError = err instanceof Error ? err.message : "Clave privada inválida";
  }

  try {
    const x509 = new X509Certificate(cert);
    certOk = true;
    certValidFrom = x509.validFrom;
    certValidTo = x509.validTo;
    certSubject = x509.subject;
    certSerial = x509.serialNumber;
    const notAfter = new Date(x509.validTo).getTime();
    certExpired = Number.isFinite(notAfter) ? notAfter < Date.now() : null;
  } catch (err) {
    certError = err instanceof Error ? err.message : "Certificado inválido";
  }

  return {
    certOk,
    keyOk,
    certError,
    keyError,
    certValidFrom,
    certValidTo,
    certExpired,
    certSubject,
    certSerial,
  };
}

/** Extrae CUIT de subject/serial AFIP (11 dígitos). */
export function extractCuitFromCertMeta(
  subject: string | null,
  serial: string | null,
): number | null {
  const fromSerial = serial?.replace(/\D/g, "") ?? "";
  if (fromSerial.length === 11) return Number(fromSerial);

  const subjectDigits = subject?.replace(/\D/g, "") ?? "";
  const match = subjectDigits.match(/(\d{11})/);
  return match ? Number(match[1]) : null;
}
