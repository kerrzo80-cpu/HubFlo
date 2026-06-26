"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Bot,
  Calculator,
  ClipboardList,
  FilePlus2,
  FileText,
  Link2,
  ListChecks,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

type TradeCategory =
  | "Plumbing"
  | "Heating"
  | "Bathroom"
  | "Joinery"
  | "Electrical"
  | "Tiling"
  | "Decoration"
  | "Multi-trade"
  | "Tender / BOQ";

type JobDetails = {
  jobName: string;
  customerName: string;
  siteAddress: string;
  tradeCategory: TradeCategory;
  labourRate: number;
  materialMarkup: number;
  vatRate: number;
};

type HubRecordKind = "Job" | "Quote" | "Lead";

type HubRecordLink = {
  kind: HubRecordKind;
  id: string;
  ref: string;
  customer: string;
  title: string;
  site?: string;
  status?: string;
};

type HubRecordOption = HubRecordLink & {
  description: string;
};

type UploadedFileSummary = {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
};

type EstimateLine = {
  id: string;
  section: string;
  itemDescription: string;
  trade: TradeCategory | "Builder works";
  quantity: number;
  unit: string;
  labourHours: number;
  labourRate: number;
  materialUnitCost: number;
  notes: string;
};

type BoqLine = {
  itemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
  notes: string;
};

type TakeoffLine = {
  section: string;
  description: string;
  quantity: number;
  unit: string;
  source: string;
  assumption: string;
};

type AiTotals = {
  total_labour: number;
  total_materials: number;
  markup: number;
  vat: number;
  total_ex_vat: number;
  total_inc_vat: number;
};

type AiResponse = {
  job_summary: string;
  scope_understood: string[];
  assumptions: string[];
  questions: string[];
  labour_lines: Array<{ trade: string; description: string; hours: number; total: number }>;
  material_lines: Array<{ description: string; quantity: number; unit: string; total: number }>;
  boq_lines: BoqLine[];
  takeoff_lines: TakeoffLine[];
  totals: AiTotals;
  simpro_description: string;
  exclusions: string[];
  confidence_level: "Low" | "Medium" | "High";
  review_required: boolean;
  suggested_next_step: string;
};

type AiDraft = {
  id: string;
  title: string;
  jobDetails: JobDetails;
  uploadedFiles: UploadedFileSummary[];
  userPrompt: string;
  aiOutput: AiResponse;
  estimateLines: EstimateLine[];
  simproDescription: string;
  dateCreated: string;
  linkedRecord?: HubRecordLink | null;
  linkedQuoteRef?: string;
};

type ApiJob = {
  id: string;
  ref: string;
  customer: string;
  site: string;
  description: string;
  status: string;
};

type ApiQuote = {
  id: string;
  ref: string;
  customer: string;
  description: string;
  status: string;
};

type ApiLead = {
  id: string;
  ref: string;
  customerName: string;
  address: string;
  description: string;
  status: string;
};

const tradeCategories: TradeCategory[] = [
  "Plumbing",
  "Heating",
  "Bathroom",
  "Joinery",
  "Electrical",
  "Tiling",
  "Decoration",
  "Multi-trade",
  "Tender / BOQ",
];

const promptExamples = [
  "Price this job from the photos and notes",
  "Create a BOQ from this drawing",
  "Do a plumbing and heating takeoff",
  "Split this into labour and materials",
  "Make this into a simPRO quote description",
  "Create an RFQ for materials",
  "Check what I've missed",
];

const storageKey = "hubflo:ai-surveyor-drafts:v1";
const quoteCostCentreStorageKey = "hubflo:quote-cost-centres:v1";

const defaultJobDetails: JobDetails = {
  jobName: "",
  customerName: "",
  siteAddress: "",
  tradeCategory: "Multi-trade",
  labourRate: 70,
  materialMarkup: 30,
  vatRate: 20,
};

const ewgSystemPrompt =
  "You are the EWG AI Surveyor and Estimator for Errol Watson Group. You help price UK plumbing, heating, bathroom, joinery and small construction works. You can analyse typed notes, survey sheets, handwritten notes, photos, drawings, specifications, emails and tender documents. Your job is to produce realistic estimates, takeoffs, BOQs, material lists, labour allowances, RFQs and simPRO-ready quote descriptions.\n\nAlways separate labour and materials. Use £70/hr labour rate, 30% material markup and 20% VAT unless the user changes these values. Break multi-trade work into clear sections. Make sensible assumptions where information is missing and clearly list those assumptions. Ask only essential questions where missing information would materially affect the price. For drawings and takeoffs, clearly state if quantities are provisional because scale, dimensions or details are unclear. Always include exclusions and qualifications suitable for a customer quote or tender submission.";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function fileSizeLabel(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function safeLoadDrafts(): AiDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as AiDraft[]) : [];
  } catch {
    return [];
  }
}

function safeSaveDrafts(drafts: AiDraft[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(drafts));
  } catch {
    // Draft storage is best effort in the browser.
  }
}

