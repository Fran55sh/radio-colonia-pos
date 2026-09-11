import { readFile } from "fs/promises";
import { extractPdfTextFromBuffer } from "../src/modules/compras/importacion/pdf-text-extractor.js";
import { parseInvoiceText } from "../src/modules/compras/importacion/invoice-parser.js";

const pdfPath = process.argv[2];
const buffer = await readFile(pdfPath);
const text = await extractPdfTextFromBuffer(buffer);
console.log("Extracted length:", text.length);
console.log("Preview:\n", text.slice(0, 500));
const parsed = parseInvoiceText(text);
console.log("\nParsed:", JSON.stringify(parsed, null, 2));
