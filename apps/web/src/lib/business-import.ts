export type BusinessImportType = "employees" | "leads" | "quotes" | "jobs" | "invoices";

export type BusinessImportRow = Record<string, string>;

export type ParsedBusinessImport = {
  headers: string[];
  rows: BusinessImportRow[];
};

export const businessImportLabels: Record<BusinessImportType, string> = {
  employees: "Employees",
  leads: "Leads",
  quotes: "Quotes",
  jobs: "Jobs",
  invoices: "Invoices",
};

export const businessImportTemplateHeaders: Record<BusinessImportType, string[]> = {
  employees: ["name", "role", "job_title", "email", "phone", "start_date"],
  leads: ["reference", "customer", "phone", "email", "address", "description", "source", "status", "surveyor", "survey_date", "survey_time"],
  quotes: ["reference", "customer", "description", "owner", "status", "value", "next_action", "due"],
  jobs: ["reference", "customer", "site", "description", "manager", "status", "value", "next_action", "due", "scheduled_date", "scheduled_time"],
  invoices: ["reference", "customer", "title", "status", "value_ex_vat", "cost", "vat_rate", "issued_date", "due_date", "source_reference", "notes"],
};

function normaliseHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function delimiterScore(line: string, delimiter: string) {
  let score = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      score += 1;
    }
  }
  return score;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"];
  return candidates.reduce((best, candidate) =>
    delimiterScore(firstLine, candidate) > delimiterScore(firstLine, best) ? candidate : best,
  );
}

function parseDelimitedGrid(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }

  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseBusinessImport(text: string): ParsedBusinessImport {
  const grid = parseDelimitedGrid(text.replace(/^\uFEFF/, ""), detectDelimiter(text));
  const sourceHeaders = grid[0] ?? [];
  const headers = sourceHeaders.map(normaliseHeader);
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error("The import file needs a header row.");
  }
  const rows = grid.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, values[index]?.trim() ?? ""])),
  );
  return { headers, rows };
}

export function importValue(row: BusinessImportRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normaliseHeader(alias)]?.trim();
    if (value) return value;
  }
  return "";
}

export function importNumber(row: BusinessImportRow, aliases: string[], fallback = 0) {
  const value = importValue(row, aliases).replace(/,/g, "").replace(/[£$]/g, "");
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function validateBusinessImportRow(type: BusinessImportType, row: BusinessImportRow) {
  const missing: string[] = [];
  const requireValue = (label: string, aliases: string[]) => {
    if (!importValue(row, aliases)) missing.push(label);
  };

  if (type === "employees") requireValue("name", ["name", "employee", "employee_name"]);
  if (type === "leads") {
    requireValue("customer", ["customer", "client", "customer_name", "client_name", "name"]);
    requireValue("address", ["address", "site", "site_address"]);
    requireValue("description", ["description", "scope", "work_description"]);
  }
  if (type === "quotes") {
    requireValue("reference", ["reference", "ref", "quote", "quote_number"]);
    requireValue("customer", ["customer", "client", "customer_name", "client_name"]);
    requireValue("description", ["description", "scope", "work_description"]);
  }
  if (type === "jobs") {
    requireValue("reference", ["reference", "ref", "job", "job_number"]);
    requireValue("customer", ["customer", "client", "customer_name", "client_name"]);
    requireValue("description", ["description", "scope", "work_description"]);
  }
  if (type === "invoices") {
    requireValue("reference", ["reference", "ref", "invoice", "invoice_number"]);
    requireValue("customer", ["customer", "client", "customer_name", "client_name"]);
    requireValue("value_ex_vat", ["value_ex_vat", "value", "amount", "net"]);
  }
  return missing;
}
