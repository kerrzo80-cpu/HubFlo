import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { Tender } from "@/lib/tenders-types";
import { computeBoqTotal } from "@/lib/tenders-types";

function money(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

function amountInWords(value: number) {
  const pounds = Math.floor(Math.abs(value));
  // Keep FoT practical — full legal words can come later; use a readable fallback.
  const formatted = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(pounds);
  return `${formatted} pounds only`;
}

function wrap(text: string, max = 92) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function createFormOfTenderPdf(input: {
  tender: Tender;
  businessName?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  submittedDate?: string;
}) {
  const tender = input.tender;
  const businessName = input.businessName?.trim() || "Errol Watson Group Ltd";
  const signatoryName = input.signatoryName?.trim() || "Brian Kerr";
  const signatoryTitle = input.signatoryTitle?.trim() || "Commercial Manager";
  const boqTotal = computeBoqTotal(tender.boqLines);
  // FoT figure always matches priced BoQ total (same as Bid value).
  const tenderSum = boqTotal;
  const submittedDate =
    input.submittedDate ||
    (tender.submittedAt ? tender.submittedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = rgb(0.08, 0.45, 0.62);
  const ink = rgb(0.1, 0.15, 0.18);
  const muted = rgb(0.3, 0.35, 0.38);

  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;

  const ensure = (need = 60) => {
    if (y < need) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  const write = (text: string, opts?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number; max?: number }) => {
    const size = opts?.size ?? 10;
    for (const line of wrap(text, opts?.max ?? (size >= 14 ? 55 : 92))) {
      ensure();
      page.drawText(line, {
        x: 48,
        y,
        size,
        font: opts?.bold ? bold : regular,
        color: opts?.color ?? ink,
      });
      y -= size + 4;
    }
    y -= opts?.gap ?? 2;
  };

  write(businessName, { size: 11, bold: true, color: brand, gap: 6 });
  write("FORM OF TENDER", { size: 18, bold: true, gap: 12 });
  write(`Date ${submittedDate}`);
  write(`Contractor ${tender.client}`);
  write(`Project ${tender.name}`);
  write(`Location ${tender.area}`, { gap: 10 });
  write(`Our offer for the ${tender.category.toLowerCase()} works to:`, { gap: 4 });
  write(tender.name, { bold: true });
  write(tender.area, { gap: 10 });
  write(`Our price based on the attached quantities: ${money(tenderSum)}`, { bold: true, size: 12, gap: 4 });
  write(`Tender sum in words: ${amountInWords(tenderSum)}.`, { gap: 12 });

  const conditions = [
    "Our offer is open for acceptance for a period of 3 months from the date of submission.",
    "Our offer does not include VAT unless clearly stated.",
    "All powered access, platforms and scaffolding over 3m high is to be supplied by the Main Contractor.",
    "Skips, builders' work, making good and works in connection with the services are by the Main Contractor unless specifically included within our package.",
    "Price is based on the attached Bill of Quantities and information available at tender stage.",
    "Payment terms are to be agreed prior to commitment to commence works.",
  ];
  conditions.forEach((line, index) => write(`${index + 1}. ${line}`, { gap: 4, max: 88 }));

  y -= 8;
  write("Our dayworks rates are as follows:", { bold: true, gap: 6 });
  write(`Labour  £${tender.daywork.labourPerHour.toFixed(2)} per hour`);
  write(`Materials  Cost + ${tender.daywork.materialsUpliftPercent}%`);
  write(`Plant  Cost + ${tender.daywork.plantUpliftPercent}%`, { gap: 14 });
  write("Yours faithfully", { gap: 18 });
  write(signatoryName, { bold: true });
  write(signatoryTitle, { color: muted, gap: 20 });

  // Appendix
  page = pdf.addPage([595.28, 841.89]);
  y = 800;
  write(businessName, { size: 11, bold: true, color: brand, gap: 6 });
  write("APPENDIX A — TENDER SUMMARY", { size: 16, bold: true, gap: 12 });
  write(`Project: ${tender.name}`);
  write(`Contractor: ${tender.client}`);
  write(`Tender Total excluding VAT: ${money(tenderSum)}`, { bold: true, gap: 10 });
  write(
    "The tender total stated above is based on the priced Bill of Quantities and leaves unpriced measured items blank on the return BoQ (not NIL / not £0). Blank rates mean not priced — they are not free work.",
    { size: 9, color: muted, gap: 12, max: 95 },
  );
  write(`Main priced Bill of Quantities  ${money(boqTotal)}`);
  write(`Amount carried to Form of Tender  ${money(tenderSum)}`, { bold: true, gap: 14 });
  write("Tender qualifications / caveats", { bold: true, gap: 8 });
  (tender.qualifications.length ? tender.qualifications : ["No additional qualifications recorded."]).forEach((item) => {
    write(`• ${item}`, { size: 9, gap: 4, max: 95 });
  });

  return Buffer.from(await pdf.save());
}

export function formOfTenderFilename(tender: Tender) {
  const safe = `${tender.name}`.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 60);
  return `Form_of_Tender_${safe || "tender"}.pdf`;
}
