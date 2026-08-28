/**
 * Compact live Tender / Job snapshot for Ask Blake.
 * Product: Blake talks through the open record on HubFlo data — not a ChatGPT paste-back.
 */

import { getHubDetailState } from "@/lib/hub-detail-store";
import { getJob, getJobs, getQuotes, type Job } from "@/lib/workflow-data";
import {
  groupBoqLinesBySection,
  isBoqLinePriced,
  listBoqSheetTabs,
} from "@/lib/tender-boq-sections";
import { getTender, listTendersLean } from "@/lib/tenders-data";
import { getTakeoffProject } from "@/lib/takeoff-data";
import {
  boqProgress,
  computeBoqTotal,
  daysLeftForDeadline,
  type Tender,
  type TenderBoqLine,
  type TenderDocumentKind,
} from "@/lib/tenders-types";

export type BlakeScreenContext = {
  view?: string;
  tenderId?: string | null;
  jobId?: string | null;
  quoteId?: string | null;
  takeoffId?: string | null;
};

export type BlakeBoqLineBrief = {
  ref?: string;
  description: string;
  quantity?: number | null;
  unit?: string;
  rate?: number | null;
  value?: number | null;
  section?: string;
  sheet?: string;
  source?: string;
};

export type BlakeTenderSnapshot = {
  kind: "tender";
  id: string;
  name: string;
  client: string;
  status: string;
  category: string;
  area: string;
  owner: string;
  deadline?: string;
  daysLeft: number | null;
  bidValue: number;
  tenderSum: number;
  linkedTakeoff?: { id: string; ref?: string };
  linkedJob?: { id: string; ref?: string };
  materialsNote?: string;
  qualifications: string[];
  documents: Partial<Record<TenderDocumentKind, number>>;
  documentNames: Array<{ kind: TenderDocumentKind; name: string }>;
  boq: {
    title?: string;
    measured: number;
    priced: number;
    unpriced: number;
    blakeFilled: number;
    libraryFilled: number;
    manualFilled: number;
    sheets: Array<{ name: string; measured: number; priced: number }>;
    sections: Array<{ name: string; measured: number; priced: number; total: number }>;
    blankExamples: BlakeBoqLineBrief[];
    highestPriced: BlakeBoqLineBrief[];
  };
};

export type BlakeJobSnapshot = {
  kind: "job";
  id: string;
  ref: string;
  customer: string;
  site: string;
  description: string;
  status: string;
  manager: string;
  value: number;
  next?: string;
  due?: string;
  scheduledDate?: string;
  sourceQuote?: { id: string; ref?: string };
  sourceTender?: { id: string; name?: string };
  costCentres: string[];
};

export type BlakeTakeoffSnapshot = {
  kind: "takeoff";
  id: string;
  ref?: string;
  name: string;
  customer?: string;
  drawings: string[];
  otherDocs: string[];
};

export type BlakeOpenRecord = {
  tender?: BlakeTenderSnapshot;
  job?: BlakeJobSnapshot;
  takeoff?: BlakeTakeoffSnapshot;
};

const DESCRIPTION_CAP = 140;
const BLANK_EXAMPLE_CAP = 12;
const HIGH_VALUE_CAP = 8;
const SECTION_CAP = 10;
const SHEET_CAP = 8;

export function looksLikeFillRates(message: string) {
  return /\b(price this|price the (plumbing |heating |electrical )?(tender|bill|job|boq)|fill (the |these |those )?(rates|prices)|budget[- ]price|apply (blake )?(budget |guide )?rates|qs this|price (the )?boq)\b/i.test(
    message,
  );
}

export function looksLikeRefreshRates(message: string) {
  return /\b(refresh|reprice|overwrite|fill again|price again)\b/i.test(message);
}

export function looksLikeOpenRecordQs(message: string) {
  if (looksLikeFillRates(message)) return true;
  return /\b(this (tender|bill|boq|job)|open (tender|job)|walk me through|explain (this|the) (tender|bill|boq|job)|what('s| is) (still )?(unpriced|blank|priced)|how much (is|are) (this|the|we)|tender sum|form of tender|\bfot\b|sundries|by others|rate audit|how confident|qualifications?|what('s| is) left|deadline|due date)\b/i.test(
    message,
  );
}

function clip(text: string, max = DESCRIPTION_CAP) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);
}

function briefLine(line: TenderBoqLine): BlakeBoqLineBrief {
  return {
    ref: line.ref,
    description: clip(line.description || ""),
    quantity: line.quantity,
    unit: line.unit,
    rate: line.rate,
    value: line.value,
    section: line.section,
    sheet: line.sheet,
    source: line.pricingSource,
  };
}

