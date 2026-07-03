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
  TakeoffDocument,
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

type TakeoffTab = "intake" | "rooms" | "runs" | "boq" | "review";

type NewProjectDraft = {
  name: string;
  customer: string;
  site: string;
  description: string;
  linkedQuoteId: string;
};

const tabs: Array<{ key: TakeoffTab; label: string; icon: LucideIcon }> = [
  { key: "intake", label: "Intake", icon: Upload },
  { key: "rooms", label: "Rooms", icon: Ruler },
  { key: "runs", label: "Pipe / radiators", icon: ThermometerSun },
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

function documentDrafts(kind: TakeoffDocumentKind, fileName: string, documentId: string) {
  if (kind === "Contractor BOQ") {
    const materialId = makeId("takeoff-material");
    return {
      materialAllowances: [
        {
          id: materialId,
          section: "Contractor BOQ",
          description: fileName.replace(/\.[^.]+$/, "") || "Contractor BOQ material allowance",
          quantity: 1,
          unit: "allowance",
          unitCost: 0,
          markupPercent: 30,
          supplierRequired: true,
          preferredSupplier: "",
          sourceDocumentId: documentId,
        } satisfies TakeoffMaterialAllowance,
      ],
      supplierRequests: [
        {
          id: makeId("takeoff-supplier"),
          supplier: "",
          description: `Price BOQ allowance from ${fileName}`,
          quantity: 1,
          unit: "allowance",
          linkedMaterialId: materialId,
          notes: "Confirm quantities, exclusions and lead time.",
        } satisfies TakeoffSupplierRequestItem,
      ],
      measurements: [] as TakeoffMeasurement[],
      pipeRuns: [] as TakeoffPipeRun[],
      riskFlags: ["Contractor BOQ quantities need office check"],
    };
  }

  if (kind === "Specification") {
    return {
      materialAllowances: [
        {
          id: makeId("takeoff-material"),
          section: "Specification",
          description: "Specified valves, controls and accessories",
          quantity: 1,
          unit: "allowance",
          unitCost: 0,
          markupPercent: 30,
          supplierRequired: true,
          preferredSupplier: "",
          sourceDocumentId: documentId,
        } satisfies TakeoffMaterialAllowance,
      ],
      supplierRequests: [] as TakeoffSupplierRequestItem[],
      measurements: [] as TakeoffMeasurement[],
      pipeRuns: [] as TakeoffPipeRun[],
      riskFlags: ["Named manufacturers and equal-approved options need review"],
    };
  }

  return {
    materialAllowances: [] as TakeoffMaterialAllowance[],
    supplierRequests: [] as TakeoffSupplierRequestItem[],
    measurements: [
      {
        id: makeId("takeoff-measure"),
        label: "Measured pipe route from drawing",
        quantity: 0,
        unit: "m",
        source: "Drawing",
      } satisfies TakeoffMeasurement,
    ],
    pipeRuns: [
      {
        id: makeId("takeoff-pipe"),
        service: "Heating flow/return",
        route: fileName.replace(/\.[^.]+$/, "") || "Drawing route",
        diameter: "22mm",
        material: "Copper",
        lengthM: 0,
        fittings: 0,
        insulation: false,
        notes: "Confirm scale and route before final pricing.",
      } satisfies TakeoffPipeRun,
    ],
    riskFlags: ["Drawing scale and revision need confirmation"],
  };
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
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedProject?.linkedQuoteId) ?? null,
    [quotes, selectedProject],
  );

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

      if (!projectResponse.ok) throw new Error("Unable to load Takeoff projects");
      if (!quoteResponse.ok) throw new Error("Unable to load quotes");

      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = (await quoteResponse.json()) as Quote[];

      setProjects(nextProjects);
      setQuotes(nextQuotes);
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

  function addDocuments(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    if (!selectedProject) return;
    const files = Array.from(event.currentTarget.files ?? []);
    if (!files.length) return;

    let nextDocuments = [...selectedProject.documents];
    let nextMeasurements = [...selectedProject.measurements];
    let nextPipeRuns = [...selectedProject.pipeRuns];
    let nextMaterials = [...selectedProject.materialAllowances];
    let nextSupplierRequests = [...selectedProject.supplierRequests];
    const nextRiskFlags = new Set(selectedProject.review.riskFlags);

    files.forEach((file) => {
      const documentId = makeId("takeoff-doc");
      const document: TakeoffDocument = {
        id: documentId,
        kind,
        fileName: file.name,
        mimeType: file.type || undefined,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        status: kind === "Contractor BOQ" ? "Parsed" : "Needs review",
        notes: kind === "Drawing"
          ? ["Confirm scale and revision."]
          : kind === "Specification"
            ? ["Confirm named manufacturer requirements."]
            : ["Check provisional sums and exclusions."],
      };
      const drafts = documentDrafts(kind, file.name, documentId);
      nextDocuments = [document, ...nextDocuments];
      nextMeasurements = [...nextMeasurements, ...drafts.measurements];
      nextPipeRuns = [...nextPipeRuns, ...drafts.pipeRuns];
      nextMaterials = [...nextMaterials, ...drafts.materialAllowances];
      nextSupplierRequests = [...nextSupplierRequests, ...drafts.supplierRequests];
      drafts.riskFlags.forEach((flag) => nextRiskFlags.add(flag));
    });

    updateProject(
      {
        status: selectedProject.status === "Draft" ? "In review" : selectedProject.status,
        documents: nextDocuments,
        measurements: nextMeasurements,
        pipeRuns: nextPipeRuns,
        materialAllowances: nextMaterials,
        supplierRequests: nextSupplierRequests,
        review: {
          ...selectedProject.review,
          riskFlags: Array.from(nextRiskFlags),
        },
      },
      `${files.length} ${kind.toLowerCase()} file${files.length === 1 ? "" : "s"} registered.`,
    );
    event.currentTarget.value = "";
  }

  async function runAiExtraction() {
    if (!selectedProject) return;
    if (!selectedProject.documents.length) {
      setError("Upload drawings, specs or BOQs before running extraction.");
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
      setNotice(
        `Draft extraction complete: ${result.generated.measurements} measurement row(s), ${result.generated.materialAllowances} material allowance(s), ${result.generated.labourAllowances} labour allowance(s).`,
      );
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Unable to run extraction");
    } finally {
      setIsExtracting(false);
    }
  }

  function addRoom() {
    if (!selectedProject) return;
    const room: TakeoffRoom = {
      id: makeId("takeoff-room"),
      name: "New room",
      level: "Ground",
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
      const result = (await response.json()) as { project: TakeoffProject; quote: Quote };
      replaceProject(result.project);
      setQuotes((current) => current.map((quote) => (quote.id === result.quote.id ? result.quote : quote)));
      setNotice(`${result.project.reference} pushed into ${result.quote.ref}.`);
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
                    <PanelTitle icon={FileText} title="Documents" action={`${selectedProject.documents.length} files`}>
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
                      <UploadButton kind="Drawing" label="Drawings" onUpload={addDocuments} />
                      <UploadButton kind="Specification" label="Specs" onUpload={addDocuments} />
                      <UploadButton kind="Contractor BOQ" label="BOQs" onUpload={addDocuments} />
                    </div>
                    {selectedProject.extraction ? (
                      <div className="takeoff-extraction-strip">
                        <Sparkles size={15} />
                        <span>
                          <strong>{selectedProject.extraction.status}</strong>
                          <small>{selectedProject.extraction.summary}</small>
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
                            <small>{document.kind} - {document.status} - {fileSizeLabel(document.size)}</small>
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
                        <span>Area</span>
                        <span>Heat</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.rooms.map((room) => (
                        <div className="takeoff-table-row" key={room.id}>
                          <input value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} />
                          <input value={room.level} onChange={(event) => updateRoom(room.id, { level: event.target.value })} />
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
  onUpload,
}: {
  kind: TakeoffDocumentKind;
  label: string;
  onUpload: (kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="takeoff-upload-button">
      <Upload size={15} />
      {label}
      <input
        type="file"
        multiple
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
