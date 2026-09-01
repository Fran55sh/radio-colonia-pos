import { describe, expect, it } from "vitest";
import { extractPdfTextFromBuffer } from "./pdf-text-extractor.js";
import { AppError } from "../../../middleware/errors.js";

describe("extractPdfTextFromBuffer", () => {
  it("rejects empty buffers", async () => {
    await expect(extractPdfTextFromBuffer(Buffer.alloc(0))).rejects.toMatchObject({
      code: "PDF_EMPTY",
    } satisfies Partial<AppError>);
  });

  it("rejects invalid pdf bytes", async () => {
    await expect(extractPdfTextFromBuffer(Buffer.from("%PDF-invalid"))).rejects.toMatchObject({
      code: "PDF_PARSE_ERROR",
    } satisfies Partial<AppError>);
  });
});