export function summariseTenderForBlake(tender: Tender): BlakeTenderSnapshot {
  const progress = boqProgress(tender.boqLines);
  const measured = tender.boqLines.filter((line) => line.kind === "measured");
  const priced = measured.filter((line) => isBoqLinePriced(line));
  const blank = measured.filter((line) => !isBoqLinePriced(line));
  const sheets = listBoqSheetTabs(tender.boqLines).slice(0, SHEET_CAP).map((tab) => {
    const pricedCount = tab.measuredIds.filter((id) => {
      const line = tender.boqLines.find((item) => item.id === id);
      return line ? isBoqLinePriced(line) : false;
    }).length;
    return { name: tab.label, measured: tab.measuredIds.length, priced: pricedCount };
  });
  const sections = groupBoqLinesBySection(tender.boqLines)
    .slice(0, SECTION_CAP)
    .map((group) => {
      const lines = group.measuredIds
        .map((id) => tender.boqLines.find((item) => item.id === id))
        .filter((line): line is TenderBoqLine => Boolean(line));
      const pricedLines = lines.filter((line) => isBoqLinePriced(line));
      const total = computeBoqTotal(lines);
      return {
        name: clip(group.label || "Ungrouped", 80),
        measured: lines.length,
        priced: pricedLines.length,
        total,
      };
    });
  const documents: Partial<Record<TenderDocumentKind, number>> = {};
  const documentNames: Array<{ kind: TenderDocumentKind; name: string }> = [];
  for (const doc of tender.documents) {
    documents[doc.kind] = (documents[doc.kind] || 0) + 1;
    if (documentNames.length < 12) {
      documentNames.push({ kind: doc.kind, name: doc.name });
    }
  }
  const highestPriced = priced
    .slice()
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, HIGH_VALUE_CAP)
    .map(briefLine);

  return {
    kind: "tender",
    id: tender.id,
    name: tender.name,
    client: tender.client,
    status: tender.status,
    category: tender.category,
    area: tender.area,
    owner: tender.owner,
    deadline: tender.submissionDeadline,
    daysLeft: daysLeftForDeadline(tender.submissionDeadline),
    bidValue: tender.bidValue,
    tenderSum: tender.tenderSum ?? computeBoqTotal(tender.boqLines),
    linkedTakeoff:
      tender.linkedTakeoffId
        ? { id: tender.linkedTakeoffId, ref: tender.linkedTakeoffRef }
        : undefined,
    linkedJob:
      tender.convertedJobId
        ? { id: tender.convertedJobId, ref: tender.convertedJobRef }
        : undefined,
    materialsNote: tender.materialsNote?.trim() || undefined,
    qualifications: (tender.qualifications || []).slice(0, 6),
    documents,
    documentNames,
    boq: {
      title: tender.boqTitle || undefined,
      measured: progress.measured,
      priced: progress.priced,
      unpriced: progress.unpriced,
      blakeFilled: priced.filter((line) => line.pricingSource === "blake-budget").length,
      libraryFilled: priced.filter((line) => line.pricingSource === "rate-library").length,
      manualFilled: priced.filter((line) => line.pricingSource === "manual").length,
      sheets,
      sections,
      blankExamples: blank.slice(0, BLANK_EXAMPLE_CAP).map(briefLine),
      highestPriced,
    },
  };
}

export function summariseJobForBlake(job: Job): BlakeJobSnapshot {
  const hubState = getHubDetailState();
  const centres = ((hubState.jobCostCentres ?? {}) as Record<string, Array<{ id?: string; name?: string }>>)[job.id] ?? [];
  const quote = job.sourceQuoteId
    ? getQuotes().find((item) => item.id === job.sourceQuoteId)
    : undefined;
  return {
    kind: "job",
    id: job.id,
    ref: job.ref,
    customer: job.customer,
    site: job.site,
    description: job.description,
    status: job.status,
    manager: job.manager,
    value: job.value,
    next: job.next || undefined,
    due: job.due || undefined,
    scheduledDate: job.scheduledDate,
    sourceQuote:
      job.sourceQuoteId
        ? { id: job.sourceQuoteId, ref: job.sourceQuoteRef || quote?.ref }
        : undefined,
    sourceTender:
      job.sourceTenderId
        ? { id: job.sourceTenderId, name: job.sourceTenderName }
        : undefined,
    costCentres: centres
      .map((centre) => (centre.name || "").trim())
      .filter(Boolean)
      .slice(0, 20),
  };
}

