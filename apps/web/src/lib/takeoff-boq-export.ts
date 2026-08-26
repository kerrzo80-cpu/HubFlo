import { deflateRawSync } from "node:zlib";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import type { TakeoffMeasuredQuantity } from "@/lib/takeoff-skill";

function crc32(buf: Buffer) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

function zipStore(files: Array<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, end]);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index: number) {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export function buildTakeoffBoqXlsx(args: {
  projectName: string;
  reference: string;
  trade: string;
  rows: TakeoffMeasuredQuantity[];
}): Buffer {
  const headers = ["Code", "Kind", "Description", "Quantity", "Unit", "Method", "Confidence", "Sanity", "Notes"];
  const sheetRows = [
    headers,
    ...args.rows.map((row) => [
      row.code,
      row.kind,
      row.description,
      String(row.quantity),
      row.unit,
      row.method,
      row.confidence,
      row.sanityCheck?.ok === false ? "FAIL" : row.sanityCheck?.ok ? "OK" : "",
      row.notes || row.derivation || "",
    ]),
  ];

  const sheetXmlRows = sheetRows.map((cells, rowIndex) => {
    const cellsXml = cells.map((value, colIndex) => {
      const ref = `${colName(colIndex)}${rowIndex + 1}`;
      if (colIndex === 3 && rowIndex > 0 && Number.isFinite(Number(value))) {
        return `<c r="${ref}"><v>${Number(value)}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
  }).join("");

  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetXmlRows}</sheetData>
</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="BOQ" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const meta = `Blake Takeoff BOQ · ${args.reference} · ${args.projectName} · ${args.trade}`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1, "utf8") },
    { name: "docProps/meta.txt", data: Buffer.from(meta, "utf8") },
  ]);
}

export async function buildMarkedUpPdf(args: {
  sourcePdf: Buffer;
  title: string;
  quantities: Array<{
    label: string;
    quantity: number;
    unit: string;
    confidence: string;
    matches?: Array<{ pageNumber: number; text: string; x: number; y: number }>;
  }>;
}): Promise<Buffer> {
  const pdf = await PDFDocument.load(args.sourcePdf, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  // Summary stamp on first page
  if (pages[0]) {
    const page = pages[0];
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: 24,
      y: height - 110,
      width: Math.min(360, width - 48),
      height: 86,
      color: rgb(0.05, 0.18, 0.12),
      opacity: 0.88,
    });
    page.drawText("Blake Takeoff markup", {
      x: 36,
      y: height - 42,
      size: 12,
      font,
      color: rgb(0.85, 0.95, 0.9),
    });
    page.drawText(args.title.slice(0, 54), {
      x: 36,
      y: height - 60,
      size: 9,
      font,
      color: rgb(0.75, 0.88, 0.8),
    });
    const summary = args.quantities
      .slice(0, 3)
      .map((row) => `${row.label}: ${row.quantity}${row.unit}`)
      .join(" · ");
    page.drawText(summary.slice(0, 70) || "Measured quantities stamped", {
      x: 36,
      y: height - 78,
      size: 8,
      font,
      color: rgb(0.7, 0.85, 0.76),
    });
    page.drawText("Audit low-confidence / failed sanity rows before lump-sum use", {
      x: 36,
      y: height - 94,
      size: 7,
      font,
      color: rgb(0.95, 0.8, 0.45),
    });
  }

  for (const quantity of args.quantities) {
    for (const match of quantity.matches || []) {
      const page = pages[match.pageNumber - 1];
      if (!page) continue;
      const { height } = page.getSize();
      // PDF text coords are often origin bottom-left already from pdf.js transform.
      const x = Math.max(8, match.x - 4);
      const y = Math.max(8, match.y - 4);
      page.drawCircle({
        x: x + 6,
        y,
        size: 7,
        borderWidth: 1.2,
        borderColor: rgb(0.95, 0.55, 0.15),
        color: rgb(0.95, 0.55, 0.15),
        opacity: 0.35,
      });
      page.drawText(String(quantity.quantity), {
        x: x + 14,
        y: Math.min(height - 12, y + 2),
        size: 7,
        font,
        color: rgb(0.85, 0.35, 0.05),
      });
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
