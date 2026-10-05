import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { docxToText, pdfToText, readCv, readZipEntry } from "../dist/cv.js";

function zip(entries, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Denis &amp; Co</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Line two</w:t><w:tab/><w:t>after tab</w:t><w:br/><w:t>after break &#8211; dash</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;

function minimalPdf(lines) {
  const content = `BT /F1 24 Tf 72 700 Td ${lines.map((l, i) => `${i ? "0 -30 Td " : ""}(${l}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("zip entries are found and decompressed, stored or deflated", () => {
  for (const deflate of [false, true]) {
    const z = zip([["a.txt", "alpha"], ["word/document.xml", DOCUMENT_XML]], { deflate });
    assert.equal(readZipEntry(z, "a.txt").toString(), "alpha");
    assert.equal(readZipEntry(z, "word/document.xml").toString(), DOCUMENT_XML);
    assert.equal(readZipEntry(z, "missing.xml"), null);
  }
});

test("docx text keeps every paragraph, with tabs, breaks, entities and table cells", () => {
  const text = docxToText(zip([["word/document.xml", DOCUMENT_XML]], { deflate: true }));
  assert.match(text, /^Denis & Co\n/);
  assert.match(text, /Line two\tafter tab\nafter break – dash\n/);
  assert.match(text, /cell A\tcell B/);
  assert.doesNotMatch(text, /<w:/);
});

test("pdf text comes out line by line without any external binary", async () => {
  const text = await pdfToText(minimalPdf(["Hello CV", "Second line"]));
  assert.match(text, /Hello CV\s*\n\s*Second line/);
});

test("readCv detects the format from the bytes and reads plain text as-is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cv-test-"));
  writeFileSync(join(dir, "resume.pdf"), minimalPdf(["Jane Doe"]));
  writeFileSync(join(dir, "resume.docx"), zip([["word/document.xml", DOCUMENT_XML]], { deflate: true }));
  writeFileSync(join(dir, "notes.txt"), "plain text cv\n");
  writeFileSync(join(dir, "scan.pdf"), minimalPdf([]));
  const pdf = await readCv(join(dir, "resume.pdf"));
  assert.equal(pdf.format, "pdf");
  assert.match(pdf.text, /Jane Doe/);
  const docx = await readCv(join(dir, "resume.docx"));
  assert.equal(docx.format, "docx");
  assert.match(docx.text, /Denis & Co/);
  const txt = await readCv(join(dir, "notes.txt"));
  assert.equal(txt.format, "text");
  assert.equal(txt.text, "plain text cv");
  const scan = await readCv(join(dir, "scan.pdf"));
  assert.equal(scan.format, "pdf");
  assert.equal(scan.text, "");
  assert.match(scan.note ?? "", /OCR/);
});
