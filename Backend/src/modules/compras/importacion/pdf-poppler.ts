import { execFile } from "node:child_process";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractWithPdftotext(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "compras-pdf-"));
  const pdfPath = path.join(dir, "input.pdf");
  await writeFile(pdfPath, buffer);

  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", pdfPath, "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } finally {
    await unlink(pdfPath).catch(() => undefined);
  }
}