function matchTenderFromMessage(message: string) {
  const tenders = listTendersLean();
  const lower = message.toLowerCase();
  return tenders.find((tender) => {
    const name = tender.name.trim().toLowerCase();
    const client = tender.client.trim().toLowerCase();
    return (name.length > 3 && lower.includes(name)) || (client.length > 3 && lower.includes(client));
  });
}

export function resolveOpenRecord(screen?: BlakeScreenContext | null, message = ""): BlakeOpenRecord {
  const record: BlakeOpenRecord = {};
  const tenderId = screen?.tenderId?.trim();
  const jobId = screen?.jobId?.trim();
  const takeoffId = screen?.takeoffId?.trim();

  if (tenderId) {
    const tender = getTender(tenderId);
    if (tender) record.tender = summariseTenderForBlake(tender);
  }

  if (jobId) {
    const job = getJob(jobId) || getJobs().find((item) => item.id === jobId);
    if (job) {
      record.job = summariseJobForBlake(job);
      if (!record.tender && job.sourceTenderId) {
        const linked = getTender(job.sourceTenderId);
        if (linked) record.tender = summariseTenderForBlake(linked);
      }
    }
  }

  const takeoffLookup = takeoffId || record.tender?.linkedTakeoff?.id;
  if (takeoffLookup) {
    const takeoff = getTakeoffProject(takeoffLookup);
    if (takeoff) {
      record.takeoff = {
        kind: "takeoff",
        id: takeoff.id,
        ref: takeoff.reference,
        name: takeoff.name,
        customer: takeoff.customer,
        drawings: takeoff.documents
          .filter((doc) => doc.kind === "Drawing" || doc.kind === "Marked-up drawing")
          .map((doc) => doc.fileName)
          .slice(0, 8),
        otherDocs: takeoff.documents
          .filter((doc) => doc.kind !== "Drawing" && doc.kind !== "Marked-up drawing")
          .map((doc) => `${doc.kind}: ${doc.fileName}`)
          .slice(0, 6),
      };
    }
  }

  if (!record.tender && looksLikeOpenRecordQs(message)) {
    const named = matchTenderFromMessage(message);
    if (named) {
      const tender = getTender(named.id);
      if (tender) record.tender = summariseTenderForBlake(tender);
    }
  }

  return record;
}

