import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

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

function findEndOfCentralDirectory(zip: Buffer): number {
  const floor = Math.max(0, zip.length - 65_557);
  for (let i = zip.length - 22; i >= floor; i--) if (zip.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(zip);
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const localHeader = zip.readUInt32LE(p + 42);
    const entryName = zip.toString("utf8", p + 46, p + 46 + nameLength);
    if (entryName === name) {
      if (zip.readUInt32LE(localHeader) !== 0x04034b50) throw new Error("damaged zip local header");
      const start = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

export function docxToText(file: Buffer): string {
  const xml = readZipEntry(file, "word/document.xml");
  if (!xml) throw new Error("no word/document.xml inside the file");
  const text = xml
    .toString("utf8")
    .replace(/>\s*\n\s*</g, "><")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => `${cell.replace(/<\/w:p>/g, " ")}\t`)
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .replace(/ +\t/g, "\t")
    .replace(/\t+\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PositionedText {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function layoutLines(items: unknown[]): string {
  const rows = new Map<number, Array<{ x: number; end: number; h: number; str: string }>>();
  for (const item of items) {
    const it = item as Partial<PositionedText>;
    if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
    const x = it.transform[4];
    const y = Math.round(it.transform[5] / 3) * 3;
    const row = rows.get(y) ?? [];
    row.push({ x, end: x + (it.width ?? 0), h: it.height ?? 0, str: it.str });
    rows.set(y, row);
  }
  const out: string[] = [];
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    let line = "";
    let previousEnd: number | null = null;
    for (const it of rows.get(y)!.sort((a, b) => a.x - b.x)) {
      if (!it.str) continue;
      if (previousEnd !== null) {
        const gap = it.x - previousEnd;
        if (gap > Math.max(8, it.h * 1.5)) line += "   ";
        else if (gap > Math.max(0.8, it.h * 0.12) && !line.endsWith(" ") && !it.str.startsWith(" ")) line += " ";
      }
      line += it.str;
      previousEnd = it.end;
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

const standardFontDataUrl = (() => {
  try {
    const require = createRequire(import.meta.url);
    return `${join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;
  } catch {
    return undefined;
  }
})();

export async function pdfToText(file: Buffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(file),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl,
    verbosity: 0,
  }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(layoutLines(content.items));
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await doc.destroy();
  }
}

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString("latin1").startsWith("%PDF");
const isZip = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 2048);
  if (!sample.length) return false;
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  return printable / sample.length > 0.85;
}

export async function readCv(path: string): Promise<CvText> {
  const buf = await readFile(path);
  const name = basename(path);
  const ext = extname(path).toLowerCase();
  let format: CvText["format"] = "unknown";
  let text = "";
  let note: string | undefined;

  if (isPdf(buf)) {
    format = "pdf";
    try {
      text = await pdfToText(buf);
      if (!text.trim()) note = "The PDF has no text layer (probably a scan); it needs OCR before it can be read.";
    } catch (e) {
      note = `Could not read the PDF (${(e as Error).message.slice(0, 120)}).`;
    }
  } else if (ext === ".docx" || isZip(buf)) {
    format = "docx";
    try {
      text = docxToText(buf);
    } catch (e) {
      note = `Could not read the document (${(e as Error).message.slice(0, 120)}).`;
    }
  } else if ([".txt", ".md", ".rtf", ""].includes(ext) || looksLikeText(buf)) {
    format = "text";
    text = buf.toString("utf8");
    if (![".txt", ".md", ".rtf", ""].includes(ext)) note = `Unrecognised extension "${ext}"; read as plain text.`;
  } else {
    note = `"${name}" is not a PDF, DOCX or text file. Convert it first.`;
  }

  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = clean.length > MAX_CHARS;
  return {
    path,
    name,
    bytes: buf.length,
    format,
    text: truncated ? `${clean.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]` : clean,
    truncated,
    note,
  };
}
