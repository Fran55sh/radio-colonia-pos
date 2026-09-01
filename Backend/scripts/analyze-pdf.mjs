/**
 * One-off PDF diagnostic script for import failures.
 * Usage: node scripts/analyze-pdf.mjs "path/to/file.pdf"
 */
import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PasswordException, PDFParse } from "pdf-parse";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/analyze-pdf.mjs <pdf-path>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const legacyPdfParse = require("legacy-pdf-parse/lib/pdf-parse.js");

const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

function pdfJsResourceUrls() {
  return {
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    cMapPacked: true,
  };
}

function scoreText(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.replace(/[^\p{L}\p{N}]/gu, "").length;
}

function preview(text, n = 200) {
  return JSON.stringify(text.replace(/\s+/g, " ").trim().slice(0, n));
}

async function analyzeStructure(buffer) {
  const raw = buffer.toString("latin1");
  const info = {
    fileSize: buffer.length,
    hasXfa: /\/XFA\b/.test(raw) || /\/AcroForm.*\/XFA/.test(raw),
    hasEncrypt: /\/Encrypt\b/.test(raw),
    hasAcroForm: /\/AcroForm\b/.test(raw),
    hasToUnicode: (raw.match(/\/ToUnicode\b/g) || []).length,
    fontCount: (raw.match(/\/Type\s*\/Font\b/g) || []).length,
    imageCount: (raw.match(/\/Subtype\s*\/Image\b/g) || []).length,
    textOpCount: (raw.match(/\(([^)]*)\)\s*Tj/g) || []).length,
    btEtCount: (raw.match(/\bBT\b/g) || []).length,
  };

  const loadingTask = getDocument({
    ...pdfJsResourceUrls(),
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    enableXfa: true,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  const doc = await loadingTask.promise;
  info.numPages = doc.numPages;
  info.isEncrypted = doc.isEncrypted ?? false;
  info.hasXfaHtml = !!doc.allXfaHtml;

  const pageDetails = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const ops = await page.getOperatorList();
    const textContent = await page.getTextContent({ includeMarkedContent: true });
    const items = textContent.items.filter((it) => "str" in it && it.str.trim());
    const textLen = items.map((it) => it.str).join("").length;
    const hasImages = ops.fnArray.some((fn) => fn === 85 || fn === 86); // paintImageXObject
    pageDetails.push({
      page: i,
      textItemCount: items.length,
      textCharLen: textLen,
      sampleText: items.slice(0, 5).map((it) => it.str).join(" | "),
      likelyImageOnly: textLen < 5 && hasImages,
    });
    page.cleanup();
  }
  info.pageDetails = pageDetails;

  const fields = await doc.getFieldObjects().catch(() => null);
  if (fields) {
    info.fieldNames = Object.keys(fields);
    info.fieldCount = Object.keys(fields).length;
  }

  await doc.destroy();
  return info;
}

async function runStrategy(name, fn) {
  try {
    const text = await fn();
    const score = scoreText(text);
    return { name, ok: true, len: text.length, score, text, preview: preview(text) };
  } catch (err) {
    return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const buffer = await readFile(pdfPath);
  console.log("=== PDF Structure ===");
  const structure = await analyzeStructure(buffer);
  console.log(JSON.stringify(structure, null, 2));

  const xfaLoad = {
    enableXfa: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    ...pdfJsResourceUrls(),
  };

  const strategies = [
    {
      name: "pdf-parse-default",
      run: async () => {
        const p = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          const r = await p.getText({});
          return (r.text ?? "").trim();
        } finally {
          await p.destroy().catch(() => {});
        }
      },
    },
    {
      name: "pdf-parse-xfa-fonts",
      run: async () => {
        const p = new PDFParse({ ...xfaLoad, data: new Uint8Array(buffer) });
        try {
          const r = await p.getText({});
          return (r.text ?? "").trim();
        } finally {
          await p.destroy().catch(() => {});
        }
      },
    },
    {
      name: "pdf-parse-no-normalize",
      run: async () => {
        const p = new PDFParse({ ...xfaLoad, data: new Uint8Array(buffer) });
        try {
          const r = await p.getText({ disableNormalization: true });
          return (r.text ?? "").trim();
        } finally {
          await p.destroy().catch(() => {});
        }
      },
    },
    {
      name: "legacy-pdf-parse",
      run: async () => {
        const r = await legacyPdfParse(buffer, { max: 0 });
        return (r.text ?? "").trim();
      },
    },
    {
      name: "pdfjs-direct",
      run: async () => {
        const loadingTask = getDocument({
          ...pdfJsResourceUrls(),
          data: new Uint8Array(buffer),
          enableXfa: true,
          useSystemFonts: true,
          useWorkerFetch: false,
          isEvalSupported: false,
        });
        const doc = await loadingTask.promise;
        const chunks = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          for (const dn of [false, true]) {
            const tc = await page.getTextContent({ disableNormalization: dn });
            chunks.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
          }
          page.cleanup();
        }
        await doc.destroy();
        return chunks.join("\n").trim();
      },
    },
    {
      name: "pdftotext-poppler",
      run: async () => {
        const { execFile } = await import("node:child_process");
        const { mkdtemp, unlink, writeFile } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const dir = await mkdtemp(path.join(tmpdir(), "pdf-diag-"));
        const fp = path.join(dir, "in.pdf");
        await writeFile(fp, buffer);
        try {
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          const { stdout } = await exec("pdftotext", ["-layout", "-enc", "UTF-8", fp, "-"], {
            maxBuffer: 10 * 1024 * 1024,
          });
          return stdout.trim();
        } finally {
          await unlink(fp).catch(() => {});
        }
      },
    },
  ];

  console.log("\n=== Extraction Strategies ===");
  for (const s of strategies) {
    const result = await runStrategy(s.name, s.run);
    console.log(JSON.stringify(result, null, 2));
    if (result.ok && result.text) {
      console.log(`  FULL TEXT (${result.name}):\n${result.text.slice(0, 2000)}`);
    }
  }

  // Show raw Tj strings from PDF binary
  const raw = buffer.toString("latin1");
  const tjMatches = [...raw.matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g)].slice(0, 30);
  console.log("\n=== Raw Tj strings (first 30) ===");
  for (const m of tjMatches) {
    console.log(JSON.stringify(m[1]));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
