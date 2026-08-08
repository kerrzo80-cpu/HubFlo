"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";

import { useBrand } from "@/components/BrandProvider";
import { resolveBrandLogoUrl } from "@/lib/branding";
import { roleHeaderName } from "@/lib/access";
import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";
import {
  classificationLayer,
  createDefaultStudioState,
  ensureServiceClassifications,
  importSkillCountsIntoStudio,
  isAiStudioGeometry,
  nextClassificationColour,
  SERVICE_CLASS_DEFS,
  setClassificationColour,
  setStudioActiveLayer,
  STUDIO_SERVICE_LAYERS,
  studioId,
  studioHasAiCounts,
  studioNeedsAiReview,
  studioQuantitiesToMaterialAllowances,
  summariseStudioQuantities,
  type StudioAiReviewMeasuredQuantity,
  type StudioClassKind,
  type StudioClassification,
  type StudioState,
} from "@/lib/takeoff-studio";
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
  DEFAULT_STUDIO_PIPE_SPEC_ID,
  STUDIO_PIPE_SPECS,
  summariseStudioPipeBoq,
} from "@/lib/takeoff-studio-pipe";

import TakeoffOverlayReview from "./TakeoffOverlayReview";
import StudioCanvas from "./studio/StudioCanvas";
import "./takeoff-skill.css";
import "./studio/studio.css";

type QuoteOption = { id: string; ref: string; customer: string; site: string };
type AuthState = "checking" | "signed-in" | "signed-out" | "pilot";

const requestHeaders: HeadersInit = {
  [roleHeaderName]: "Office",
};

