/**
 * Deep PDF binary analysis
 */
import { readFile } from "fs/promises";
import zlib from "zlib";
import { promisify } from "util";

const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);

const pdfPath = process.argv[2];
const buffer = await readFile(pdfPath);
const raw = buffer.toString("latin1");

console.log("File size:", buffer.length);
console.log("PDF version:", raw.slice(0, 20));

// Find all stream objects
const streamRegex = /(\d+)\s+(\d+)\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
let match;
const streams = [];
while ((match = streamRegex.exec(raw)) !== null) {
  streams.push({
    objNum: match[1],
    gen: match[2],
    header: match[0].slice(0, match[0].indexOf("stream")),
    rawLen: match[3].length,
    rawStart: match[3].slice(0, 80),
  });
}
console.log("\nStreams found:", streams.length);
for (const s of streams) {
  console.log(`  obj ${s.objNum} ${s.gen}: header=${JSON.stringify(s.header.slice(0, 120).replace(/\s+/g, " "))} rawLen=${s.rawLen}`);
}

// Try decompress streams
console.log("\n=== Decompressed stream previews ===");
const streamRegex2 = /(\d+)\s+(\d+)\s+obj([\s\S]*?)stream\r?\n([\s\S]*?)endstream/g;
while ((match = streamRegex2.exec(raw)) !== null) {
  const header = match[3];
  const streamData = match[4];
  const objNum = match[1];
  const isFlate = /\/FlateDecode/.test(header) || /\/Filter\s*\/FlateDecode/.test(header);
  const isDCT = /\/DCTDecode/.test(header) || /\/Filter\s*\/DCTDecode/.test(header);
  const isJPX = /\/JPXDecode/.test(header);

  console.log(`\n--- Object ${objNum} ---`);
  console.log("Header:", header.replace(/\s+/g, " ").trim().slice(0, 200));
  console.log("Filters: Flate=", isFlate, "DCT=", isDCT, "JPX=", isJPX);

  if (isFlate) {
    try {
      const data = Buffer.from(streamData, "latin1");
      const dec = await inflate(data);
      const text = dec.toString("latin1");
      console.log("Decompressed len:", dec.length);
      console.log("Preview:", JSON.stringify(text.slice(0, 500)));
      // Check for text operators
      const hasBT = /\bBT\b/.test(text);
      const hasTj = /\)\s*Tj/.test(text);
      const hasTJ = /\)\s*TJ/.test(text);
      const hasText = /\/Font/.test(text);
      console.log("Has BT:", hasBT, "Tj:", hasTj, "TJ:", hasTJ, "Font:", hasText);
    } catch (e) {
      try {
        const data = Buffer.from(streamData, "latin1");
        const dec = await inflateRaw(data);
        console.log("inflateRaw len:", dec.length, "preview:", JSON.stringify(dec.toString("latin1").slice(0, 300)));
      } catch (e2) {
        console.log("Decompress failed:", e.message);
      }
    }
  } else if (isDCT) {
    console.log("JPEG image stream, size:", streamData.length);
    console.log("JPEG header:", streamData.slice(0, 20));
  }
}

// Catalog and page tree
console.log("\n=== Key PDF markers ===");
const markers = [
  "Producer", "Creator", "Title", "Author", "Subject",
  "/Type /Page", "/Type /Pages", "/Type /XObject", "/Subtype /Image",
  "/Subtype /Form", "/Font", "/ToUnicode", "/Encoding",
  "Text", "Factura", "CUIT", "CORVATTA", "AFIP",
];
for (const m of markers) {
  const idx = raw.indexOf(m);
  if (idx >= 0) {
    console.log(`Found "${m}" at ${idx}: ${JSON.stringify(raw.slice(Math.max(0, idx - 20), idx + 60))}`);
  }
}

// Metadata
const infoMatch = raw.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
console.log("\nInfo ref:", infoMatch?.[0]);

// Check for invisible text tricks - ActualText, OCProperties
for (const pat of ["/ActualText", "/OCProperties", "/MarkedContent", "/StructTreeRoot", "/PieceInfo"]) {
  console.log(`${pat}:`, raw.includes(pat));
}