function saveQuoteCostCentreHandoff(quoteId: string, job: JobDetails, lines: EstimateLine[], response: AiResponse, linkedRecord?: HubRecordLink | null) {
  if (typeof window === "undefined") return;
  const stored = window.localStorage.getItem(quoteCostCentreStorageKey);
  const current = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
  const quoteLines = lines.flatMap((line) => {
    const totals = lineMath(line, job.materialMarkup);
    return [
      {
        id: `${line.id}-labour`,
        catalogItemId: "labour-engineer",
        description: `${line.section} labour - ${line.itemDescription}`,
        quantity: line.labourHours,
        unitCost: Math.round(line.labourRate * 0.55 * 100) / 100,
        unitSell: line.labourRate,
      },
      {
        id: `${line.id}-materials`,
        catalogItemId: "one-off-material",
        description: `${line.section} materials - ${line.itemDescription}`,
        quantity: line.quantity,
        unitCost: line.materialUnitCost,
        unitSell: line.quantity > 0 ? Math.round(((totals.materialTotal + totals.markup) / line.quantity) * 100) / 100 : 0,
      },
    ];
  });
  current[quoteId] = [
    {
      id: `${quoteId}-ai-surveyor-centre`,
      name: job.tradeCategory,
      templateName: "AI Surveyor / Estimator",
      clientDescription: response.simpro_description,
      engineerDescription: `${linkedRecord ? `Linked to ${linkedRecord.kind} ${linkedRecord.ref}. ` : ""}AI-generated draft from: ${response.job_summary}`,
      lines: quoteLines,
      takeoffRows: response.takeoff_lines.map((line, index) => ({
        id: `${quoteId}-takeoff-${index + 1}`,
        source: "Takeoff",
        section: line.section,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        supplierRequired: true,
        unitCost: 0,
        markupPercent: job.materialMarkup,
      })),
    },
  ];
  window.localStorage.setItem(quoteCostCentreStorageKey, JSON.stringify(current));
}

function lineMath(line: EstimateLine, markupPercent: number) {
  const labourTotal = line.labourHours * line.labourRate;
  const materialTotal = line.quantity * line.materialUnitCost;
  const markup = materialTotal * (markupPercent / 100);
  return {
    labourTotal,
    materialTotal,
    markup,
    lineTotal: labourTotal + materialTotal + markup,
  };
}

function estimateTotals(lines: EstimateLine[], markupPercent: number, vatPercent: number): AiTotals {
  const base = lines.reduce(
    (acc, line) => {
      const totals = lineMath(line, markupPercent);
      acc.labour += totals.labourTotal;
      acc.materials += totals.materialTotal;
      acc.markup += totals.markup;
      return acc;
    },
    { labour: 0, materials: 0, markup: 0 },
  );
  const totalExVat = base.labour + base.materials + base.markup;
  const vat = totalExVat * (vatPercent / 100);
  return {
    total_labour: base.labour,
    total_materials: base.materials,
    markup: base.markup,
    vat,
    total_ex_vat: totalExVat,
    total_inc_vat: totalExVat + vat,
  };
}

function sectionsForTrade(trade: TradeCategory): Array<{ section: string; trade: EstimateLine["trade"] }> {
  if (trade === "Multi-trade" || trade === "Tender / BOQ") {
    return [
      { section: "Plumbing", trade: "Plumbing" },
      { section: "Heating", trade: "Heating" },
      { section: "Joinery", trade: "Joinery" },
      { section: "Electrical", trade: "Electrical" },
      { section: "Tiling", trade: "Tiling" },
      { section: "Decoration", trade: "Decoration" },
      { section: "Builder works", trade: "Builder works" },
    ];
  }
  if (trade === "Bathroom") {
    return [
      { section: "Strip out and prep", trade: "Builder works" },
      { section: "Plumbing first and second fix", trade: "Plumbing" },
      { section: "Bathroom fit out", trade: "Bathroom" },
      { section: "Tiling and finishes", trade: "Tiling" },
      { section: "Making good", trade: "Decoration" },
    ];
  }
  return [{ section: trade, trade }];
}

function descriptionForSection(section: string) {
  const descriptions: Record<string, string> = {
    Plumbing: "Pipework, isolation, fittings, testing and commissioning allowance",
    Heating: "Heating components, radiator/pipework allowance and commissioning",
    Joinery: "Joinery openings, boxing, access panels and making-good support",
    Electrical: "Electrical isolation, minor alteration and certification allowance",
    Tiling: "Wall/floor tiling, trims, adhesive, grout and preparation allowance",
    Decoration: "Preparation, stain block where required and decoration finish",
    "Builder works": "Protection, waste, small builder works and making good",
    "Strip out and prep": "Strip out, protection, waste handling and site preparation",
    "Plumbing first and second fix": "First fix, second fix and pressure testing allowance",
    "Bathroom fit out": "Sanitaryware, furniture and final bathroom installation",
    "Tiling and finishes": "Wet wall or tiling areas, trims, sealants and finishing",
    "Making good": "Patch repairs, decoration and final clean allowance",
  };
  return descriptions[section] ?? `${section} labour and materials allowance`;
}