async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (!headers.has(key) && typeof value === "string") headers.set(key, value);
  }
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
  const saveTimer = useRef<number | null>(null);
  const historyRef = useRef<StudioState[]>([]);
  const futureRef = useRef<StudioState[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const seededServicesRef = useRef<string | null>(null);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const studio: StudioState = ensureServiceClassifications(selected?.studio ?? createDefaultStudioState());
  const drawingDocs = (selected?.documents || []).filter(
    (doc) => doc.kind === "Drawing" || doc.kind === "Marked-up drawing" || (doc.mimeType || "").includes("pdf"),
  );
  const activeDoc =
    drawingDocs.find((doc) => doc.id === studio.activeDocumentId) || drawingDocs[0] || null;
  const activeClass = studio.classifications.find((cls) => cls.id === studio.activeClassificationId) || null;
  const activeLayerId = studio.activeLayerId || "all";
  const visibleClassifications = studio.classifications.filter((cls) =>
    activeLayerId === "all" ? true : classificationLayer(cls) === activeLayerId,
  );
  // Always show every preset service + any custom linears/counts so Draw as isn't stuck on Hot/Cold only.
  const presetIds = new Set(SERVICE_CLASS_DEFS.map((def) => def.id));
  const pipeServiceClasses = [
    ...SERVICE_CLASS_DEFS
      .map((def) => studio.classifications.find((cls) => cls.id === def.id))
      .filter((cls): cls is StudioClassification => Boolean(cls)),
    ...studio.classifications.filter((cls) => !presetIds.has(cls.id) && (cls.kind === "linear" || cls.kind === "count")),
  ];
  const quantities = summariseStudioQuantities(studio);
  const linkedQuote = quotes.find((q) => q.id === selected?.linkedQuoteId);
  const aiReviewRows = studio.aiReviewMeasured || [];
  const aiReviewPinCount = aiReviewRows.reduce(
    (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
    0,
  );
  const hasAiReviewRows = aiReviewPinCount > 0;
  const hasAiCounts = studioHasAiCounts(studio);
  const hasPendingAiReview = studioNeedsAiReview(studio);
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

  const refresh = useCallback(async () => {
    const [projectRes, quoteRes] = await Promise.all([
      apiFetch("/api/takeoff-projects"),
      apiFetch("/api/quotes"),
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
    setSelectedId((current) => current ?? list[0]?.id ?? null);
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
    if (!selected || seededServicesRef.current === selected.id) return;
    const raw = selected.studio ?? createDefaultStudioState();
    const ensured = ensureServiceClassifications(raw);
    seededServicesRef.current = selected.id;
    if (ensured !== raw) {
      void persistStudio(ensured, {}, { skipHistory: true, immediate: true });
    }
    // Seed service classes once per project; persistStudio is defined below in this component.
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
    if (hasPendingAiReview) setReviewOpen(true);
  }, [hasPendingAiReview, selectedId]);

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

  async function uploadDrawings(event: ChangeEvent<HTMLInputElement>) {
    if (!selected || !event.target.files?.length) return;
    setBusy("upload");
    try {
      const body = new FormData();
      for (const file of Array.from(event.target.files)) body.append("files", file);
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
      show(`Uploaded ${event.target.files.length} drawing(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      event.target.value = "";
    }
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

  function selectPipeService(cls: StudioClassification) {
    void persistStudio({
      ...studio,
      activeClassificationId: cls.id,
      tool: cls.kind,
      activeLayerId: classificationLayer(cls),
    });
  }

  function quickAddDrawItem() {
    const name = window.prompt("Name for this mark-up (e.g. Condensate, Gas branch, Radiators)", "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const kindAnswer = window.prompt("Type: linear (pipe length) or count (tap fixtures)", "linear");
    const kind: StudioClassKind = kindAnswer?.trim().toLowerCase() === "count" ? "count" : "linear";
    const colour = kind === "count" ? "#7a4f9a" : nextClassificationColour(studio.classifications);
    const cls: StudioClassification = {
      id: studioId("cls"),
      kind,
      name: trimmed,
      colour,
      unit: kind === "count" ? "nr" : "m",
      layer: activeLayerId === "all" ? "general" : activeLayerId,
    };
    void persistStudio({
      ...studio,
      classifications: [...studio.classifications, cls],
      activeClassificationId: cls.id,
      tool: kind,
    });
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
      "Reading PDF text tags and coloured pipe runs…",
      "Placing pins and tracing pipe runs on the sheet…",
    ];
    let stepIndex = 0;
    setBlakeStep(steps[0] || "Blake is working…");
    const stepTimer = window.setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      setBlakeStep(steps[stepIndex] || "Blake is working…");
    }, 2200);
    try {
      setBlakeStep("Reading text from the open PDF…");
      const clientExtracts = [];
      for (const drawing of drawingDocs.slice(0, 4)) {
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

      setBlakeStep("Tracing coloured pipe runs on the open PDF…");
      const clientStrokeRuns = [];
      for (const drawing of drawingDocs.slice(0, 2)) {
        try {
          const strokes = await extractTakeoffPdfStrokesInBrowser(
            selected.id,
            drawing.id,
            drawing.fileName,
            { maxPages: 4 },
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

      setBlakeStep("Blake is analysing your drawings…");
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/blake-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientExtracts, clientStrokeRuns }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        measured?: StudioAiReviewMeasuredQuantity[];
        pinCount?: number;
        pipeRunCount?: number;
        project?: TakeoffProject;
        focus?: { documentId: string; page: number; classificationId: string } | null;
      };
      if (!response.ok || !payload.ok || !payload.project) {
        throw new Error(payload.error || `Blake failed (${response.status}).`);
      }
      const nextStudio = payload.project.studio ?? createDefaultStudioState();
      if (payload.focus) {
        nextStudio.activeDocumentId = payload.focus.documentId;
        nextStudio.activePage = payload.focus.page;
        nextStudio.activeClassificationId = payload.focus.classificationId;
        nextStudio.tool = "select";
      }
      upsert({
        ...payload.project,
        studio: nextStudio,
      });
      setSaveState("saved");
      const message = payload.message || "Blake finished.";
      const found = (payload.pinCount || 0) + (payload.pipeRunCount || 0);
      setBlakeStep(
        found
          ? `Done — ${payload.pinCount || 0} pin(s) · ${payload.pipeRunCount || 0} pipe run(s).`
          : "Done — nothing Blake could auto-measure yet.",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if (found > 0) {
        setReviewOpen(true);
        show(message, 14000);
      } else {
        setNotice(null);
        setError(message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blake could not finish. Try again or mark up manually.");
    } finally {
      window.clearInterval(stepTimer);
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
      setReviewOpen(false);
      const activePins = reviewed.reduce(
        (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
        0,
      );
      show(`AI counts confirmed — ${activePins} pin(s) ready for Core.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm AI counts.");
    } finally {
      setBusy(null);
    }
  }

  async function rejectAiReview() {
    if (!selected) return;
    const ok = window.confirm("Reject all Blake AI count pins for this takeoff? This removes them from Studio quantities.");
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
      const remainingGeometries = studio.geometries.filter((geo) => !isAiStudioGeometry(geo));
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
      setReviewOpen(false);
      show("AI counts rejected — Blake pins were excluded from the Core push.");
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

  async function pushToCore(options: { allowPendingAiReview?: boolean } = {}) {
    if (!selected) return;
    if (!selected.linkedQuoteId) {
      setError("Link a Core quote before pushing.");
      return;
    }
    if (hasPendingAiReview && !options.allowPendingAiReview) {
      const ok = window.confirm(
        "Blake AI count pins are still pending human review. Push to Core anyway and mark this as an explicit override?",
      );
      if (!ok) {
        setReviewOpen(true);
        setError("Confirm or reject Blake AI counts before pushing to Core.");
        return;
      }
      await pushToCore({ allowPendingAiReview: true });
      return;
    }
    setBusy("push");
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
      const materials = [...pipeMaterials, ...baseMaterials];
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
          quoteId: selected.linkedQuoteId,
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
      const result = (await push.json()) as { project: TakeoffProject; quote: { id: string; ref: string } };
      upsert(result.project);
      const drawings = await saveAllStudioLayerDrawings({ quiet: true });
      show(
        `Pushed BOQ into quote ${result.quote.ref}`
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
  const flowStep: "upload" | "scale" | "blake" | "review" | "mark" | "push" = !drawingDocs.length
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
      fileRef.current?.click();
      return;
    }
    if (step === "scale") {
      if (!activeDoc) {
        setError("Upload a PDF first, then set scale.");
        return;
      }
      void persistStudio({ ...studio, tool: "scale" });
      show("Scale tool on — tap two points on a known length, enter metres (or use a 1:N chip).");
      return;
    }
    if (step === "blake") {
      void runAiAssist();
      return;
    }
    if (step === "review") {
      if (!hasAiReviewRows && !hasAiCounts) {
        setError("Ask Blake first so there are AI count pins to review.");
        return;
      }
      setReviewOpen(true);
      show(
        studio.aiReviewStatus === "confirmed"
          ? "AI counts are already confirmed. Review is open if you need to inspect them."
          : studio.aiReviewStatus === "rejected"
            ? "AI counts were rejected. Ask Blake again to create a new review."
            : "Review Blake's AI pins, then confirm or reject before Core push.",
      );
      return;
    }
    if (step === "mark") {
      if (!activeDoc) {
        setError("Upload a PDF first.");
        return;
      }
      const tool = studio.classifications.find((cls) => cls.id === studio.activeClassificationId)?.kind || "count";
      void persistStudio({ ...studio, tool: tool === "area" || tool === "linear" || tool === "count" ? tool : "count" });
      show("Mark-up mode — tap Count / Linear / Area on the toolbar, or ask Blake first.");
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
              ["push", "Push"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={flowStep === id ? "on" : undefined}
              disabled={(id === "blake" && busy === "ai") || (id === "review" && !hasAiCounts)}
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
            Blake placed {aiReviewPinCount} AI count pin{aiReviewPinCount === 1 ? "" : "s"} pending human review. Confirm or reject before Core push.
          </span>
          <button type="button" onClick={() => setReviewOpen(true)}>Review AI counts</button>
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
                <button
                  key={project.id}
                  type="button"
                  className={project.id === selectedId ? "on" : undefined}
                  onClick={() => setSelectedId(project.id)}
                >
                  <strong>{project.reference}</strong>
                  <span>{project.name}</span>
                </button>
              ))}
            </div>
          </section>

          {selected ? (
            <>
              <section>
                <header>
                  <h2>Drawings</h2>
                  <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
                    {busy === "upload" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
                    Upload
                  </button>
                </header>
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

              <section>
                <header>
                  <h2>Layers</h2>
                </header>
                <div className="nexa-studio-layer-list" role="tablist" aria-label="Service layers">
                  {STUDIO_SERVICE_LAYERS.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      role="tab"
                      aria-selected={activeLayerId === layer.id}
                      className={activeLayerId === layer.id ? "on" : undefined}
                      onClick={() => void persistStudio(setStudioActiveLayer(studio, layer.id))}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
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
                <p className="muted nexa-studio-hint">
                  Like old markups: <strong>Master / all</strong> shows everything; each service layer is a fresh drawing view.
                  Save writes a marked SVG into takeoff + linked quote Documents (then onto the job when the quote converts).
                </p>
              </section>

              <section>
                <header>
                  <h2>Classifications</h2>
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
                  Tap a coloured service (Cold = blue, Hot = red), then Length. Or change the swatch colour anytime. Ask Blake can still auto-trace vector pipes.
                </p>
              </section>

              <section className="nexa-studio-core-link">
                <header>
                  <h2>Core link</h2>
                </header>
                <p className="muted nexa-studio-hint">
                  Marks auto-save here. <strong>Push BOQ</strong> sends quantities plus master/layer marked drawings into the linked quote Documents.
                  When that quote converts to a job, those drawings stay available on the job.
                </p>
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
                <button
                  type="button"
                  className="nexa-studio-primary"
                  disabled={busy === "push" || !selected.linkedQuoteId}
                  onClick={() => void pushToCore()}
                >
                  {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                  Push BOQ + drawings
                </button>
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
          ) : selected ? (
            <>
              <div className="nexa-studio-service-bar" aria-label="Pipe service colours">
                <span className="nexa-studio-service-bar-label">Draw as</span>
                {pipeServiceClasses.map((cls) => (
                  <button
                    key={cls.id}
                    type="button"
                    className={cls.id === studio.activeClassificationId ? "on" : undefined}
                    style={{ ["--svc" as string]: cls.colour }}
                    onClick={() => selectPipeService(cls)}
                    title={`Draw ${cls.name} in this colour`}
                  >
                    <i style={{ background: cls.colour }} />
                    {cls.name
                      .replace(/ pipe runs$/i, "")
                      .replace(/ runs$/i, "")
                      .replace(/ ware$/i, "")}
                  </button>
                ))}
                <button
                  type="button"
                  className="nexa-studio-service-add"
                  onClick={quickAddDrawItem}
                  title="Add another item to draw (gas, condensate, radiators…)"
                >
                  <Plus size={14} />
                  Add
                </button>
                {activeClass ? (
                  <strong className="nexa-studio-service-active" style={{ color: activeClass.colour }}>
                    Drawing: {activeClass.name}
                  </strong>
                ) : null}
              </div>
              <div className="nexa-studio-size-bar" aria-label="Pipe size">
                <span className="nexa-studio-service-bar-label">Size</span>
                {STUDIO_PIPE_SPECS.map((spec) => {
                  const active = (studio.activePipeSpecId || DEFAULT_STUDIO_PIPE_SPEC_ID) === spec.id;
                  return (
                    <button
                      key={spec.id}
                      type="button"
                      className={active ? "on" : undefined}
                      onClick={() => void persistStudio({ ...studio, activePipeSpecId: spec.id, tool: "linear" })}
                      title={`${spec.diameter} ${spec.material}${spec.autoCouplings ? ` · couplings every ${spec.stockLengthM}m` : ""}${spec.autoElbows ? " · auto elbows" : ""}`}
                    >
                      {spec.label}
                    </button>
                  );
                })}
                <span className="nexa-studio-size-note">
                  Fittings match the Size chip (e.g. 22 Cu → 22mm Copper elbows &amp; couplings every 3 m). Scale required for metres/couplings.
                </span>
                {(() => {
                  const fittingRows = summariseStudioPipeBoq(studio).filter((row) => row.section === "Fittings");
                  if (!fittingRows.length) return null;
                  return (
                    <div className="nexa-studio-fitting-tally" aria-label="Sized fittings tally">
                      {fittingRows.map((row) => (
                        <span key={row.id}>
                          <strong>{row.quantity}</strong> {row.description}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <StudioCanvas
                projectId={selected.id}
                document={activeDoc}
                studio={studio}
                onChange={(next) => void persistStudio(next)}
                onUndo={undoStudio}
                onRedo={redoStudio}
                canUndo={canUndo}
                canRedo={canRedo}
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
