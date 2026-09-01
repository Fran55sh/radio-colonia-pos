import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFParse } from "pdf-parse";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const execFileAsync = promisify(execFile);
const pdfPath =
  process.argv[2] ??
  "c:\\Users\\corva\\Downloads\\FA-A-0003-00040899   CORVATTA DANIEL H..pdf";

const buffer = await readFile(pdfPath);
console.log("file:", pdfPath);
console.log("size:", buffer.length);

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const resources = {
  standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
  cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
  cMapPacked: true,
};
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

for (const name of ["pdf-parse", "pdf-parse-xfa"]) {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    ...(name.includes("xfa")
      ? { enableXfa: true, useSystemFonts: true, useWorkerFetch: false, ...resources }
      : {}),
  });
  const result = await parser.getText();
  console.log(`\n${name}: len=${(result.text ?? "").length}`);
  console.log("preview:", JSON.stringify((result.text ?? "").slice(0, 300)));
  await parser.destroy();
}

const doc = await getDocument({
  data: new Uint8Array(buffer),
  enableXfa: true,
  useSystemFonts: true,
  useWorkerFetch: false,
  ...resources,
}).promise;

console.log("\npdfjs:", {
  numPages: doc.numPages,
  isPureXfa: doc.isPureXfa,
  hasXfaHtml: Boolean(doc.allXfaHtml),
});

for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent({ includeMarkedContent: true });
  const text = tc.items.map((item) => ("str" in item ? item.str : "")).join("");
  console.log(`page ${i} text items=${tc.items.length} len=${text.length}`);
  if (text) console.log("text preview:", JSON.stringify(text.slice(0, 300)));

  const content = await page.getTextContent({ disableNormalization: true });
  const raw = content.items.map((item) => ("str" in item ? item.str : "")).join("");
  console.log(`page ${i} raw len=${raw.length}`);

  page.cleanup();
}
await doc.destroy();

try {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", pdfPath, "-"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  console.log("\npdftotext len:", stdout.trim().length);
  console.log("pdftotext preview:", JSON.stringify(stdout.trim().slice(0, 300)));
} catch (err) {
  console.log("\npdftotext:", err.code ?? err.message);
}

// Scan raw PDF for BT/Tj operators and font refs
const raw = buffer.toString("latin1");
const btCount = (raw.match(/\bBT\b/g) ?? []).length;
const tjCount = (raw.match(/\(([^)]*)\)\s*Tj/g) ?? []).length;
const tjSamples = [...raw.matchAll(/\(([^)]{1,80})\)\s*Tj/g)].slice(0, 10).map((m) => m[1]);
console.log("\nraw scan:", { btCount, tjCount, tjSamples });

const rawLatin = buffer.toString("latin1");
console.log("\nmetadata:", {
  producer: rawLatin.match(/\/Producer\s*\(([^)]+)\)/)?.[1],
  creator: rawLatin.match(/\/Creator\s*\(([^)]+)\)/)?.[1],
  images: (rawLatin.match(/\/Subtype\s*\/Image/g) ?? []).length,
});
const contentMatch = rawLatin.match(/(\d+ 0 obj[\s\S]{0,500}?stream)/);
console.log("first stream obj preview:", contentMatch?.[1]?.slice(0, 400));