function defaultMaterialCost(section: string) {
  if (section.includes("Heating")) return 420;
  if (section.includes("Bathroom")) return 650;
  if (section.includes("Tiling")) return 260;
  if (section.includes("Electrical")) return 180;
  if (section.includes("Joinery")) return 240;
  if (section.includes("Decoration")) return 95;
  if (section.includes("Builder") || section.includes("Strip")) return 140;
  return 220;
}

function defaultHours(section: string) {
  if (section.includes("Heating")) return 10;
  if (section.includes("Bathroom")) return 18;
  if (section.includes("Tiling")) return 14;
  if (section.includes("Electrical")) return 4;
  if (section.includes("Joinery")) return 7;
  if (section.includes("Decoration")) return 6;
  if (section.includes("Builder") || section.includes("Strip")) return 5;
  return 8;
}

function buildEstimateLines(job: JobDetails, instruction: string, files: UploadedFileSummary[], mode: string): EstimateLine[] {
  const lower = `${instruction} ${files.map((file) => file.name).join(" ")} ${mode}`.toLowerCase();
  const quantityBoost = lower.includes("boq") || lower.includes("tender") ? 1.25 : 1;
  const takeoffBoost = lower.includes("drawing") || lower.includes("plan") || lower.includes("takeoff") ? 1.15 : 1;
  const fileBoost = files.length > 2 ? 1.1 : 1;
  return sectionsForTrade(job.tradeCategory).map(({ section, trade }, index) => ({
    id: makeId("line"),
    section,
    itemDescription: descriptionForSection(section),
    trade,
    quantity: Number((quantityBoost * takeoffBoost).toFixed(2)),
    unit: section.includes("Tiling") || section.includes("Decoration") ? "m2 allowance" : "item",
    labourHours: Math.round(defaultHours(section) * takeoffBoost * fileBoost),
    labourRate: job.labourRate,
    materialUnitCost: Math.round(defaultMaterialCost(section) * quantityBoost * fileBoost),
    notes: "Draft AI allowance. Confirm quantities, access, specification and hidden conditions before issue.",
  }));
}

function buildTakeoffLines(lines: EstimateLine[], files: UploadedFileSummary[]): TakeoffLine[] {
  const source = files.length ? "Uploaded notes/drawings/photos" : "Typed job description";
  return lines.flatMap((line) => {
    const common = {
      section: line.section,
      source,
      assumption: "Provisional quantity pending measured survey or confirmed scaled drawing.",
    };
    if (line.trade === "Heating") {
      return [
        { ...common, description: "Radiator positions and sizes", quantity: Math.max(1, Math.round(line.quantity * 3)), unit: "nr" },
        { ...common, description: "Heating pipework allowance", quantity: Math.max(10, Math.round(line.quantity * 18)), unit: "m" },
      ];
    }
    if (line.trade === "Plumbing" || line.trade === "Bathroom") {
      return [
        { ...common, description: "Hot/cold/waste pipework allowance", quantity: Math.max(8, Math.round(line.quantity * 12)), unit: "m" },
        { ...common, description: "Sanitaryware / appliance connection points", quantity: Math.max(1, Math.round(line.quantity * 3)), unit: "nr" },
      ];
    }
    if (line.trade === "Tiling") {
      return [{ ...common, description: "Wall/floor finish area allowance", quantity: Math.max(8, Math.round(line.quantity * 12)), unit: "m2" }];
    }
    if (line.trade === "Decoration") {
      return [{ ...common, description: "Decoration surface area allowance", quantity: Math.max(10, Math.round(line.quantity * 18)), unit: "m2" }];
    }
    if (line.trade === "Joinery") {
      return [{ ...common, description: "Openings, boxing or access panel allowance", quantity: Math.max(1, Math.round(line.quantity * 2)), unit: "nr" }];
    }
    return [{ ...common, description: `${line.section} measured allowance`, quantity: line.quantity, unit: line.unit }];
  });
}

