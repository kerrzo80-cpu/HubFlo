"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useBrand } from "@/components/BrandProvider";
import { FileDropZone } from "@/components/FileDropZone";
import { resolveBrandLogoUrl } from "@/lib/branding";
import { employeeHeaderName, roleHeaderName } from "@/lib/access";
import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";
import {
  classificationLayer,
  createDefaultStudioState,
  ensureServiceClassifications,
  importSkillCountsIntoStudio,
  countAiStudioCountPins,
  countAiStudioPipeRuns,
  isAiStudioGeometry,
  nextClassificationColour,
  setClassificationColour,
  setStudioActiveLayer,
  listStudioLayers,
  addCustomStudioLayer,
  removeCustomStudioLayer,
  studioId,
  studioHasAiCounts,
  studioHasAiPipeRuns,
  studioNeedsAiReview,
  studioQuantitiesToMaterialAllowances,
  summariseStudioQuantities,
  fillMissingPageScalesFromDocument,
  mergeStudioScales,
  type StudioAiReviewMeasuredQuantity,
  type StudioClassKind,
  type StudioClassification,
  type StudioState,
} from "@/lib/takeoff-studio";
import {
  ensurePlantClassifications,
  type BlakeEmitterMode,
  type BlakePlantKind,
} from "@/lib/takeoff-blake-propose";
import {
  buildStudioMarkedDrawingSvg,
  buildStudioMarkedSnapshot,
  layersWithStudioMarks,
  markedDrawingFileName,
  renderTakeoffPdfPageDataUrl,
  studioLayerLabel,
  type StudioExportLayerId,
} from "@/lib/takeoff-studio-marked-export";
import {
  extractTakeoffPdfInBrowser,
  extractTakeoffPdfStrokesInBrowser,
} from "@/lib/takeoff-pdf-browser";
import {
  countUnscaledStudioLinears,
  DEFAULT_STUDIO_PIPE_SPEC_ID,
  STUDIO_PIPE_SPECS,
  summariseStudioBoq,
  summariseStudioPipeBoq,
  summariseUnscaledStudioLinears,
  type StudioBoqRow,
} from "@/lib/takeoff-studio-pipe";
import { recordTakeoffLearningClient } from "@/lib/takeoff-learning-client";
import {
  applyTakeoffRatesToMaterials,
  priceAndExpandTakeoffMaterials,
  summarisePricedMaterials,
} from "@/lib/takeoff-studio-rates";
import type { TakeoffAssemblyKit, TakeoffRateEntry, TakeoffRateLibrary } from "@/lib/takeoff-rate-core";
import type { AuditEvent } from "@/lib/people-seed-data";

import TakeoffOverlayReview from "./TakeoffOverlayReview";
import StudioCanvas from "./studio/StudioCanvas";
import "./takeoff-skill.css";
import "./studio/studio.css";

type QuoteOption = { id: string; ref: string; customer: string; site: string };
type TenderOption = {
  id: string;
  name: string;
  client: string;
  status: string;
  externalId?: string;
  linkedTakeoffId?: string;
};
type AuthState = "checking" | "signed-in" | "signed-out" | "pilot";

let sessionActor = "Office";

function isTakeoffAuditEvent(event: AuditEvent, projectId: string | null) {
  if ((event.source || "").toLowerCase().includes("takeoff")) return true;
  if ((event.recordType || "").startsWith("takeoff")) return true;
  if (projectId && event.recordId === projectId) return true;
  return false;
}

