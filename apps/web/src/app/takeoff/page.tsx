"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useBrand } from "@/components/BrandProvider";
import { FileDropZone } from "@/components/FileDropZone";
import { BuddyCharacter } from "@/lib/BuddyCharacter";
import { resolveBrandLogoUrl } from "@/lib/branding";
import { employeeHeaderName, roleHeaderName } from "@/lib/access";
import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";
import {
  takeoffDrawingDisplayLabel,
  takeoffSourceFolderLabel,
  takeoffSourceTenderDocId,
} from "@/lib/takeoff-drawing-labels";
import { countMarkupsOnTenderDocuments } from "@/lib/takeoff-tender-archive";
import {
  downloadTakeoffStudioLocalDraft,
  readTakeoffStudioLocalDraft,
  shouldRestoreTakeoffStudioLocalDraft,
  writeTakeoffStudioLocalDraft,
} from "@/lib/takeoff-studio-local-draft";
import {
  documentIdsTouchedSinceBase,
  softRefreshStudioFromServer,
  type TakeoffConcurrentMergeMeta,
} from "@/lib/takeoff-studio-concurrent-merge";
import {
  classificationGroup,
  classificationLayer,
  createDefaultStudioState,
  ensureServiceClassifications,
  groupStudioClassifications,
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
import { lookingForLabel, scanBriefForLayer } from "@/lib/blake-trade-scope";
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
type JobOption = { id: string; ref: string; customer: string; status: string };
type TenderOption = {
  id: string;
  name: string;
  client: string;
  status: string;
  externalId?: string;
  linkedTakeoffId?: string;
  /** Drawing-kind PDFs on the Core tender (for sync honesty). */
  drawingCount: number;
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

function sortDrawingDocs(docs: TakeoffDocument[]) {
  return docs.slice().sort((a, b) => {
    const setA = takeoffSourceFolderLabel(a.notes) || "";
    const setB = takeoffSourceFolderLabel(b.notes) || "";
    return setA.localeCompare(setB) || a.fileName.localeCompare(b.fileName);
  });
}

async function apiFetch(input: string, init: RequestInit & { skipAuthRedirect?: boolean } = {}) {
  const { skipAuthRedirect, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers || {});
  if (!headers.has(roleHeaderName)) headers.set(roleHeaderName, "Office");
  if (!headers.has(employeeHeaderName)) headers.set(employeeHeaderName, sessionActor);
  const response = await fetch(input, { ...fetchInit, credentials: "include", headers });
  // Never bounce to /login mid-save — that wipes in-memory marks (localStorage still has them).
  if (response.status === 401 && typeof window !== "undefined" && !skipAuthRedirect) {
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
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [tenders, setTenders] = useState<TenderOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassKind, setNewClassKind] = useState<StudioClassKind>("linear");
  const [newClassColour, setNewClassColour] = useState("#2878c8");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [blakeStep, setBlakeStep] = useState<string | null>(null);
  const [blakeAskOpen, setBlakeAskOpen] = useState(false);
  const [blakeAskScope, setBlakeAskScope] = useState<"current" | "project">("current");
  const [blakeAskHotCold, setBlakeAskHotCold] = useState(true);
  const [blakeAskWaste, setBlakeAskWaste] = useState(false);
  const [blakeAskHeating, setBlakeAskHeating] = useState(false);
  const [blakeAskFixtures, setBlakeAskFixtures] = useState(true);
  const [blakeAskNote, setBlakeAskNote] = useState("");
  const [blakeChatDraft, setBlakeChatDraft] = useState("");
  const [blakeChatBusy, setBlakeChatBusy] = useState(false);
  const [blakeChatMessages, setBlakeChatMessages] = useState<Array<{ role: "assistant" | "user"; text: string }>>([]);
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
  const [drawSizesOpen, setDrawSizesOpen] = useState(false);
  /** Collapsible Draw-as groups (Valves, Boilers / plant, …) — mirrors Size accordion chrome. */
  const [openClassGroups, setOpenClassGroups] = useState<Record<string, boolean>>({});
  const [newLayerName, setNewLayerName] = useState("");
  /** Accordion: Linked | Drawings | Draw as | More — Projects lives under More. */
  const [railAccordions, setRailAccordions] = useState({
    link: true,
    drawings: true,
    draw: true,
    more: false,
  });
  const saveTimer = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<{
    projectId: string;
    studio: StudioState;
    extras: Partial<TakeoffProject>;
  } | null>(null);
  /** Server `updatedAt` we last successfully loaded/saved — used to detect another user saving the same project. */
  const baseUpdatedAtRef = useRef<string | null>(null);
  /** Studio snapshot at last successful sync — used to compute which drawings we actually edited. */
  const baseStudioRef = useRef<StudioState | null>(null);
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
  const drawingDocs = useMemo(
    () =>
      sortDrawingDocs(
        (selected?.documents || []).filter(
          (doc) =>
            doc.kind === "Drawing"
            || doc.kind === "Marked-up drawing"
            || (doc.mimeType || "").includes("pdf"),
        ),
      ),
    [selected?.documents],
  );
  const activeDoc =
    drawingDocs.find((doc) => doc.id === studio.activeDocumentId) || drawingDocs[0] || null;
  const activeClass = studio.classifications.find((cls) => cls.id === studio.activeClassificationId) || null;
  const activeLayerId = studio.activeLayerId || "all";
  const studioLayers = listStudioLayers(studio);
  const visibleClassifications = studio.classifications.filter((cls) =>
    activeLayerId === "all" ? true : classificationLayer(cls) === activeLayerId,
  );
  const drawAsGroups = useMemo(
    () =>
      groupStudioClassifications(visibleClassifications, {
        scopeLayer: activeLayerId,
        layerLabels: studioLayers,
      }),
    [visibleClassifications, activeLayerId, studioLayers],
  );
  const activeDrawGroupKey = useMemo(() => {
    if (!activeClass) return null;
    const groupId = classificationGroup(activeClass);
    return activeLayerId === "all"
      ? `${classificationLayer(activeClass)}::${groupId}`
      : groupId;
  }, [activeClass, activeLayerId]);

  useEffect(() => {
    if (!activeDrawGroupKey) return;
    setOpenClassGroups((prev) =>
      prev[activeDrawGroupKey] ? prev : { ...prev, [activeDrawGroupKey]: true },
    );
  }, [activeDrawGroupKey, activeLayerId]);
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
  const linkedQuote = quotes.find((q) => q.id === selected?.linkedQuoteId);
  const linkedTender = tenders.find((t) => t.id === selected?.sourceTenderId);
  const linkedJob = jobs.find((j) => j.id === selected?.linkedJobId);
  const tenderDrawingCount = linkedTender?.drawingCount ?? 0;
  const sourcedFromTenderCount = drawingDocs.filter((doc) => takeoffSourceTenderDocId(doc.notes)).length;
  const tenderDrawingsPending = Math.max(0, tenderDrawingCount - sourcedFromTenderCount);
  const activeDrawingSetLabel = activeDoc ? takeoffSourceFolderLabel(activeDoc.notes) : undefined;
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
    const [projectRes, quoteRes, tenderRes, jobRes] = await Promise.all([
      apiFetch("/api/takeoff-projects"),
      apiFetch("/api/quotes"),
      apiFetch("/api/tenders"),
      apiFetch("/api/jobs"),
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
    if (jobRes.ok) {
      const jobList = (await jobRes.json()) as Array<Record<string, unknown>>;
      setJobs(
        jobList
          .map((job) => ({
            id: String(job.id || ""),
            ref: String(job.ref || ""),
            customer: String(job.customer || ""),
            status: String(job.status || ""),
          }))
          .filter((job) => job.id),
      );
    }
    if (tenderRes.ok) {
      const tenderPayload = (await tenderRes.json()) as {
        tenders?: Array<Record<string, unknown>>;
      };
      setTenders(
        (tenderPayload.tenders || [])
          .map((tender) => {
            const documents = Array.isArray(tender.documents) ? tender.documents : [];
            const drawingCount = documents.filter((doc) => {
              if (!doc || typeof doc !== "object") return false;
              return String((doc as { kind?: unknown }).kind || "") === "drawing";
            }).length;
            return {
              id: String(tender.id || ""),
              name: String(tender.name || ""),
              client: String(tender.client || ""),
              status: String(tender.status || ""),
              externalId: tender.externalId ? String(tender.externalId) : undefined,
              linkedTakeoffId: tender.linkedTakeoffId ? String(tender.linkedTakeoffId) : undefined,
              drawingCount,
            };
          })
          .filter((tender) => tender.id),
      );
    }
  }, []);

  useEffect(() => {
    historyRef.current = [];
    futureRef.current = [];
    setHistoryTick((value) => value + 1);
    setSaveState("saved");
    setSavedAt(null);
    setReviewOpen(false);
    seededServicesRef.current = null;
    pendingSaveRef.current = null;
    baseUpdatedAtRef.current = null;
    baseStudioRef.current = null;
    // Mark mode: Linked + Drawings + Draw as open; More stays collapsible.
    setRailAccordions((prev) => ({
      ...prev,
      link: true,
      drawings: true,
      draw: true,
      more: !selectedId,
    }));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setBlakeChatMessages([]);
      return;
    }
    void apiFetch(
      `/api/nexa-assistant?takeoffId=${encodeURIComponent(selectedId)}`,
      { skipAuthRedirect: true },
    )
      .then((response) => response.json().catch(() => null))
      .then((payload: { messages?: Array<{ role: "assistant" | "user"; text: string }> } | null) => {
        if (!payload?.messages?.length) return;
        setBlakeChatMessages(payload.messages.map((item) => ({ role: item.role, text: item.text })));
      })
      .catch(() => {
        // Chat hydrate is optional.
      });
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    // Seed concurrency token / studio baseline once per open (don't chase every optimistic local updatedAt).
    if (baseUpdatedAtRef.current === null && selected.updatedAt) {
      baseUpdatedAtRef.current = selected.updatedAt;
    }
    if (baseStudioRef.current === null && selected.studio) {
      baseStudioRef.current = selected.studio;
    }
  }, [selected]);

  const toggleRailAccordion = useCallback((key: keyof typeof railAccordions) => {
    setRailAccordions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    void refreshTakeoffAudit(selectedId);
  }, [selectedId, refreshTakeoffAudit]);

  useEffect(() => {
    if (!selected || seededServicesRef.current === selected.id) return;
    seededServicesRef.current = selected.id;

    const draft = readTakeoffStudioLocalDraft(selected.id);
    if (shouldRestoreTakeoffStudioLocalDraft(selected.studio, draft) && draft?.studio) {
      const ok = window.confirm(
        `This takeoff looks empty on the server, but this browser still has a local autosave from ${new Date(draft.savedAt).toLocaleString()} with ${draft.geometryCount} mark(s). Restore it?`,
      );
      if (ok) {
        void persistStudio(draft.studio, {}, { skipHistory: true, immediate: true }).then((merged) => {
          if (merged) show("Restored markups from local autosave");
        });
        return;
      }
    }

    const raw = selected.studio ?? createDefaultStudioState();
    const ensured = ensurePlantClassifications(ensureServiceClassifications(raw));
    if (ensured !== raw) {
      void persistStudio(ensured, {}, { skipHistory: true, immediate: true });
    }
    // Seed service classes / optional local-draft recovery; persistStudio is defined below.
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
    writeTakeoffStudioLocalDraft(selected.id, nextStudio, {
      sourceTenderId: (extras.sourceTenderId as string | undefined) ?? selected.sourceTenderId,
    });
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    pendingSaveRef.current = {
      projectId: selected.id,
      studio: nextStudio,
      extras,
    };

    const formatSaveError = async (response: Response) => {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (payload?.error?.trim()) return payload.error.trim();
      if (response.status === 401) return "Session expired — sign in again in another tab, then keep working here (this browser still has an autosave).";
      if (response.status === 403) {
        return "Your login cannot save Takeoffs. Sign in with an Office account, or ask an admin for quote-create / job-edit permission.";
      }
      if (response.status === 409) {
        return "Someone else saved this takeoff on the same drawing. Reload that sheet to see their marks — your work stays in this browser's autosave.";
      }
      if (response.status === 413 || response.status === 400) {
        return `Could not save studio takeoff (${response.status}) — payload may be too large or invalid. Try again; if it keeps failing, Download local backup below.`;
      }
      if (response.status >= 500) {
        return `Could not save studio takeoff (server ${response.status}). Marks stay in this browser — use Download local backup, then retry Save.`;
      }
      return `Could not save studio takeoff (${response.status}) — marks stay in this browser's autosave.`;
    };

    const flushSave = async (): Promise<TakeoffProject | null> => {
      if (saveInFlightRef.current) return null;
      saveInFlightRef.current = true;
      let lastMerged: TakeoffProject | null = null;
      try {
        while (pendingSaveRef.current) {
          const job = pendingSaveRef.current;
          pendingSaveRef.current = null;
          const touchedDocumentIds = documentIdsTouchedSinceBase(baseStudioRef.current, job.studio);
          try {
            const { studioTenderArchives: _dropArchives, ...safeExtras } = job.extras as Partial<TakeoffProject> & {
              studioTenderArchives?: unknown;
            };
            const bodyText = JSON.stringify({
              studio: job.studio,
              ...safeExtras,
              touchedDocumentIds,
              ...(baseUpdatedAtRef.current ? { expectedUpdatedAt: baseUpdatedAtRef.current } : {}),
            });
            if (bodyText.length > 12_000_000) {
              setSaveState("error");
              setError(
                `Could not save studio takeoff — payload is ${(bodyText.length / 1_000_000).toFixed(1)}MB (too large). Download local backup, then ask admin to clear unused tender archives.`,
              );
              pendingSaveRef.current = null;
              return null;
            }
            const response = await apiFetch(`/api/takeoff-projects/${job.projectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: bodyText,
              skipAuthRedirect: true,
            });
            if (!response.ok) {
              setSaveState("error");
              setError(await formatSaveError(response));
              // Stop the queue on conflict/auth — later coalesced writes would also fail.
              pendingSaveRef.current = null;
              return null;
            }
            const payload = (await response.json()) as TakeoffProject & {
              concurrentMerge?: TakeoffConcurrentMergeMeta;
            };
            const { concurrentMerge, ...projectFields } = payload;
            const project = projectFields as TakeoffProject;
            const serverStudio = project.studio ?? job.studio;

            // If the user kept marking while this request flew, protect those drawings and
            // pull teammates' other sheets from the merged server copy.
            const pendingNewer = pendingSaveRef.current;
            const protectIds = [
              ...touchedDocumentIds,
              ...(job.studio.activeDocumentId ? [job.studio.activeDocumentId] : []),
              ...(pendingNewer?.studio.activeDocumentId ? [pendingNewer.studio.activeDocumentId] : []),
            ];
            const localForRefresh = pendingNewer?.studio || job.studio;
            const soft = softRefreshStudioFromServer({
              local: localForRefresh,
              server: serverStudio,
              protectDocumentIds: protectIds,
            });

            if (pendingNewer && pendingNewer.projectId === job.projectId) {
              pendingSaveRef.current = { ...pendingNewer, studio: soft.studio };
            }

            const merged: TakeoffProject = {
              ...project,
              studio: soft.studio,
            };
            upsert(merged);
            writeTakeoffStudioLocalDraft(job.projectId, merged.studio || job.studio, {
              sourceTenderId: merged.sourceTenderId,
            });
            if (merged.updatedAt) baseUpdatedAtRef.current = merged.updatedAt;
            baseStudioRef.current = merged.studio || serverStudio;
            setSavedAt(new Date().toISOString());
            setSaveState("saved");
            setError(null);
            if (concurrentMerge?.adoptedFromServer?.length || soft.refreshedDocumentIds.length) {
              show("Updated from server — teammate marks on other drawings kept", 4500);
            }
            lastMerged = merged;
          } catch (err) {
            setSaveState("error");
            setError(
              err instanceof Error && err.message
                ? `Could not save studio takeoff — ${err.message}`
                : "Could not save studio takeoff — network error. Check connection; marks stay in this browser until Saved shows again.",
            );
            pendingSaveRef.current = null;
            return null;
          }
        }
        return lastMerged;
      } finally {
        saveInFlightRef.current = false;
        if (pendingSaveRef.current) {
          void flushSave();
        }
      }
    };

    if (options?.immediate) {
      return flushSave();
    }
    saveTimer.current = window.setTimeout(() => {
      void flushSave();
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
      if (project.updatedAt) baseUpdatedAtRef.current = project.updatedAt;
      baseStudioRef.current = project.studio ?? nextStudio;
      await persistStudio(nextStudio, {}, { skipHistory: true, immediate: true });
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

  async function syncTenderDrawings() {
    if (!selected?.sourceTenderId) {
      setError("Link a Core tender first, then sync drawings.");
      return;
    }
    setBusy("sync-drawings");
    try {
      const before = drawingDocs.length;
      const beforeSourced = sourcedFromTenderCount;
      const merged = await persistStudio(
        studio,
        { sourceTenderId: selected.sourceTenderId },
        { skipHistory: true, immediate: true },
      );
      if (!merged) throw new Error("Could not sync tender drawings");
      const nextDocs = sortDrawingDocs(
        (merged.documents || []).filter(
          (doc) =>
            doc.kind === "Drawing"
            || doc.kind === "Marked-up drawing"
            || (doc.mimeType || "").includes("pdf"),
        ),
      );
      const nextSourced = nextDocs.filter((doc) => takeoffSourceTenderDocId(doc.notes)).length;
      const added = Math.max(0, nextDocs.length - before);
      const labeled = Math.max(0, nextSourced - beforeSourced);
      if (added > 0) {
        show(`Synced ${added} drawing${added === 1 ? "" : "s"} from tender`);
      } else if (labeled > 0 || nextSourced > 0) {
        show("Drawing set labels updated from tender folders");
      } else if (tenderDrawingCount === 0) {
        show("Linked tender has no drawing-kind PDFs yet");
      } else {
        show("All available tender drawings are already in this takeoff");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
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
      group: "general",
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

  function blakeAskTargets(): Array<"hot-cold" | "waste" | "heating" | "fixtures"> {
    const targets: Array<"hot-cold" | "waste" | "heating" | "fixtures"> = [];
    if (blakeAskHotCold) targets.push("hot-cold");
    if (blakeAskWaste) targets.push("waste");
    if (blakeAskHeating) targets.push("heating");
    if (blakeAskFixtures) targets.push("fixtures");
    return targets;
  }

  function openBlakeAsk() {
    if (!selected) {
      setError("Create or select a project first.");
      return;
    }
    if (!activeDoc && !drawingDocs[0]) {
      setError("Upload a PDF drawing first, then find CAD plumbing on this sheet.");
      return;
    }
    const brief = scanBriefForLayer(activeLayerId);
    setBlakeAskHotCold(brief.targets.includes("hot-cold"));
    setBlakeAskWaste(brief.targets.includes("waste"));
    setBlakeAskHeating(brief.targets.includes("heating"));
    setBlakeAskFixtures(brief.targets.includes("fixtures"));
    setError(null);
    setBlakeAskOpen(true);
  }

  function confirmBlakeAsk() {
    const targets = blakeAskTargets();
    if (!targets.length) {
      setError("Pick at least one thing for Blake to look for.");
      return;
    }
    const instruction = (blakeChatDraft || blakeAskNote).trim();
    if (instruction) setBlakeAskNote(instruction);
    setBlakeAskOpen(false);
    void runAiAssist({
      drawingScope: blakeAskScope,
      targets,
      instruction,
    });
  }

  async function runAiAssist(intent?: {
    drawingScope: "current" | "project";
    targets: Array<"hot-cold" | "waste" | "heating" | "fixtures">;
    instruction?: string;
  }) {
    const doc = activeDoc || drawingDocs[0] || null;
    if (!selected) {
      setError("Create or select a project first.");
      return;
    }
    if (!doc) {
      setError("Upload a PDF drawing first, then find CAD plumbing on this sheet.");
      return;
    }
    const defaultTargets = scanBriefForLayer(activeLayerId).targets;
    const brief = intent || {
      drawingScope: "current" as const,
      targets: (defaultTargets.length ? defaultTargets : ["hot-cold", "fixtures"]) as Array<"hot-cold" | "waste" | "heating" | "fixtures">,
    };
    const wantHotCold = brief.targets.includes("hot-cold");
    const wantWaste = brief.targets.includes("waste");
    const wantHeating = brief.targets.includes("heating");
    const wantFixtures = brief.targets.includes("fixtures");
    const allowedRoles = new Set<"hot" | "cold" | "waste">([
      ...(wantHotCold || wantHeating ? (["hot", "cold"] as const) : []),
      ...(wantWaste ? (["waste"] as const) : []),
    ]);
    const lookingFor = lookingForLabel(brief.targets, activeLayerId);

    setBusy("ai");
    setError(null);
    setNotice(null);
    const steps = [
      `Blake is looking for: ${lookingFor}`,
      "Reading the open PDF…",
      wantHotCold || wantWaste || wantHeating
        ? "Tracing coloured CAD pipe lines you asked for…"
        : "Skipping pipe colours for this brief…",
      wantFixtures ? "Placing fixture pins from tags…" : "Skipping fixture pins for this brief…",
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

      setBlakeStep(
        brief.drawingScope === "current"
          ? `Reading text from this drawing (${doc.fileName})…`
          : "Reading text from open drawing(s)…",
      );
      const clientExtracts = [];
      // Keep memory light on live: current only, or active + at most one sibling.
      const drawingsForBlake = brief.drawingScope === "current"
        ? [doc]
        : [
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

      const clientStrokeRuns = [];
      if (allowedRoles.size > 0) {
        setBlakeStep(
          `Looking for ${[
            wantHotCold || wantHeating ? "hot/cold (or heating) colours" : null,
            wantWaste ? "waste colours" : null,
          ].filter(Boolean).join(" + ")} in CAD lines…`,
        );
        for (const drawing of drawingsForBlake.slice(0, brief.drawingScope === "current" ? 1 : 1)) {
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
              runs: (strokes.runs || []).filter((run) =>
                run?.role === "hot" || run?.role === "cold" || run?.role === "waste"
                  ? allowedRoles.has(run.role)
                  : false,
              ),
              colouredStrokeCount: strokes.colouredStrokeCount,
            });
          } catch {
            // Server may still extract strokes if client path fails.
          }
        }
      } else {
        setBlakeStep("No pipe colours in this brief — skipping CAD line scan…");
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
      if (textItems < 8 && strokeRuns === 0 && (wantFixtures || allowedRoles.size > 0)) {
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

      setBlakeStep(`Blake is scanning for: ${lookingFor}…`);
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/blake-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientExtracts,
          clientStrokeRuns,
          pageImages,
          clientScales: studio.scales,
          intent: {
            drawingScope: brief.drawingScope,
            focusDocumentId: doc.id,
            targets: brief.targets,
            layerId: activeLayerId,
            instruction: intent?.instruction || blakeAskNote.trim() || undefined,
            includeElectrical: /electrical|lighting|socket|switch/.test(blakeAskNote.toLowerCase()) && /include|look for|price the electrical/.test(blakeAskNote.toLowerCase()),
          },
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
        rejectedCodes: aiReviewRows.map((row) => row.code).filter(Boolean),
        trade: "plumbing",
        actor: authName || "Office",
      });
      setReviewOpen(false);
      setBlakeAskOpen(true);
      setBlakeChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Those pins will not come back. Tell me why if you want — e.g. “That was a light switch — I’m a plumber. Only pipework and sanitary.” That changes the next scan.",
        },
      ]);
      show(`Pins rejected and remembered — they will not be re-proposed. Talk to Blake below · ${authName || "Office"}.`);
      void refreshTakeoffAudit(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject AI counts.");
    } finally {
      setBusy(null);
    }
  }

  async function sendBlakeTakeoffChat() {
    const text = blakeChatDraft.trim() || blakeAskNote.trim();
    if (!selected || !text || blakeChatBusy) return;
    setBlakeChatBusy(true);
    setBlakeChatDraft("");
    setBlakeAskNote("");
    setBlakeChatMessages((current) => [...current, { role: "user", text }]);
    try {
      const response = await apiFetch("/api/nexa-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: blakeChatMessages.concat({ role: "user", text }).map((item) => ({ role: item.role, text: item.text })),
          screenContext: {
            view: "takeoff",
            takeoffId: selected.id,
            tenderId: selected.sourceTenderId || undefined,
            jobId: selected.linkedJobId || undefined,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      setBlakeChatMessages((current) => [
        ...current,
        { role: "assistant", text: payload.reply || payload.error || "Blake could not reply." },
      ]);
    } catch {
      setBlakeChatMessages((current) => [
        ...current,
        { role: "assistant", text: "Could not reach Blake just now. Nothing was changed." },
      ]);
    } finally {
      setBlakeChatBusy(false);
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

  async function prepareBoqForPush(options: { allowPendingAiReview?: boolean } = {}): Promise<{
    materials: ReturnType<typeof priceAndExpandTakeoffMaterials>;
    priced: ReturnType<typeof summarisePricedMaterials>;
  } | null> {
    if (!selected) return null;
    if (hasPendingAiReview && !options.allowPendingAiReview) {
      const ok = window.confirm(
        "Blake fixture pins are still pending review. Push the BOQ to Core anyway?",
      );
      if (!ok) {
        setReviewOpen(true);
        show("Confirm or reject Blake’s fixture pins, then Push — or override from Push again.", 12000);
        return null;
      }
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
        return null;
      }
    }
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
    if (!patch.ok) {
      const body = (await patch.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Could not prepare BOQ");
    }
    return { materials, priced };
  }

  async function pushToTender(options: { allowPendingAiReview?: boolean } = {}) {
    if (!selected) return;
    const tenderId = selected.sourceTenderId;
    if (!tenderId) {
      setRailCollapsed(false);
      show("Link a tender under Linked, then Push to tender.", 10000);
      return;
    }
    if (hasPendingAiReview && !options.allowPendingAiReview) {
      const ok = window.confirm(
        "Blake fixture pins are still pending review. Push the BOQ to the tender anyway?",
      );
      if (!ok) {
        setReviewOpen(true);
        show("Confirm or reject Blake’s fixture pins, then Push — or override from Push again.", 12000);
        return;
      }
      await pushToTender({ allowPendingAiReview: true });
      return;
    }
    setBusy("push");
    setError(null);
    try {
      const prepared = await prepareBoqForPush({ allowPendingAiReview: true });
      if (!prepared) {
        setBusy(null);
        return;
      }
      const push = await apiFetch(`/api/takeoff-projects/${selected.id}/push-to-tender`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderId,
          actor: authName || "Office",
          allowPendingAiReview: Boolean(options.allowPendingAiReview),
        }),
      });
      if (!push.ok) {
        const body = (await push.json().catch(() => ({}))) as { error?: string; code?: string };
        if (body.code === "AI_REVIEW_PENDING") {
          setReviewOpen(true);
        }
        throw new Error(body.error || `Push to tender failed (${push.status})`);
      }
      const result = (await push.json()) as {
        project: TakeoffProject;
        tender: { id: string; name: string };
        lineCount?: number;
        sheetCount?: number;
        sellTotal?: number;
        note?: string;
      };
      upsert(result.project);
      show(
        `Updated tender “${result.tender.name}” with ${result.lineCount ?? 0} BoQ line(s)`
        + (result.sheetCount ? ` across ${result.sheetCount} layer sheet(s)` : "")
        + (typeof result.sellTotal === "number" && result.sellTotal > 0
          ? ` · ≈ £${result.sellTotal.toFixed(0)}`
          : "")
        + ". Open Core → Tenders → BoQ to review Takeoff · Hot & cold / Heating / Gas sheets.",
        16000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push to tender failed");
    } finally {
      setBusy(null);
    }
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
        show(
          selected.sourceTenderId
            ? "Use Push to tender for the linked tender, or link a quote / tap New quote."
            : "Link a quote under Linked, or tap New quote.",
          10000,
        );
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
    setBusy("push");
    setError(null);
    try {
      const prepared = await prepareBoqForPush({ allowPendingAiReview: true });
      if (!prepared) {
        setBusy(null);
        return;
      }
      const { priced } = prepared;
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
        throw new Error(body.error || `Push failed (${push.status})`);
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

  function primaryPushAction(): "tender" | "quote" | "new-quote" {
    if (selected?.sourceTenderId) return "tender";
    if (selected?.linkedQuoteId) return "quote";
    return "new-quote";
  }

  function runPrimaryPush() {
    const action = primaryPushAction();
    if (action === "tender") {
      void pushToTender();
      return;
    }
    void pushToCore(action === "new-quote" ? { createNew: true } : undefined);
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
        : selected?.sourceTenderId || selected?.linkedQuoteId
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
      openBlakeAsk();
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
      runPrimaryPush();
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
          <span className={`pill save-${saveState}`} title={savedAt ? `Last saved ${new Date(savedAt).toLocaleString()}` : undefined}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Save failed"
                : savedAt
                  ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Saved"}
          </span>
          {authName ? <span className="pill muted-pill">{authName}</span> : null}
          <button type="button" className="nexa-studio-ai" disabled={busy === "ai" || !selected} onClick={() => openBlakeAsk()}>
            {busy === "ai" ? <Loader2 className="spin" size={16} /> : <BuddyCharacter mood="idle" size="sm" interactive={false} />}
            {scanBriefForLayer(activeLayerId).title.replace(/ on this sheet$/i, "")}
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void uploadDrawings(e)} />
        </div>
      </header>

      {blakeAskOpen ? (
        <div className="nexa-studio-blake-overlay" role="dialog" aria-modal="true" aria-labelledby="blake-ask-title">
          <div className="nexa-studio-blake-card nexa-studio-blake-ask">
            <BuddyCharacter mood="guide" size="md" interactive={false} />
            <strong id="blake-ask-title">{scanBriefForLayer(activeLayerId).title}</strong>
            <p>
              Blake is looking for: {lookingForLabel(blakeAskTargets(), activeLayerId)}. Not a mystery scan. Talk first if you want — then scan this sheet.
            </p>

            <fieldset className="nexa-studio-blake-ask-group">
              <legend>Drawing</legend>
              <label className={blakeAskScope === "current" ? "on" : undefined}>
                <input
                  type="radio"
                  name="blake-scope"
                  checked={blakeAskScope === "current"}
                  onChange={() => setBlakeAskScope("current")}
                />
                <span>
                  <strong>This drawing only</strong>
                  <em>{activeDoc?.fileName || "Open sheet"}</em>
                </span>
              </label>
              <label className={blakeAskScope === "project" ? "on" : undefined}>
                <input
                  type="radio"
                  name="blake-scope"
                  checked={blakeAskScope === "project"}
                  onChange={() => setBlakeAskScope("project")}
                />
                <span>
                  <strong>This sheet + one more</strong>
                  <em>Max 2 PDFs this pass — not a ChatGPT dump of the whole pack</em>
                </span>
              </label>
            </fieldset>

            <fieldset className="nexa-studio-blake-ask-group">
              <legend>Find</legend>
              <label className={blakeAskHotCold ? "on" : undefined}>
                <input
                  type="checkbox"
                  checked={blakeAskHotCold}
                  onChange={(e) => setBlakeAskHotCold(e.target.checked)}
                />
                <span>
                  <strong>Hot &amp; cold runs</strong>
                  <em>Coloured CAD hot/cold pipe strokes</em>
                </span>
              </label>
              <label className={blakeAskWaste ? "on" : undefined}>
                <input
                  type="checkbox"
                  checked={blakeAskWaste}
                  onChange={(e) => setBlakeAskWaste(e.target.checked)}
                />
                <span>
                  <strong>Waste / soil runs</strong>
                  <em>Coloured waste / drainage strokes</em>
                </span>
              </label>
              <label className={blakeAskHeating ? "on" : undefined}>
                <input
                  type="checkbox"
                  checked={blakeAskHeating}
                  onChange={(e) => setBlakeAskHeating(e.target.checked)}
                />
                <span>
                  <strong>Heating flow &amp; return</strong>
                  <em>Heating-coloured lines + plant-oriented plan</em>
                </span>
              </label>
              <label className={blakeAskFixtures ? "on" : undefined}>
                <input
                  type="checkbox"
                  checked={blakeAskFixtures}
                  onChange={(e) => setBlakeAskFixtures(e.target.checked)}
                />
                <span>
                  <strong>Sanitary / plant tags</strong>
                  <em>WCs, basins, radiators on this layer — not light switches or pendants</em>
                </span>
              </label>
            </fieldset>

            <p className="nexa-studio-blake-ask-note">
              Blake reads coloured CAD strokes and text on the open PDF — not a ChatGPT dump of six files. Guide quantities only, not a firm tender. Type e.g. “ignore electrical”, “we don’t do ventilation”, “price the plumbing bill only”.
            </p>

            {blakeChatMessages.length ? (
              <div className="nexa-studio-blake-chat">
                {blakeChatMessages.slice(-8).map((item, index) => (
                  <p key={`${item.role}-${index}`} className={item.role === "user" ? "you" : "blake"}>
                    <strong>{item.role === "user" ? "You" : "Blake"}</strong>
                    {item.text}
                  </p>
                ))}
              </div>
            ) : null}

            <label className="nexa-studio-blake-chat-compose">
              Talk to Blake
              <textarea
                value={blakeChatDraft}
                onChange={(event) => setBlakeChatDraft(event.target.value)}
                placeholder="ignore electrical — I’m a plumber. Only pipework and sanitary."
                rows={3}
              />
            </label>
            <div className="nexa-studio-blake-ask-actions">
              <button type="button" className="ghost" onClick={() => setBlakeAskOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="ghost"
                disabled={blakeChatBusy || !(blakeChatDraft.trim() || blakeAskNote.trim())}
                onClick={() => void sendBlakeTakeoffChat()}
              >
                {blakeChatBusy ? "Sending…" : "Send"}
              </button>
              <button type="button" className="go" onClick={() => confirmBlakeAsk()}>
                Scan this sheet
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {blakeStep ? (
        <div className="nexa-studio-blake-overlay" role="status" aria-live="polite">
          <div className="nexa-studio-blake-card">
            <BuddyCharacter mood="thinking" size="md" interactive={false} />
            <strong>Blake is working</strong>
            <p>{blakeStep}</p>
            <Loader2 className="spin" size={20} />
          </div>
        </div>
      ) : null}

      {/* Notice/error + Blake review overlay canvas — scale alerts live in the rail (in-flow). */}
      <div className="nexa-studio-banner-stack" aria-live="polite">
        {(notice || error) ? (
          <div className={`nexa-studio-banner ${error ? "error" : "ok"}`}>
            <span>{error || notice}</span>
            {error && selectedId ? (
              <span className="nexa-studio-banner-actions">
                <button
                  type="button"
                  onClick={() => {
                    const ok = downloadTakeoffStudioLocalDraft(selectedId);
                    show(
                      ok
                        ? "Downloaded local autosave JSON — keep that file safe."
                        : "No local autosave found yet — keep marking so one is written.",
                      8000,
                    );
                  }}
                >
                  Download local backup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selected) return;
                    void persistStudio(studio, {}, { skipHistory: true, immediate: true });
                  }}
                >
                  Retry save
                </button>
              </span>
            ) : null}
          </div>
        ) : null}

        {selected && hasPendingAiReview ? (
          <div className="nexa-studio-banner warn nexa-studio-ai-review-banner">
            <span>
              Blake: {aiReviewPinCount || blakePinCount} fixture pin{(aiReviewPinCount || blakePinCount) === 1 ? "" : "s"} to confirm
              {blakePipeRunCount > 0 ? ` · ${blakePipeRunCount} pipe run(s) in BOQ` : ""}.
            </span>
            <button type="button" onClick={() => setReviewOpen(true)}>Review pins</button>
          </div>
        ) : null}
      </div>

      <div className={`nexa-studio-body${railCollapsed ? " rail-collapsed" : ""}`}>
        <aside className={`nexa-studio-rail${railCollapsed ? " is-collapsed" : ""}`}>
          <button
            type="button"
            className="nexa-studio-rail-toggle"
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((value) => !value)}
          >
            <FolderOpen size={15} />
            <span>{railCollapsed ? "Links & drawings" : "Hide panel"}</span>
            <strong>
              {linkedTender?.name
                || linkedQuote?.ref
                || linkedJob?.ref
                || selected?.reference
                || "Takeoff"}
            </strong>
          </button>

          {/* LAYOUT QA: absolute scrollport inside rail — every section lives here. */}
          <div
            className="nexa-studio-rail-scroll"
            onWheel={(event) => {
              // Keep wheel/trackpad scroll on the rail; do not let canvas zoom handlers steal it.
              event.stopPropagation();
            }}
          >
            {!selected ? (
              <section className="nexa-studio-rail-acc is-open">
                <button type="button" className="nexa-studio-rail-acc-toggle" aria-expanded>
                  <FolderOpen size={14} aria-hidden />
                  <h2>Takeoffs</h2>
                  <ChevronDown size={14} aria-hidden />
                </button>
                <div className="nexa-studio-rail-acc-body">
                  <p className="muted">Create or open a takeoff, then link a tender and pick drawings.</p>
                  <div className="nexa-studio-create">
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="New takeoff name"
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
                          title="Delete takeoff"
                          disabled={busy === `delete-${project.id}`}
                          onClick={() => void deleteProject(project.id, project.reference)}
                        >
                          {busy === `delete-${project.id}` ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {selected ? (
              <>
              <section className={`nexa-studio-rail-acc${railAccordions.link ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="nexa-studio-rail-acc-toggle"
                  aria-expanded={railAccordions.link}
                  onClick={() => toggleRailAccordion("link")}
                >
                  <h2>Linked</h2>
                  <span className="nexa-studio-rail-acc-meta">
                    {linkedTender || linkedQuote || linkedJob
                      ? [linkedTender?.name, linkedQuote?.ref, linkedJob?.ref].filter(Boolean).join(" · ")
                      : "Tender / quote / job"}
                  </span>
                  <ChevronDown size={14} aria-hidden />
                </button>
                {railAccordions.link ? (
                  <div className="nexa-studio-rail-acc-body nexa-studio-core-link">
                    <label>
                      Tender
                      <select
                        value={selected.sourceTenderId || ""}
                        onChange={(e) => {
                          const sourceTenderId = e.target.value || undefined;
                          const previousTenderId = selected.sourceTenderId || undefined;
                          const tenderChanged = previousTenderId !== sourceTenderId;
                          if (tenderChanged) {
                            const markupCount = countMarkupsOnTenderDocuments(studio, drawingDocs);
                            if (markupCount > 0) {
                              const ok = window.confirm(
                                "Switch Linked tender? Markups on this tender’s drawings stay saved and come back when you switch back — they won’t stay visible on the other tender’s sheets.",
                              );
                              if (!ok) {
                                e.target.value = previousTenderId || "";
                                return;
                              }
                            }
                          }
                          void (async () => {
                            const beforeLocal = drawingDocs.filter(
                              (doc) => !takeoffSourceTenderDocId(doc.notes),
                            ).length;
                            const merged = await persistStudio(studio, { sourceTenderId }, { skipHistory: true, immediate: true });
                            if (!merged) return;
                            const nextDocs = (merged.documents || []).filter(
                              (doc) =>
                                doc.kind === "Drawing"
                                || doc.kind === "Marked-up drawing"
                                || (doc.mimeType || "").includes("pdf"),
                            );
                            const nextSourced = nextDocs.filter((doc) => takeoffSourceTenderDocId(doc.notes)).length;
                            const nextLocal = nextDocs.length - nextSourced;
                            if (sourceTenderId && tenderChanged) {
                              const archiveRestored = Boolean(
                                previousTenderId
                                && (merged.studioTenderArchives?.[sourceTenderId]?.geometries?.length
                                  || merged.studio?.geometries?.some((geo) =>
                                    nextDocs.some((doc) => doc.id === geo.documentId && takeoffSourceTenderDocId(doc.notes)),
                                  )),
                              );
                              const keptLocal = nextLocal > 0 && beforeLocal > 0
                                ? ` · kept ${nextLocal} local upload${nextLocal === 1 ? "" : "s"}`
                                : "";
                              const restoredNote = archiveRestored ? " · restored saved markups" : "";
                              show(
                                nextSourced > 0
                                  ? `Linked tender · ${nextSourced} drawing${nextSourced === 1 ? "" : "s"} from this tender${restoredNote}${keptLocal}`
                                  : `Linked tender${restoredNote}${keptLocal || " · no drawings on tender"}`,
                              );
                            } else if (sourceTenderId) {
                              show("Linked tender");
                            } else {
                              show(
                                tenderChanged && beforeLocal > 0
                                  ? `Tender unlinked · kept ${beforeLocal} local upload${beforeLocal === 1 ? "" : "s"}`
                                  : "Tender unlinked",
                              );
                            }
                          })();
                        }}
                      >
                        <option value="">Select Core tender</option>
                        {tenders.map((tender) => (
                          <option key={tender.id} value={tender.id}>
                            {tender.externalId ? `${tender.externalId} · ` : ""}
                            {tender.name} · {tender.client}
                            {tender.drawingCount ? ` · ${tender.drawingCount} dwg` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {linkedTender ? (
                      <div className="nexa-studio-link-status">
                        <span>
                          {linkedTender.status}
                          {tenderDrawingCount
                            ? ` · ${sourcedFromTenderCount}/${tenderDrawingCount} drawings synced`
                            : " · no drawings on tender"}
                        </span>
                        <a className="ghost link" href={`/?view=tenders`}>
                          Open tenders in Core
                          <ExternalLink size={13} />
                        </a>
                      </div>
                    ) : null}
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

                    <label>
                      Job
                      <select
                        value={selected.linkedJobId || ""}
                        onChange={(e) => {
                          const linkedJobId = e.target.value || undefined;
                          const job = jobs.find((row) => row.id === linkedJobId);
                          void persistStudio(studio, {
                            linkedJobId,
                            linkedJobRef: linkedJobId ? job?.ref : undefined,
                          });
                        }}
                      >
                        <option value="">Select Core job</option>
                        {jobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.ref} · {job.customer}
                          </option>
                        ))}
                      </select>
                    </label>
                    {linkedJob ? (
                      <a className="ghost link" href={`/?view=jobs`}>
                        Open {linkedJob.ref} in Core
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                    <div className="nexa-studio-push-actions">
                      {selected.sourceTenderId ? (
                        <button
                          type="button"
                          className="nexa-studio-primary"
                          disabled={busy === "push"}
                          onClick={() => void pushToTender()}
                        >
                          {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                          Push to tender
                        </button>
                      ) : null}
                      {selected.linkedQuoteId ? (
                        <button
                          type="button"
                          className={selected.sourceTenderId ? "ghost" : "nexa-studio-primary"}
                          disabled={busy === "push"}
                          onClick={() => void pushToCore()}
                        >
                          {busy === "push" && !selected.sourceTenderId ? <Loader2 className="spin" size={14} /> : null}
                          Push BOQ + drawings
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={
                          selected.sourceTenderId || selected.linkedQuoteId ? "ghost" : "nexa-studio-primary"
                        }
                        disabled={busy === "push"}
                        onClick={() => void pushToCore({ createNew: true })}
                      >
                        {busy === "push" && !selected.sourceTenderId && !selected.linkedQuoteId ? (
                          <Loader2 className="spin" size={14} />
                        ) : null}
                        {selected.linkedQuoteId ? "New quote instead" : "Push to new quote"}
                      </button>
                      {selected.linkedJobId ? (
                        <p className="muted">
                          Job {linkedJob?.ref || selected.linkedJobRef} is linked for reference — push BoQ via tender or
                          quote, then convert in Core.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>

              {!boqOpen ? (
                <>
                {activeDoc && !hasScale ? (
                  <p className="nexa-studio-rail-alert nexa-studio-boq-scale-warn" role="status">
                    Set scale on this page before measuring — Scale tool or 1:N chip → two points → metres.
                  </p>
                ) : null}
                {unscaledLinearCount > 0 ? (
                  <p className="nexa-studio-rail-alert nexa-studio-boq-scale-warn" role="status">
                    {unscaledLinearCount} run{unscaledLinearCount === 1 ? "" : "s"} need Set scale
                    {unscaledLinearSummary.pageLabels.length
                      ? ` — ${unscaledLinearSummary.pageLabels.join(", ")}`
                      : ""}.
                  </p>
                ) : null}
                <section className={`nexa-studio-rail-acc${railAccordions.drawings ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="nexa-studio-rail-acc-toggle"
                    aria-expanded={railAccordions.drawings}
                    onClick={() => toggleRailAccordion("drawings")}
                  >
                    <h2>Drawings</h2>
                    <span className="nexa-studio-rail-acc-meta">
                      {activeDrawingSetLabel
                        ? `${activeDrawingSetLabel} · ${activeDoc?.fileName || ""}`
                        : activeDoc?.fileName || `${drawingDocs.length} PDF`}
                    </span>
                    <ChevronDown size={14} aria-hidden />
                  </button>
                  {railAccordions.drawings ? (
                    <div className="nexa-studio-rail-acc-body">
                      {/* List first, compact dropzone after — never stack dropzone over names. */}
                      <div className="nexa-studio-doc-list">
                        {drawingDocs.length ? drawingDocs.map((doc: TakeoffDocument) => {
                          const setLabel = takeoffSourceFolderLabel(doc.notes);
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              className={doc.id === activeDoc?.id ? "on" : undefined}
                              title={takeoffDrawingDisplayLabel(doc.fileName, doc.notes)}
                              onClick={() => void persistStudio({ ...studio, activeDocumentId: doc.id, activePage: 1 })}
                            >
                              {setLabel ? <strong className="nexa-studio-doc-set">{setLabel}</strong> : null}
                              <span className="nexa-studio-doc-name">{doc.fileName}</span>
                            </button>
                          );
                        }) : <p className="muted">Upload a PDF or sync from the linked tender.</p>}
                      </div>
                      {selected.sourceTenderId ? (
                        <div className="nexa-studio-drawing-sync">
                          {tenderDrawingCount > 0 ? (
                            <p className="muted">
                              {sourcedFromTenderCount >= tenderDrawingCount
                                ? `Showing all ${tenderDrawingCount} tender drawing${tenderDrawingCount === 1 ? "" : "s"}.`
                                : `Showing ${sourcedFromTenderCount} of ${tenderDrawingCount} from tender${
                                    tenderDrawingsPending ? ` — ${tenderDrawingsPending} not loaded yet` : ""
                                  }.`}
                            </p>
                          ) : (
                            <p className="muted">Linked tender has no drawing-kind PDFs in Documents yet.</p>
                          )}
                          <button
                            type="button"
                            className="ghost"
                            disabled={busy === "sync-drawings"}
                            onClick={() => void syncTenderDrawings()}
                          >
                            {busy === "sync-drawings" ? <Loader2 className="spin" size={14} /> : null}
                            {tenderDrawingsPending > 0 ? "Load remaining from tender" : "Sync from tender"}
                          </button>
                        </div>
                      ) : null}
                      <FileDropZone
                        accept="application/pdf,.pdf"
                        multiple
                        compact
                        disabled={busy === "upload" || !selected}
                        label={busy === "upload" ? "Uploading…" : "Drop PDF or click"}
                        hint="PDF drawing sets"
                        onFiles={(files) => void uploadDrawingFiles(files)}
                        className="nexa-studio-drawing-drop"
                      />
                      <div className="nexa-studio-layer-list nexa-studio-layer-list-compact" role="tablist" aria-label="Service layers">
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
                          placeholder="New layer"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addCustomLayer();
                          }}
                        />
                        <button type="button" className="ghost" onClick={addCustomLayer}>
                          <Plus size={14} />
                          Add
                        </button>
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
                          Save layer
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
                          Save all
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
                </>
              ) : null}

{!boqOpen ? (
                <section className={`nexa-studio-rail-acc nexa-studio-rail-acc-draw${railAccordions.draw ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="nexa-studio-rail-acc-toggle"
                    aria-expanded={railAccordions.draw}
                    onClick={() => toggleRailAccordion("draw")}
                  >
                    <h2>Draw as</h2>
                    <span className="nexa-studio-rail-acc-meta">
                      {activeClass?.name || `${visibleClassifications.length} tools`}
                    </span>
                    <ChevronDown size={14} aria-hidden />
                  </button>
                  {railAccordions.draw ? (
                    <div className="nexa-studio-rail-acc-body">
                      <div className="nexa-studio-class-list">
                        {drawAsGroups.map((section) => {
                          const groupOpen = Boolean(openClassGroups[section.key]);
                          const groupHasActive = section.items.some(
                            (cls) => cls.id === studio.activeClassificationId,
                          );
                          return (
                            <div
                              key={section.key}
                              className={`nexa-studio-class-group${groupOpen ? " is-open" : ""}${groupHasActive ? " has-active" : ""}`}
                            >
                              <button
                                type="button"
                                className="nexa-studio-class-group-toggle"
                                aria-expanded={groupOpen}
                                onClick={() => {
                                  setOpenClassGroups((prev) => ({
                                    ...prev,
                                    [section.key]: !prev[section.key],
                                  }));
                                }}
                              >
                                <span className="nexa-studio-class-group-label">{section.label}</span>
                                <strong>
                                  {section.items.length} item{section.items.length === 1 ? "" : "s"}
                                </strong>
                                <ChevronDown size={14} aria-hidden />
                              </button>
                              {groupOpen ? (
                                <div className="nexa-studio-class-group-body">
                                  {section.items.map((cls) => {
                                    const qty = quantities.find((row) => row.classificationId === cls.id);
                                    const isActive = cls.id === studio.activeClassificationId;
                                    const activeSpecId = studio.activePipeSpecId || DEFAULT_STUDIO_PIPE_SPEC_ID;
                                    const activeSpec = STUDIO_PIPE_SPECS.find((spec) => spec.id === activeSpecId);
                                    return (
                                      <div
                                        key={cls.id}
                                        className={`nexa-studio-class-row${isActive ? " on" : ""}`}
                                      >
                                        <div className="nexa-studio-class-row-main">
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
                                            aria-expanded={isActive && cls.kind === "linear" ? drawSizesOpen : undefined}
                                            onClick={() => {
                                              if (isActive && cls.kind === "linear") {
                                                setDrawSizesOpen((open) => !open);
                                                return;
                                              }
                                              void persistStudio({
                                                ...studio,
                                                activeClassificationId: cls.id,
                                                tool: cls.kind,
                                                activeLayerId: classificationLayer(cls),
                                              });
                                              setDrawSizesOpen(cls.kind === "linear");
                                            }}
                                          >
                                            <span>
                                              <strong>{cls.name}</strong>
                                              <small>
                                                {cls.kind}
                                                {cls.kind === "linear" && isActive && activeSpec
                                                  ? ` · ${activeSpec.label}`
                                                  : ""}
                                                {" · "}
                                                {qty?.pieces || 0} item{(qty?.pieces || 0) === 1 ? "" : "s"}
                                              </small>
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
                                        {isActive && cls.kind === "linear" ? (
                                          <div className={`nexa-studio-draw-sizes${drawSizesOpen ? " is-open" : ""}`}>
                                            <button
                                              type="button"
                                              className="nexa-studio-draw-sizes-toggle"
                                              aria-expanded={drawSizesOpen}
                                              onClick={() => setDrawSizesOpen((open) => !open)}
                                            >
                                              <span className="nexa-studio-draw-sizes-label">Size</span>
                                              <strong>{activeSpec?.label || "Pick"}</strong>
                                              <ChevronDown size={14} aria-hidden />
                                            </button>
                                            {drawSizesOpen ? (
                                              <div className="nexa-studio-draw-sizes-chips" role="group" aria-label={`Pipe size for ${cls.name}`}>
                                                {STUDIO_PIPE_SPECS.map((spec) => {
                                                  const active = activeSpecId === spec.id;
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
                                              </div>
                                            ) : null}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
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
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className={`nexa-studio-rail-acc${railAccordions.more ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="nexa-studio-rail-acc-toggle"
                  aria-expanded={railAccordions.more}
                  onClick={() => toggleRailAccordion("more")}
                >
                  <h2>More</h2>
                  <span className="nexa-studio-rail-acc-meta">Records · propose · rates</span>
                  <ChevronDown size={14} aria-hidden />
                </button>
                {railAccordions.more ? (
                  <div className="nexa-studio-rail-acc-body">
                    <div className="nexa-studio-more-projects">
                      <header>
                        <h2>Takeoff records</h2>
                        <span className="muted">{selected.reference}</span>
                      </header>
                      <p className="muted">Internal takeoff id for persistence — day-to-day work is Linked + Drawings.</p>
                      <div className="nexa-studio-create">
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          placeholder="New takeoff name"
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
                              title="Delete takeoff"
                              disabled={busy === `delete-${project.id}`}
                              onClick={() => void deleteProject(project.id, project.reference)}
                            >
                              {busy === `delete-${project.id}` ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`ghost${proposeOpen ? " on" : ""}`}
                      disabled={busy === "propose"}
                      onClick={() => setProposeOpen((open) => !open)}
                    >
                      {proposeOpen ? "Hide propose" : "Propose plant / routes"}
                    </button>
                    <section className="nexa-studio-rates-rail">
                      <header>
                        <h2>Rates &amp; assemblies</h2>
                        <button type="button" className="ghost" onClick={() => setRatesOpen((open) => !open)}>
                          {ratesOpen ? "Hide" : "Edit"}
                        </button>
                      </header>
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
                            <p className="muted">No takeoff log yet.</p>
                          )}
                        </>
                      ) : null}
                    </section>
                  </div>
                ) : null}
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
                onRejectClass={(code, description) => {
                  recordTakeoffLearningClient({
                    type: "ai_reject",
                    projectId: selected.id,
                    codes: [code],
                    rejectedCodes: [code, description].filter(Boolean),
                    trade: "plumbing",
                    actor: authName || "Office",
                  });
                }}
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
                  <button
                    type="button"
                    className="nexa-studio-primary"
                    disabled={busy === "push"}
                    onClick={() => runPrimaryPush()}
                  >
                    {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                    {selected.sourceTenderId
                      ? "Push master BOQ to tender"
                      : selected.linkedQuoteId
                        ? "Push master BOQ"
                        : "Push to new quote"}
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
