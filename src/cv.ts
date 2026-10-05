import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";

const run = promisify(execFile);

export interface CvText {
  path: string;
  name: string;
  bytes: number;
  format: "pdf" | "docx" | "text" | "unknown";
  text: string;
  truncated: boolean;
  note?: string;
}

const MAX_CHARS = 40_000;

async function isBinaryPdf(p: string): Promise<boolean> {
  const head = readFileSync(p).subarray(0, 5).toString("latin1");
  return head.startsWith("%PDF");
}

async function docxText(p: string): Promise<string> {
  const { stdout } = await run("unzip", ["-p", p, "word/document.xml"], { maxBuffer: 32 * 1024 * 1024 });
  return stdout
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

export async function readCv(path: string): Promise<CvText> {
  const st = await stat(path);
  const name = basename(path);
  const ext = extname(path).toLowerCase();
  let format: CvText["format"] = "unknown";
  let text = "";
  let note: string | undefined;

  if (await isBinaryPdf(path)) {
    format = "pdf";
    try {
      const { stdout } = await run("pdftotext", ["-layout", path, "-"], { maxBuffer: 32 * 1024 * 1024 });
      text = stdout;
    } catch (e) {
      note = `pdftotext failed (${(e as Error).message.slice(0, 120)}). The PDF may be a scan, which needs OCR.`;
    }
  } else if (ext === ".docx") {
    format = "docx";
    try {
      text = await docxText(path);
    } catch (e) {
      note = `Could not read the docx (${(e as Error).message.slice(0, 120)}).`;
    }
  } else if ([".txt", ".md", ".rtf", ""].includes(ext)) {
    format = "text";
    text = await readFile(path, "utf8");
  } else {
    const buf = await readFile(path);
    const printable = [...buf.subarray(0, 2048)].filter((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)).length;
    if (printable / Math.min(2048, buf.length) > 0.85) {
      format = "text";
      text = buf.toString("utf8");
      note = `Unrecognised extension "${ext}"; read as plain text.`;
    } else {
      note = `"${name}" is not a PDF, DOCX or text file. Convert it first.`;
    }
  }

  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = clean.length > MAX_CHARS;
  return {
    path,
    name,
    bytes: st.size,
    format,
    text: truncated ? `${clean.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]` : clean,
    truncated,
    note,
  };
}