function formatLine(line: BlakeBoqLineBrief) {
  const ref = line.ref ? `${line.ref} · ` : "";
  const qty = typeof line.quantity === "number" ? ` ${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "";
  return `• ${ref}${line.description}${qty}`;
}

export function formatOpenRecordBrief(record: BlakeOpenRecord): string {
  const parts: string[] = [];

  if (record.job && !record.tender) {
    const job = record.job;
    parts.push(
      `Open job ${job.ref} — ${job.customer}.`,
      `${job.description || "No description"} · ${job.status} · ${money(job.value)}.`,
    );
    if (job.manager) parts.push(`Manager: ${job.manager}.`);
    if (job.costCentres.length) parts.push(`Cost centres: ${job.costCentres.join(", ")}.`);
    if (job.sourceQuote?.ref) parts.push(`Raised from quote ${job.sourceQuote.ref}.`);
    parts.push("This job is not linked to a tender BoQ, so I cannot fill client-bill rates from here.");
    return parts.join("\n");
  }

  if (record.job && record.tender) {
    parts.push(
      `Open job ${record.job.ref} — ${record.job.customer} (from tender ${record.tender.name}).`,
    );
  }

  const tender = record.tender;
  if (!tender) {
    return "Open the tender or job you want to talk through, then ask again. I work from live NeXa records, not a pasted ChatGPT chat.";
  }

  const days =
    tender.daysLeft == null
      ? "no submission date"
      : tender.daysLeft < 0
        ? `${Math.abs(tender.daysLeft)} day(s) overdue`
        : `${tender.daysLeft} day(s) left`;

  parts.push(
    `Open tender: ${tender.name} · ${tender.client} · ${tender.category} · ${tender.status}.`,
    `Deadline: ${tender.deadline ? `${tender.deadline.slice(0, 10)} (${days})` : "not set"}. Owner: ${tender.owner || "unassigned"}.`,
    `BoQ ${tender.boq.title ? `“${tender.boq.title}”` : ""}: ${tender.boq.measured} measured line(s), ${tender.boq.priced} priced, ${tender.boq.unpriced} still blank.`.replace(
      "BoQ :",
      "BoQ:",
    ),
    `Priced total / FoT: ${money(tender.tenderSum)} (guide ${tender.boq.blakeFilled} Blake · ${tender.boq.libraryFilled} library · ${tender.boq.manualFilled} typed).`,
  );

  if (tender.linkedTakeoff?.ref || tender.linkedTakeoff?.id) {
    parts.push(`Linked takeoff: ${tender.linkedTakeoff.ref || tender.linkedTakeoff.id}.`);
  }
  if (tender.linkedJob?.ref || tender.linkedJob?.id) {
    parts.push(`Won job: ${tender.linkedJob.ref || tender.linkedJob.id}.`);
  }

  const docBits = Object.entries(tender.documents)
    .filter(([, count]) => (count || 0) > 0)
    .map(([kind, count]) => `${kind.replace(/-/g, " ")} ${count}`);
  if (docBits.length) parts.push(`Documents on this tender: ${docBits.join(", ")}.`);
  if (tender.documentNames?.length) {
    parts.push(`Files: ${tender.documentNames.map((doc) => doc.name).join("; ")}.`);
  }
  if (record.takeoff) {
    parts.push(
      `Linked takeoff ${record.takeoff.ref || record.takeoff.name}: ${
        record.takeoff.drawings.length
          ? `drawings ${record.takeoff.drawings.join(", ")}`
          : "no drawings yet"
      }.`,
    );
  }
  parts.push(
    "I can talk through these files by name and the live BoQ. I do not ingest a ChatGPT-style dump of six PDFs at once — put the bill in Tenders → Bill, then ask. Drawings: find CAD plumbing one sheet at a time.",
  );

  if (tender.boq.blankExamples.length) {
    parts.push("Still blank (examples):");
    parts.push(...tender.boq.blankExamples.slice(0, 8).map(formatLine));
  }
  if (tender.boq.highestPriced.length && tender.boq.priced > 0) {
    parts.push("Highest priced lines:");
    parts.push(
      ...tender.boq.highestPriced.slice(0, 5).map((line) => {
        const value = typeof line.value === "number" ? ` · ${money(line.value)}` : "";
        return `${formatLine(line)}${value}`;
      }),
    );
  }
  if (tender.qualifications.length) {
    parts.push("Qualifications already on this tender:");
    parts.push(...tender.qualifications.slice(0, 4).map((item) => `• ${clip(item, 180)}`));
  }

  parts.push(
    "Assumptions: rate library first, then UK trade ballpark for gaps. Unsure lines stay blank (not £0). This is an internal budget — confirm supplier quotes before you treat it as a firm tender. I do not replay ChatGPT chats; I price the live BoQ in NeXa.",
  );

  return parts.join("\n");
}

export function formatBudgetPriceOffer(record: BlakeOpenRecord, forceRefresh: boolean): {
  reply: string;
  canApply: boolean;
  detail: string;
} {
  const tender = record.tender;
  if (!tender) {
    return {
      reply: "Open a tender (or a job raised from a tender) first. Then ask me to price the live BoQ.",
      canApply: false,
      detail: "",
    };
  }
  if (!tender.boq.measured) {
    return {
      reply: [
        formatOpenRecordBrief(record),
        "",
        "No measured BoQ lines yet. Import their bill on Tenders → Bill, then ask me again.",
      ].join("\n"),
      canApply: false,
      detail: "",
    };
  }
  if (!forceRefresh && tender.boq.unpriced === 0) {
    return {
      reply: [
        formatOpenRecordBrief(record),
        "",
        "Every measured line already has a rate. Say “refresh rates” if you want Blake/library guides re-run (typed rates stay). Do not treat this total as a firm tender until specialist quotes are in.",
      ].join("\n"),
      canApply: true,
      detail: `Refresh guides on ${tender.boq.measured} line(s) · current FoT ${money(tender.tenderSum)}`,
    };
  }
  const target = forceRefresh ? tender.boq.measured : tender.boq.unpriced;
  return {
    reply: [
      formatOpenRecordBrief(record),
      "",
      forceRefresh
        ? `I can re-run Blake budget prices on the open BoQ (${target} measured line(s)). Typed/manual rates are kept. Confirm and I’ll write guide rates into this tender.`
        : `I can fill blank rates on the open BoQ (${target} unpriced line(s)) from the rate library, then UK trade ballpark for gaps. Confirm and I’ll write those guides into this tender — same as Tenders → Bill → Blake budget prices.`,
      "Leave ventilation / AC / BMS / builders’ work blank yourself if they are not our trade — I will not silently drop their bill wording.",
    ].join("\n"),
    canApply: true,
    detail: forceRefresh
      ? `Refresh Blake/library guides · ${tender.name}`
      : `Fill ${target} blank line(s) · ${tender.name}`,
  };
}