function buildAiResponse(job: JobDetails, instruction: string, files: UploadedFileSummary[], lines: EstimateLine[], mode: string): AiResponse {
  const totals = estimateTotals(lines, job.materialMarkup, job.vatRate);
  const hasDrawing = files.some((file) => /pdf|drawing|plan|dwg|floor|spec/i.test(`${file.name} ${file.type}`));
  const hasImages = files.some((file) => file.type.startsWith("image/"));
  const scope = lines.map((line) => `${line.section}: ${line.itemDescription}`);
  const assumptions = [
    `Labour priced at ${money(job.labourRate)} per hour.`,
    `Materials include ${job.materialMarkup}% markup and VAT is calculated at ${job.vatRate}%.`,
    "Labour and materials are split on every priced line.",
    "Wall type assumed to be plasterboard/stud unless site notes or images confirm block/brick.",
  ];
  if (hasDrawing) assumptions.push("Drawing/takeoff quantities are provisional unless scale and dimensions are confirmed.");
  if (hasImages) assumptions.push("Photo interpretation is treated as budgetary where details are unclear.");
  if (!instruction.trim()) assumptions.push("No detailed instruction was entered, so the estimate is based on the job category and uploads only.");

  const questions = [
    "Are there any access restrictions, out-of-hours requirements or parking constraints that affect labour?",
    "Are fixtures and finishes client supplied, contractor supplied or a mix?",
  ];
  if (hasDrawing) questions.push("Can the drawing scale or key dimensions be confirmed before final issue?");

  const labourLines = lines.map((line) => ({
    trade: line.trade,
    description: line.itemDescription,
    hours: line.labourHours,
    total: lineMath(line, job.materialMarkup).labourTotal,
  }));
  const materialLines = lines.map((line) => ({
    description: line.itemDescription,
    quantity: line.quantity,
    unit: line.unit,
    total: lineMath(line, job.materialMarkup).materialTotal,
  }));
  const boqLines = lines.map((line, index) => {
    const totalsForLine = lineMath(line, job.materialMarkup);
    return {
      itemNumber: `${index + 1}`,
      description: line.itemDescription,
      quantity: line.quantity,
      unit: line.unit,
      rate: totalsForLine.lineTotal / Math.max(line.quantity, 1),
      total: totalsForLine.lineTotal,
      notes: line.notes,
    };
  });
  const takeoffLines = buildTakeoffLines(lines, files);
  const fileSummary = files.length ? ` Reviewed uploaded file list: ${files.map((file) => file.name).join(", ")}.` : "";
  const simproDescription = [
    `${job.jobName || "AI estimate"} - ${job.tradeCategory} works for ${job.customerName || "customer to confirm"}.`,
    `Scope includes ${lines.map((line) => line.section).join(", ")}.`,
    `Labour and materials have been separated. Total draft value ${money(totals.total_ex_vat)} ex VAT / ${money(totals.total_inc_vat)} inc VAT.`,
    "Allow for survey confirmation, final material specification, site access and review of assumptions before issue.",
  ].join("\n");

  return {
    job_summary: `${job.jobName || "Unnamed job"} for ${job.customerName || "customer to confirm"} at ${job.siteAddress || "site address to confirm"}.${fileSummary}`,
    scope_understood: scope,
    assumptions,
    questions,
    labour_lines: labourLines,
    material_lines: materialLines,
    boq_lines: boqLines,
    takeoff_lines: takeoffLines,
    totals,
    simpro_description: simproDescription,
    exclusions: [
      "Hidden services, asbestos, structural design and building control fees unless expressly included.",
      "Client-specified fixtures, specialist plant, scaffolding and out-of-hours working unless noted.",
      "Final quantities subject to site survey, drawing scale confirmation and supplier quote review.",
    ],
    confidence_level: hasDrawing || files.length > 0 ? "Medium" : "Low",
    review_required: true,
    suggested_next_step:
      mode === "Create RFQ"
        ? "Send the materials RFQ to preferred suppliers, then update unit costs before issuing."
        : "Review assumptions, answer material questions, edit the line table, then create a simPRO draft quote.",
  };
}

function responseWithEditedLines(response: AiResponse | null, job: JobDetails, lines: EstimateLine[], files: UploadedFileSummary[]) {
  if (!response) return null;
  const totals = estimateTotals(lines, job.materialMarkup, job.vatRate);
  const rebuilt = buildAiResponse(job, response.suggested_next_step, files, lines, "Edited estimate");
  return {
    ...response,
    labour_lines: rebuilt.labour_lines,
    material_lines: rebuilt.material_lines,
    boq_lines: rebuilt.boq_lines,
    takeoff_lines: rebuilt.takeoff_lines,
    totals,
    simpro_description: response.simpro_description.replace(/Total draft value.*$/m, `Total draft value ${money(totals.total_ex_vat)} ex VAT / ${money(totals.total_inc_vat)} inc VAT.`),
  };
}

