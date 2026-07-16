import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { EstimateRecord, SurveyCompletionReview, SurveyRecord } from "@hubflo/domain";

import { getServerStoreDirectory } from "@/lib/server-store";

const blue = rgb(0.08, 0.52, 0.72);
const darkBlue = rgb(0.05, 0.25, 0.36);
const ink = rgb(0.09, 0.18, 0.23);
const muted = rgb(0.35, 0.44, 0.48);
const line = rgb(0.81, 0.87, 0.89);
const paleBlue = rgb(0.92, 0.97, 0.99);
const white = rgb(1, 1, 1);

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E£°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function logoPath() {
  const candidates = [
    path.join(process.cwd(), "public", "ewg-logo.png"),
    path.join(process.cwd(), "apps", "web", "public", "ewg-logo.png"),
  ];
  return candidates.find(existsSync);
}

async function embedLogo(pdf: PDFDocument) {
  const file = logoPath();
  return file ? pdf.embedPng(readFileSync(file)) : undefined;
}

async function embedPhoto(pdf: PDFDocument, storageKey: string) {
  try {
    const root = path.resolve(getServerStoreDirectory());
    const file = path.resolve(root, storageKey);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return undefined;
    const bytes = readFileSync(file);
    return /\.png$/i.test(file) ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  } catch {
    return undefined;
  }
}