function formatAuditWhen(createdAt: string) {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return createdAt;
  const mins = Math.floor((Date.now() - parsed) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return createdAt;
}

async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has(roleHeaderName)) headers.set(roleHeaderName, "Office");
  if (!headers.has(employeeHeaderName)) headers.set(employeeHeaderName, sessionActor);
  const response = await fetch(input, { ...init, credentials: "include", headers });
  if (response.status === 401 && typeof window !== "undefined") {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(next || "/takeoff")}`);
  }
  return response;
}

export default function TakeoffStudioPage() {
  const brand = useBrand();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authName, setAuthName] = useState<string | null>(null);
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [tenders, setTenders] = useState<TenderOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassKind, setNewClassKind] = useState<StudioClassKind>("linear");
  const [newClassColour, setNewClassColour] = useState("#2878c8");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [blakeStep, setBlakeStep] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [boqOpen, setBoqOpen] = useState(false);
  const [rateLibrary, setRateLibrary] = useState<TakeoffRateLibrary | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ratesBusy, setRatesBusy] = useState(false);
  const [takeoffAudit, setTakeoffAudit] = useState<AuditEvent[]>([]);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposePlant, setProposePlant] = useState<BlakePlantKind>("boiler");
  const [proposeEmitters, setProposeEmitters] = useState<BlakeEmitterMode>("radiators");
  const [proposeCylinder, setProposeCylinder] = useState(true);
  const [proposeQuestions, setProposeQuestions] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const saveTimer = useRef<number | null>(null);
  const historyRef = useRef<StudioState[]>([]);
  const futureRef = useRef<StudioState[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const seededServicesRef = useRef<string | null>(null);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const studio: StudioState = ensurePlantClassifications(
    ensureServiceClassifications(selected?.studio ?? createDefaultStudioState()),
  );
  const drawingDocs = (selected?.documents || []).filter(
    (doc) => doc.kind === "Drawing" || doc.kind === "Marked-up drawing" || (doc.mimeType || "").includes("pdf"),
  );
  const activeDoc =
    drawingDocs.find((doc) => doc.id === studio.activeDocumentId) || drawingDocs[0] || null;
  const activeClass = studio.classifications.find((cls) => cls.id === studio.activeClassificationId) || null;
  const activeLayerId = studio.activeLayerId || "all";
  const studioLayers = listStudioLayers(studio);
  const visibleClassifications = studio.classifications.filter((cls) =>
    activeLayerId === "all" ? true : classificationLayer(cls) === activeLayerId,
  );
  const quantities = summariseStudioQuantities(studio);
  const layerBoq = summariseStudioBoq(studio, activeLayerId);
  const masterBoq = summariseStudioBoq(studio, "all");
  const boqForPanel = activeLayerId === "all" ? masterBoq : layerBoq;
  const pricedBoqForPanel = applyTakeoffRatesToMaterials(
    boqForPanel.map((row) => ({
      id: row.id,
      section: row.section,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitCost: 0,
      markupPercent: 0,
      supplierRequired: false,
    })),
    rateLibrary,
  );
  const boqMaterialCost = summarisePricedMaterials(pricedBoqForPanel).materialCost;
  const boqLayerLabel =
    studioLayers.find((layer) => layer.id === activeLayerId)?.label || "Master / all";
  const showSizeBar = studio.tool === "linear" || activeClass?.kind === "linear";
  const linkedQuote = quotes.find((q) => q.id === selected?.linkedQuoteId);
  const linkedTender = tenders.find((t) => t.id === selected?.sourceTenderId);
  // Pin review board is fixture counts only — ignore legacy pipe-metre rows in aiReviewMeasured.
  const aiReviewRows = (studio.aiReviewMeasured || []).filter((row) => row.unit === "nr");
  const aiReviewPinCount = aiReviewRows.reduce(
    (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
    0,
  );
  const hasAiReviewRows = aiReviewPinCount > 0;
  const hasAiCounts = studioHasAiCounts(studio);
  const hasPendingAiReview = studioNeedsAiReview(studio);
  const blakePipeRunCount = countAiStudioPipeRuns(studio);
  const blakePinCount = countAiStudioCountPins(studio);
  const hasBlakePipesOnSheet = studioHasAiPipeRuns(studio);
  const unscaledLinearCount = countUnscaledStudioLinears(studio, activeLayerId);
  const unscaledLinearSummary = summariseUnscaledStudioLinears(studio, activeLayerId);
  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyTick;

  const upsert = useCallback((project: TakeoffProject) => {
    setProjects((current) => {
      const next = current.filter((row) => row.id !== project.id);
      return [project, ...next];
    });
    setSelectedId(project.id);
  }, []);

  const refreshTakeoffAudit = useCallback(async (projectId: string | null) => {
    try {
      const response = await apiFetch("/api/audit", { cache: "no-store" });
      if (!response.ok) return;
      const events = (await response.json()) as AuditEvent[];
      const filtered = events
        .filter((event) => isTakeoffAuditEvent(event, projectId))
        .slice(0, 12);
      setTakeoffAudit(filtered);
    } catch {
      // Audit strip is optional — studio still works offline of Core audit.
    }
  }, []);

  const refresh = useCallback(async () => {
    const [projectRes, quoteRes, tenderRes] = await Promise.all([
      apiFetch("/api/takeoff-projects"),
      apiFetch("/api/quotes"),
      apiFetch("/api/tenders"),
    ]);
    if (projectRes.status === 401) {
      setAuthState("signed-out");
      return;
    }
    if (!projectRes.ok) {
      setError("Unable to load takeoff projects");
      return;
    }
    const list = (await projectRes.json()) as TakeoffProject[];
    setProjects(list.map((project) => ({
      ...project,
      studio: project.studio ?? createDefaultStudioState(),
    })));
    const search =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    // Accept projectId (canonical) and legacy ?project= from older Survey/Heat deep links.
    const wantedId = search?.get("projectId") || search?.get("project") || null;
    const wantedTab = (search?.get("tab") || "").toLowerCase();
    setSelectedId((current) => {
      if (wantedId && list.some((project) => project.id === wantedId)) return wantedId;
      return current ?? list[0]?.id ?? null;
    });
    if (wantedTab === "boq" || wantedTab === "bill" || wantedTab === "quantities") {
      setBoqOpen(true);
    }
    if (quoteRes.ok) {
      const quoteList = (await quoteRes.json()) as Array<Record<string, unknown>>;
      setQuotes(
        quoteList
          .map((quote) => ({
            id: String(quote.id || ""),
            ref: String(quote.ref || ""),
            customer: String(quote.customer || ""),
            site: String(quote.site || ""),
          }))
          .filter((quote) => quote.id),
      );
    }
    if (tenderRes.ok) {
      const tenderPayload = (await tenderRes.json()) as {
        tenders?: Array<Record<string, unknown>>;
      };
      setTenders(
        (tenderPayload.tenders || [])
          .map((tender) => ({
            id: String(tender.id || ""),
            name: String(tender.name || ""),
            client: String(tender.client || ""),
            status: String(tender.status || ""),
            externalId: tender.externalId ? String(tender.externalId) : undefined,
            linkedTakeoffId: tender.linkedTakeoffId ? String(tender.linkedTakeoffId) : undefined,
          }))
          .filter((tender) => tender.id),
      );
    }
  }, []);

  useEffect(() => {
    historyRef.current = [];
    futureRef.current = [];
    setHistoryTick((value) => value + 1);
    setSaveState("saved");
    setReviewOpen(false);
    seededServicesRef.current = null;
  }, [selectedId]);

  useEffect(() => {
    void refreshTakeoffAudit(selectedId);
  }, [selectedId, refreshTakeoffAudit]);

  useEffect(() => {
    if (!selected || seededServicesRef.current === selected.id) return;
    const raw = selected.studio ?? createDefaultStudioState();
    const ensured = ensurePlantClassifications(ensureServiceClassifications(raw));
    seededServicesRef.current = selected.id;
    if (ensured !== raw) {
      void persistStudio(ensured, {}, { skipHistory: true, immediate: true });
    }
    // Seed service + plant classes once per project; persistStudio is defined below in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // On phones, collapse Projects so the drawing fills the first screen.
    const narrow = window.matchMedia("(max-width: 960px)").matches;
    if (!narrow) {
      setRailCollapsed(false);
      return;
    }
    setRailCollapsed(Boolean(activeDoc));
  }, [selectedId, activeDoc?.id]);

  useEffect(() => {
    // Only auto-open the pin review board when there are real fixture pins.
    if (hasPendingAiReview) setReviewOpen(true);
    else setReviewOpen(false);
  }, [hasPendingAiReview, selectedId]);

  useEffect(() => {
    sessionActor = authName?.trim() || "Office";
  }, [authName]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch("/api/takeoff-rates", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; library?: TakeoffRateLibrary } | null;
        if (!active || !response.ok || !body?.library) return;
        setRateLibrary(body.library);
      } catch {
        // Rates stay on built-in defaults until library loads.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch("/api/auth/me", { cache: "no-store" });
        if (!active) return;
        if (response.status === 401) {
          setAuthState("signed-out");
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          mode?: string;
          user?: { name?: string } | null;
        } | null;
        if (body?.mode === "pilot") {
          setAuthState("pilot");
          setAuthName("Pilot");
        } else if (body?.user) {
          setAuthState("signed-in");
          setAuthName(body.user.name || "Signed in");
        } else {
          setAuthState("signed-out");
          return;
        }
        await refresh();
      } catch {
        if (active) setAuthState("signed-out");
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  function show(message: string, ms = 6000) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), ms);
  }

  function studioMarkupKey(state: StudioState) {
    // Only geometry / classes / scales count as undoable edits — not tool, page, or selection.
    return JSON.stringify({
      geometries: state.geometries,
      classifications: state.classifications,
      scales: state.scales,
    });
  }

  async function persistStudio(
    nextStudio: StudioState,
    extras: Partial<TakeoffProject> = {},
    options?: { skipHistory?: boolean; immediate?: boolean },
  ) {
    if (!selected) return null;
    const markupChanged = studioMarkupKey(studio) !== studioMarkupKey(nextStudio);
    if (!options?.skipHistory && markupChanged) {
      historyRef.current = [...historyRef.current.slice(-40), studio];
      futureRef.current = [];
      setHistoryTick((value) => value + 1);
    }
    const optimistic: TakeoffProject = {
      ...selected,
      ...extras,
      studio: nextStudio,
      updatedAt: new Date().toISOString(),
    };
    upsert(optimistic);
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    const write = async () => {
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: nextStudio, ...extras }),
      });
      if (!response.ok) {
        setSaveState("error");
        setError("Could not save studio takeoff");
        return null;
      }
      const project = (await response.json()) as TakeoffProject;
      const merged = { ...project, studio: project.studio ?? nextStudio };
      upsert(merged);
      setSaveState("saved");
      return merged;
    };

    if (options?.immediate) {
      return write();
    }
    saveTimer.current = window.setTimeout(() => {
      void write();
    }, 450);
    return optimistic;
  }

  function undoStudio() {
    if (!selected || !historyRef.current.length) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, studio];
    setHistoryTick((value) => value + 1);
    // Restore last markup only — keep current tool/page/doc so Undo is not browser-Back.
    void persistStudio({
      ...studio,
      geometries: previous.geometries,
      classifications: previous.classifications,
      scales: previous.scales,
      updatedAt: new Date().toISOString(),
    }, {}, { skipHistory: true });
  }

  function redoStudio() {
    if (!selected || !futureRef.current.length) return;
    const next = futureRef.current[futureRef.current.length - 1];
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, studio];
    setHistoryTick((value) => value + 1);
    void persistStudio({
      ...studio,
      geometries: next.geometries,
      classifications: next.classifications,
      scales: next.scales,
      updatedAt: new Date().toISOString(),
    }, {}, { skipHistory: true });
  }

  // Keep active drawing set when documents exist.
  useEffect(() => {
    if (!selected || !drawingDocs.length) return;
    if (studio.activeDocumentId && drawingDocs.some((doc) => doc.id === studio.activeDocumentId)) return;
    const first = drawingDocs[0];
    if (!first) return;
    void persistStudio({ ...studio, activeDocumentId: first.id, activePage: 1 }, {}, { skipHistory: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, drawingDocs.map((d) => d.id).join("|")]);

  async function createProject() {
    setBusy("create");
    try {
      const response = await apiFetch("/api/takeoff-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName || "NeXa takeoff",
          customer: "",
          site: "",
          description: `${brand.takeoffsAppName} Studio`,
          studio: createDefaultStudioState(),
        }),
      });
      if (!response.ok) throw new Error("Unable to create project");
      const project = (await response.json()) as TakeoffProject;
      upsert({ ...project, studio: project.studio ?? createDefaultStudioState() });
      setDraftName("");
      show(`Created ${project.reference}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject(projectId: string, reference: string) {
    const ok = window.confirm(
      `Delete takeoff ${reference}? Drawings and mark-up for this project will be removed. This cannot be undone.`,
    );
    if (!ok) return;
    setBusy(`delete-${projectId}`);
    try {
      const response = await apiFetch(`/api/takeoff-projects/${projectId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete project");
      setProjects((current) => current.filter((row) => row.id !== projectId));
      if (selectedId === projectId) {
        setSelectedId(null);
        setBoqOpen(false);
      }
      show(`Deleted ${reference}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  function addCustomLayer() {
    const next = addCustomStudioLayer(studio, newLayerName);
    if (next === studio) {
      setError(newLayerName.trim() ? "That layer already exists." : "Enter a layer name first.");
      return;
    }
    setNewLayerName("");
    void persistStudio(next);
    show(`Added layer “${newLayerName.trim()}”`);
  }

  async function uploadDrawingFiles(files: File[]) {
    if (!selected || !files.length) return;
    setBusy("upload");
    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      body.append("kind", "Drawing");
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/documents`, {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error("Upload failed");
      const payload = (await response.json()) as { project: TakeoffProject };
      const project = payload.project;
      const docs = project.documents || [];
      const first = docs[docs.length - 1];
      const nextStudio: StudioState = {
        ...(project.studio ?? studio),
        activeDocumentId: first?.id || studio.activeDocumentId,
        activePage: 1,
        updatedAt: new Date().toISOString(),
      };
      upsert({ ...project, studio: nextStudio });
      await apiFetch(`/api/takeoff-projects/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: nextStudio }),
      });
      show(`Uploaded ${files.length} drawing(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function uploadDrawings(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadDrawingFiles(files);
  }

  function addClassification() {
    const name = newClassName.trim() || (newClassKind === "area" ? "Area" : newClassKind === "linear" ? "Linear" : "Count");
    const colour = /^#?[0-9a-fA-F]{6}$/.test(newClassColour.trim())
      ? (newClassColour.startsWith("#") ? newClassColour : `#${newClassColour}`)
      : nextClassificationColour(studio.classifications);
    const cls: StudioClassification = {
      id: studioId("cls"),
      kind: newClassKind,
      name,
      colour,
      unit: newClassKind === "area" ? "m2" : newClassKind === "linear" ? "m" : "nr",
      layer: activeLayerId === "all" ? "general" : activeLayerId,
    };
    void persistStudio({
      ...studio,
      classifications: [...studio.classifications, cls],
      activeClassificationId: cls.id,
      tool: newClassKind,
    });
    setNewClassName("");
  }

  function deleteClassification(id: string) {
    const remaining = studio.classifications.filter((cls) => cls.id !== id);
    const activeClassificationId =
      studio.activeClassificationId === id
        ? remaining[0]?.id
        : studio.activeClassificationId;
    void persistStudio({
      ...studio,
      classifications: remaining,
      geometries: studio.geometries.filter((geo) => geo.classificationId !== id),
      activeClassificationId,
      tool: remaining.find((cls) => cls.id === activeClassificationId)?.kind || "select",
    });
  }

  async function runAiAssist() {
    const doc = activeDoc || drawingDocs[0] || null;
    if (!selected) {
      setError("Create or select a project first.");
      return;
    }
    if (!doc) {
      setError("Upload a PDF drawing first, then tap Ask Blake.");
      return;
    }
    setBusy("ai");
    setError(null);
    setNotice(null);
    const steps = [
      "Blake is analysing your drawings…",
      "Building a measurement plan…",
      "Reading PDF text tags and coloured CAD pipe lines…",
      "Placing fixture pins from tags on the sheet…",
    ];
    let stepIndex = 0;
    setBlakeStep(steps[0] || "Blake is working…");
    const stepTimer = window.setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      setBlakeStep(steps[stepIndex] || "Blake is working…");
    }, 2200);
    try {
      // Flush scale / mark-up before Blake — otherwise the server may miss Set scale and wipe it on return.
      await persistStudio(studio, {}, { immediate: true, skipHistory: true });

      setBlakeStep("Reading text from the open PDF…");
      const clientExtracts = [];
      // Keep memory light on live: active drawing first, then at most one sibling.
      const drawingsForBlake = [
        doc,
        ...drawingDocs.filter((drawing) => drawing.id !== doc.id),
      ].slice(0, 2);
      for (const drawing of drawingsForBlake) {
        try {
          const extracted = await extractTakeoffPdfInBrowser(selected.id, drawing.id, drawing.fileName);
          clientExtracts.push({
            documentId: drawing.id,
            fileName: drawing.fileName,
            pages: extracted.pages,
          });
        } catch (extractError) {
          // Keep going for other drawings; server may still recover.
          if (drawing.id === doc.id && clientExtracts.length === 0) {
            const message = extractError instanceof Error ? extractError.message : "Unable to read PDF text.";
            // Hard stop only when the active drawing itself cannot be opened in the browser.
            if (/missing from storage|empty|Unable to open drawing/i.test(message)) {
              throw extractError;
            }
          }
        }
      }

      setBlakeStep("Looking for coloured CAD pipe lines in the PDF (not your Length marks)…");
      const clientStrokeRuns = [];
      for (const drawing of drawingsForBlake.slice(0, 1)) {
        try {
          const strokes = await extractTakeoffPdfStrokesInBrowser(
            selected.id,
            drawing.id,
            drawing.fileName,
            { maxPages: 3 },
          );
          clientStrokeRuns.push({
            documentId: strokes.documentId,
            fileName: strokes.fileName,
            runs: strokes.runs,
            colouredStrokeCount: strokes.colouredStrokeCount,
          });
        } catch {
          // Server may still extract strokes if client path fails.
        }
      }

      // Scanned sheets: send page screenshot(s) so Blake can use vision when text/vectors are empty.
      const pageImages: Array<{
        documentId: string;
        fileName: string;
        pageNumber: number;
        dataUrl: string;
        width: number;
        height: number;
      }> = [];
      const textItems = clientExtracts.reduce(
        (sum, extract) => sum + extract.pages.reduce((pageSum, page) => pageSum + (page.textItems?.length || 0), 0),
        0,
      );
      const strokeRuns = clientStrokeRuns.reduce((sum, row) => sum + (row.runs?.length || 0), 0);
      if (textItems < 8 && strokeRuns === 0) {
        setBlakeStep("Sheet looks scanned — Blake is looking at the open page…");
        const pagesToSnap = [studio.activePage || 1];
        if ((studio.activePage || 1) === 1) pagesToSnap.push(2);
        for (const pageNumber of pagesToSnap.slice(0, 2)) {
          try {
            const snap = await renderTakeoffPdfPageDataUrl(selected.id, doc.id, pageNumber, 1200);
            if (!snap?.dataUrl) continue;
            pageImages.push({
              documentId: doc.id,
              fileName: doc.fileName,
              pageNumber,
              dataUrl: snap.dataUrl,
              width: snap.width,
              height: snap.height,
            });
          } catch {
            // Vision is optional.
          }
        }
      }

      setBlakeStep("Blake is analysing your drawings…");
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/blake-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientExtracts,
          clientStrokeRuns,
          pageImages,
          clientScales: studio.scales,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        measured?: StudioAiReviewMeasuredQuantity[];
        pinCount?: number;
        pipeRunCount?: number;
        visionUsed?: boolean;
        visionPipeRuns?: number;
        actor?: string;
        project?: TakeoffProject;
        coverage?: {
          drawingCount: number;
          scannedCount: number;
          scannedNames?: string[];
          capped?: boolean;
          note?: string;
        };
        focus?: { documentId: string; page: number; classificationId: string } | null;
      };
      if (!response.ok || !payload.ok || !payload.project) {
        throw new Error(payload.error || `Blake failed (${response.status}).`);
      }
      let nextStudio = payload.project.studio ?? createDefaultStudioState();
      // Never let Blake wipe a user Set scale — merge + propagate to sibling pages with mark-up.
      nextStudio = {
        ...nextStudio,
        scales: mergeStudioScales(studio.scales, nextStudio.scales || []),
      };
      nextStudio = fillMissingPageScalesFromDocument(nextStudio);
      if (payload.focus) {
        nextStudio.activeDocumentId = payload.focus.documentId;
        nextStudio.activePage = payload.focus.page;
        nextStudio.activeClassificationId = payload.focus.classificationId;
        nextStudio.tool = "select";
      }
      await persistStudio(nextStudio, {}, { immediate: true, skipHistory: true });
      const actorLabel = payload.actor && payload.actor !== "Blake" ? ` · ${payload.actor}` : "";
      const coverage = payload.coverage;
      const coverageNote = coverage?.note
        || (coverage
          ? ` Scanned ${coverage.scannedCount} of ${coverage.drawingCount} drawing file(s). BOQ totals are for the whole project.`
          : "");
      const message = `${payload.message || "Blake finished."}${actorLabel}${
        payload.message && coverage?.note && payload.message.includes(coverage.note) ? "" : coverageNote
      }`;
      const pinCount = payload.pinCount || 0;
      const pipeRunCount = payload.pipeRunCount || 0;
      const found = pinCount + pipeRunCount;
      setBlakeStep(
        found
          ? `Done — ${pinCount} fixture pin(s) · ${pipeRunCount} CAD pipe line(s)${
              payload.visionUsed ? " · vision" : ""
            }${
              coverage
                ? ` · ${coverage.scannedCount}/${coverage.drawingCount} drawing${coverage.drawingCount === 1 ? "" : "s"}`
                : ""
            }.`
          : coverage
            ? `Done — nothing auto-measured on ${coverage.scannedCount}/${coverage.drawingCount} drawing(s) scanned.`
            : "Done — nothing Blake could auto-measure yet.",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      setError(null);
      if (pinCount > 0) {
        setReviewOpen(true);
        show(message, 14000);
      } else if (pipeRunCount > 0) {
        setReviewOpen(false);
        setBoqOpen(true);
        show(message, 16000);
      } else {
        show(message, 16000);
        setBoqOpen(true);
      }
      void refreshTakeoffAudit(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blake could not finish. Keep the sheet open and try again, or Length the run.");
    } finally {
      window.clearInterval(stepTimer);
      setBusy(null);
      setBlakeStep(null);
    }
  }

  function plantClassIdForPropose(kind: BlakePlantKind) {
    return kind === "ashp" ? "cls-ai-P-ASHP" : "cls-ai-P-BOILER";
  }

  function placeProposePlant() {
    if (!selected || !activeDoc) {
      setError("Upload a drawing first, then tap where the plant goes.");
      return;
    }
    const classId = plantClassIdForPropose(proposePlant);
    void persistStudio({
      ...studio,
      activeDocumentId: activeDoc.id,
      activeLayerId: "heating",
      activeClassificationId: classId,
      tool: "count",
    });
    setProposeOpen(true);
    show(
      `Count tool on — tap the ${proposePlant === "ashp" ? "ASHP" : "boiler"} position on the sheet, then Propose routes.`,
      12000,
    );
  }

  async function runBlakePropose() {
    if (!selected || !activeDoc) {
      setError("Upload a drawing first.");
      return;
    }
    setBusy("propose");
    setError(null);
    setBlakeStep("Blake is proposing plant, routes and equipment…");
    try {
      const classId = plantClassIdForPropose(proposePlant);
      const existingPlant = [...studio.geometries]
        .reverse()
        .find(
          (geo) =>
            geo.kind === "count"
            && geo.classificationId === classId
            && geo.documentId === activeDoc.id
            && geo.page === (studio.activePage || 1),
        );
      const plantPoint = existingPlant && existingPlant.kind === "count" ? existingPlant.point : undefined;
      const includeCylinder = proposePlant === "ashp" ? true : proposeCylinder;
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/blake-propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantKind: proposePlant,
          emitterMode: proposeEmitters,
          includeCylinder,
          documentId: activeDoc.id,
          page: studio.activePage || 1,
          pageWidth: 1200,
          pageHeight: 850,
          plantPoint,
          pipeSpecId: studio.activePipeSpecId,
          actor: authName || "Office",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        summary?: string;
        questions?: string[];
        project?: TakeoffProject;
        actor?: string;
        aiUsed?: boolean;
        connected?: boolean;
      };
      if (!response.ok || !payload.ok || !payload.project) {
        throw new Error(payload.error || `Propose failed (${response.status}).`);
      }
      upsert({
        ...payload.project,
        studio: payload.project.studio ?? createDefaultStudioState(),
      });
      setSaveState("saved");
      setProposeQuestions(payload.questions || []);
      setProposeOpen(true);
      setBoqOpen(true);
      setReviewOpen(false);
      const aiTag = payload.aiUsed
        ? " · live AI"
        : payload.connected
          ? " · rule stubs (AI miss)"
          : " · rule stubs (OpenAI off)";
      show(
        `${payload.summary || "Blake proposed a layout."}${aiTag}${
          payload.actor && payload.actor !== "Blake" ? ` · ${payload.actor}` : ""
        }`,
        16000,
      );
      void refreshTakeoffAudit(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blake could not propose routes.");
    } finally {
      setBusy(null);
      setBlakeStep(null);
    }
  }

  async function confirmAiReview(reviewed: StudioAiReviewMeasuredQuantity[]) {
    if (!selected) return;
    setBusy("ai-review");
    setError(null);
    try {
      const stamp = new Date().toISOString();
      const baseStudio: StudioState = {
        ...studio,
        aiReviewStatus: "confirmed",
        aiReviewMeasured: reviewed,
        aiReviewUpdatedAt: stamp,
      };
      const nextStudio = importSkillCountsIntoStudio(baseStudio, reviewed, {
        replaceExistingAi: true,
        aiReviewStatus: "confirmed",
      });
      nextStudio.aiReviewStatus = "confirmed";
      nextStudio.aiReviewMeasured = reviewed;
      nextStudio.aiReviewUpdatedAt = stamp;
      nextStudio.updatedAt = stamp;
      await persistStudio(nextStudio, {}, { immediate: true, skipHistory: true });
      recordTakeoffLearningClient({
        type: "ai_confirm",
        projectId: selected.id,
        codes: reviewed.map((row) => row.code).filter(Boolean),
        pipeSpecId: studio.activePipeSpecId,
        trade: "plumbing",
        actor: authName || "Office",
      });
      setReviewOpen(false);
      const activePins = reviewed.reduce(
        (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
        0,
      );
      show(`AI counts confirmed — ${activePins} pin(s) ready for Core · ${authName || "Office"}.`);
      void refreshTakeoffAudit(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm AI counts.");
    } finally {
      setBusy(null);
    }
  }

  async function rejectAiReview() {
    if (!selected) return;
    const ok = window.confirm(
      "Reject Blake’s fixture pins? Pipe runs on the sheet stay in the BOQ — only count pins are removed.",
    );
    if (!ok) return;
    setBusy("ai-review");
    setError(null);
    try {
      const stamp = new Date().toISOString();
      const rejectedRows = aiReviewRows.map((row) => ({
        ...row,
        quantity: 0,
        tagMatches: (row.tagMatches || []).map((match) => ({ ...match, excluded: true })),
        notes: "Rejected during human AI count review",
      }));
      // Keep Blake/vision pipe runs, fittings, and propose-* plant pins; only strip measured AI count pins.
      const remainingGeometries = studio.geometries.filter((geo) => {
        if (geo.kind !== "count" || geo.autoGenerated) return true;
        if (!isAiStudioGeometry(geo)) return true;
        if (geo.id.startsWith("ai-propose-")) return true;
        return false;
      });
      const usedClassifications = new Set(remainingGeometries.map((geo) => geo.classificationId));
      const nextStudio: StudioState = {
        ...studio,
        geometries: remainingGeometries,
        classifications: studio.classifications.filter((cls) => !cls.id.startsWith("cls-ai-") || usedClassifications.has(cls.id)),
        aiReviewStatus: "rejected",
        aiReviewMeasured: rejectedRows,
        aiReviewUpdatedAt: stamp,
        tool: "select",
        updatedAt: stamp,
      };
      await persistStudio(nextStudio, {}, { immediate: true, skipHistory: true });
      recordTakeoffLearningClient({
        type: "ai_reject",
        projectId: selected.id,
        codes: aiReviewRows.map((row) => row.code).filter(Boolean),
        trade: "plumbing",
        actor: authName || "Office",
      });
      setReviewOpen(false);
      show(`Fixture pins rejected — Blake pipe runs stay on the sheet/BOQ · ${authName || "Office"}.`);
      void refreshTakeoffAudit(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject AI counts.");
    } finally {
      setBusy(null);
    }
  }

  async function saveStudioLayerDrawing(
    layerId: StudioExportLayerId,
    options: { quiet?: boolean } = {},
  ): Promise<{ saved: boolean; attached: boolean; empty: boolean }> {
    if (!selected || !activeDoc) {
      if (!options.quiet) setError("Open a drawing before saving a marked layer.");
      return { saved: false, attached: false, empty: true };
    }
    const background = await renderTakeoffPdfPageDataUrl(
      selected.id,
      activeDoc.id,
      studio.activePage || 1,
      1400,
    );
    const width = background?.width || 1200;
    const height = background?.height || 850;
    const snapshot = buildStudioMarkedSnapshot(studio, layerId, {
      documentId: activeDoc.id,
      page: studio.activePage || 1,
      width,
      height,
    });
    if (!snapshot.geometries.length) {
      if (!options.quiet) setError(`Nothing on ${studioLayerLabel(layerId)} to save yet.`);
      return { saved: false, attached: false, empty: true };
    }

    const svg = buildStudioMarkedDrawingSvg(studio, snapshot, {
      projectReference: selected.reference,
      drawingFileName: activeDoc.fileName,
      backgroundDataUrl: background?.dataUrl,
    });
    const fileName = markedDrawingFileName(
      selected.reference,
      activeDoc.fileName,
      snapshot.layerLabel,
      snapshot.page,
    );
    const body = new FormData();
    body.append("kind", "Marked-up drawing");
    body.append("files", new Blob([svg], { type: "image/svg+xml" }), fileName);
    const upload = await apiFetch(`/api/takeoff-projects/${selected.id}/documents`, {
      method: "POST",
      body,
    });
    if (!upload.ok) {
      if (!options.quiet) setError("Could not store the marked layer drawing.");
      return { saved: false, attached: false, empty: false };
    }
    const payload = (await upload.json()) as { project?: TakeoffProject; documents?: TakeoffDocument[] };
    if (payload.project) upsert({ ...payload.project, studio: payload.project.studio ?? studio });
    const documentId = payload.documents?.[0]?.id;
    if (!documentId) {
      if (!options.quiet) setError("Marked drawing saved but document id was missing.");
      return { saved: true, attached: false, empty: false };
    }

    if (!selected.linkedQuoteId && !payload.project?.linkedQuoteId) {
      if (!options.quiet) {
        show(`${studioLayerLabel(layerId)} saved on the takeoff. Link a quote to put it in Core Documents.`);
      }
      return { saved: true, attached: false, empty: false };
    }

    const attach = await apiFetch(`/api/takeoff-projects/${selected.id}/marked-drawing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, actor: authName || "NeXa Takeoff" }),
    });
    if (!attach.ok) {
      if (!options.quiet) {
        show(`${studioLayerLabel(layerId)} saved on the takeoff. Quote document attach needs a linked quote.`);
      }
      return { saved: true, attached: false, empty: false };
    }
    if (!options.quiet) {
      show(`${studioLayerLabel(layerId)} saved into quote Documents. It will show on the job after conversion.`);
    }
    return { saved: true, attached: true, empty: false };
  }

  async function saveAllStudioLayerDrawings(options: { quiet?: boolean } = {}) {
    if (!selected || !activeDoc) {
      if (!options.quiet) setError("Open a drawing before saving layers.");
      return { saved: 0, attached: 0 };
    }
    const layerIds = layersWithStudioMarks(studio, {
      documentId: activeDoc.id,
      page: studio.activePage || 1,
    });
    if (!layerIds.length) {
      if (!options.quiet) setError("Mark the drawing before saving layer drawings.");
      return { saved: 0, attached: 0 };
    }
    let saved = 0;
    let attached = 0;
    for (const layerId of layerIds) {
      const result = await saveStudioLayerDrawing(layerId, { quiet: true });
      if (result.saved) saved += 1;
      if (result.attached) attached += 1;
    }
    if (!options.quiet) {
      show(
        `Saved ${saved} marked drawing${saved === 1 ? "" : "s"} (master + layers). ${
          attached
            ? `${attached} attached to quote Documents — they stay with the job after conversion.`
            : "Link a Core quote to attach them to Documents."
        }`,
        12000,
      );
    }
    return { saved, attached };
  }

  async function saveRateLibrary(next: TakeoffRateLibrary) {
    setRatesBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/takeoff-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: next.rates, assemblies: next.assemblies }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; library?: TakeoffRateLibrary; error?: string };
      if (!response.ok || !body.library) throw new Error(body.error || "Could not save rates");
      setRateLibrary(body.library);
      show("Rate library saved — Push will use these £ rates and assembly kits.", 8000);
      void refreshTakeoffAudit(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save rates");
    } finally {
      setRatesBusy(false);
    }
  }

  function patchRateCost(id: string, unitCost: number) {
    if (!rateLibrary) return;
    const rates: TakeoffRateEntry[] = rateLibrary.rates.map((row) =>
      row.id === id ? { ...row, unitCost: Number.isFinite(unitCost) ? unitCost : 0 } : row,
    );
    setRateLibrary({ ...rateLibrary, rates });
  }

  function patchAssemblyEnabled(id: string, enabled: boolean) {
    if (!rateLibrary) return;
    const assemblies: TakeoffAssemblyKit[] = rateLibrary.assemblies.map((row) =>
      row.id === id ? { ...row, enabled } : row,
    );
    setRateLibrary({ ...rateLibrary, assemblies });
  }

  async function pushToCore(options: { allowPendingAiReview?: boolean; createNew?: boolean } = {}) {
    if (!selected) return;
    const createNew = Boolean(options.createNew) || !selected.linkedQuoteId;
    if (!selected.linkedQuoteId && !options.createNew) {
      const makeNew = window.confirm(
        "No Core quote linked yet. Create a new quote from this takeoff BOQ?",
      );
      if (!makeNew) {
        setRailCollapsed(false);
        show("Link a quote under Core link, or tap New quote.", 10000);
        return;
      }
    }
    if (hasPendingAiReview && !options.allowPendingAiReview) {
      const ok = window.confirm(
        "Blake fixture pins are still pending review. Push the BOQ to Core anyway?",
      );
      if (!ok) {
        setReviewOpen(true);
        show("Confirm or reject Blake’s fixture pins, then Push — or override from Push again.", 12000);
        return;
      }
      await pushToCore({ allowPendingAiReview: true, createNew });
      return;
    }
    if (unscaledLinearCount > 0) {
      const detail = unscaledLinearSummary;
      const where = detail.pageLabels.length ? ` on ${detail.pageLabels.join(", ")}` : "";
      const ok = window.confirm(
        `${detail.count} length run(s) still need Set scale${where} before they become metres. Push scaled BOQ only?`,
      );
      if (!ok) {
        show("Set scale on those pages (or re-set on the open page — it copies across the drawing), then Push again.", 12000);
        void persistStudio({ ...studio, tool: "scale" });
        return;
      }
    }
    setBusy("push");
    setError(null);
    try {
      const baseMaterials = studioQuantitiesToMaterialAllowances(studio, selected.id);
      const pipeMaterials = summariseStudioPipeBoq(studio).map((row) => ({
        id: `studio-mat-${selected.id}-${row.id}`,
        section: row.section,
        description: `Takeoff · ${row.description}`,
        quantity: row.quantity,
        unit: row.unit,
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: false,
      }));
      const materials = priceAndExpandTakeoffMaterials([...pipeMaterials, ...baseMaterials]);
      const priced = summarisePricedMaterials(materials);
      const patch = await apiFetch(`/api/takeoff-projects/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studio,
          materialAllowances: [
            ...selected.materialAllowances.filter((line) => !line.id.startsWith("studio-mat-")),
            ...materials,
          ],
          status: "Approved",
        }),
      });
      if (!patch.ok) throw new Error("Could not prepare BOQ");
      const push = await apiFetch(`/api/takeoff-projects/${selected.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: createNew ? undefined : selected.linkedQuoteId,
          createNew,
          actor: authName || "Office",
          allowPendingAiReview: Boolean(options.allowPendingAiReview),
        }),
      });
      if (!push.ok) {
        const body = (await push.json().catch(() => ({}))) as { error?: string; code?: string };
        if (body.code === "AI_REVIEW_PENDING") {
          setReviewOpen(true);
        }
        throw new Error(body.error || "Push failed");
      }
      const result = (await push.json()) as { project: TakeoffProject; quote: { id: string; ref: string }; created?: boolean };
      upsert(result.project);
      const drawings = await saveAllStudioLayerDrawings({ quiet: true });
      show(
        `${result.created ? "Created" : "Updated"} quote ${result.quote.ref} with takeoff BOQ`
        + (priced.pricedLines
          ? ` · ${priced.pricedLines} priced line(s) ≈ £${priced.materialCost.toFixed(0)} mat.`
          : "")
        + (drawings.attached
          ? ` · ${drawings.attached} layer drawing(s) in quote Documents (carry to job on convert).`
          : drawings.saved
            ? ` · ${drawings.saved} layer drawing(s) saved on takeoff.`
            : ""),
        14000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setBusy(null);
    }
  }

  const hasScale = Boolean(
    activeDoc && studio.scales.some((row) => row.documentId === activeDoc.id && row.page === (studio.activePage || 1)),
  );
  const hasMarks = studio.geometries.length > 0;
  const flowStep: "upload" | "scale" | "blake" | "review" | "mark" | "boq" | "push" = boqOpen
    ? "boq"
    : !drawingDocs.length
    ? "upload"
    : hasPendingAiReview
      ? "review"
      : !hasScale
      ? "scale"
      : !hasMarks
        ? "blake"
        : selected?.linkedQuoteId
          ? "push"
          : "mark";

  function runFlowAction(step: typeof flowStep) {
    if (!selected && step !== "upload") {
      setError("Create or select a project first.");
      return;
    }
    if (step === "upload") {
      if (!selected) {
        setError("Create a project first, then upload a PDF.");
        return;
      }
      setBoqOpen(false);
      fileRef.current?.click();
      return;
    }
    if (step === "boq") {
      setReviewOpen(false);
      setBoqOpen(true);
      return;
    }
    if (step === "scale") {
      setBoqOpen(false);
      if (!activeDoc) {
        setError("Upload a drawing first.");
        return;
      }
      void persistStudio({ ...studio, tool: "scale" });
      return;
    }
    if (step === "blake") {
      setBoqOpen(false);
      void runAiAssist();
      return;
    }
    if (step === "review") {
      setBoqOpen(false);
      if (hasAiReviewRows) {
        setReviewOpen(true);
        return;
      }
      if (hasBlakePipesOnSheet) {
        setBoqOpen(true);
        show("Pipe runs are already on the sheet — check the BOQ.", 10000);
        return;
      }
      setError("Ask Blake first to place pins to review.");
      return;
    }
    if (step === "mark") {
      setBoqOpen(false);
      void persistStudio({
        ...studio,
        tool: activeClass?.kind === "area" || activeClass?.kind === "linear" || activeClass?.kind === "count"
          ? activeClass.kind
          : "count",
      });
      return;
    }
    if (step === "push") {
      void pushToCore();
    }
  }

  if (authState === "checking") {
    return (
      <div className="nexa-studio-gate">
        <Loader2 className="spin" size={22} />
        Opening {brand.takeoffsAppName}…
      </div>
    );
  }

  if (authState === "signed-out") {
    return (
      <div className="nexa-studio-gate">
        <h1>Sign in to {brand.takeoffsAppName}</h1>
        <p>Use your Core login. This studio is linked to {brand.tradingName || brand.companyName} quotes and jobs.</p>
        <a className="nexa-studio-primary" href="/login?next=/takeoff">Sign in</a>
      </div>
    );
  }

  return (
    <div className="nexa-studio">
      <header className="nexa-studio-top">
        <div className="nexa-studio-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveBrandLogoUrl(brand, "takeoffs")} alt={brand.companyName || "Errol Watson Group"} />
          <div>
            <strong>{brand.takeoffsAppName}</strong>
            <span>Blake · {brand.tradingName || brand.companyName}</span>
          </div>
        </div>
        <nav className="nexa-studio-flow" aria-label="Takeoff steps">
          {(
            [
              ["upload", "Upload"],
              ["scale", "Scale"],
              ["blake", "Blake"],
              ["review", "Review"],
              ["mark", "Mark"],
              ["boq", "BOQ"],
              ["push", "Push"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={flowStep === id ? "on" : undefined}
              disabled={(id === "blake" && busy === "ai") || (id === "review" && !hasAiCounts && !hasBlakePipesOnSheet)}
              onClick={() => runFlowAction(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="nexa-studio-top-actions">
          <Link href="/" className="nexa-studio-core-pill">Core</Link>
          <span className={`pill save-${saveState}`}>
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}
          </span>
          {authName ? <span className="pill muted-pill">{authName}</span> : null}
          <button type="button" className="nexa-studio-ai" disabled={busy === "ai" || !selected} onClick={() => void runAiAssist()}>
            {busy === "ai" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            Ask Blake
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void uploadDrawings(e)} />
        </div>
      </header>

      {blakeStep ? (
        <div className="nexa-studio-blake-overlay" role="status" aria-live="polite">
          <div className="nexa-studio-blake-card">
            <Sparkles size={22} />
            <strong>Blake is working</strong>
            <p>{blakeStep}</p>
            <Loader2 className="spin" size={20} />
          </div>
        </div>
      ) : null}

      {(notice || error) ? (
        <div className={`nexa-studio-banner ${error ? "error" : "ok"}`}>{error || notice}</div>
      ) : null}

      {selected && activeDoc && !studio.scales.some((row) => row.documentId === activeDoc.id && row.page === (studio.activePage || 1)) ? (
        <div className="nexa-studio-banner warn">
          Set scale before measuring lengths or areas — use a <strong>1:N</strong> chip if Blake finds one on the sheet, or tap <strong>Scale</strong>, two points, enter metres.
        </div>
      ) : null}

      {selected && hasPendingAiReview ? (
        <div className="nexa-studio-banner warn nexa-studio-ai-review-banner">
          <span>
            Blake placed {aiReviewPinCount || blakePinCount} fixture pin{(aiReviewPinCount || blakePinCount) === 1 ? "" : "s"} to confirm before Core push.
            {blakePipeRunCount > 0 ? ` ${blakePipeRunCount} pipe run(s) are already in the BOQ.` : ""}
          </span>
          <button type="button" onClick={() => setReviewOpen(true)}>Review fixture pins</button>
        </div>
      ) : null}

      {selected && !hasPendingAiReview && hasBlakePipesOnSheet ? (
        <div className="nexa-studio-banner ok nexa-studio-ai-review-banner">
          <span>
            Blake drew {blakePipeRunCount} pipe run{blakePipeRunCount === 1 ? "" : "s"} on the sheet — already in the BOQ. Use Edit to trim, then Push.
          </span>
          <button type="button" onClick={() => setBoqOpen(true)}>Open BOQ</button>
        </div>
      ) : null}

      <div className={`nexa-studio-body${railCollapsed ? " rail-collapsed" : ""}`}>
        <aside className={`nexa-studio-rail${railCollapsed ? " is-collapsed" : ""}`}>
          <button
            type="button"
            className="nexa-studio-rail-toggle"
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((value) => !value)}
          >
            <FolderOpen size={15} />
            <span>{railCollapsed ? "Projects & tools" : "Hide projects"}</span>
            <strong>{selected?.reference || "Projects"}</strong>
          </button>
          <div className="nexa-studio-rail-body">
          <section>
            <header>
              <FolderOpen size={15} />
              <h2>Projects</h2>
            </header>
            <div className="nexa-studio-create">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="New project name"
              />
              <button type="button" className="nexa-studio-primary" disabled={busy === "create"} onClick={() => void createProject()}>
                {busy === "create" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
                New
              </button>
            </div>
            <div className="nexa-studio-project-list">
              {projects.map((project) => (
                <div key={project.id} className={`nexa-studio-project-row${project.id === selectedId ? " on" : ""}`}>
                  <button
                    type="button"
                    className="nexa-studio-project-pick"
                    onClick={() => {
                      setSelectedId(project.id);
                      setBoqOpen(false);
                    }}
                  >
                    <strong>{project.reference}</strong>
                    <span>{project.name}</span>
                  </button>
                  <button
                    type="button"
                    className="nexa-studio-project-delete"
                    aria-label={`Delete ${project.reference}`}
                    title="Delete project"
                    disabled={busy === `delete-${project.id}`}
                    onClick={() => void deleteProject(project.id, project.reference)}
                  >
                    {busy === `delete-${project.id}` ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
            <p className="muted nexa-studio-hint">Projects stay until you delete them — finishing a takeoff does not remove them.</p>
          </section>

          {selected ? (
            <>
              <section className="nexa-studio-core-link">
                <header>
                  <h2>Link tender</h2>
                </header>
                <label>
                  Tender
                  <select
                    value={selected.sourceTenderId || ""}
                    onChange={(e) => {
                      const sourceTenderId = e.target.value || undefined;
                      void persistStudio(studio, { sourceTenderId });
                    }}
                  >
                    <option value="">Select Core tender</option>
                    {tenders.map((tender) => (
                      <option key={tender.id} value={tender.id}>
                        {tender.externalId ? `${tender.externalId} · ` : ""}
                        {tender.name} · {tender.client}
                      </option>
                    ))}
                  </select>
                </label>
                {linkedTender ? (
                  <a className="ghost link" href={`/?view=tenders`}>
                    Open tenders in Core
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <p className="muted">Optional — pick the opportunity this takeoff belongs to.</p>
                )}
              </section>

              <section className="nexa-studio-core-link">
                <header>
                  <h2>Link quote</h2>
                </header>
                <label>
                  Quote
                  <select
                    value={selected.linkedQuoteId || ""}
                    onChange={(e) => {
                      const linkedQuoteId = e.target.value || undefined;
                      void persistStudio(studio, { linkedQuoteId });
                    }}
                  >
                    <option value="">Select Core quote</option>
                    {quotes.map((quote) => (
                      <option key={quote.id} value={quote.id}>
                        {quote.ref} · {quote.customer}
                      </option>
                    ))}
                  </select>
                </label>
                {linkedQuote ? (
                  <a className="ghost link" href={`/?quote=${encodeURIComponent(linkedQuote.id)}`}>
                    Open {linkedQuote.ref} in Core
                    <ExternalLink size={13} />
                  </a>
                ) : null}
                <div className="nexa-studio-push-actions">
                  <button
                    type="button"
                    className="nexa-studio-primary"
                    disabled={busy === "push"}
                    onClick={() => void pushToCore()}
                  >
                    {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                    {selected.linkedQuoteId ? "Push BOQ + drawings" : "Push to new quote"}
                  </button>
                  {selected.linkedQuoteId ? (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy === "push"}
                      onClick={() => void pushToCore({ createNew: true })}
                    >
                      New quote instead
                    </button>
                  ) : null}
                </div>
              </section>

              {!boqOpen ? (
                <section>
                  <header>
                    <h2>Drawings</h2>
                  </header>
                  <FileDropZone
                    accept="application/pdf,.pdf"
                    multiple
                    disabled={busy === "upload" || !selected}
                    label={busy === "upload" ? "Uploading…" : "Drop PDF plans here or click"}
                    hint="PDF drawing sets"
                    onFiles={(files) => void uploadDrawingFiles(files)}
                    className="nexa-studio-drawing-drop"
                  />
                  <div className="nexa-studio-doc-list">
                    {drawingDocs.length ? drawingDocs.map((doc: TakeoffDocument) => (
                      <button
                        key={doc.id}
                        type="button"
                        className={doc.id === activeDoc?.id ? "on" : undefined}
                        onClick={() => void persistStudio({ ...studio, activeDocumentId: doc.id, activePage: 1 })}
                      >
                        {doc.fileName}
                      </button>
                    )) : <p className="muted">Upload a PDF plan set.</p>}
                  </div>
                </section>
              ) : null}

              <section>
                <header>
                  <h2>Layers</h2>
                </header>
                <div className="nexa-studio-layer-list" role="tablist" aria-label="Service layers">
                  {studioLayers.map((layer) => (
                    <div key={layer.id} className={`nexa-studio-layer-row${activeLayerId === layer.id ? " on" : ""}`}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeLayerId === layer.id}
                        className={activeLayerId === layer.id ? "on" : undefined}
                        onClick={() => void persistStudio(setStudioActiveLayer(studio, layer.id))}
                      >
                        {layer.label}
                      </button>
                      {layer.id !== "all" && (studio.customLayers || []).some((row) => row.id === layer.id) ? (
                        <button
                          type="button"
                          className="nexa-studio-layer-delete"
                          aria-label={`Remove ${layer.label}`}
                          title="Remove custom layer"
                          onClick={() => void persistStudio(removeCustomStudioLayer(studio, String(layer.id)))}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="nexa-studio-create class">
                  <input
                    value={newLayerName}
                    onChange={(e) => setNewLayerName(e.target.value)}
                    placeholder="New layer (e.g. Ventilation)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCustomLayer();
                    }}
                  />
                  <button type="button" className="ghost" onClick={addCustomLayer}>
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                {!boqOpen ? (
                  <div className="nexa-studio-layer-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy === "save-layer" || !activeDoc}
                      onClick={() => {
                        setBusy("save-layer");
                        void saveStudioLayerDrawing(activeLayerId)
                          .finally(() => setBusy(null));
                      }}
                    >
                      {busy === "save-layer" ? <Loader2 className="spin" size={14} /> : null}
                      Save this layer
                    </button>
                    <button
                      type="button"
                      className="nexa-studio-primary"
                      disabled={busy === "save-layers" || !activeDoc}
                      onClick={() => {
                        setBusy("save-layers");
                        void saveAllStudioLayerDrawings()
                          .finally(() => setBusy(null));
                      }}
                    >
                      {busy === "save-layers" ? <Loader2 className="spin" size={14} /> : null}
                      Save all layers to quote
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="nexa-studio-boq-rail">
                <header>
                  <h2>Bill of quantities</h2>
                </header>
                <button
                  type="button"
                  className={`nexa-studio-primary nexa-studio-boq-open${boqOpen ? " on" : ""}`}
                  onClick={() => {
                    setReviewOpen(false);
                    setBoqOpen(true);
                  }}
                >
                  Open full BOQ · {boqForPanel.length || 0} lines
                  {boqMaterialCost > 0 ? ` · £${boqMaterialCost.toFixed(0)}` : ""}
                </button>
                {unscaledLinearCount > 0 ? (
                  <p className="nexa-studio-boq-scale-warn">
                    {unscaledLinearCount} run{unscaledLinearCount === 1 ? "" : "s"} need Set scale
                    {unscaledLinearSummary.pageLabels.length
                      ? ` — ${unscaledLinearSummary.pageLabels.join(", ")}`
                      : ""}.
                  </p>
                ) : null}
              </section>

              {!boqOpen ? (
                <section>
                  <header>
                    <h2>Draw as</h2>
                  </header>
                  <div className="nexa-studio-class-list">
                    {visibleClassifications.map((cls) => {
                      const qty = quantities.find((row) => row.classificationId === cls.id);
                      return (
                        <div
                          key={cls.id}
                          className={`nexa-studio-class-row${cls.id === studio.activeClassificationId ? " on" : ""}`}
                        >
                          <label className="nexa-studio-class-colour" title="Pipe / mark colour">
                            <span style={{ background: cls.colour }} />
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(cls.colour) ? cls.colour : "#2878c8"}
                              aria-label={`Colour for ${cls.name}`}
                              onChange={(e) => {
                                void persistStudio(setClassificationColour(studio, cls.id, e.target.value));
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="nexa-studio-class-pick"
                            onClick={() => void persistStudio({
                              ...studio,
                              activeClassificationId: cls.id,
                              tool: cls.kind,
                              activeLayerId: classificationLayer(cls),
                            })}
                          >
                            <span>
                              <strong>{cls.name}</strong>
                              <small>{cls.kind} · {qty?.pieces || 0} item{(qty?.pieces || 0) === 1 ? "" : "s"}</small>
                            </span>
                            <em>
                              {qty && qty.quantity > 0 ? `${qty.quantity} ${qty.unit}` : "—"}
                            </em>
                          </button>
                          <button
                            type="button"
                            className="nexa-studio-class-delete"
                            aria-label={`Delete ${cls.name}`}
                            title="Delete classification"
                            onClick={() => deleteClassification(cls.id)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="nexa-studio-create class">
                    <select value={newClassKind} onChange={(e) => setNewClassKind(e.target.value as StudioClassKind)}>
                      <option value="linear">Linear</option>
                      <option value="count">Count</option>
                      <option value="area">Area</option>
                    </select>
                    <input
                      type="color"
                      value={newClassColour}
                      onChange={(e) => setNewClassColour(e.target.value)}
                      aria-label="New classification colour"
                      title="Colour"
                    />
                    <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="Name" />
                    <button type="button" className="ghost" onClick={addClassification}>Add</button>
                  </div>
                  <p className="muted nexa-studio-hint">
                    Pick Hot / Cold / Waste here, then draw on the sheet. Colour swatches can be changed any time.
                  </p>
                </section>
              ) : null}

              <section className="nexa-studio-rates-rail">
                <header>
                  <h2>Rates &amp; assemblies</h2>
                  <button type="button" className="ghost" onClick={() => setRatesOpen((open) => !open)}>
                    {ratesOpen ? "Hide" : "Edit"}
                  </button>
                </header>
                <p className="muted nexa-studio-hint">
                  Edit £ rates for pipe/fittings/fixtures. Assembly kits (WC / WHB / rad) add ancillaries on Push.
                </p>
                {ratesOpen && rateLibrary ? (
                  <div className="nexa-studio-rates-editor">
                    <strong className="nexa-studio-rates-heading">Unit rates</strong>
                    <ul className="nexa-studio-rates-list">
                      {rateLibrary.rates.map((row) => (
                        <li key={row.id}>
                          <span>
                            {row.label}
                            <small>{row.unit}</small>
                          </span>
                          <label>
                            £
                            <input
                              inputMode="decimal"
                              value={String(row.unitCost)}
                              onChange={(e) => patchRateCost(row.id, Number(e.target.value))}
                              aria-label={`${row.label} unit cost`}
                            />
                          </label>
                        </li>
                      ))}
                    </ul>
                    <strong className="nexa-studio-rates-heading">Assemblies on Push</strong>
                    <ul className="nexa-studio-assembly-list">
                      {rateLibrary.assemblies.map((kit) => (
                        <li key={kit.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={kit.enabled}
                              onChange={(e) => patchAssemblyEnabled(kit.id, e.target.checked)}
                            />
                            <span>
                              {kit.label}
                              <small>{kit.lines.length} ancillaries</small>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="nexa-studio-rates-actions">
                      <button
                        type="button"
                        className="nexa-studio-primary"
                        disabled={ratesBusy}
                        onClick={() => rateLibrary && void saveRateLibrary(rateLibrary)}
                      >
                        {ratesBusy ? <Loader2 className="spin" size={14} /> : null}
                        Save rates
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={ratesBusy}
                        onClick={() => {
                          void (async () => {
                            setRatesBusy(true);
                            try {
                              const response = await apiFetch("/api/takeoff-rates", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ reset: true }),
                              });
                              const body = (await response.json().catch(() => ({}))) as {
                                library?: TakeoffRateLibrary;
                                error?: string;
                              };
                              if (!response.ok || !body.library) throw new Error(body.error || "Reset failed");
                              setRateLibrary(body.library);
                              show("Rates reset to defaults.", 6000);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Reset failed");
                            } finally {
                              setRatesBusy(false);
                            }
                          })();
                        }}
                      >
                        Reset defaults
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="nexa-studio-audit-rail" aria-label="Takeoff log">
                <header>
                  <h2>Log</h2>
                  <button type="button" className="ghost" onClick={() => setLogOpen((open) => !open)}>
                    {logOpen ? "Hide" : "Show"}
                  </button>
                </header>
                {logOpen ? (
                  <>
                    <p className="muted nexa-studio-hint">
                      Blake runs, AI confirm/reject, and rate library saves for this takeoff.
                    </p>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void refreshTakeoffAudit(selectedId)}
                      title="Refresh takeoff audit"
                    >
                      Refresh
                    </button>
                    {takeoffAudit.length ? (
                      <ul className="nexa-studio-audit-list">
                        {takeoffAudit.map((event) => (
                          <li key={event.id}>
                            <strong>{event.summary}</strong>
                            <span>
                              {event.actor} · {formatAuditWhen(event.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No takeoff log yet — Ask Blake or save rates to start the trail.</p>
                    )}
                  </>
                ) : (
                  <p className="muted nexa-studio-hint">Hidden by default so mark-up stays clear.</p>
                )}
              </section>
            </>
          ) : null}
          </div>
        </aside>

        <main className="nexa-studio-main">
          {selected && reviewOpen && aiReviewRows.length ? (
            <div className="nexa-studio-ai-review-panel">
              <TakeoffOverlayReview
                projectId={selected.id}
                documents={selected.documents}
                measured={aiReviewRows}
                busy={busy === "ai-review"}
                reviewStatus={studio.aiReviewStatus}
                onApply={confirmAiReview}
                onReject={studio.aiReviewStatus === "rejected" ? undefined : rejectAiReview}
                onClose={() => setReviewOpen(false)}
              />
            </div>
          ) : selected && boqOpen ? (
            <div className="nexa-studio-boq-workspace" aria-label={`Bill of quantities · ${boqLayerLabel}`}>
              <header className="nexa-studio-boq-workspace-head">
                <div>
                  <p className="eyebrow">Bill of quantities</p>
                  <h1>{boqLayerLabel}</h1>
                  <p className="muted">
                    Full list for this takeoff — switch layers below. Drawing register stays on Mark when you go back.
                  </p>
                </div>
                <div className="nexa-studio-boq-workspace-actions">
                  <button type="button" className="ghost" onClick={() => setBoqOpen(false)}>
                    Back to drawing
                  </button>
                  <button type="button" className="nexa-studio-primary" disabled={busy === "push"} onClick={() => void pushToCore()}>
                    {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                    {selected.linkedQuoteId ? "Push master BOQ" : "Push to new quote"}
                  </button>
                </div>
              </header>
              <div className="nexa-studio-boq-layers" role="tablist" aria-label="Cost centre layers">
                {studioLayers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    role="tab"
                    aria-selected={activeLayerId === layer.id}
                    className={activeLayerId === layer.id ? "on" : undefined}
                    onClick={() => void persistStudio(setStudioActiveLayer(studio, layer.id))}
                  >
                    {layer.id === "all" ? "Master" : layer.label}
                  </button>
                ))}
              </div>
              <p className="nexa-studio-boq-workspace-meta">
                {activeLayerId === "all"
                  ? "Master BOQ — every cost centre."
                  : `${boqLayerLabel} cost centre only. Master rolls them all up for Push.`}
                {boqMaterialCost > 0 ? ` Indicative materials ≈ £${boqMaterialCost.toFixed(0)}.` : ""}
                {boqForPanel.length ? ` · ${boqForPanel.length} line${boqForPanel.length === 1 ? "" : "s"}` : ""}
              </p>
              {unscaledLinearCount > 0 ? (
                <p className="nexa-studio-boq-scale-warn">
                  {unscaledLinearCount} length run{unscaledLinearCount === 1 ? "" : "s"} need <strong>Set scale</strong>
                  {unscaledLinearSummary.pageLabels.length
                    ? ` (${unscaledLinearSummary.pageLabels.join(", ")})`
                    : ""}
                  — they are not pushed as quantities.
                </p>
              ) : null}
              {pricedBoqForPanel.length ? (
                <div className="nexa-studio-boq-list nexa-studio-boq-list-full">
                  {(["Pipework", "Fittings", "Counts", "Areas"] as const).map((section) => {
                    const rows = pricedBoqForPanel.filter((row) => row.section === section);
                    if (!rows.length) return null;
                    return (
                      <div key={section} className="nexa-studio-boq-section">
                        <strong>{section}</strong>
                        <ul>
                          {rows.map((row) => {
                            const state =
                              row.pricingState
                              || (row.supplierRequired || !(row.unitCost > 0) ? "rfq" : "guide");
                            return (
                              <li key={row.id}>
                                <span>
                                  {row.description}{" "}
                                  <small className={`price-ledger-chip is-${state}`}>
                                    {state === "budget"
                                      ? "Budget"
                                      : state === "guide"
                                        ? "Guide"
                                        : state === "firm"
                                          ? "Firm"
                                          : "RFQ"}
                                  </small>
                                </span>
                                <em>
                                  {row.quantity} {row.unit}
                                  {row.unitCost > 0
                                    ? ` · £${(row.quantity * row.unitCost).toFixed(0)}`
                                    : " · RFQ"}
                                </em>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="empty">Nothing on this layer yet — go Back to drawing, Ask Blake or finish a Length run.</p>
              )}
            </div>
          ) : selected ? (
            <>
              {activeDoc ? (
                <div className="nexa-studio-quick-actions" aria-label="Takeoff shortcuts">
                  <button
                    type="button"
                    className={!hasScale ? "need" : undefined}
                    onClick={() => runFlowAction("scale")}
                  >
                    {hasScale ? "Scale ✓" : "Set scale"}
                  </button>
                  <button type="button" onClick={() => runFlowAction("boq")}>
                    BOQ · {boqForPanel.length || 0}
                  </button>
                  <button type="button" disabled={busy === "ai"} onClick={() => void runAiAssist()}>
                    {busy === "ai" ? "Blake…" : "Ask Blake"}
                  </button>
                  <button
                    type="button"
                    className={proposeOpen ? "on" : undefined}
                    disabled={busy === "propose"}
                    onClick={() => setProposeOpen((open) => !open)}
                  >
                    Propose
                  </button>
                  <button type="button" disabled={busy === "push"} onClick={() => void pushToCore()}>
                    {selected.linkedQuoteId ? "Push" : "New quote"}
                  </button>
                </div>
              ) : null}
              {proposeOpen ? (
                <div className="nexa-studio-propose-panel" aria-label="Blake route and equipment proposer">
                  <header>
                    <strong>Blake propose</strong>
                    <span>Place plant → answer a few questions → routes + equipment land in the BOQ</span>
                  </header>
                  <div className="nexa-studio-propose-row" role="group" aria-label="Heat source">
                    <em>Heat source</em>
                    {(
                      [
                        ["boiler", "Boiler"],
                        ["ashp", "ASHP"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={proposePlant === id ? "on" : undefined}
                        onClick={() => {
                          setProposePlant(id);
                          if (id === "ashp") setProposeCylinder(true);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="nexa-studio-propose-row" role="group" aria-label="Emitters">
                    <em>Emitters</em>
                    {(
                      [
                        ["radiators", "Rads"],
                        ["ufh", "UFH"],
                        ["mixed", "Mixed"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={proposeEmitters === id ? "on" : undefined}
                        onClick={() => setProposeEmitters(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="nexa-studio-propose-check">
                    <input
                      type="checkbox"
                      checked={proposePlant === "ashp" ? true : proposeCylinder}
                      disabled={proposePlant === "ashp"}
                      onChange={(event) => setProposeCylinder(event.target.checked)}
                    />
                    Include hot water cylinder{proposePlant === "ashp" ? " (usual with ASHP)" : ""}
                  </label>
                  <div className="nexa-studio-propose-actions">
                    <button type="button" className="ghost" onClick={placeProposePlant}>
                      Tap plant on sheet
                    </button>
                    <button
                      type="button"
                      className="nexa-studio-primary"
                      disabled={busy === "propose"}
                      onClick={() => void runBlakePropose()}
                    >
                      {busy === "propose" ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
                      Propose routes
                    </button>
                  </div>
                  {proposeQuestions.length ? (
                    <div className="nexa-studio-propose-questions">
                      <strong>Blake still needs</strong>
                      <ul>
                        {proposeQuestions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="muted">
                      Tip: tap plant position first for a better layout. Edit dashed proposed runs like any Blake mark.
                    </p>
                  )}
                </div>
              ) : null}
              {activeClass ? (
                <p className="nexa-studio-active-draw muted">
                  Drawing: <strong style={{ color: activeClass.colour }}>{activeClass.name}</strong>
                  {" "}— change from <strong>Draw as</strong> in the left rail.
                </p>
              ) : null}
              {showSizeBar ? (
                <div className="nexa-studio-size-bar" aria-label="Pipe size">
                  <span className="nexa-studio-service-bar-label">Size</span>
                  {STUDIO_PIPE_SPECS.map((spec) => {
                    const active = (studio.activePipeSpecId || DEFAULT_STUDIO_PIPE_SPEC_ID) === spec.id;
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        className={active ? "on" : undefined}
                        onClick={() => {
                          void persistStudio({ ...studio, activePipeSpecId: spec.id, tool: "linear" });
                          if (selected) {
                            recordTakeoffLearningClient({
                              type: "pipe_spec_choice",
                              projectId: selected.id,
                              pipeSpecId: spec.id,
                              trade: "plumbing",
                            });
                          }
                        }}
                        title={`${spec.diameter} ${spec.material}${spec.autoCouplings ? ` · couplings every ${spec.stockLengthM}m` : ""}${spec.autoElbows ? " · auto elbows" : ""}`}
                      >
                        {spec.label}
                      </button>
                    );
                  })}
                  <span className="nexa-studio-size-note">
                    Fittings match the Size chip. Scale required for metres/couplings.
                  </span>
                </div>
              ) : null}
              <StudioCanvas
                projectId={selected.id}
                document={activeDoc}
                studio={studio}
                onChange={(next) => void persistStudio(next)}
                onUndo={undoStudio}
                onRedo={redoStudio}
                canUndo={canUndo}
                canRedo={canRedo}
                onLinearFinished={(summary) => {
                  const bits = [
                    summary.metres != null ? `${summary.metres.toFixed(2)} m` : "run saved · set scale for m",
                    summary.elbows ? `${summary.elbows} elbow${summary.elbows === 1 ? "" : "s"}` : null,
                    summary.couplings ? `${summary.couplings} coupling${summary.couplings === 1 ? "" : "s"}` : null,
                  ].filter(Boolean);
                  show(`Added to BOQ · ${summary.label} · ${bits.join(" · ")}`, 10000);
                }}
              />
            </>
          ) : (
            <div className="nexa-studio-empty-main">
              <h1>Start a NeXa takeoff</h1>
              <p>Create a project, upload drawings, set scale, then Count / Linear / Area — or Ask Blake.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