export default function AiSurveyorPage() {
  const [jobDetails, setJobDetails] = useState<JobDetails>(defaultJobDetails);
  const [files, setFiles] = useState<UploadedFileSummary[]>([]);
  const [instruction, setInstruction] = useState("Price this job from the photos and notes");
  const [estimateLines, setEstimateLines] = useState<EstimateLine[]>([]);
  const [aiResponse, setAiResponse] = useState<AiResponse | null>(null);
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [hubRecords, setHubRecords] = useState<HubRecordOption[]>([]);
  const [linkedRecord, setLinkedRecord] = useState<HubRecordLink | null>(null);
  const [recordSearch, setRecordSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);

  useEffect(() => {
    setDrafts(safeLoadDrafts());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHubRecords() {
      try {
        const [jobsResponse, quotesResponse, leadsResponse] = await Promise.all([
          fetch("/api/jobs"),
          fetch("/api/quotes"),
          fetch("/api/leads"),
        ]);
        const [jobs, quotes, leads] = await Promise.all([
          jobsResponse.ok ? jobsResponse.json() as Promise<ApiJob[]> : Promise.resolve([]),
          quotesResponse.ok ? quotesResponse.json() as Promise<ApiQuote[]> : Promise.resolve([]),
          leadsResponse.ok ? leadsResponse.json() as Promise<ApiLead[]> : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const options: HubRecordOption[] = [
          ...jobs.map((job) => ({
            kind: "Job" as const,
            id: job.id,
            ref: job.ref,
            customer: job.customer,
            title: job.description,
            site: job.site,
            status: job.status,
            description: `${job.ref} ${job.customer} ${job.site} ${job.description} ${job.status}`,
          })),
          ...quotes.map((quote) => ({
            kind: "Quote" as const,
            id: quote.id,
            ref: quote.ref,
            customer: quote.customer,
            title: quote.description,
            status: quote.status,
            description: `${quote.ref} ${quote.customer} ${quote.description} ${quote.status}`,
          })),
          ...leads.map((lead) => ({
            kind: "Lead" as const,
            id: lead.id,
            ref: lead.ref,
            customer: lead.customerName,
            title: lead.description,
            site: lead.address,
            status: lead.status,
            description: `${lead.ref} ${lead.customerName} ${lead.address} ${lead.description} ${lead.status}`,
          })),
        ];
        setHubRecords(options);
      } catch {
        if (!cancelled) setHubRecords([]);
      }
    }

    loadHubRecords();

    return () => {
      cancelled = true;
    };
  }, []);

  const editedResponse = useMemo(
    () => responseWithEditedLines(aiResponse, jobDetails, estimateLines, files),
    [aiResponse, estimateLines, files, jobDetails],
  );

  const totals = useMemo(
    () => estimateTotals(estimateLines, jobDetails.materialMarkup, jobDetails.vatRate),
    [estimateLines, jobDetails.materialMarkup, jobDetails.vatRate],
  );

  const filteredHubRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    if (!query) return hubRecords.slice(0, 12);
    return hubRecords
      .filter((record) => record.description.toLowerCase().includes(query))
      .slice(0, 12);
  }, [hubRecords, recordSearch]);

  function updateJob<K extends keyof JobDetails>(key: K, value: JobDetails[K]) {
    setJobDetails((current) => ({ ...current, [key]: value }));
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const summaries = selected.map((file) => ({
      id: makeId("file"),
      name: file.name,
      type: file.type || "Unknown",
      size: file.size,
      uploadedAt: new Date().toISOString(),
    }));
    setFiles((current) => [...current, ...summaries]);
    event.target.value = "";
  }

  function selectHubRecord(recordId: string) {
    const record = hubRecords.find((item) => `${item.kind}:${item.id}` === recordId);
    if (!record) return;
    const link: HubRecordLink = {
      kind: record.kind,
      id: record.id,
      ref: record.ref,
      customer: record.customer,
      title: record.title,
      site: record.site,
      status: record.status,
    };
    setLinkedRecord(link);
    setJobDetails((current) => ({
      ...current,
      jobName: record.ref,
      customerName: record.customer,
      siteAddress: record.site ?? current.siteAddress,
    }));
    setInstruction((current) =>
      current.trim()
        ? current
        : record.kind === "Job"
          ? "Check what has been missed and create a variation estimate"
          : "Create an estimate and simPRO-ready quote description",
    );
    setNotice(`Linked AI Surveyor draft to ${record.kind} ${record.ref}.`);
  }

  function runAssistant(mode: string) {
    const nextLines = buildEstimateLines(jobDetails, instruction, files, mode);
    const response = buildAiResponse(jobDetails, instruction, files, nextLines, mode);
    setEstimateLines(nextLines);
    setAiResponse(response);
    setNotice(`${mode} draft created. Review assumptions and edit line items before issue.`);
  }

  function updateLine(id: string, patch: Partial<EstimateLine>) {
    setEstimateLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addEstimateLine() {
    setEstimateLines((current) => [
      ...current,
      {
        id: makeId("line"),
        section: jobDetails.tradeCategory,
        itemDescription: "Additional allowance",
        trade: jobDetails.tradeCategory === "Tender / BOQ" ? "Builder works" : jobDetails.tradeCategory,
        quantity: 1,
        unit: "item",
        labourHours: 1,
        labourRate: jobDetails.labourRate,
        materialUnitCost: 0,
        notes: "Added during review.",
      },
    ]);
  }

  function saveDraft(extra?: Partial<AiDraft>) {
    const response = editedResponse ?? buildAiResponse(jobDetails, instruction, files, estimateLines, "Save Draft");
    const draft: AiDraft = {
      id: extra?.id ?? makeId("draft"),
      title: jobDetails.jobName || response.job_summary || "AI surveyor draft",
      jobDetails,
      uploadedFiles: files,
      userPrompt: instruction,
      aiOutput: response,
      estimateLines,
      simproDescription: response.simpro_description,
      dateCreated: extra?.dateCreated ?? new Date().toISOString(),
      linkedRecord,
      linkedQuoteRef: extra?.linkedQuoteRef,
    };
    const nextDrafts = [draft, ...drafts.filter((item) => item.id !== draft.id)].slice(0, 20);
    setDrafts(nextDrafts);
    safeSaveDrafts(nextDrafts);
    setNotice("AI estimate draft saved locally.");
    return draft;
  }

  function loadDraft(draft: AiDraft) {
    setJobDetails(draft.jobDetails);
    setFiles(draft.uploadedFiles);
    setInstruction(draft.userPrompt);
    setAiResponse(draft.aiOutput);
    setEstimateLines(draft.estimateLines);
    setLinkedRecord(draft.linkedRecord ?? null);
    setNotice(`${draft.title} loaded.`);
  }

  async function createSimproDraftQuote() {
    const response = editedResponse;
    if (!response) {
      setNotice("Run an AI action before creating a simPRO draft quote.");
      return;
    }

    setIsCreatingQuote(true);
    try {
      const quoteRef = `Q-${Date.now().toString().slice(-6)}`;
      const quotePayload = {
        ref: quoteRef,
        sourceLeadId: linkedRecord?.kind === "Lead" ? linkedRecord.id : undefined,
        sourceLeadRef: linkedRecord?.kind === "Lead" ? linkedRecord.ref : undefined,
        customer: jobDetails.customerName.trim() || "Customer to confirm",
        description: `${linkedRecord ? `Linked to ${linkedRecord.kind} ${linkedRecord.ref}\n\n` : ""}${response.simpro_description}`,
        owner: "Errol Watson",
        status: "Draft",
        value: Math.round(response.totals.total_ex_vat * 100) / 100,
        next: linkedRecord ? `Review AI estimate linked to ${linkedRecord.kind} ${linkedRecord.ref}` : "Review AI estimate lines before sending",
        due: "Today",
      };
      const quoteResponse = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload),
      });
      if (!quoteResponse.ok) throw new Error("Unable to create quote");
      const created = (await quoteResponse.json()) as { id: string; ref: string };
      saveQuoteCostCentreHandoff(created.id, jobDetails, estimateLines, response, linkedRecord);
      saveDraft({ linkedQuoteRef: created.ref });
      setNotice(`${created.ref} created as a draft quote${linkedRecord ? ` from ${linkedRecord.kind} ${linkedRecord.ref}` : ""}. Review it in the existing Quotes workflow before sending.`);
    } catch {
      setNotice("Unable to create the simPRO draft quote right now. The AI draft is still saved locally.");
      saveDraft();
    } finally {
      setIsCreatingQuote(false);
    }
  }

  const actionButtons = [
    { label: "Analyse Job", icon: Sparkles },
    { label: "Create Estimate", icon: Calculator },
    { label: "Create Takeoff", icon: ListChecks },
    { label: "Create BOQ", icon: ClipboardList },
    { label: "Create Materials List", icon: FileText },
    { label: "Create simPRO Description", icon: Bot },
    { label: "Create RFQ", icon: FilePlus2 },
  ];

  return (
    <div className="platform ai-surveyor-platform">
      <header className="global-header ai-surveyor-header">
        <a className="ai-back-link" href="/">
          <ArrowLeft size={17} />
          <span>HubFlo</span>
        </a>
        <div className="brand-lockup">
          <Image src="/ewg-logo.png" alt="Errol Watson Group" width={200} height={111} priority />
          <div className="product-name">
            <strong>AI Surveyor</strong>
            <span>Estimator / Takeoff</span>
          </div>
        </div>
      </header>

      <nav className="module-bar ai-module-bar" aria-label="Main modules">
        <a className="module-link" href="/">
          <FileText size={16} />
          <span>HubFlo</span>
        </a>
        <a className="module-link active" href="/ai-surveyor">
          <Sparkles size={16} />
          <span>AI Surveyor</span>
        </a>
      </nav>

      <main className="ai-surveyor-workspace">
        <div className="ai-surveyor-topline">
          <div>
            <div className="breadcrumb">
              <span>EWG Operations</span>
              <strong>AI Surveyor / Estimator</strong>
            </div>
            <h1>AI Surveyor / Estimator</h1>
            <p>Chat-style estimating for surveys, takeoffs, BOQs, materials lists and simPRO-ready draft quotes.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => runAssistant("Analyse Job")}>
            <Sparkles size={16} />
            Analyse Job
          </button>
        </div>

        {notice ? <div className="section-notice">{notice}</div> : null}

        <div className="ai-warning">
          AI estimates, takeoffs and BOQs are draft outputs and must be reviewed before issue, especially where drawings, scale, hidden services, structural works or site conditions are unclear.
        </div>

        <section className="ai-chat-layout">
          <div className="ai-input-column">
            <section className="ai-panel">
              <header>
                <span><Link2 size={15} /> Link to HubFlo</span>
              </header>
              <div className="ai-record-linker">
                <label>
                  Search jobs, quotes or leads
                  <input
                    value={recordSearch}
                    onChange={(event) => setRecordSearch(event.target.value)}
                    placeholder="Search by ref, customer, site or scope"
                  />
                </label>
                <label>
                  Select HubFlo record
                  <select
                    value={linkedRecord ? `${linkedRecord.kind}:${linkedRecord.id}` : ""}
                    onChange={(event) => selectHubRecord(event.target.value)}
                  >
                    <option value="">No linked record</option>
                    {filteredHubRecords.map((record) => (
                      <option key={`${record.kind}:${record.id}`} value={`${record.kind}:${record.id}`}>
                        {record.kind} {record.ref} - {record.customer}
                      </option>
                    ))}
                  </select>
                </label>
                {linkedRecord ? (
                  <div className="ai-linked-record">
                    <span>{linkedRecord.kind}</span>
                    <strong>{linkedRecord.ref} - {linkedRecord.title}</strong>
                    <small>{linkedRecord.customer}{linkedRecord.site ? ` · ${linkedRecord.site}` : ""}{linkedRecord.status ? ` · ${linkedRecord.status}` : ""}</small>
                    <button
                      type="button"
                      onClick={() => {
                        setLinkedRecord(null);
                        setNotice("AI Surveyor draft is no longer linked to a HubFlo record.");
                      }}
                    >
                      Clear link
                    </button>
                  </div>
                ) : (
                  <p className="ai-empty">Optional: link this AI estimate to an existing job, quote or lead.</p>
                )}
              </div>
            </section>

            <section className="ai-panel">
              <header>
                <span><FileText size={15} /> Job details</span>
              </header>
              <div className="ai-form-grid">
                <label>
                  Job name/reference
                  <input value={jobDetails.jobName} onChange={(event) => updateJob("jobName", event.target.value)} placeholder="Q- / address / lead ref" />
                </label>
                <label>
                  Customer name
                  <input value={jobDetails.customerName} onChange={(event) => updateJob("customerName", event.target.value)} placeholder="Customer or contractor" />
                </label>
                <label className="wide">
                  Site address
                  <input value={jobDetails.siteAddress} onChange={(event) => updateJob("siteAddress", event.target.value)} placeholder="Full site address" />
                </label>
                <label>
                  Trade/category
                  <select value={jobDetails.tradeCategory} onChange={(event) => updateJob("tradeCategory", event.target.value as TradeCategory)}>
                    {tradeCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
                <label>
                  Labour rate
                  <input type="number" min="0" value={jobDetails.labourRate} onChange={(event) => updateJob("labourRate", Number(event.target.value) || 0)} />
                </label>
                <label>
                  Materials markup %
                  <input type="number" min="0" value={jobDetails.materialMarkup} onChange={(event) => updateJob("materialMarkup", Number(event.target.value) || 0)} />
                </label>
                <label>
                  VAT %
                  <input type="number" min="0" value={jobDetails.vatRate} onChange={(event) => updateJob("vatRate", Number(event.target.value) || 0)} />
                </label>
              </div>
            </section>

            <section className="ai-panel">
              <header>
                <span><Upload size={15} /> Upload job information</span>
              </header>
              <label className="ai-upload-target">
                <Upload size={22} />
                <strong>Upload files and photos</strong>
                <span>Images, PDFs, Excel files, documents, emails or screenshots</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx,.txt,.rtf,.eml,.msg"
                  onChange={addFiles}
                />
              </label>
              <div className="ai-file-list">
                {files.length ? files.map((file) => (
                  <div className="ai-file-row" key={file.id}>
                    <FileText size={15} />
                    <span>
                      <strong>{file.name}</strong>
                      <small>{file.type || "Unknown"} · {fileSizeLabel(file.size)}</small>
                    </span>
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )) : <p className="ai-empty">No files uploaded yet.</p>}
              </div>
            </section>

            <section className="ai-panel ai-message-panel">
              <header>
                <span><Bot size={15} /> AI instruction</span>
              </header>
              <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={6} />
              <div className="ai-prompt-chips">
                {promptExamples.map((example) => (
                  <button type="button" key={example} onClick={() => setInstruction(example)}>{example}</button>
                ))}
              </div>
            </section>

            <section className="ai-actions-panel">
              {actionButtons.map((action) => {
                const Icon = action.icon;
                return (
                  <button type="button" key={action.label} onClick={() => runAssistant(action.label)}>
                    <Icon size={16} />
                    {action.label}
                  </button>
                );
              })}
              <button type="button" onClick={() => saveDraft()}>
                <Save size={16} />
                Save Draft
              </button>
              <button type="button" className="primary-action" onClick={createSimproDraftQuote} disabled={isCreatingQuote}>
                <Send size={16} />
                Send/Create simPRO Draft Quote
              </button>
            </section>

            <section className="ai-panel">
              <header>
                <span><Save size={15} /> Saved drafts</span>
              </header>
              <div className="ai-draft-list">
                {drafts.length ? drafts.map((draft) => (
                  <button type="button" key={draft.id} onClick={() => loadDraft(draft)}>
                    <strong>{draft.title}</strong>
                    <span>{new Date(draft.dateCreated).toLocaleString("en-GB")}{draft.linkedQuoteRef ? ` · ${draft.linkedQuoteRef}` : ""}</span>
                  </button>
                )) : <p className="ai-empty">No AI drafts saved yet.</p>}
              </div>
            </section>
          </div>

          <div className="ai-output-column">
            <section className="ai-response-panel">
              <header>
                <span><Sparkles size={16} /> AI output</span>
                <small>{editedResponse ? `${editedResponse.confidence_level} confidence · Review required` : "Waiting for instruction"}</small>
              </header>
              {editedResponse ? (
                <div className="ai-response-content">
                  <section>
                    <h2>Job summary</h2>
                    <p>{editedResponse.job_summary}</p>
                  </section>
                  <section>
                    <h2>Scope understood</h2>
                    <ul>{editedResponse.scope_understood.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                  <section>
                    <h2>Assumptions made</h2>
                    <ul>{editedResponse.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                  <section>
                    <h2>Missing information / questions</h2>
                    <ul>{editedResponse.questions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                  <section className="ai-total-grid">
                    <div><span>Total labour</span><strong>{money(totals.total_labour)}</strong></div>
                    <div><span>Total materials</span><strong>{money(totals.total_materials)}</strong></div>
                    <div><span>Markup</span><strong>{money(totals.markup)}</strong></div>
                    <div><span>VAT</span><strong>{money(totals.vat)}</strong></div>
                    <div><span>Total ex VAT</span><strong>{money(totals.total_ex_vat)}</strong></div>
                    <div><span>Total inc VAT</span><strong>{money(totals.total_inc_vat)}</strong></div>
                  </section>
                  <section>
                    <h2>Takeoff quantities</h2>
                    <div className="ai-mini-table">
                      {editedResponse.takeoff_lines.map((line) => (
                        <div key={`${line.section}-${line.description}`}>
                          <span>{line.section}</span>
                          <strong>{line.description}</strong>
                          <span>{line.quantity} {line.unit}</span>
                          <small>{line.assumption}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h2>BOQ table</h2>
                    <div className="ai-boq-table">
                      <div className="table-head"><span>No.</span><span>Description</span><span>Qty</span><span>Rate</span><span>Total</span></div>
                      {editedResponse.boq_lines.map((line) => (
                        <div key={line.itemNumber}>
                          <span>{line.itemNumber}</span>
                          <span>{line.description}</span>
                          <span>{line.quantity} {line.unit}</span>
                          <span>{money(line.rate)}</span>
                          <strong>{money(line.total)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h2>simPRO-ready quote description</h2>
                    <pre>{editedResponse.simpro_description}</pre>
                  </section>
                  <section>
                    <h2>Exclusions / qualifications</h2>
                    <ul>{editedResponse.exclusions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                  <section>
                    <h2>Suggested next step</h2>
                    <p>{editedResponse.suggested_next_step}</p>
                  </section>
                </div>
              ) : (
                <div className="ai-empty-state">
                  <Bot size={34} />
                  <strong>Upload notes, drawings, photos or paste a job description.</strong>
                  <span>The assistant will produce a draft estimate, takeoff, BOQ, materials list and simPRO wording.</span>
                </div>
              )}
            </section>

            <section className="ai-estimate-table-panel">
              <header>
                <span><Calculator size={16} /> Editable estimate table</span>
                <button type="button" onClick={addEstimateLine}><Plus size={14} /> Add line</button>
              </header>
              <div className="ai-estimate-table-scroll">
                <div className="ai-estimate-table">
                  <div className="table-head">
                    <span>Section</span><span>Item description</span><span>Trade</span><span>Qty</span><span>Unit</span><span>Hours</span><span>Rate</span><span>Labour</span><span>Material unit</span><span>Material total</span><span>Markup</span><span>Line total</span><span>Notes</span><span></span>
                  </div>
                  {estimateLines.map((line) => {
                    const rowTotals = lineMath(line, jobDetails.materialMarkup);
                    return (
                      <div className="ai-estimate-row" key={line.id}>
                        <input value={line.section} onChange={(event) => updateLine(line.id, { section: event.target.value })} />
                        <input value={line.itemDescription} onChange={(event) => updateLine(line.id, { itemDescription: event.target.value })} />
                        <select value={line.trade} onChange={(event) => updateLine(line.id, { trade: event.target.value as EstimateLine["trade"] })}>
                          {[...tradeCategories, "Builder works"].map((trade) => <option key={trade}>{trade}</option>)}
                        </select>
                        <input type="number" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) || 0 })} />
                        <input value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })} />
                        <input type="number" value={line.labourHours} onChange={(event) => updateLine(line.id, { labourHours: Number(event.target.value) || 0 })} />
                        <input type="number" value={line.labourRate} onChange={(event) => updateLine(line.id, { labourRate: Number(event.target.value) || 0 })} />
                        <strong>{money(rowTotals.labourTotal)}</strong>
                        <input type="number" value={line.materialUnitCost} onChange={(event) => updateLine(line.id, { materialUnitCost: Number(event.target.value) || 0 })} />
                        <strong>{money(rowTotals.materialTotal)}</strong>
                        <strong>{money(rowTotals.markup)}</strong>
                        <strong>{money(rowTotals.lineTotal)}</strong>
                        <input value={line.notes} onChange={(event) => updateLine(line.id, { notes: event.target.value })} />
                        <button type="button" aria-label="Remove line" onClick={() => setEstimateLines((current) => current.filter((item) => item.id !== line.id))}><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="ai-json-panel">
              <header>
                <span><ClipboardList size={16} /> Structured JSON</span>
              </header>
              <pre>{editedResponse ? JSON.stringify(editedResponse, null, 2) : JSON.stringify({ system_prompt: ewgSystemPrompt }, null, 2)}</pre>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
