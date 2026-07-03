"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Home,
  Link2,
  ListChecks,
  PackageSearch,
  Plus,
  RefreshCw,
  Ruler,
  Send,
  Sparkles,
  ThermometerSun,
  Trash2,
  Upload,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { roleHeaderName } from "@/lib/access";
import type { Quote } from "@/lib/workflow-data";
import type {
  TakeoffDocumentKind,
  TakeoffLabourAllowance,
  TakeoffMaterialAllowance,
  TakeoffMeasurement,
  TakeoffPipeRun,
  TakeoffProject,
  TakeoffRadiator,
  TakeoffRoom,
  TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";

type TakeoffTab = "intake" | "survey" | "rooms" | "heat" | "runs" | "boq" | "review";

type NewProjectDraft = {
  name: string;
  customer: string;
  site: string;
  description: string;
  linkedQuoteId: string;
};

type TakeoffAiStatus = {
  connected: boolean;
  model: string;
  keyName: string;
  source?: "env" | "local" | "none";
  updatedAt?: string;
};

type HeatCalcDraft = {
  roomId: string;
  roomType: "Living Room" | "Bedroom" | "Bathroom" | "Kitchen" | "Hall" | "Office";
  lengthM: string;
  widthM: string;
  heightM: string;
  construction: "Modern / insulated" | "Average" | "Older / exposed";
  glazing: "Double glazed" | "Single glazed" | "Large glazing";
  outsideWalls: string;
  windowAreaM2: string;
  waterTempC: string;
  upliftPercent: string;
};

const tabs: Array<{ key: TakeoffTab; label: string; icon: LucideIcon }> = [
  { key: "intake", label: "Intake", icon: Upload },
  { key: "survey", label: "Survey quote", icon: ClipboardList },
  { key: "rooms", label: "Rooms", icon: Ruler },
  { key: "heat", label: "Heat loss", icon: ThermometerSun },
  { key: "runs", label: "Pipework", icon: Wrench },
  { key: "boq", label: "BOQ", icon: PackageSearch },
  { key: "review", label: "Review", icon: CheckCircle2 },
];

const requestHeaders: HeadersInit = {
  [roleHeaderName]: "Office",
};

const blankNewProject: NewProjectDraft = {
  name: "",
  customer: "",
  site: "",
  description: "",
  linkedQuoteId: "",
};

const blankHeatCalc: HeatCalcDraft = {
  roomId: "",
  roomType: "Living Room",
  lengthM: "",
  widthM: "",
  heightM: "2.4",
  construction: "Average",
  glazing: "Double glazed",
  outsideWalls: "1",
  windowAreaM2: "",
  waterTempC: "70",
  upliftPercent: "10",
};

const heatCalcRoomTypes: Array<{ id: HeatCalcDraft["roomType"]; targetTemp: number }> = [
  { id: "Living Room", targetTemp: 21 },
  { id: "Bedroom", targetTemp: 21 },
  { id: "Bathroom", targetTemp: 22 },
  { id: "Kitchen", targetTemp: 21 },
  { id: "Hall", targetTemp: 20 },
  { id: "Office", targetTemp: 21 },
];

const heatCalcConstruction: Array<{ id: HeatCalcDraft["construction"]; wattsPerM2: number }> = [
  { id: "Modern / insulated", wattsPerM2: 55 },
  { id: "Average", wattsPerM2: 75 },
  { id: "Older / exposed", wattsPerM2: 100 },
];

const heatCalcGlazing: Array<{ id: HeatCalcDraft["glazing"]; uplift: number }> = [
  { id: "Double glazed", uplift: 0 },
  { id: "Single glazed", uplift: 0.14 },
  { id: "Large glazing", uplift: 0.18 },
];

const takeoffRadiatorCatalogue = [
  { range: "Classic Compact", model: "K1 600 x 800", outputWatts: 740 },
  { range: "Classic Compact", model: "P+ 600 x 1000", outputWatts: 1180 },
  { range: "Classic Compact", model: "K2 600 x 1000", outputWatts: 1680 },
  { range: "Classic Compact", model: "K2 600 x 1200", outputWatts: 2010 },
  { range: "Softline Compact", model: "K2 600 x 1400", outputWatts: 2275 },
  { range: "Classic Compact", model: "K3 600 x 1200", outputWatts: 2720 },
  { range: "Vertical", model: "K2 1800 x 600", outputWatts: 2095 },
];

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
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

function numberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineSell(unitCost: number, markupPercent: number) {
  return unitCost * (1 + markupPercent / 100);
}

function selectedHeatOption<T extends { id: string }>(options: T[], id: string) {
  return options.find((option) => option.id === id) ?? options[0];
}

function inferHeatRoomType(name: string): HeatCalcDraft["roomType"] {
  if (/bath|wc|ensuite|en suite/i.test(name)) return "Bathroom";
  if (/bed/i.test(name)) return "Bedroom";
  if (/kitchen/i.test(name)) return "Kitchen";
  if (/hall|landing/i.test(name)) return "Hall";
  if (/office|study/i.test(name)) return "Office";
  return "Living Room";
}

function heatDraftFromRoom(room: TakeoffRoom, current: HeatCalcDraft = blankHeatCalc): HeatCalcDraft {
  const squareLength = room.areaM2 > 0 ? Math.sqrt(room.areaM2) : 0;
  return {
    ...current,
    roomId: room.id,
    roomType: inferHeatRoomType(room.name),
    lengthM: room.lengthM ? String(room.lengthM) : squareLength ? squareLength.toFixed(2) : current.lengthM,
    widthM: room.widthM ? String(room.widthM) : squareLength ? squareLength.toFixed(2) : current.widthM,
    heightM: room.heightM ? String(room.heightM) : current.heightM,
  };
}

function calculateHeatRequirement(draft: HeatCalcDraft) {
  const lengthM = numberFromInput(draft.lengthM);
  const widthM = numberFromInput(draft.widthM);
  const heightM = numberFromInput(draft.heightM || "2.4") || 2.4;
  const areaM2 = Math.max(0, lengthM * widthM);
  const volumeM3 = areaM2 * heightM;
  const roomType = selectedHeatOption(heatCalcRoomTypes, draft.roomType);
  const construction = selectedHeatOption(heatCalcConstruction, draft.construction);
  const glazing = selectedHeatOption(heatCalcGlazing, draft.glazing);
  const outsideWalls = Math.max(0, numberFromInput(draft.outsideWalls));
  const windowAreaM2 = Math.max(0, numberFromInput(draft.windowAreaM2));
  const upliftPercent = Math.max(0, numberFromInput(draft.upliftPercent));
  const waterTempC = numberFromInput(draft.waterTempC || "70") || 70;
  const targetTemp = roomType?.targetTemp ?? 21;
  const heightFactor = Math.max(0.7, heightM / 2.4);
  const exposureFactor = 1 + outsideWalls * 0.06 + Math.min(0.24, windowAreaM2 * 0.025);
  const targetFactor = 1 + Math.max(-0.08, (targetTemp - 21) * 0.04);
  const watts = Math.round(areaM2 * (construction?.wattsPerM2 ?? 75) * heightFactor * exposureFactor * targetFactor * (1 + (glazing?.uplift ?? 0)) * (1 + upliftPercent / 100));
  const deltaT = Math.max(1, waterTempC - targetTemp);
  const correctionFactor = Math.max(0.25, Math.pow(deltaT / 50, 1.3));
  const radiatorOutputWatts = Math.round(watts / correctionFactor);
  const defaultRadiator = takeoffRadiatorCatalogue[0];
  if (!defaultRadiator) {
    return {
      areaM2,
      volumeM3,
      watts,
      btu: Math.round(watts * 3.412),
      radiatorOutputWatts,
      radiatorBtu: Math.round(radiatorOutputWatts * 3.412),
      deltaT,
      targetTemp,
      recommended: null,
      quantity: 1,
    };
  }
  const largestRadiator = takeoffRadiatorCatalogue.reduce((largest, radiator) => (
    radiator.outputWatts > largest.outputWatts ? radiator : largest
  ), defaultRadiator);
  const recommended = takeoffRadiatorCatalogue
    .filter((radiator) => radiator.outputWatts >= radiatorOutputWatts)
    .sort((first, second) => first.outputWatts - second.outputWatts)[0] ?? largestRadiator;
  const quantity = recommended ? Math.max(1, Math.ceil(radiatorOutputWatts / recommended.outputWatts)) : 1;

  return {
    areaM2,
    volumeM3,
    watts,
    btu: Math.round(watts * 3.412),
    radiatorOutputWatts,
    radiatorBtu: Math.round(radiatorOutputWatts * 3.412),
    deltaT,
    targetTemp,
    recommended,
    quantity,
  };
}

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileSizeLabel(size?: number) {
  if (!size) return "Unknown size";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function quoteLabel(quote: Quote) {
  return `${quote.ref} - ${quote.customer} - ${quote.description}`;
}

function replaceById<T extends { id: string }>(items: T[], id: string, patch: Partial<T>) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

export default function TakeoffPage() {
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeTab, setActiveTab] = useState<TakeoffTab>("intake");
  const [newProject, setNewProject] = useState<NewProjectDraft>(blankNewProject);
  const [showNewProject, setShowNewProject] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSurveyDrafting, setIsSurveyDrafting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [aiStatus, setAiStatus] = useState<TakeoffAiStatus | null>(null);
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState("");
  const [isSavingAiKey, setIsSavingAiKey] = useState(false);
  const [heatCalc, setHeatCalc] = useState<HeatCalcDraft>(blankHeatCalc);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedProject?.linkedQuoteId) ?? null,
    [quotes, selectedProject],
  );

  const aiReadyDocumentCount = useMemo(
    () => selectedProject?.documents.filter((document) => document.storageKey).length ?? 0,
    [selectedProject],
  );

  const surveyDocuments = useMemo(
    () => selectedProject?.documents.filter((document) => document.kind === "Survey note" || document.kind === "Survey photo") ?? [],
    [selectedProject],
  );

  const surveyAiReadyDocumentCount = useMemo(
    () => surveyDocuments.filter((document) => document.storageKey).length,
    [surveyDocuments],
  );

  const selectedHeatCalcRoom = useMemo(
    () => selectedProject?.rooms.find((room) => room.id === heatCalc.roomId) ?? null,
    [heatCalc.roomId, selectedProject],
  );

  const heatCalcResult = useMemo(() => calculateHeatRequirement(heatCalc), [heatCalc]);

  const heatLossSchedule = useMemo(() => {
    if (!selectedProject) return [];

    return selectedProject.rooms.map((room) => {
      const calculated = calculateHeatRequirement(heatDraftFromRoom(room));
      const heatWatts = room.heatLoadWatts > 0 ? room.heatLoadWatts : calculated.watts;
      const radiators = selectedProject.radiators.filter((radiator) => radiator.roomId === room.id);
      const radiatorOutputWatts = radiators.reduce((sum, radiator) => sum + radiator.outputWatts * radiator.quantity, 0);
      const dimensions = room.lengthM && room.widthM
        ? `${room.lengthM} x ${room.widthM} x ${room.heightM ?? 2.4}m`
        : room.areaM2
          ? `${room.areaM2}m2`
          : "Not measured";

      return {
        room,
        dimensions,
        heatWatts,
        heatBtu: Math.round(heatWatts * 3.412),
        radiators,
        radiatorSummary: radiators.length
          ? radiators.map((radiator) => `${radiator.quantity} x ${radiator.model}`).join("; ")
          : "No radiator selected",
        radiatorOutputWatts,
        radiatorOutputBtu: Math.round(radiatorOutputWatts * 3.412),
        coverageWatts: radiatorOutputWatts - heatWatts,
      };
    });
  }, [selectedProject]);

  const projectTotals = useMemo(() => {
    if (!selectedProject) {
      return {
        materialSell: 0,
        labourSell: 0,
        supplierCount: 0,
        labourHours: 0,
        lineCount: 0,
      };
    }

    const materialSell = selectedProject.materialAllowances.reduce(
      (sum, line) => sum + line.quantity * lineSell(line.unitCost, line.markupPercent),
      0,
    );
    const labourSell = selectedProject.labourAllowances.reduce(
      (sum, line) => sum + line.hours * lineSell(line.costRate, line.markupPercent),
      0,
    );
    const flaggedMaterials = selectedProject.materialAllowances.filter((line) => line.supplierRequired).length;
    const flaggedRadiators = selectedProject.radiators.filter((radiator) => radiator.supplierRequired).length;

    return {
      materialSell,
      labourSell,
      supplierCount: selectedProject.supplierRequests.length + flaggedMaterials + flaggedRadiators,
      labourHours: selectedProject.labourAllowances.reduce((sum, line) => sum + line.hours, 0),
      lineCount: selectedProject.materialAllowances.length + selectedProject.labourAllowances.length + selectedProject.radiators.length,
    };
  }, [selectedProject]);

  const boqPreviewRows = useMemo(() => {
    if (!selectedProject) return [];
    return [
      ...selectedProject.materialAllowances.map((line) => ({
        id: line.id,
        type: "Material",
        section: line.section,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        total: line.quantity * lineSell(line.unitCost, line.markupPercent),
        supplierRequired: line.supplierRequired,
      })),
      ...selectedProject.radiators.map((line) => ({
        id: line.id,
        type: "Radiator",
        section: line.roomName || "Radiator schedule",
        description: line.model,
        quantity: line.quantity,
        unit: "each",
        total: 0,
        supplierRequired: line.supplierRequired,
      })),
      ...selectedProject.labourAllowances.map((line) => ({
        id: line.id,
        type: "Labour",
        section: line.section,
        description: line.role,
        quantity: line.hours,
        unit: "hours",
        total: line.hours * lineSell(line.costRate, line.markupPercent),
        supplierRequired: false,
      })),
    ];
  }, [selectedProject]);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [projectResponse, quoteResponse] = await Promise.all([
        fetch("/api/takeoff-projects", { headers: requestHeaders }),
        fetch("/api/quotes", { headers: requestHeaders }),
      ]);
      const aiResponse = await fetch("/api/takeoff-ai/status", { headers: requestHeaders });

      if (!projectResponse.ok) throw new Error("Unable to load Takeoff projects");
      if (!quoteResponse.ok) throw new Error("Unable to load quotes");

      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = (await quoteResponse.json()) as Quote[];
      const nextAiStatus = aiResponse.ok ? ((await aiResponse.json()) as TakeoffAiStatus) : null;

      setProjects(nextProjects);
      setQuotes(nextQuotes);
      setAiStatus(nextAiStatus);
      setSelectedProjectId((current) =>
        current && nextProjects.some((project) => project.id === current)
          ? current
          : nextProjects[0]?.id ?? "",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Takeoff workspace");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  function replaceProject(project: TakeoffProject) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  }

  async function patchProject(projectId: string, patch: Partial<TakeoffProject>, successMessage?: string) {
    setError("");
    const currentProject = projects.find((project) => project.id === projectId);
    if (currentProject) {
      replaceProject({
        ...currentProject,
        ...patch,
        review: {
          ...currentProject.review,
          ...(patch.review ?? {}),
          riskFlags: patch.review?.riskFlags ?? currentProject.review.riskFlags,
        },
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      const response = await fetch(`/api/takeoff-projects/${projectId}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Unable to save Takeoff project");
      const updated = (await response.json()) as TakeoffProject;
      replaceProject(updated);
      if (successMessage) setNotice(successMessage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save Takeoff project");
      loadData().catch(() => {});
    }
  }

  function updateProject(patch: Partial<TakeoffProject>, successMessage?: string) {
    if (!selectedProject) return;
    patchProject(selectedProject.id, patch, successMessage).catch(() => {});
  }

  async function createProject() {
    setError("");
    const linkedQuote = quotes.find((quote) => quote.id === newProject.linkedQuoteId);
    try {
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProject.name,
          customer: newProject.customer || linkedQuote?.customer,
          site: newProject.site,
          description: newProject.description,
          linkedQuoteId: newProject.linkedQuoteId || undefined,
        }),
      });
      if (!response.ok) throw new Error("Unable to create Takeoff project");
      const created = (await response.json()) as TakeoffProject;
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.id);
      setNewProject(blankNewProject);
      setShowNewProject(false);
      setActiveTab("intake");
      setNotice(`${created.reference} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create Takeoff project");
    }
  }

  async function saveOpenAiKey() {
    const apiKey = openAiKeyDraft.trim();
    if (!apiKey) {
      setError("Paste your OpenAI API key before saving.");
      return;
    }

    setIsSavingAiKey(true);
    setError("");
    try {
      const response = await fetch("/api/takeoff-ai/config", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model: aiStatus?.model || "gpt-5.5",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to save OpenAI key");
      }
      const status = (await response.json()) as TakeoffAiStatus;
      setAiStatus(status);
      setOpenAiKeyDraft("");
      setNotice("OpenAI connected. Re-upload the files you want scanned, then click AI scan.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save OpenAI key");
    } finally {
      setIsSavingAiKey(false);
    }
  }

  async function addDocuments(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    if (!selectedProject) return;
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    const formData = new FormData();
    formData.append("kind", kind);
    files.forEach((file) => formData.append("files", file));

    setIsUploadingDocs(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/documents`, {
        method: "POST",
        headers: requestHeaders,
        body: formData,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let body: { error?: string } = {};
        if (text) {
          try {
            body = JSON.parse(text) as { error?: string };
          } catch {
            body = {};
          }
        }
        throw new Error(body.error ?? (text || `Unable to upload Takeoff documents (${response.status})`));
      }
      const result = (await response.json()) as { project: TakeoffProject };
      replaceProject(result.project);
      setNotice(`${files.length} ${kind.toLowerCase()} file${files.length === 1 ? "" : "s"} uploaded for AI scan.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload Takeoff documents");
    } finally {
      setIsUploadingDocs(false);
      input.value = "";
    }
  }

  async function runAiExtraction() {
    if (!selectedProject) return;
    if (!selectedProject.documents.length) {
      setError("Upload drawings, specs or BOQs before running extraction.");
      return;
    }
    if (aiStatus?.connected && aiReadyDocumentCount === 0) {
      setError("OpenAI is connected, but these files were uploaded before live file scanning was enabled. Re-upload the drawing/spec/BOQ in Intake, then click AI scan again.");
      return;
    }

    setIsExtracting(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/extract`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Office review" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to run extraction");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        generated: {
          rooms: number;
          measurements: number;
          pipeRuns: number;
          radiators: number;
          materialAllowances: number;
          labourAllowances: number;
          supplierRequests: number;
        };
      };
      replaceProject(result.project);
      setActiveTab("boq");
      const provider = result.project.extraction?.provider ?? "Pilot";
      setNotice(
        `${provider} extraction complete: ${result.generated.measurements} measurement row(s), ${result.generated.materialAllowances} material allowance(s), ${result.generated.labourAllowances} labour allowance(s).`,
      );
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Unable to run extraction");
    } finally {
      setIsExtracting(false);
    }
  }

  async function runSurveyDraft() {
    if (!selectedProject) return;
    if (!aiStatus?.connected) {
      setError("Connect OpenAI in Intake before running a survey quote draft.");
      return;
    }
    if (!surveyDocuments.length) {
      setError("Upload handwritten notes or room photos before running a survey quote draft.");
      return;
    }
    if (surveyAiReadyDocumentCount === 0) {
      setError("OpenAI is connected, but these survey files are not AI-ready. Re-upload notes/photos in Survey quote, then click AI draft quote again.");
      return;
    }

    setIsSurveyDrafting(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/survey-draft`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Office survey review" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to draft survey quote");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        generated: {
          rooms: number;
          measurements: number;
          pipeRuns: number;
          radiators: number;
          materialAllowances: number;
          labourAllowances: number;
          supplierRequests: number;
        };
      };
      replaceProject(result.project);
      setActiveTab("boq");
      setNotice(
        `Survey quote draft complete: ${result.generated.materialAllowances} material line(s), ${result.generated.labourAllowances} labour line(s), ${result.generated.supplierRequests} supplier request(s).`,
      );
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Unable to draft survey quote");
    } finally {
      setIsSurveyDrafting(false);
    }
  }

  function addRoom() {
    if (!selectedProject) return;
    const room: TakeoffRoom = {
      id: makeId("takeoff-room"),
      name: "New room",
      level: "Ground",
      lengthM: 0,
      widthM: 0,
      heightM: 2.4,
      areaM2: 0,
      heatLoadWatts: 0,
      notes: "",
    };
    updateProject({ rooms: [...selectedProject.rooms, room] });
  }

  function updateRoom(id: string, patch: Partial<TakeoffRoom>) {
    if (!selectedProject) return;
    updateProject({ rooms: replaceById(selectedProject.rooms, id, patch) });
  }

  function updateRoomDimension(id: string, key: "lengthM" | "widthM" | "heightM", value: string) {
    if (!selectedProject) return;
    const room = selectedProject.rooms.find((item) => item.id === id);
    if (!room) return;
    const numericValue = numberFromInput(value);
    const nextLength = key === "lengthM" ? numericValue : room.lengthM ?? 0;
    const nextWidth = key === "widthM" ? numericValue : room.widthM ?? 0;
    const patch: Partial<TakeoffRoom> = {
      [key]: numericValue,
    };
    if (nextLength > 0 && nextWidth > 0) {
      patch.areaM2 = Number((nextLength * nextWidth).toFixed(2));
    }
    updateRoom(id, patch);
  }

  function addMeasurement() {
    if (!selectedProject) return;
    const measurement: TakeoffMeasurement = {
      id: makeId("takeoff-measure"),
      label: "Measurement",
      quantity: 0,
      unit: "m",
      source: "Manual",
    };
    updateProject({ measurements: [...selectedProject.measurements, measurement] });
  }

  function updateMeasurement(id: string, patch: Partial<TakeoffMeasurement>) {
    if (!selectedProject) return;
    updateProject({ measurements: replaceById(selectedProject.measurements, id, patch) });
  }

  function addPipeRun() {
    if (!selectedProject) return;
    const pipeRun: TakeoffPipeRun = {
      id: makeId("takeoff-pipe"),
      service: "Heating flow/return",
      route: "Route to confirm",
      diameter: "22mm",
      material: "Copper",
      lengthM: 0,
      fittings: 0,
      insulation: false,
      notes: "",
    };
    updateProject({ pipeRuns: [...selectedProject.pipeRuns, pipeRun] });
  }

  function updatePipeRun(id: string, patch: Partial<TakeoffPipeRun>) {
    if (!selectedProject) return;
    updateProject({ pipeRuns: replaceById(selectedProject.pipeRuns, id, patch) });
  }

  function addRadiator() {
    if (!selectedProject) return;
    const radiator: TakeoffRadiator = {
      id: makeId("takeoff-rad"),
      roomId: selectedProject.rooms[0]?.id,
      roomName: selectedProject.rooms[0]?.name ?? "Room",
      outputWatts: 0,
      model: "Radiator model to confirm",
      quantity: 1,
      supplierRequired: true,
      notes: "",
    };
    updateProject({ radiators: [...selectedProject.radiators, radiator] });
  }

  function updateRadiator(id: string, patch: Partial<TakeoffRadiator>) {
    if (!selectedProject) return;
    const enrichedPatch = patch.roomId
      ? { ...patch, roomName: selectedProject.rooms.find((room) => room.id === patch.roomId)?.name ?? patch.roomName ?? "" }
      : patch;
    updateProject({ radiators: replaceById(selectedProject.radiators, id, enrichedPatch) });
  }

  function updateHeatCalc(patch: Partial<HeatCalcDraft>) {
    setHeatCalc((current) => ({ ...current, ...patch }));
  }

  function loadRoomIntoHeatCalc(roomId: string) {
    const room = selectedProject?.rooms.find((item) => item.id === roomId);
    if (!room) {
      updateHeatCalc({ roomId });
      return;
    }

    setHeatCalc((current) => heatDraftFromRoom(room, current));
  }

  function applyHeatCalculation() {
    if (!selectedProject || !selectedHeatCalcRoom) {
      setError("Choose a room before applying the heat calculation.");
      return;
    }

    if (!heatCalcResult.watts || !heatCalcResult.recommended) {
      setError("Enter room dimensions before applying the heat calculation.");
      return;
    }

    const radiatorModel = `${heatCalcResult.recommended.range} ${heatCalcResult.recommended.model}`;
    const existingRadiator = selectedProject.radiators.find((radiator) => radiator.roomId === selectedHeatCalcRoom.id);
    const radiator: TakeoffRadiator = {
      id: existingRadiator?.id ?? makeId("takeoff-radiator"),
      roomId: selectedHeatCalcRoom.id,
      roomName: selectedHeatCalcRoom.name,
      outputWatts: heatCalcResult.recommended.outputWatts,
      model: radiatorModel,
      quantity: heatCalcResult.quantity,
      supplierRequired: true,
      notes: `${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU room heat load. Requires ${heatCalcResult.radiatorOutputWatts}W at Delta T50.`,
    };
    const nextRadiators = existingRadiator
      ? replaceById(selectedProject.radiators, existingRadiator.id, radiator)
      : [...selectedProject.radiators, radiator];
    const nextRooms = replaceById(selectedProject.rooms, selectedHeatCalcRoom.id, {
      lengthM: numberFromInput(heatCalc.lengthM),
      widthM: numberFromInput(heatCalc.widthM),
      heightM: numberFromInput(heatCalc.heightM || "2.4") || 2.4,
      areaM2: Number(heatCalcResult.areaM2.toFixed(2)),
      heatLoadWatts: heatCalcResult.watts,
      notes: selectedHeatCalcRoom.notes
        ? `${selectedHeatCalcRoom.notes} Heat calc: ${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU.`
        : `Heat calc: ${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU.`,
    });

    updateProject(
      {
        rooms: nextRooms,
        radiators: nextRadiators,
      },
      `${selectedHeatCalcRoom.name} heat load applied and radiator schedule updated.`,
    );
  }

  function addMaterial() {
    if (!selectedProject) return;
    const material: TakeoffMaterialAllowance = {
      id: makeId("takeoff-material"),
      section: "Materials",
      description: "Material allowance",
      quantity: 1,
      unit: "allowance",
      unitCost: 0,
      markupPercent: 30,
      supplierRequired: false,
      preferredSupplier: "",
    };
    updateProject({ materialAllowances: [...selectedProject.materialAllowances, material] });
  }

  function updateMaterial(id: string, patch: Partial<TakeoffMaterialAllowance>) {
    if (!selectedProject) return;
    updateProject({ materialAllowances: replaceById(selectedProject.materialAllowances, id, patch) });
  }

  function addLabour() {
    if (!selectedProject) return;
    const labour: TakeoffLabourAllowance = {
      id: makeId("takeoff-labour"),
      section: "Labour",
      role: "Engineer",
      hours: 0,
      costRate: 38,
      markupPercent: 40,
      notes: "",
    };
    updateProject({ labourAllowances: [...selectedProject.labourAllowances, labour] });
  }

  function updateLabour(id: string, patch: Partial<TakeoffLabourAllowance>) {
    if (!selectedProject) return;
    updateProject({ labourAllowances: replaceById(selectedProject.labourAllowances, id, patch) });
  }

  function addSupplierRequest() {
    if (!selectedProject) return;
    const request: TakeoffSupplierRequestItem = {
      id: makeId("takeoff-supplier"),
      supplier: "",
      description: "Supplier request item",
      quantity: 1,
      unit: "item",
      notes: "",
    };
    updateProject({ supplierRequests: [...selectedProject.supplierRequests, request] });
  }

  function updateSupplierRequest(id: string, patch: Partial<TakeoffSupplierRequestItem>) {
    if (!selectedProject) return;
    updateProject({ supplierRequests: replaceById(selectedProject.supplierRequests, id, patch) });
  }

  function approveProject() {
    if (!selectedProject) return;
    updateProject(
      {
        status: "Approved",
        review: {
          ...selectedProject.review,
          approvedAt: new Date().toISOString(),
          approvedBy: "Office review",
        },
      },
      `${selectedProject.reference} approved for quote push.`,
    );
  }

  async function pushProject() {
    if (!selectedProject) return;
    if (!selectedProject.linkedQuoteId) {
      setError("Choose a quote before pushing Takeoff output.");
      return;
    }
    if (selectedProject.status !== "Approved" && selectedProject.status !== "Pushed") {
      setError("Approve the Takeoff project before pushing into NeXa.");
      return;
    }

    setIsPushing(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/push`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: selectedProject.linkedQuoteId,
          actor: "Office review",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to push Takeoff output");
      }
      const result = (await response.json()) as { project: TakeoffProject; quote: Quote; costCentres?: Array<{ id: string }> };
      replaceProject(result.project);
      setQuotes((current) => current.map((quote) => (quote.id === result.quote.id ? result.quote : quote)));
      setNotice(`${result.project.reference} pushed into ${result.quote.ref} as ${result.costCentres?.length ?? 1} cost centre(s).`);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "Unable to push Takeoff output");
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <main className="takeoff-app">
      <header className="takeoff-header">
        <div className="takeoff-brand">
          <img src="/brand/nexa-command-lockup-light.svg" alt="NeXa" />
          <span>Takeoff / BOQ</span>
        </div>
        <div className="takeoff-header-actions">
          <a className="takeoff-ghost-button" href="/">
            <ArrowLeft size={16} />
            Core
          </a>
          <button className="takeoff-ghost-button" type="button" onClick={() => loadData().catch(() => {})}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <div className="takeoff-shell">
        <aside className="takeoff-sidebar">
          <div className="takeoff-sidebar-title">
            <span>Projects</span>
            <button type="button" aria-label="Create Takeoff project" onClick={() => setShowNewProject((open) => !open)}>
              <Plus size={16} />
            </button>
          </div>

          {showNewProject ? (
            <section className="takeoff-create-panel">
              <input
                placeholder="Project name"
                value={newProject.name}
                onChange={(event) => setNewProject((current) => ({ ...current, name: event.target.value }))}
              />
              <input
                placeholder="Customer"
                value={newProject.customer}
                onChange={(event) => setNewProject((current) => ({ ...current, customer: event.target.value }))}
              />
              <input
                placeholder="Site"
                value={newProject.site}
                onChange={(event) => setNewProject((current) => ({ ...current, site: event.target.value }))}
              />
              <select
                value={newProject.linkedQuoteId}
                onChange={(event) => setNewProject((current) => ({ ...current, linkedQuoteId: event.target.value }))}
              >
                <option value="">No quote yet</option>
                {quotes.map((quote) => (
                  <option value={quote.id} key={quote.id}>{quoteLabel(quote)}</option>
                ))}
              </select>
              <textarea
                placeholder="Scope summary"
                value={newProject.description}
                onChange={(event) => setNewProject((current) => ({ ...current, description: event.target.value }))}
              />
              <button className="takeoff-primary-button" type="button" onClick={createProject}>
                <Plus size={15} />
                Create
              </button>
            </section>
          ) : null}

          <div className="takeoff-project-list">
            {projects.map((project) => (
              <button
                className={project.id === selectedProject?.id ? "takeoff-project-button active" : "takeoff-project-button"}
                key={project.id}
                type="button"
                onClick={() => {
                  setSelectedProjectId(project.id);
                  setActiveTab("intake");
                }}
              >
                <span>
                  <strong>{project.reference}</strong>
                  <small>{project.status}</small>
                </span>
                <b>{project.name}</b>
                <em>{project.customer}</em>
              </button>
            ))}
            {!projects.length && !isLoading ? (
              <p className="takeoff-empty">No Takeoff projects yet.</p>
            ) : null}
          </div>
        </aside>

        <section className="takeoff-main">
          {isLoading ? (
            <section className="takeoff-panel takeoff-empty-state">
              <RefreshCw size={18} />
              <strong>Loading Takeoff workspace</strong>
            </section>
          ) : selectedProject ? (
            <>
              <section className="takeoff-project-hero">
                <div>
                  <div className="takeoff-kicker">
                    <span>{selectedProject.reference}</span>
                    <b className={`takeoff-status ${selectedProject.status.toLowerCase().replace(/\s+/g, "-")}`}>{selectedProject.status}</b>
                  </div>
                  <h1>{selectedProject.name}</h1>
                  <p>{selectedProject.customer} - {selectedProject.site}</p>
                </div>
                <div className="takeoff-quote-link">
                  <Link2 size={16} />
                  <select
                    value={selectedProject.linkedQuoteId ?? ""}
                    onChange={(event) => updateProject({ linkedQuoteId: event.target.value })}
                  >
                    <option value="">Choose quote</option>
                    {quotes.map((quote) => (
                      <option value={quote.id} key={quote.id}>{quoteLabel(quote)}</option>
                    ))}
                  </select>
                </div>
              </section>

              {error ? <p className="takeoff-error">{error}</p> : null}
              {notice ? <p className="takeoff-notice">{notice}</p> : null}

              <section className="takeoff-metrics" aria-label="Takeoff totals">
                <article>
                  <span>Material sell</span>
                  <strong>{money(projectTotals.materialSell)}</strong>
                </article>
                <article>
                  <span>Labour sell</span>
                  <strong>{money(projectTotals.labourSell)}</strong>
                </article>
                <article>
                  <span>Labour hours</span>
                  <strong>{projectTotals.labourHours.toFixed(1)}</strong>
                </article>
                <article>
                  <span>Supplier items</span>
                  <strong>{projectTotals.supplierCount}</strong>
                </article>
              </section>

              <nav className="takeoff-tabs" aria-label="Takeoff sections">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      className={activeTab === tab.key ? "active" : ""}
                      type="button"
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <Icon size={15} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              {activeTab === "intake" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Building2} title="Project setup" action={formatDate(selectedProject.updatedAt)} />
                    <div className="takeoff-form-grid">
                      <label>
                        Project name
                        <input value={selectedProject.name} onChange={(event) => updateProject({ name: event.target.value })} />
                      </label>
                      <label>
                        Customer
                        <input value={selectedProject.customer} onChange={(event) => updateProject({ customer: event.target.value })} />
                      </label>
                      <label>
                        Site
                        <input value={selectedProject.site} onChange={(event) => updateProject({ site: event.target.value })} />
                      </label>
                      <label>
                        Status
                        <select
                          value={selectedProject.status}
                          onChange={(event) => updateProject({ status: event.target.value as TakeoffProject["status"] })}
                        >
                          <option>Draft</option>
                          <option>In review</option>
                          <option>Approved</option>
                          <option>Pushed</option>
                        </select>
                      </label>
                      <label className="wide">
                        Scope
                        <textarea value={selectedProject.description} onChange={(event) => updateProject({ description: event.target.value })} />
                      </label>
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle
                      icon={FileText}
                      title="Documents"
                      action={isUploadingDocs ? "Uploading..." : `${selectedProject.documents.length} files`}
                    >
                      <button
                        className="takeoff-small-button"
                        type="button"
                        disabled={isExtracting || selectedProject.documents.length === 0}
                        onClick={runAiExtraction}
                      >
                        <Sparkles size={14} />
                        {isExtracting ? "Scanning" : "AI scan"}
                      </button>
                    </PanelTitle>
                    <div className="takeoff-upload-strip">
                      <UploadButton kind="Drawing" label="Drawings" disabled={isUploadingDocs} onUpload={addDocuments} />
                      <UploadButton kind="Specification" label="Specs" disabled={isUploadingDocs} onUpload={addDocuments} />
                      <UploadButton kind="Contractor BOQ" label="BOQs" disabled={isUploadingDocs} onUpload={addDocuments} />
                    </div>
                    <div className={`takeoff-ai-status ${aiStatus?.connected ? "connected" : "missing"}`}>
                      <Sparkles size={15} />
                      <span>
                        <strong>{aiStatus?.connected ? "OpenAI connected" : "OpenAI not connected yet"}</strong>
                        <small>
                          {aiStatus?.connected
                            ? `AI scan will use ${aiStatus.model}${aiStatus.source === "local" ? " from local pilot settings" : ""}. ${aiReadyDocumentCount} of ${selectedProject.documents.length} file(s) are AI-ready.`
                            : "Paste an OpenAI Platform API key below, then re-upload files for a live scan."}
                        </small>
                      </span>
                      {!aiStatus?.connected ? (
                        <div className="takeoff-ai-connect">
                          <input
                            aria-label="OpenAI API key"
                            autoComplete="off"
                            placeholder="sk-..."
                            type="password"
                            value={openAiKeyDraft}
                            onChange={(event) => setOpenAiKeyDraft(event.target.value)}
                          />
                          <button
                            className="takeoff-small-button"
                            disabled={isSavingAiKey}
                            type="button"
                            onClick={saveOpenAiKey}
                          >
                            {isSavingAiKey ? "Saving" : "Connect"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {selectedProject.extraction ? (
                      <div className="takeoff-extraction-strip">
                        <Sparkles size={15} />
                        <span>
                          <strong>
                            {selectedProject.extraction.provider
                              ? `${selectedProject.extraction.provider} ${selectedProject.extraction.status.toLowerCase()}`
                              : selectedProject.extraction.status}
                          </strong>
                          <small>
                            {selectedProject.extraction.model ? `${selectedProject.extraction.model} - ` : ""}
                            {selectedProject.extraction.summary}
                          </small>
                        </span>
                        <b>{selectedProject.extraction.confidence}</b>
                      </div>
                    ) : null}
                    <div className="takeoff-document-list">
                      {selectedProject.documents.map((document) => (
                        <article key={document.id}>
                          <FileSpreadsheet size={16} />
                          <span>
                            <strong>{document.fileName}</strong>
                            <small>
                              {document.kind} - {document.status} - {fileSizeLabel(document.size)}
                              {aiStatus?.connected ? ` - ${document.storageKey ? "AI-ready" : "Re-upload for OpenAI"}` : ""}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${document.fileName}`}
                            onClick={() => updateProject({ documents: removeById(selectedProject.documents, document.id) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </article>
                      ))}
                      {!selectedProject.documents.length ? (
                        <div className="takeoff-empty">No drawings, specs or BOQs registered.</div>
                      ) : null}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "survey" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={ClipboardList} title="Survey evidence" action={`${surveyDocuments.length} files`}>
                      <button
                        className="takeoff-small-button"
                        type="button"
                        disabled={isSurveyDrafting || surveyDocuments.length === 0 || !aiStatus?.connected}
                        onClick={runSurveyDraft}
                      >
                        <Sparkles size={14} />
                        {isSurveyDrafting ? "Drafting" : "AI draft quote"}
                      </button>
                    </PanelTitle>
                    <div className="takeoff-upload-strip">
                      <UploadButton
                        kind="Survey note"
                        label="Notes"
                        disabled={isUploadingDocs}
                        onUpload={addDocuments}
                      />
                      <UploadButton
                        kind="Survey photo"
                        label="Photos"
                        disabled={isUploadingDocs}
                        onUpload={addDocuments}
                      />
                    </div>
                    <div className={`takeoff-ai-status ${aiStatus?.connected ? "connected" : "missing"}`}>
                      <Sparkles size={15} />
                      <span>
                        <strong>{aiStatus?.connected ? "OpenAI connected" : "OpenAI not connected yet"}</strong>
                        <small>
                          {aiStatus?.connected
                            ? `${surveyAiReadyDocumentCount} of ${surveyDocuments.length} survey file(s) are AI-ready.`
                            : "Connect an OpenAI Platform key before drafting from notes/photos."}
                        </small>
                      </span>
                      {!aiStatus?.connected ? (
                        <div className="takeoff-ai-connect">
                          <input
                            aria-label="OpenAI API key"
                            autoComplete="off"
                            placeholder="sk-..."
                            type="password"
                            value={openAiKeyDraft}
                            onChange={(event) => setOpenAiKeyDraft(event.target.value)}
                          />
                          <button
                            className="takeoff-small-button"
                            disabled={isSavingAiKey}
                            type="button"
                            onClick={saveOpenAiKey}
                          >
                            {isSavingAiKey ? "Saving" : "Connect"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="takeoff-document-list">
                      {surveyDocuments.map((document) => (
                        <article key={document.id}>
                          <FileText size={16} />
                          <span>
                            <strong>{document.fileName}</strong>
                            <small>
                              {document.kind} - {document.status} - {fileSizeLabel(document.size)}
                              {aiStatus?.connected ? ` - ${document.storageKey ? "AI-ready" : "Re-upload for OpenAI"}` : ""}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${document.fileName}`}
                            onClick={() => updateProject({ documents: removeById(selectedProject.documents, document.id) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </article>
                      ))}
                      {!surveyDocuments.length ? (
                        <div className="takeoff-empty">No handwritten notes or room photos uploaded.</div>
                      ) : null}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle
                      icon={Sparkles}
                      title="Draft quote output"
                      action={selectedProject.extraction?.completedAt ? formatDate(selectedProject.extraction.completedAt) : "Not drafted"}
                    />
                    <div className="takeoff-survey-summary">
                      <div>
                        <span>Rooms</span>
                        <strong>{selectedProject.rooms.length}</strong>
                      </div>
                      <div>
                        <span>Materials</span>
                        <strong>{selectedProject.materialAllowances.length}</strong>
                      </div>
                      <div>
                        <span>Labour</span>
                        <strong>{projectTotals.labourHours.toFixed(1)} hrs</strong>
                      </div>
                      <div>
                        <span>Supplier</span>
                        <strong>{selectedProject.supplierRequests.length}</strong>
                      </div>
                    </div>
                    {selectedProject.extraction ? (
                      <div className="takeoff-extraction-strip">
                        <Sparkles size={15} />
                        <span>
                          <strong>{selectedProject.extraction.provider ?? "AI"} draft</strong>
                          <small>{selectedProject.extraction.summary}</small>
                        </span>
                        <b>{selectedProject.extraction.confidence}</b>
                      </div>
                    ) : null}
                    <div className="takeoff-table boq-preview survey-preview">
                      <div className="takeoff-table-head">
                        <span>Type</span>
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Total</span>
                        <span>RFQ</span>
                      </div>
                      {boqPreviewRows.slice(0, 8).map((line) => (
                        <div className="takeoff-table-row readonly" key={`survey-${line.type}-${line.id}`}>
                          <span>{line.type}</span>
                          <span>{line.section}</span>
                          <strong>{line.description}</strong>
                          <span>{line.quantity}</span>
                          <span>{line.unit}</span>
                          <span>{money(line.total)}</span>
                          <span>{line.supplierRequired ? "Yes" : "No"}</span>
                        </div>
                      ))}
                      {!boqPreviewRows.length ? (
                        <div className="takeoff-empty">No draft quote lines yet.</div>
                      ) : null}
                    </div>
                    <div className="takeoff-review-actions">
                      <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("boq")}>
                        <PackageSearch size={15} />
                        Review BOQ
                      </button>
                      <button className="takeoff-primary-button" type="button" onClick={() => setActiveTab("review")}>
                        <CheckCircle2 size={15} />
                        Review / push
                      </button>
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "rooms" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Ruler} title="Rooms" action={`${selectedProject.rooms.length} rooms`}>
                      <button className="takeoff-small-button" type="button" onClick={addRoom}>
                        <Plus size={14} />
                        Room
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table rooms">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Level</span>
                        <span>L m</span>
                        <span>W m</span>
                        <span>H m</span>
                        <span>Area</span>
                        <span>Heat</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.rooms.map((room) => (
                        <div className="takeoff-table-row" key={room.id}>
                          <input value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} />
                          <input value={room.level} onChange={(event) => updateRoom(room.id, { level: event.target.value })} />
                          <input type="number" value={room.lengthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "lengthM", event.target.value)} />
                          <input type="number" value={room.widthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "widthM", event.target.value)} />
                          <input type="number" value={room.heightM ?? 0} onChange={(event) => updateRoomDimension(room.id, "heightM", event.target.value)} />
                          <input type="number" value={room.areaM2} onChange={(event) => updateRoom(room.id, { areaM2: numberFromInput(event.target.value) })} />
                          <input type="number" value={room.heatLoadWatts} onChange={(event) => updateRoom(room.id, { heatLoadWatts: numberFromInput(event.target.value) })} />
                          <input value={room.notes} onChange={(event) => updateRoom(room.id, { notes: event.target.value })} />
                          <button type="button" aria-label={`Remove ${room.name}`} onClick={() => updateProject({ rooms: removeById(selectedProject.rooms, room.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ClipboardList} title="Measurements" action={`${selectedProject.measurements.length} rows`}>
                      <button className="takeoff-small-button" type="button" onClick={addMeasurement}>
                        <Plus size={14} />
                        Row
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table measurements">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Label</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Source</span>
                        <span />
                      </div>
                      {selectedProject.measurements.map((measurement) => (
                        <div className="takeoff-table-row" key={measurement.id}>
                          <select value={measurement.roomId ?? ""} onChange={(event) => updateMeasurement(measurement.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <input value={measurement.label} onChange={(event) => updateMeasurement(measurement.id, { label: event.target.value })} />
                          <input type="number" value={measurement.quantity} onChange={(event) => updateMeasurement(measurement.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={measurement.unit} onChange={(event) => updateMeasurement(measurement.id, { unit: event.target.value })} />
                          <select value={measurement.source} onChange={(event) => updateMeasurement(measurement.id, { source: event.target.value as TakeoffMeasurement["source"] })}>
                            <option>Drawing</option>
                            <option>Spec</option>
                            <option>BOQ</option>
                            <option>Manual</option>
                          </select>
                          <button type="button" aria-label="Remove measurement" onClick={() => updateProject({ measurements: removeById(selectedProject.measurements, measurement.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "heat" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Heat loss schedule" action={`${heatLossSchedule.length} rooms`} />
                    <div className="takeoff-table heat-loss">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Dimensions</span>
                        <span>Heat loss</span>
                        <span>Radiators</span>
                        <span>Output</span>
                        <span>Coverage</span>
                        <span />
                      </div>
                      {heatLossSchedule.map((row) => (
                        <div className="takeoff-table-row readonly" key={row.room.id}>
                          <strong>{row.room.name}</strong>
                          <span>{row.dimensions}</span>
                          <span>{row.heatWatts}W / {row.heatBtu} BTU</span>
                          <span>{row.radiatorSummary}</span>
                          <span>{row.radiatorOutputWatts}W / {row.radiatorOutputBtu} BTU</span>
                          <span className={row.coverageWatts >= 0 ? "takeoff-coverage-ok" : "takeoff-coverage-low"}>
                            {row.coverageWatts >= 0 ? "+" : ""}{row.coverageWatts}W
                          </span>
                          <button type="button" aria-label={`Load ${row.room.name} heat calculation`} onClick={() => loadRoomIntoHeatCalc(row.room.id)}>
                            <Ruler size={15} />
                          </button>
                        </div>
                      ))}
                      {!heatLossSchedule.length ? (
                        <div className="takeoff-empty">No rooms to calculate yet.</div>
                      ) : null}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Heat calculator" action={selectedHeatCalcRoom?.name ?? "Select room"}>
                      <button className="takeoff-small-button" type="button" onClick={applyHeatCalculation}>
                        <CheckCircle2 size={14} />
                        Apply
                      </button>
                    </PanelTitle>
                    <div className="takeoff-heat-summary">
                      <div>
                        <span>Room heat load</span>
                        <strong>{heatCalcResult.watts}W</strong>
                        <small>{heatCalcResult.btu} BTU</small>
                      </div>
                      <div>
                        <span>Radiator output</span>
                        <strong>{heatCalcResult.radiatorOutputWatts}W</strong>
                        <small>Delta T50</small>
                      </div>
                      <div>
                        <span>Recommended</span>
                        <strong>{heatCalcResult.recommended ? `${heatCalcResult.quantity} x ${heatCalcResult.recommended.model}` : "-"}</strong>
                        <small>{heatCalcResult.recommended?.range ?? "No match"}</small>
                      </div>
                    </div>
                    <div className="takeoff-form-grid heat">
                      <label>
                        Room
                        <select value={heatCalc.roomId} onChange={(event) => loadRoomIntoHeatCalc(event.target.value)}>
                          <option value="">Choose room</option>
                          {selectedProject.rooms.map((room) => (
                            <option value={room.id} key={room.id}>{room.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Room type
                        <select value={heatCalc.roomType} onChange={(event) => updateHeatCalc({ roomType: event.target.value as HeatCalcDraft["roomType"] })}>
                          {heatCalcRoomTypes.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Length m
                        <input type="number" value={heatCalc.lengthM} onChange={(event) => updateHeatCalc({ lengthM: event.target.value })} />
                      </label>
                      <label>
                        Width m
                        <input type="number" value={heatCalc.widthM} onChange={(event) => updateHeatCalc({ widthM: event.target.value })} />
                      </label>
                      <label>
                        Height m
                        <input type="number" value={heatCalc.heightM} onChange={(event) => updateHeatCalc({ heightM: event.target.value })} />
                      </label>
                      <label>
                        Construction
                        <select value={heatCalc.construction} onChange={(event) => updateHeatCalc({ construction: event.target.value as HeatCalcDraft["construction"] })}>
                          {heatCalcConstruction.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Glazing
                        <select value={heatCalc.glazing} onChange={(event) => updateHeatCalc({ glazing: event.target.value as HeatCalcDraft["glazing"] })}>
                          {heatCalcGlazing.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Outside walls
                        <input type="number" value={heatCalc.outsideWalls} onChange={(event) => updateHeatCalc({ outsideWalls: event.target.value })} />
                      </label>
                      <label>
                        Window area m2
                        <input type="number" value={heatCalc.windowAreaM2} onChange={(event) => updateHeatCalc({ windowAreaM2: event.target.value })} />
                      </label>
                      <label>
                        Mean water C
                        <input type="number" value={heatCalc.waterTempC} onChange={(event) => updateHeatCalc({ waterTempC: event.target.value })} />
                      </label>
                      <label>
                        Uplift %
                        <input type="number" value={heatCalc.upliftPercent} onChange={(event) => updateHeatCalc({ upliftPercent: event.target.value })} />
                      </label>
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "runs" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Wrench} title="Pipe runs" action={`${selectedProject.pipeRuns.length} runs`}>
                      <button className="takeoff-small-button" type="button" onClick={addPipeRun}>
                        <Plus size={14} />
                        Run
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table pipe-runs">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Service</span>
                        <span>Route</span>
                        <span>Dia.</span>
                        <span>Material</span>
                        <span>Metres</span>
                        <span>Fittings</span>
                        <span>Ins.</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.pipeRuns.map((run) => (
                        <div className="takeoff-table-row" key={run.id}>
                          <select value={run.roomId ?? ""} onChange={(event) => updatePipeRun(run.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <select value={run.service} onChange={(event) => updatePipeRun(run.id, { service: event.target.value as TakeoffPipeRun["service"] })}>
                            <option>Heating flow/return</option>
                            <option>Hot water</option>
                            <option>Cold water</option>
                            <option>Gas</option>
                            <option>Waste</option>
                            <option>Condensate</option>
                            <option>Other</option>
                          </select>
                          <input value={run.route} onChange={(event) => updatePipeRun(run.id, { route: event.target.value })} />
                          <input value={run.diameter} onChange={(event) => updatePipeRun(run.id, { diameter: event.target.value })} />
                          <input value={run.material} onChange={(event) => updatePipeRun(run.id, { material: event.target.value })} />
                          <input type="number" value={run.lengthM} onChange={(event) => updatePipeRun(run.id, { lengthM: numberFromInput(event.target.value) })} />
                          <input type="number" value={run.fittings} onChange={(event) => updatePipeRun(run.id, { fittings: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={run.insulation} onChange={(event) => updatePipeRun(run.id, { insulation: event.target.checked })} />
                          <input value={run.notes} onChange={(event) => updatePipeRun(run.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove pipe run" onClick={() => updateProject({ pipeRuns: removeById(selectedProject.pipeRuns, run.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Radiator schedule" action={`${selectedProject.radiators.length} radiators`}>
                      <button className="takeoff-small-button" type="button" onClick={addRadiator}>
                        <Plus size={14} />
                        Radiator
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table radiators">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Output</span>
                        <span>Model</span>
                        <span>Qty</span>
                        <span>RFQ</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.radiators.map((radiator) => (
                        <div className="takeoff-table-row" key={radiator.id}>
                          <select value={radiator.roomId ?? ""} onChange={(event) => updateRadiator(radiator.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <input type="number" value={radiator.outputWatts} onChange={(event) => updateRadiator(radiator.id, { outputWatts: numberFromInput(event.target.value) })} />
                          <input value={radiator.model} onChange={(event) => updateRadiator(radiator.id, { model: event.target.value })} />
                          <input type="number" value={radiator.quantity} onChange={(event) => updateRadiator(radiator.id, { quantity: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={radiator.supplierRequired} onChange={(event) => updateRadiator(radiator.id, { supplierRequired: event.target.checked })} />
                          <input value={radiator.notes} onChange={(event) => updateRadiator(radiator.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove radiator" onClick={() => updateProject({ radiators: removeById(selectedProject.radiators, radiator.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "boq" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={PackageSearch} title="Materials" action={money(projectTotals.materialSell)}>
                      <button className="takeoff-small-button" type="button" onClick={addMaterial}>
                        <Plus size={14} />
                        Material
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table materials">
                      <div className="takeoff-table-head">
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Cost</span>
                        <span>Markup</span>
                        <span>RFQ</span>
                        <span>Supplier</span>
                        <span />
                      </div>
                      {selectedProject.materialAllowances.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.section} onChange={(event) => updateMaterial(line.id, { section: event.target.value })} />
                          <input value={line.description} onChange={(event) => updateMaterial(line.id, { description: event.target.value })} />
                          <input type="number" value={line.quantity} onChange={(event) => updateMaterial(line.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={line.unit} onChange={(event) => updateMaterial(line.id, { unit: event.target.value })} />
                          <input type="number" value={line.unitCost} onChange={(event) => updateMaterial(line.id, { unitCost: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.markupPercent} onChange={(event) => updateMaterial(line.id, { markupPercent: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={line.supplierRequired} onChange={(event) => updateMaterial(line.id, { supplierRequired: event.target.checked })} />
                          <input value={line.preferredSupplier ?? ""} onChange={(event) => updateMaterial(line.id, { preferredSupplier: event.target.value })} />
                          <button type="button" aria-label="Remove material" onClick={() => updateProject({ materialAllowances: removeById(selectedProject.materialAllowances, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ListChecks} title="Labour" action={`${projectTotals.labourHours.toFixed(1)} hrs`}>
                      <button className="takeoff-small-button" type="button" onClick={addLabour}>
                        <Plus size={14} />
                        Labour
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table labour">
                      <div className="takeoff-table-head">
                        <span>Section</span>
                        <span>Role</span>
                        <span>Hours</span>
                        <span>Rate</span>
                        <span>Markup</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.labourAllowances.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.section} onChange={(event) => updateLabour(line.id, { section: event.target.value })} />
                          <input value={line.role} onChange={(event) => updateLabour(line.id, { role: event.target.value })} />
                          <input type="number" value={line.hours} onChange={(event) => updateLabour(line.id, { hours: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.costRate} onChange={(event) => updateLabour(line.id, { costRate: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.markupPercent} onChange={(event) => updateLabour(line.id, { markupPercent: numberFromInput(event.target.value) })} />
                          <input value={line.notes} onChange={(event) => updateLabour(line.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove labour" onClick={() => updateProject({ labourAllowances: removeById(selectedProject.labourAllowances, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={FileSpreadsheet} title="Generated BOQ" action={`${boqPreviewRows.length} lines`} />
                    <div className="takeoff-table boq-preview">
                      <div className="takeoff-table-head">
                        <span>Type</span>
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Total</span>
                        <span>RFQ</span>
                      </div>
                      {boqPreviewRows.map((line) => (
                        <div className="takeoff-table-row readonly" key={`${line.type}-${line.id}`}>
                          <span>{line.type}</span>
                          <span>{line.section}</span>
                          <strong>{line.description}</strong>
                          <span>{line.quantity}</span>
                          <span>{line.unit}</span>
                          <span>{money(line.total)}</span>
                          <span>{line.supplierRequired ? "Yes" : "No"}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "review" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={CheckCircle2} title="Office review" action={selectedQuote?.ref ?? "No quote"} />
                    <div className="takeoff-form-grid">
                      <label className="wide">
                        Office notes
                        <textarea
                          value={selectedProject.review.officeNotes}
                          onChange={(event) =>
                            updateProject({
                              review: { ...selectedProject.review, officeNotes: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        Risk flags
                        <textarea
                          value={selectedProject.review.riskFlags.join("\n")}
                          onChange={(event) =>
                            updateProject({
                              review: {
                                ...selectedProject.review,
                                riskFlags: event.target.value
                                  .split("\n")
                                  .map((line) => line.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="takeoff-review-actions">
                      <button className="takeoff-secondary-button" type="button" onClick={() => updateProject({ status: "In review" })}>
                        <ClipboardList size={15} />
                        Mark in review
                      </button>
                      <button className="takeoff-primary-button" type="button" onClick={approveProject}>
                        <CheckCircle2 size={15} />
                        Approve
                      </button>
                      <button className="takeoff-primary-button strong" type="button" disabled={isPushing} onClick={pushProject}>
                        <Send size={15} />
                        {isPushing ? "Pushing" : "Push to quote"}
                      </button>
                    </div>
                    <div className="takeoff-review-meta">
                      <span>Approved: {formatDate(selectedProject.review.approvedAt)}</span>
                      <span>Pushed: {formatDate(selectedProject.review.pushedAt)}</span>
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={Send} title="Supplier request list" action={`${selectedProject.supplierRequests.length} lines`}>
                      <button className="takeoff-small-button" type="button" onClick={addSupplierRequest}>
                        <Plus size={14} />
                        RFQ line
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table supplier">
                      <div className="takeoff-table-head">
                        <span>Supplier</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.supplierRequests.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.supplier} onChange={(event) => updateSupplierRequest(line.id, { supplier: event.target.value })} />
                          <input value={line.description} onChange={(event) => updateSupplierRequest(line.id, { description: event.target.value })} />
                          <input type="number" value={line.quantity} onChange={(event) => updateSupplierRequest(line.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={line.unit} onChange={(event) => updateSupplierRequest(line.id, { unit: event.target.value })} />
                          <input value={line.notes} onChange={(event) => updateSupplierRequest(line.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove supplier request" onClick={() => updateProject({ supplierRequests: removeById(selectedProject.supplierRequests, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}
            </>
          ) : (
            <section className="takeoff-panel takeoff-empty-state">
              <Home size={18} />
              <strong>Create a Takeoff project to begin.</strong>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function UploadButton({
  kind,
  label,
  accept,
  disabled = false,
  onUpload,
}: {
  kind: TakeoffDocumentKind;
  label: string;
  accept?: string;
  disabled?: boolean;
  onUpload: (kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}) {
  return (
    <label className={`takeoff-upload-button${disabled ? " disabled" : ""}`}>
      <Upload size={15} />
      {label}
      <input
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(event) => onUpload(kind, event)}
      />
    </label>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: string;
  children?: ReactNode;
}) {
  return (
    <div className="takeoff-panel-title">
      <span>
        <Icon size={17} />
        <strong>{title}</strong>
      </span>
      <div>
        {action ? <small>{action}</small> : null}
        {children}
      </div>
    </div>
  );
}