export async function createSurveyPdf(
  survey: SurveyRecord,
  review: SurveyCompletionReview,
  estimate?: EstimateRecord,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${survey.reference} - ${survey.customerName} site survey`);
  pdf.setAuthor("Errol Watson Group Ltd - NeXa Surveyor");
  pdf.setSubject(`${survey.jobType} survey`);
  pdf.setCreator("NeXa Surveyor");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);
  const margin = 38;
  const pageWidth = PageSizes.A4[0];
  const contentWidth = pageWidth - margin * 2;
  let page!: PDFPage;
  let y = 0;
  let sectionName = "Site survey";

  function header(target: PDFPage) {
    target.drawRectangle({ x: 0, y: PageSizes.A4[1] - 76, width: pageWidth, height: 76, color: white });
    target.drawRectangle({ x: 0, y: PageSizes.A4[1] - 80, width: pageWidth, height: 4, color: blue });
    if (logo) {
      const size = logo.scaleToFit(90, 50);
      target.drawImage(logo, { x: margin, y: PageSizes.A4[1] - 65, width: size.width, height: size.height });
    } else {
      target.drawText("ERROL WATSON GROUP", { x: margin, y: PageSizes.A4[1] - 45, font: bold, size: 14, color: darkBlue });
    }
    target.drawText(safeText(survey.reference), { x: pageWidth - margin - 90, y: PageSizes.A4[1] - 38, font: bold, size: 13, color: darkBlue });
    target.drawText(sectionName, { x: pageWidth - margin - regular.widthOfTextAtSize(sectionName, 8), y: PageSizes.A4[1] - 53, font: regular, size: 8, color: muted });
  }

  function addPage(nextSection = sectionName) {
    sectionName = nextSection;
    page = pdf.addPage(PageSizes.A4);
    header(page);
    y = PageSizes.A4[1] - 104;
  }

  function ensureSpace(height: number, nextSection = sectionName) {
    if (y - height < 52) addPage(nextSection);
  }

  function section(title: string) {
    ensureSpace(34, title);
    sectionName = title;
    page.drawRectangle({ x: margin, y: y - 23, width: contentWidth, height: 25, color: paleBlue });
    page.drawText(safeText(title).toUpperCase(), { x: margin + 10, y: y - 15, font: bold, size: 8.5, color: darkBlue });
    y -= 35;
  }

  function paragraph(text: string, options: { bold?: boolean; color?: typeof ink; indent?: number; prefix?: string } = {}) {
    const font = options.bold ? bold : regular;
    const size = options.bold ? 9.5 : 8.5;
    const indent = options.indent || 0;
    const value = options.prefix ? `${options.prefix} ${text}` : text;
    const lines = wrapText(value, font, size, contentWidth - indent);
    ensureSpace(lines.length * 12 + 4);
    lines.forEach((textLine, index) => page.drawText(textLine, { x: margin + indent, y: y - index * 12, font, size, color: options.color || ink }));
    y -= lines.length * 12 + 5;
  }

  function keyValue(label: string, value: unknown, x: number, width: number, rowY: number) {
    page.drawText(safeText(label).toUpperCase(), { x, y: rowY, font: bold, size: 6.8, color: muted });
    const lines = wrapText(safeText(value) || "Not recorded", regular, 8.5, width);
    lines.slice(0, 3).forEach((textLine, index) => page.drawText(textLine, { x, y: rowY - 13 - index * 10.5, font: regular, size: 8.5, color: ink }));
    return Math.max(36, 20 + Math.min(lines.length, 3) * 10.5);
  }

  function detailGrid(items: Array<[string, unknown]>) {
    for (let index = 0; index < items.length; index += 2) {
      const left = items[index]!;
      const right = items[index + 1];
      const rowHeight = Math.max(
        46,
        20 + wrapText(safeText(left[1]) || "Not recorded", regular, 8.5, contentWidth / 2 - 18).length * 10.5,
        right ? 20 + wrapText(safeText(right[1]) || "Not recorded", regular, 8.5, contentWidth / 2 - 18).length * 10.5 : 0,
      );
      ensureSpace(rowHeight + 4);
      keyValue(left[0], left[1], margin, contentWidth / 2 - 12, y);
      if (right) keyValue(right[0], right[1], margin + contentWidth / 2 + 12, contentWidth / 2 - 12, y);
      page.drawLine({ start: { x: margin, y: y - rowHeight + 7 }, end: { x: margin + contentWidth, y: y - rowHeight + 7 }, thickness: 0.5, color: line });
      y -= rowHeight;
    }
  }

  function statusPill(status: string, x: number, rowY: number) {
    const label = safeText(status);
    const width = Math.max(48, bold.widthOfTextAtSize(label, 6.5) + 14);
    page.drawRectangle({ x, y: rowY - 4, width, height: 16, color: /TBC|RFQ|Provisional|Assumed/i.test(label) ? rgb(1, .95, .82) : rgb(.9, .97, .93), borderColor: line, borderWidth: .4 });
    page.drawText(label, { x: x + 7, y: rowY + 1, font: bold, size: 6.5, color: /TBC|RFQ/i.test(label) ? rgb(.6, .35, .03) : rgb(.1, .4, .25) });
  }

  addPage("Survey details");
  page.drawText("SITE SURVEY REPORT", { x: margin, y, font: bold, size: 20, color: darkBlue });
  page.drawText(safeText(survey.jobType), { x: margin, y: y - 21, font: regular, size: 11, color: blue });
  y -= 48;
  section("Survey details");
  detailGrid([
    ["Customer", survey.customerName], ["Site", survey.siteAddress],
    ["Primary contact", `${survey.primaryContact.name} ${survey.primaryContact.phone} ${survey.primaryContact.email}`], ["Linked record", survey.jobLink ? `${survey.jobLink.type} ${survey.jobLink.reference}` : "Not linked"],
    ["Surveyor", survey.surveyorName], ["Survey date", survey.surveyDate],
    ["Required by", survey.requiredByDate || "Not specified"], ["Occupancy / market", `${survey.occupancy} / ${survey.market}`],
  ]);
  section("Customer requirements");
  paragraph(survey.customerRequirements || "No customer requirements recorded.");
  section("Existing conditions");
  for (const answer of survey.answers) {
    const answerHeight = wrapText(`${answer.question}: ${safeText(answer.value) || answer.tbcReason || "Not recorded"}`, regular, 8.3, contentWidth - 82).length * 11 + 12;
    ensureSpace(answerHeight);
    statusPill(answer.status, margin, y - 2);
    const value = `${answer.question}: ${safeText(answer.value) || answer.tbcReason || "Not recorded"}${answer.notes ? ` - ${answer.notes}` : ""}`;
    const lines = wrapText(value, regular, 8.3, contentWidth - 82);
    lines.forEach((textLine, index) => page.drawText(textLine, { x: margin + 78, y: y - index * 11, font: regular, size: 8.3, color: ink }));
    y -= Math.max(27, lines.length * 11 + 8);
  }

  section("Proposed scope");
  survey.scopeItems.forEach((item, index) => {
    paragraph(`${index + 1}. ${item.taskType} - ${item.roomOrArea || "Area TBC"}`, { bold: true });
    paragraph(`${item.existingPosition || "Existing position TBC"} to ${item.proposedPosition || "proposed position TBC"}. Quantity ${item.quantity}. ${item.dimensions || ""} ${item.notes || ""}`, { indent: 12 });
    paragraph(`Responsibility: ${item.responsibility}. Status: ${item.status}.`, { indent: 12, color: muted });
  });

  section("Rooms and measurements");
  if (!survey.rooms.length) paragraph("No room measurements recorded.", { color: muted });
  survey.rooms.forEach((room) => detailGrid([
    ["Room / area", room.name], ["Dimensions", `${room.lengthM ?? "TBC"}m x ${room.widthM ?? "TBC"}m x ${room.heightM ?? "TBC"}m`],
    ["Construction", `Walls: ${room.wallConstruction}; floor: ${room.floorConstruction}; ceiling: ${room.ceilingConstruction}`], ["Access", room.accessNotes],
  ]));

  section("Pipe runs");
  if (!survey.pipeRuns.length) paragraph("No pipe runs recorded.", { color: muted });
  survey.pipeRuns.forEach((run) => {
    paragraph(`${run.service}: ${run.fromLocation} to ${run.toLocation}`, { bold: true });
    paragraph(`${run.measuredLengthM ?? "TBC"}m ${run.pipeSize || "size TBC"} ${run.material || "material TBC"}. Route: ${run.route || "TBC"}. Direction changes: ${run.directionChanges.map((item) => `${item.quantity} ${item.type}`).join(", ") || "none recorded"}. Status: ${run.measurementStatus}.`, { indent: 12 });
    paragraph(`Access: ${run.accessDifficulty}. Insulation: ${run.insulationRequired ? "yes" : "no"}. Core drilling: ${run.coreDrilling ? "yes" : "no"}. Fire stopping: ${run.fireStopping ? "yes" : "no"}. Making good: ${run.makingGood ? "yes" : "no"}.`, { indent: 12, color: muted });
  });

  section("Fixtures and equipment");
  if (!survey.equipmentItems.length) paragraph("No equipment items recorded.", { color: muted });
  survey.equipmentItems.forEach((item) => {
    paragraph(`${item.quantity} x ${item.description || item.category} - ${item.make} ${item.model}`.trim(), { bold: true });
    paragraph(`${item.roomOrArea}. ${item.dimensions || ""} ${item.outputOrCapacity || ""} ${item.connectionRequirements || ""}`.trim(), { indent: 12 });
    paragraph(`${item.rfqRequired ? "Supplier RFQ required" : item.confirmedSupplierPrice !== undefined ? `Supplier price £${item.confirmedSupplierPrice.toFixed(2)}` : "Price not recorded"}. Status: ${item.status}. ${item.tbcReason || ""}`, { indent: 12, color: muted });
  });

  section("Photos and evidence");
  if (!survey.photos.length) paragraph("No photographs attached.", { color: muted });
  for (const photo of survey.photos) {
    ensureSpace(100, "Photos and evidence");
    const image = await embedPhoto(pdf, photo.storageKey);
    if (image) {
      const dimensions = image.scaleToFit(112, 78);
      page.drawRectangle({ x: margin, y: y - 80, width: 116, height: 82, borderColor: line, borderWidth: .6 });
      page.drawImage(image, { x: margin + 2, y: y - 78, width: dimensions.width, height: dimensions.height });
    } else {
      page.drawRectangle({ x: margin, y: y - 72, width: 108, height: 70, color: paleBlue, borderColor: line, borderWidth: .6 });
      page.drawText("PHOTO", { x: margin + 34, y: y - 39, font: bold, size: 8, color: muted });
    }
    page.drawText(safeText(photo.category), { x: margin + 128, y: y - 6, font: bold, size: 9, color: darkBlue });
    const captionLines = wrapText(photo.caption || photo.fileName, regular, 8.2, contentWidth - 128);
    captionLines.slice(0, 5).forEach((textLine, index) => page.drawText(textLine, { x: margin + 128, y: y - 22 - index * 11, font: regular, size: 8.2, color: ink }));
    page.drawText(`${safeText(photo.surveySection)} | ${safeText(photo.capturedAt)}`, { x: margin + 128, y: y - 75, font: regular, size: 7, color: muted });
    y -= 92;
  }

  section("Completion review");
  paragraph(review.canComplete ? "Survey passed the essential completion gates." : "Survey has blocking completion items.", { bold: true, color: review.canComplete ? rgb(.1, .4, .25) : rgb(.65, .2, .15) });
  [...review.blockers, ...review.missingInformation, ...review.tbcItems, ...review.designDependencies, ...review.supplierRfqs, ...review.conflicts]
    .forEach((item) => paragraph(`${item.section}: ${item.message}`, { prefix: "-", indent: 8 }));
  section("Assumptions and work by others");
  survey.assumptions.forEach((item) => paragraph(item, { prefix: "-", indent: 8 }));
  survey.workByOthers.forEach((item) => paragraph(`By others: ${item}`, { prefix: "-", indent: 8 }));

  if (estimate) {
    section("Estimator handoff");
    paragraph(`${estimate.reference} generated from survey version ${estimate.sourceSurveyVersion}. ${estimate.materialLines.length} material components and ${estimate.labourLines.length} labour tasks are available for estimator review.`);
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: margin, y: 36 }, end: { x: pageWidth - margin, y: 36 }, thickness: .5, color: line });
    pdfPage.drawText("Errol Watson Group Ltd | Generated by NeXa Surveyor", { x: margin, y: 22, font: regular, size: 7, color: muted });
    const pageText = `Page ${index + 1} of ${pages.length}`;
    pdfPage.drawText(pageText, { x: pageWidth - margin - regular.widthOfTextAtSize(pageText, 7), y: 22, font: regular, size: 7, color: muted });
  });
  return pdf.save();
}
