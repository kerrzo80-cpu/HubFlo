/**
 * CSV kit import — one row per kit line. Same kit_name groups into one package.
 *
 * Template columns:
 *   kit_name, category, description, quantity, kind
 * kind = Material | Labour (optional — auto-detected from description if blank)
 */

import type { ParsedKitDraft, KitXlsxImportResult } from "@/lib/kit-xlsx-import";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvText(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function detectColumns(header: string[]) {
  const normalized = header.map(normalizeHeader);
  const find = (...aliases: string[]) =>
    normalized.findIndex((cell) => aliases.some((alias) => cell === alias || cell.includes(alias)));

  return {
    kitName: find("kit name", "kit_name", "kit", "package", "prebuild", "assembly"),
    category: find("category", "group", "trade"),
    description: find("description", "item", "material", "part", "name"),
    quantity: find("quantity", "qty", "q"),
    kind: find("kind", "type", "line type"),
  };
}

function defaultCategory(kitName: string) {
  const name = kitName.toLowerCase();
  if (/bath|basin|toilet|vanity|wetwall|shower|towel|plaster/.test(name)) return "Bathroom";
  if (/boiler|cylinder|radiator|heating/.test(name)) return "Heating";
  return "General";
}

function parseKind(raw: string, description: string): "Material" | "Labour" {
  const value = raw.trim().toLowerCase();
  if (value.startsWith("lab")) return "Labour";
  if (/^\s*labou?r\b/i.test(description)) return "Labour";
  return "Material";
}

function parseQty(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseKitsFromCsvText(text: string, fileName = "kits.csv"): KitXlsxImportResult {
  const rows = parseCsvText(text);
  if (!rows.length) {
    throw new Error(`No rows found in ${fileName}.`);
  }

  const columns = detectColumns(rows[0] ?? []);
  const normalizedHeader = (rows[0] ?? []).map(normalizeHeader);
  const headerLooksLikeHeader = normalizedHeader.some(
    (cell) =>
      cell.includes("description") ||
      cell.includes("kit") ||
      cell === "qty" ||
      cell === "quantity" ||
      cell === "kind",
  );
  if (headerLooksLikeHeader && columns.kitName < 0) {
    throw new Error(
      `${fileName} needs a kit_name column. Download the kits CSV template from Setup → Kits.`,
    );
  }
  const hasHeader = columns.kitName >= 0 && columns.description >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (hasHeader && (columns.kitName < 0 || columns.description < 0)) {
    throw new Error(
      `${fileName} needs at least kit_name and description columns. Download the kits CSV template from Setup → Kits.`,
    );
  }

  const kitIndex = hasHeader ? columns.kitName : 0;
  const categoryIndex = hasHeader ? columns.category : 1;
  const descriptionIndex = hasHeader ? columns.description : 2;
  const quantityIndex = hasHeader ? columns.quantity : 3;
  const kindIndex = hasHeader ? columns.kind : 4;

  const kits = new Map<string, ParsedKitDraft>();
  const rowErrors: KitXlsxImportResult["rowErrors"] = [];
  let skippedRows = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + (hasHeader ? 2 : 1);
    const kitName = String(row[kitIndex] ?? "").trim();
    const description = String(row[descriptionIndex] ?? "").trim();
    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const qtyRaw = quantityIndex >= 0 ? String(row[quantityIndex] ?? "") : "";
    const kindRaw = kindIndex >= 0 ? String(row[kindIndex] ?? "") : "";

    if (!kitName && !description) {
      skippedRows += 1;
      return;
    }
    if (!kitName) {
      skippedRows += 1;
      rowErrors.push({ row: rowNumber, message: `Row ${rowNumber}: missing kit_name.` });
      return;
    }
    if (!description) {
      skippedRows += 1;
      rowErrors.push({ row: rowNumber, message: `Row ${rowNumber}: missing description for kit “${kitName}”.` });
      return;
    }

    const key = kitName.toLowerCase();
    let kit = kits.get(key);
    if (!kit) {
      kit = {
        name: kitName,
        category: category || defaultCategory(kitName),
        lines: [],
      };
      kits.set(key, kit);
    } else if (category && kit.category === "General") {
      kit.category = category;
    }

    const kind = parseKind(kindRaw, description);
    const qty = parseQty(qtyRaw);
    if (kind === "Material" && (qty === null || qty === 0) && /\?$/.test(description)) {
      skippedRows += 1;
      rowErrors.push({ row: rowNumber, message: `Skipped optional row “${description}”.` });
      return;
    }

    kit.lines.push({
      kind,
      description,
      quantity: kind === "Labour" ? qty ?? 1 : qty ?? 1,
      unitCost: 0,
      unit: kind === "Labour" ? "hrs" : "each",
    });
  });

  const cleaned = [...kits.values()].filter((kit) => kit.lines.length > 0);
  if (!cleaned.length) {
    throw new Error(
      `No kits found in ${fileName}. Use kit_name to group rows — every line with the same kit_name becomes one package.`,
    );
  }

  return {
    kits: cleaned,
    skippedRows,
    skippedOptional: rowErrors.filter((row) => /optional/i.test(row.message)).length,
    rowErrors,
    sheetName: fileName,
  };
}

export function parseKitsFromCsvBuffer(buffer: Buffer, fileName = "kits.csv"): KitXlsxImportResult {
  return parseKitsFromCsvText(buffer.toString("utf8"), fileName);
}

/** Downloadable office template (also served from /api/prebuilds/template.csv). */
export const KITS_CSV_TEMPLATE = `kit_name,category,description,quantity,kind
BATH,Bathroom,1700x700mm bath,1,Material
BATH,Bathroom,1700mm bath panel,1,Material
BATH,Bathroom,700mm bath panel,1,Material
BATH,Bathroom,Bath filler,1,Material
BATH,Bathroom,Bath waste and overflow,1,Material
BATH,Bathroom,100x20mm timber 2.4m,2,Material
BATH,Bathroom,22mm press elbow,6,Material
BATH,Bathroom,40mm bath trap,1,Material
BATH,Bathroom,Labour,4,Labour
Close coupled toilet,Bathroom,Close coupled toilet pan,1,Material
Close coupled toilet,Bathroom,Close coupled cistern,1,Material
Close coupled toilet,Bathroom,Labour,3,Labour
`;
