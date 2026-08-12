"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { BuddyCharacter } from "@/lib/BuddyCharacter";
import {
  autoMarkExteriorWalls,
  applyPlanScaleCalibration,
  buildUfhCircuitsOnLayout,
  calculateRoomHeatLoss,
  calculateSystemDesign,
  compareHeatingOptions,
  heatPumpCatalogue,
  heatingSystemOptions,
  isDecimalDraft,
  isSignedDecimalDraft,
  clampDesignExternalTemp,
  numberFromInput,
  kitExtraOptions,
  kw,
  makeBlankRoom,
  makeBlankProject,
  makeDemoProject,
  money,
  normaliseProject,
  pickRadiatorForRoom,
  recommendedRadiatorsForRoom,
  applyBlakePipeSizing,
  seedHeatingLayout,
  suggestHeatPump,
  summariseHeatingFittings,
  ufhWorkflowStatus,
  wattsLabel,
  buildEras,
  ceilingTypes,
  clampFlowTempToSystem,
  defaultFlowTempForSystem,
  floorTypes,
  flowTempOptionsForSystem,
  glazingTypes,
  placePlantOnLayout,
  propertyTypes,
  radiatorRanges,
  readPlanUnderlayBlob,
  roomTypes,
  wallTypes,
  type HeatDesignProject,
  type HeatDesignRoom,
  type HeatingEmitterMode,
  type HeatingFittingsSummary,
  type HeatingPlantKind,
  type HeatingSystemLayout,
  type PlanPoint,
  type PlanUnderlay,
  type UfhDesignSummary,
  type UfhPattern,
  type UfhSpacingMm,
} from "@/lib/heat-design";
import { useBrand } from "@/components/BrandProvider";
import { resolveBrandLogoUrl } from "@/lib/branding";
import {
  chipClassForPricingState,
  derivePricingState,
  PRICING_STATE_HINT,
  PRICING_STATE_LABEL,
} from "@/lib/price-ledger";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { MaterialsWizard } from "./MaterialsWizard";
import { DesignReport } from "./DesignReport";
import "./heat-design.css";

const STORAGE_KEY = "nexa-heat-design-lab-v9";
const PROJECTS_CACHE_KEY = `${STORAGE_KEY}-projects`;
const LEGACY_STORAGE_KEYS = [
  STORAGE_KEY,
  "nexa-heat-design-lab-v8",
  "nexa-heat-design-lab-v7",
  "nexa-heat-design-lab-v6",
  "nexa-heat-design-lab-v5",
  "nexa-heat-design-lab-v4",
  "nexa-heat-design-lab-v3",
  "nexa-heat-design-lab-v2",
  "nexa-heat-design-lab-v1",
] as const;

type LabTab = "project" | "plan" | "materials" | "rooms" | "system" | "options" | "kit" | "forms" | "report";
type LinkTarget = "job" | "quote" | "tender";
type SaveStatus = "loading" | "saving" | "saved" | "offline" | "error";

function readCachedProject(): HeatDesignProject | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = window.localStorage.getItem(key);
      if (raw) return normaliseProject(JSON.parse(raw) as HeatDesignProject);
    }
  } catch {
    return null;
  }
  return null;
}

function readCachedProjects() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HeatDesignProject[];
    return Array.isArray(parsed) ? parsed.map((item) => normaliseProject(item)) : [];
  } catch {
    return [];
  }
}

function upsertProjectList(projects: HeatDesignProject[], project: HeatDesignProject) {
  const normalised = normaliseProject(project);
  const next = projects.some((item) => item.id === normalised.id)
    ? projects.map((item) => (item.id === normalised.id ? normalised : item))
    : [normalised, ...projects];
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatRevisionTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HeatDesignLabPage() {
  const brand = useBrand();
  const [tab, setTab] = useState<LabTab>("plan");
  const [projects, setProjects] = useState<HeatDesignProject[]>([]);
  const [project, setProject] = useState<HeatDesignProject | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [pendingPrint, setPendingPrint] = useState(false);
  const [layoutMode, setLayoutMode] = useState(false);
  const [takeoffBusy, setTakeoffBusy] = useState(false);
  const [blakeBusy, setBlakeBusy] = useState(false);
  const [blakeMessage, setBlakeMessage] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [underlayBusy, setUnderlayBusy] = useState(false);
  const [fittingsSummary, setFittingsSummary] = useState<HeatingFittingsSummary | null>(null);
  const [ufhSummary, setUfhSummary] = useState<UfhDesignSummary | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkTarget, setLinkTarget] = useState<LinkTarget>("quote");
  const [jobOptions, setJobOptions] = useState<Array<{ id: string; ref: string; customer: string; site: string }>>([]);
  const [quoteOptions, setQuoteOptions] = useState<Array<{ id: string; ref: string; customer: string; status: string }>>(
    [],
  );
  const [tenderOptions, setTenderOptions] = useState<
    Array<{ id: string; name: string; client: string; status: string }>
  >([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [selectedTenderId, setSelectedTenderId] = useState("");
  /** Local draft so users can type `-` / `-5` before a finite number commits. */
  const [designExternalTempDraft, setDesignExternalTempDraft] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const hydratedRef = useRef(false);
  const applyingServerSaveRef = useRef(false);
  const skipNextProjectSaveRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  /** Bumps on every local edit so stale PUT responses cannot wipe newer rooms/walls. */
  const saveGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const jobId = params?.get("jobId") || "";
    const quoteId = params?.get("quoteId") || "";
    const tenderId = params?.get("tenderId") || "";
    const projectId = params?.get("projectId") || "";

    function applyIncomingLinks(input: HeatDesignProject) {
      if (!jobId && !quoteId && !tenderId) return input;
      return {
        ...input,
        linkedJobId: jobId || input.linkedJobId,
        linkedQuoteId: quoteId || input.linkedQuoteId,
        linkedTenderId: tenderId || input.linkedTenderId,
        updatedAt: new Date().toISOString(),
      };
    }

    function activate(nextProjects: HeatDesignProject[], active: HeatDesignProject, status: SaveStatus) {
      if (cancelled) return;
      const linked = normaliseProject(applyIncomingLinks(active));
      setProjects(upsertProjectList(nextProjects, linked));
      setProject(linked);
      setSelectedRoomId(linked.rooms[0]?.id ?? null);
      setSelectedJobId(linked.linkedJobId || "");
      setSelectedQuoteId(linked.linkedQuoteId || "");
      setSelectedTenderId(linked.linkedTenderId || "");
      setSaveStatus(status);
      skipNextProjectSaveRef.current = status === "saved" && !jobId && !quoteId && !tenderId;
      if (jobId) {
        setLinkTarget("job");
        setSelectedJobId(jobId);
        setTab("kit");
      } else if (quoteId) {
        setLinkTarget("quote");
        setSelectedQuoteId(quoteId);
        setTab("kit");
      } else if (tenderId) {
        setLinkTarget("tender");
        setSelectedTenderId(tenderId);
        setTab("kit");
      }
      hydratedRef.current = true;
    }

    async function hydrateProjects() {
      const cachedProject = readCachedProject();
      const cachedProjects = readCachedProjects();
      try {
        const res = await fetch("/api/heat-design/projects", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load heat design projects");
        const data = await res.json();
        const serverProjects = (Array.isArray(data) ? data : []).map((item) => normaliseProject(item as HeatDesignProject));
        if (serverProjects.length > 0) {
          const active =
            (projectId ? serverProjects.find((item) => item.id === projectId) : undefined)
            ?? serverProjects.find((item) => item.id === cachedProject?.id)
            ?? serverProjects[0]!;
          activate(serverProjects, active, "saved");
          if (projectId && active.id === projectId) {
            setNotice(`Opened Heat Design from AI spine · ${active.name}`);
          }
          return;
        }

        if (cachedProject) {
          const migrateRes = await fetch("/api/heat-design/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cachedProject),
          });
          if (!migrateRes.ok) throw new Error("Could not migrate cached heat design project");
          const migrated = normaliseProject((await migrateRes.json()) as HeatDesignProject);
          activate([migrated], migrated, "saved");
          setNotice("Migrated your saved Heat Design project to the server.");
          return;
        }

        const blank = normaliseProject(makeBlankProject());
        activate([blank], blank, "saving");
      } catch {
        const fallback = cachedProject ?? cachedProjects[0] ?? normaliseProject(makeBlankProject());
        activate(cachedProjects.length ? cachedProjects : [fallback], fallback, "offline");
        setNotice("Offline — loaded the Heat Design cache. Changes will keep saving locally until the server is reachable.");
      }
    }

    hydrateProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    setProjects((current) => upsertProjectList(current, project));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      setNotice("Couldn't save this design locally — your browser storage may be full or blocked.");
    }

    if (applyingServerSaveRef.current) {
      applyingServerSaveRef.current = false;
      return;
    }

    if (skipNextProjectSaveRef.current) {
      skipNextProjectSaveRef.current = false;
      return;
    }

    if (!hydratedRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const generation = ++saveGenerationRef.current;
    const payload = project;
    setSaveStatus((current) => (current === "offline" ? current : "saving"));
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/heat-design/projects/${encodeURIComponent(payload.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Could not save heat design project");
        const saved = normaliseProject((await res.json()) as HeatDesignProject);
        // A newer edit started after this PUT was queued — keep local truth.
        if (generation !== saveGenerationRef.current) {
          setProjects((current) => upsertProjectList(current, { ...saved, rooms: payload.rooms }));
          setSaveStatus("saved");
          return;
        }
        setProjects((current) => upsertProjectList(current, saved));
        setProject((current) => {
          if (!current || current.id !== saved.id) return current;
          // Never replace rooms/walls with an older server snapshot.
          if (current.updatedAt.localeCompare(saved.updatedAt) > 0) {
            applyingServerSaveRef.current = true;
            return {
              ...current,
              revisions: saved.revisions ?? current.revisions,
            };
          }
          if (current.rooms.length > saved.rooms.length) {
            applyingServerSaveRef.current = true;
            return {
              ...current,
              revisions: saved.revisions ?? current.revisions,
            };
          }
          applyingServerSaveRef.current = true;
          return {
            ...saved,
            // Prefer local geometry if timestamps tie but local has more detail.
            rooms: current.rooms.length >= saved.rooms.length ? current.rooms : saved.rooms,
            heatingLayout: current.heatingLayout?.updatedAt &&
              (!saved.heatingLayout?.updatedAt ||
                current.heatingLayout.updatedAt.localeCompare(saved.heatingLayout.updatedAt) > 0)
              ? current.heatingLayout
              : saved.heatingLayout,
          };
        });
        setSaveStatus("saved");
      } catch {
        if (generation === saveGenerationRef.current) setSaveStatus("offline");
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [project]);

  useEffect(() => {
    if (!projects.length) return;
    try {
      window.localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
    } catch {
      /* active project cache still gives us a single-project fallback */
    }
  }, [projects]);

  useEffect(() => {
    function onOnline() {
      if (!project || saveStatus !== "offline") return;
      void flushProjectToServer({ ...project, updatedAt: new Date().toISOString() });
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [project, saveStatus]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/jobs").then((res) => (res.ok ? res.json() : [])),
      fetch("/api/quotes").then((res) => (res.ok ? res.json() : [])),
      fetch("/api/tenders").then((res) => (res.ok ? res.json() : { tenders: [] })),
    ])
      .then(([jobs, quotes, tendersPayload]) => {
        if (cancelled) return;
        if (Array.isArray(jobs)) {
          setJobOptions(
            jobs.map((row: { id: string; ref: string; customer: string; site: string }) => ({
              id: row.id,
              ref: row.ref,
              customer: row.customer,
              site: row.site,
            })),
          );
        }
        if (Array.isArray(quotes)) {
          setQuoteOptions(
            quotes.map((row: { id: string; ref: string; customer: string; status: string }) => ({
              id: row.id,
              ref: row.ref,
              customer: row.customer,
              status: row.status,
            })),
          );
        }
        const tenders = Array.isArray(tendersPayload?.tenders) ? tendersPayload.tenders : [];
        setTenderOptions(
          tenders.map((row: { id: string; name: string; client: string; status: string }) => ({
            id: row.id,
            name: row.name,
            client: row.client,
            status: row.status,
          })),
        );
      })
      .catch(() => {
        /* signed-out users can still design locally */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project?.linkedJobId) return;
    setSelectedJobId(project.linkedJobId);
  }, [project?.linkedJobId]);

  useEffect(() => {
    if (!project?.linkedQuoteId) return;
    setSelectedQuoteId(project.linkedQuoteId);
  }, [project?.linkedQuoteId]);

  useEffect(() => {
    if (!project?.linkedTenderId) return;
    setSelectedTenderId(project.linkedTenderId);
  }, [project?.linkedTenderId]);

  useEffect(() => {
    if (!pendingPrint || tab !== "report") return;
    const timer = window.setTimeout(() => {
      window.print();
      setPendingPrint(false);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pendingPrint, tab]);

  function requestPrint() {
    setTab("report");
    setPendingPrint(true);
  }

  const design = useMemo(() => (project ? calculateSystemDesign(project) : null), [project]);
  const optionResults = useMemo(() => {
    if (!project || !design) return [];
    return compareHeatingOptions(
      project,
      design.designLoadKw,
      design.estimatedAnnualHeatKwh,
      project.reportOptionIds,
    );
  }, [project, design]);

  function activateProject(next: HeatDesignProject) {
    const normalised = normaliseProject(next);
    setProject(normalised);
    setDesignExternalTempDraft(null);
    setSelectedRoomId(normalised.rooms[0]?.id ?? null);
    setSelectedJobId(normalised.linkedJobId || "");
    setSelectedQuoteId(normalised.linkedQuoteId || "");
    setSelectedTenderId(normalised.linkedTenderId || "");
  }

  function selectProject(id: string) {
    const next = projects.find((item) => item.id === id);
    if (!next) return;
    skipNextProjectSaveRef.current = true;
    activateProject(next);
    setLayoutMode(false);
    setSaveStatus(saveStatus === "offline" ? "offline" : "saved");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("projectId", next.id);
      window.history.replaceState({}, "", url.toString());
    }
  }

  async function saveProjectNow() {
    if (!project) return;
    const snapshot = { ...project, updatedAt: new Date().toISOString() };
    setSaveStatus("saving");
    try {
      await flushProjectToServer(snapshot, { surfaceError: true });
      setNotice(`Saved · ${snapshot.name || "Untitled heat design"}`);
    } catch (err) {
      setSaveStatus("error");
      setNotice(err instanceof Error ? err.message : "Could not save heat design.");
    }
  }

  async function deleteActiveProject() {
    if (!project) return;
    const name = project.name || "Untitled heat design";
    if (typeof window !== "undefined" && !window.confirm(`Delete project “${name}”? This cannot be undone.`)) {
      return;
    }
    const deletingId = project.id;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/heat-design/projects/${encodeURIComponent(deletingId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not delete heat design project");
      const remaining = projects.filter((item) => item.id !== deletingId);
      try {
        window.localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(remaining));
      } catch {
        /* ignore */
      }
      if (remaining.length) {
        skipNextProjectSaveRef.current = true;
        setProjects(remaining);
        activateProject(remaining[0]!);
        setSaveStatus("saved");
        setNotice(`Deleted “${name}”. Opened ${remaining[0]!.name || "another project"}.`);
        return;
      }
      await startBlankPlan();
      setNotice(`Deleted “${name}”. Started a new blank project.`);
    } catch (err) {
      setSaveStatus("error");
      setNotice(err instanceof Error ? err.message : "Could not delete project.");
    }
  }

  function patchProject(patch: Partial<HeatDesignProject>) {
    setProject((current) =>
      current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current,
    );
  }

  function patchRoom(roomId: string, patch: Partial<HeatDesignRoom>) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function reconcileWalls() {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: autoMarkExteriorWalls(current.rooms),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function addRoom() {
    let nextId: string | null = null;
    setProject((current) => {
      if (!current) return current;
      const room = makeBlankRoom(current.rooms.length, {
        floorLevel: current.activeFloor ?? "ground",
        withDefaultWindow: false,
      });
      nextId = room.id;
      return {
        ...current,
        rooms: autoMarkExteriorWalls([...current.rooms, room]),
        updatedAt: new Date().toISOString(),
      };
    });
    if (nextId) setSelectedRoomId(nextId);
    setLayoutMode(false);
    setTab("plan");
  }

  function placeRoom(roomType: string, planX: number, planY: number, lengthM?: number, widthM?: number) {
    let nextId: string | null = null;
    setProject((current) => {
      if (!current) return current;
      const room = makeBlankRoom(current.rooms.length, {
        roomType,
        planX,
        planY,
        length: lengthM,
        width: widthM,
        floorLevel: current.activeFloor ?? "ground",
        withDefaultWindow: false,
      });
      nextId = room.id;
      return {
        ...current,
        rooms: autoMarkExteriorWalls([...current.rooms, room]),
        updatedAt: new Date().toISOString(),
      };
    });
    if (nextId) setSelectedRoomId(nextId);
    setLayoutMode(false);
  }

  function removeRoom(roomId: string) {
    let nextSelected: string | null = null;
    setProject((current) => {
      if (!current) return current;
      const rooms = autoMarkExteriorWalls(current.rooms.filter((room) => room.id !== roomId));
      nextSelected = rooms[0]?.id ?? null;
      return { ...current, rooms, updatedAt: new Date().toISOString() };
    });
    setSelectedRoomId(nextSelected);
    setLayoutMode(false);
  }

  async function startBlankPlan() {
    setSaveStatus("saving");
    const localProject = normaliseProject(makeBlankProject());
    try {
      const res = await fetch("/api/heat-design/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localProject),
      });
      if (!res.ok) throw new Error("Could not create heat design project");
      const created = normaliseProject((await res.json()) as HeatDesignProject);
      startTransition(() => {
        setProjects((current) => upsertProjectList(current, created));
        activateProject(created);
        setLayoutMode(false);
        setTab("plan");
        setNotice("New project — draw the floor plan, then link materials to a quote, tender, or job.");
        setSaveStatus("saved");
      });
    } catch {
      startTransition(() => {
        setProjects((current) => upsertProjectList(current, localProject));
        activateProject(localProject);
        setLayoutMode(false);
        setTab("plan");
        setNotice("New project — server unavailable, saved locally for now.");
        setSaveStatus("offline");
      });
    }
  }

  function resetDemo() {
    void (async () => {
      setSaveStatus("saving");
      const localProject = normaliseProject({
        ...makeDemoProject(),
        id: `hd-${Date.now().toString(36)}`,
        name: "Sample · Portlethen semi",
        updatedAt: new Date().toISOString(),
      });
      try {
        const res = await fetch("/api/heat-design/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(localProject),
        });
        if (!res.ok) throw new Error("Could not create sample project");
        const created = normaliseProject((await res.json()) as HeatDesignProject);
        startTransition(() => {
          setProjects((current) => upsertProjectList(current, created));
          activateProject(created);
          setLayoutMode(false);
          setTab("plan");
          setNotice("Loaded sample as a new project — Portlethen semi (your other projects stay untouched).");
          setSaveStatus("saved");
        });
      } catch {
        startTransition(() => {
          setProjects((current) => upsertProjectList(current, localProject));
          activateProject(localProject);
          setLayoutMode(false);
          setTab("plan");
          setNotice("Sample loaded locally — server unavailable.");
          setSaveStatus("offline");
        });
      }
    })();
  }

  function autoPickPump() {
    if (!project || !design) return;
    const suggested = suggestHeatPump(design.designLoadKw, project.flowTemperature);
    patchProject({ selectedHeatPumpId: suggested.id });
    setNotice(`Selected ${suggested.model} for ${kw(design.designLoadKw)} design load at ${project.flowTemperature}°C flow.`);
    setTab("system");
  }

  function designSystemOnPlan(optionId: string, mode?: HeatingEmitterMode) {
    if (!project) return;
    const option = heatingSystemOptions.find((item) => item.id === optionId);
    const emitterMode = mode ?? project.emitterMode ?? "radiators";
    const flowTemperature = clampFlowTempToSystem(
      option?.kind,
      project.flowTemperature === defaultFlowTempForSystem(
        heatingSystemOptions.find((item) => item.id === project.chosenSystemId)?.kind,
      )
        ? defaultFlowTempForSystem(option?.kind)
        : project.flowTemperature,
    );
    // If user still on ASHP default (45) and switching to boiler, jump to boiler default
    const nextFlow =
      option?.kind && option.kind !== "ashp" && option.kind !== "hybrid" && project.flowTemperature <= 55
        ? defaultFlowTempForSystem(option.kind)
        : option?.kind === "ashp" && project.flowTemperature >= 60
          ? defaultFlowTempForSystem("ashp")
          : flowTemperature;
    const nextProject = { ...project, chosenSystemId: optionId, emitterMode, flowTemperature: nextFlow };
    const layout = seedHeatingLayout(nextProject, optionId, emitterMode, {
      preservePlants: project.heatingLayout?.plants,
    });
    patchProject({
      chosenSystemId: optionId,
      emitterMode,
      flowTemperature: nextFlow,
      heatingLayout: layout,
    });
    setFittingsSummary(summariseHeatingFittings(layout));
    // Keep plan-edit mode so walls/rooms stay draggable; user can turn Heating layout on to move plant/pipes.
    setLayoutMode(false);
    setTab("plan");
    setNotice(
      `Designed ${option?.label ?? "system"} at ${nextFlow}°C flow with ${emitterMode === "ufh" ? "underfloor heating" : emitterMode === "mixed" ? "mixed radiators / UFH" : "radiators"}${project.heatingLayout?.plants?.length ? " — kept your plant positions" : ""}. Turn on Heating layout to nudge plant/pipes. Ask Blake for kit + sizing, then Send to Takeoff.`,
    );
  }

  async function linkKitToJob() {
    if (!project || !design) return;
    setLinkBusy(true);
    try {
      const option = heatingSystemOptions.find((item) => item.id === project.chosenSystemId);
      const createNew = !selectedJobId;
      const res = await fetch("/api/heat-design/link-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedJobId || undefined,
          createNew,
          customerName: project.customerName,
          siteAddress: [project.address, project.postcode].filter(Boolean).join(", "),
          projectName: project.name,
          chosenSystemLabel: option?.label,
          flowTemperature: project.flowTemperature,
          emitterMode: project.emitterMode,
          kit: design.kit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setNotice("Sign in to Core to link this design to a job.");
        return;
      }
      if (!res.ok) {
        setNotice(data.error || "Could not link to job — check job permissions.");
        return;
      }
      patchProject({ linkedJobId: data.job?.id, linkedJobRef: data.job?.ref });
      setSelectedJobId(data.job?.id || "");
      if (data.job?.id) {
        setJobOptions((current) => {
          if (current.some((row) => row.id === data.job.id)) return current;
          return [
            {
              id: data.job.id,
              ref: data.job.ref,
              customer: data.job.customer,
              site: data.job.site,
            },
            ...current,
          ];
        });
      }
      setNotice(
        data.created
          ? `Created job ${data.job?.ref} and pushed ${data.lineCount} materials into Heating design.`
          : `Updated job ${data.job?.ref} with ${data.lineCount} materials in Heating design.`,
      );
    } catch {
      setNotice("Could not reach jobs API — check you are signed in to Core.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function linkKitToQuote() {
    if (!project || !design) return;
    setLinkBusy(true);
    try {
      const option = heatingSystemOptions.find((item) => item.id === project.chosenSystemId);
      const createNew = !selectedQuoteId;
      const res = await fetch("/api/heat-design/push-to-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: selectedQuoteId || undefined,
          createNew,
          projectId: project.id,
          customerName: project.customerName,
          projectName: project.name,
          address: [project.address, project.postcode].filter(Boolean).join(", "),
          chosenSystemLabel: option?.label,
          flowTemperature: project.flowTemperature,
          emitterMode: project.emitterMode,
          kit: design.kit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setNotice("Sign in to Core to link this design to a quote.");
        return;
      }
      if (!res.ok) {
        setNotice(data.error || "Could not link to quote — check quote permissions.");
        return;
      }
      patchProject({ linkedQuoteId: data.quote?.id, linkedQuoteRef: data.quote?.ref });
      setSelectedQuoteId(data.quote?.id || "");
      if (data.quote?.id) {
        setQuoteOptions((current) => {
          if (current.some((row) => row.id === data.quote.id)) return current;
          return [
            {
              id: data.quote.id,
              ref: data.quote.ref,
              customer: data.quote.customer,
              status: data.quote.status || "Draft",
            },
            ...current,
          ];
        });
      }
      setNotice(
        data.created
          ? `Created quote ${data.quote?.ref} and pushed ${data.lineCount} materials into Heating design.`
          : `Updated quote ${data.quote?.ref} with ${data.lineCount} materials in Heating design.`,
      );
    } catch {
      setNotice("Could not reach quotes API — check you are signed in to Core.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function linkKitToTender() {
    if (!project || !design) return;
    setLinkBusy(true);
    try {
      const option = heatingSystemOptions.find((item) => item.id === project.chosenSystemId);
      const createNew = !selectedTenderId;
      const res = await fetch("/api/heat-design/push-to-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderId: selectedTenderId || undefined,
          createNew,
          projectId: project.id,
          customerName: project.customerName,
          projectName: project.name,
          address: [project.address, project.postcode].filter(Boolean).join(", "),
          chosenSystemLabel: option?.label,
          flowTemperature: project.flowTemperature,
          emitterMode: project.emitterMode,
          kit: design.kit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setNotice("Sign in to Core to link this design to a tender.");
        return;
      }
      if (!res.ok) {
        setNotice(data.error || "Could not link to tender — check tender permissions.");
        return;
      }
      const tenderLabel = data.tender?.name || "Tender";
      patchProject({ linkedTenderId: data.tender?.id, linkedTenderRef: tenderLabel });
      setSelectedTenderId(data.tender?.id || "");
      if (data.tender?.id) {
        setTenderOptions((current) => {
          if (current.some((row) => row.id === data.tender.id)) return current;
          return [
            {
              id: data.tender.id,
              name: data.tender.name,
              client: data.tender.client,
              status: data.tender.status || "In Progress",
            },
            ...current,
          ];
        });
      }
      setNotice(
        data.created
          ? `Created tender “${tenderLabel}” and pushed ${data.lineCount} BoQ lines into Heating design.`
          : `Updated tender “${tenderLabel}” with ${data.lineCount} BoQ lines in Heating design.`,
      );
    } catch {
      setNotice("Could not reach tenders API — check you are signed in to Core.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function pushKitToCore() {
    if (linkTarget === "quote") {
      await linkKitToQuote();
      return;
    }
    if (linkTarget === "tender") {
      await linkKitToTender();
      return;
    }
    await linkKitToJob();
  }

  function regenerateLayout(mode?: HeatingEmitterMode) {
    if (!project?.chosenSystemId) return;
    const emitterMode = mode ?? project.emitterMode ?? project.heatingLayout?.emitterMode ?? "radiators";
    const userPlants = project.heatingLayout?.plants?.filter((p) => p.placedByUser) ?? [];
    const layout = seedHeatingLayout(project, project.chosenSystemId, emitterMode, {
      preservePlants: project.heatingLayout?.plants,
    });
    patchProject({ emitterMode, heatingLayout: layout });
    setFittingsSummary(summariseHeatingFittings(layout));
    setLayoutMode(true);
    setNotice(
      userPlants.length
        ? `Routed pipes + emitters around your ${userPlants.length} placed plant piece${userPlants.length === 1 ? "" : "s"} — nothing else added on plan.`
        : "Designed heating layout with the selected emitter type.",
    );
  }

  function placePlant(kind: HeatingPlantKind, x: number, y: number) {
    if (!project) return;
    const systemOptionId = project.chosenSystemId || project.reportOptionIds?.[0] || "opt-ashp";
    const layout = placePlantOnLayout(project.heatingLayout, kind, x, y, project.activeFloor ?? "ground", {
      systemOptionId,
      emitterMode: project.emitterMode ?? "radiators",
      cylinderLitres: project.cylinderLitres,
    });
    patchProject({
      chosenSystemId: project.chosenSystemId || systemOptionId,
      heatingLayout: layout,
    });
    // Keep rooms editable — Heating layout is optional when nudging plant / pipes.
    setLayoutMode(false);
    setNotice(
      `Placed ${kind.replace(/_/g, " ")}. Add plant as needed, then Generate UFH (or Route pipes). Generation does not invent missing plant.`,
    );
  }

  function applyPlanScale(from: PlanPoint, to: PlanPoint, knownMetres: number) {
    if (!project?.planUnderlay) return;
    try {
      const result = applyPlanScaleCalibration(
        project.planUnderlay,
        from,
        to,
        knownMetres,
        project.rooms,
        project.heatingLayout ?? null,
      );
      const hadUfh = (result.layout?.pipes ?? []).some((pipe) => /ufh loop/i.test(pipe.label));
      patchProject({
        planUnderlay: result.underlay,
        rooms: result.rooms,
        heatingLayout: result.layout,
      });
      if (hadUfh && result.layout) {
        // Geometry scaled — regenerate UFH so loop spacing stays correct in real metres.
        const { layout, summary } = buildUfhCircuitsOnLayout(
          {
            ...project,
            planUnderlay: result.underlay,
            rooms: result.rooms,
            heatingLayout: result.layout,
            emitterMode: "ufh",
          },
          result.layout,
          { pattern: "serpentine" },
        );
        patchProject({ heatingLayout: layout, emitterMode: "ufh" });
        setUfhSummary(summary);
        setFittingsSummary(summariseHeatingFittings(layout));
      } else {
        setUfhSummary(null);
      }
      setNotice(
        `Scale applied · ${knownMetres} m reference (×${result.scaleFactor.toFixed(3)}). Room areas and pipe lengths now use real metres.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not apply scale.");
    }
  }

  function generateUfhCircuits(options: { pattern: UfhPattern; spacingMm?: UfhSpacingMm }) {
    if (!project) return;
    if (!project.rooms.length) {
      setNotice("Draw heated rooms before generating UFH.");
      return;
    }
    const systemOptionId = project.chosenSystemId || project.reportOptionIds?.[0] || "opt-gas";
    const existingPlants = project.heatingLayout?.plants;
    const base =
      project.heatingLayout ??
      seedHeatingLayout(
        { ...project, chosenSystemId: systemOptionId, emitterMode: "ufh" },
        systemOptionId,
        "ufh",
        { preservePlants: existingPlants, onlyUserPlants: true },
      );
    // Ensure plant network exists, then build real UFH circuits (seed alone may skip if no rooms at seed time).
    const seeded = seedHeatingLayout(
      { ...project, chosenSystemId: systemOptionId, emitterMode: "ufh", heatingLayout: base },
      systemOptionId,
      "ufh",
      { preservePlants: base.plants },
    );
    const { layout, summary } = buildUfhCircuitsOnLayout(
      { ...project, chosenSystemId: systemOptionId, emitterMode: "ufh", heatingLayout: seeded },
      seeded,
      {
        pattern: options.pattern,
        spacingOverrideMm: options.spacingMm,
      },
    );
    patchProject({
      chosenSystemId: systemOptionId,
      emitterMode: "ufh",
      heatingLayout: layout,
    });
    setUfhSummary(summary);
    setFittingsSummary(summariseHeatingFittings(layout));
    setLayoutMode(true);
    setNotice(
      summary.circuitCount
        ? `Generated ${summary.circuitCount} UFH circuit${summary.circuitCount === 1 ? "" : "s"} · ${summary.ufhPipeM} m loop + ${summary.tailPipeM} m tails. Review kit, then Send to Takeoff.`
        : "No UFH circuits generated — check room polygons and try again.",
    );
  }

  function setPlanUnderlay(planUnderlay: PlanUnderlay | null) {
    patchProject({ planUnderlay });
    setNotice(
      planUnderlay
        ? "Drawing underlay added — calibrate scale on a known dimension before trusting metre totals."
        : "Drawing underlay cleared.",
    );
  }

  async function useLinkedTakeoffDrawing() {
    if (!project) return;
    if (!project.linkedTakeoffId) {
      setNotice("Link or Send to Takeoff first, then Use Takeoff PDF under the plan.");
      return;
    }
    setUnderlayBusy(true);
    try {
      const res = await fetch(`/api/takeoff-projects/${encodeURIComponent(project.linkedTakeoffId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        documents?: Array<{
          id: string;
          kind: string;
          fileName: string;
          mimeType?: string;
        }>;
        reference?: string;
      };
      if (!res.ok) throw new Error(body.error || `Takeoff load failed (${res.status})`);
      const drawings = (body.documents || []).filter(
        (doc) =>
          doc.kind === "Drawing"
          || doc.kind === "Marked-up drawing"
          || /\.pdf$/i.test(doc.fileName)
          || /^image\//i.test(doc.mimeType || ""),
      );
      const doc = drawings[0];
      if (!doc) {
        setNotice(
          `No drawing on Takeoff ${body.reference || project.linkedTakeoffRef || ""} — upload a PDF there, then try again.`,
        );
        return;
      }
      const fileRes = await fetch(
        `/api/takeoff-projects/${encodeURIComponent(project.linkedTakeoffId)}/documents/${encodeURIComponent(doc.id)}/file`,
        { credentials: "include", cache: "no-store" },
      );
      if (!fileRes.ok) throw new Error(`Could not download Takeoff drawing (${fileRes.status})`);
      const blob = await fileRes.blob();
      const underlay = await readPlanUnderlayBlob(blob, doc.fileName, project.rooms);
      if (!underlay) {
        setNotice(`Could not rasterise ${doc.fileName} — try Upload PDF / photo instead.`);
        return;
      }
      setPlanUnderlay(underlay);
      setNotice(`Underlay from Takeoff · ${doc.fileName} (first page).`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load Takeoff drawing.");
    } finally {
      setUnderlayBusy(false);
    }
  }

  function blakeSizeRoutes() {
    if (!project?.heatingLayout?.pipes?.length) {
      setNotice("Design on plan first, then Blake can size 28 / 22 / 15 mm routes.");
      return;
    }
    const layout = applyBlakePipeSizing(project.heatingLayout);
    const summary = summariseHeatingFittings(layout);
    patchProject({ heatingLayout: layout });
    setFittingsSummary(summary);
    setLayoutMode(true);
    setNotice(
      `Rule size · ${summary.totalMetres} m · ${summary.totalElbows} elbows · ${summary.totalCouplings} couplings · ${summary.totalReducers} reducers (copper 28→22→15 · UFH 16 mm PEX). Prefer Ask Blake for live AI.`,
    );
  }

  async function refreshBlakeBudgetPrices() {
    if (!project?.id) return;
    setBudgetBusy(true);
    try {
      const res = await fetch("/api/heat-design/budget-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, forceRefresh: true }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        aiUsed?: boolean;
        pricedCount?: number;
        stillOpenCount?: number;
        budgetTotal?: number;
        project?: HeatDesignProject;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Budget prices failed (${res.status})`);
      }
      if (body.project) {
        patchProject({ blakeProposal: body.project.blakeProposal });
      }
      setNotice(
        body.aiUsed
          ? `Blake budget costs · ${body.pricedCount ?? 0} lines · £${Number(body.budgetTotal || 0).toFixed(0)} — amend when supplier quotes land.`
          : `Guide budget costs · ${body.pricedCount ?? 0} lines${body.stillOpenCount ? ` · ${body.stillOpenCount} still open` : ""}.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not refresh budget prices.");
    } finally {
      setBudgetBusy(false);
    }
  }

  async function flushProjectToServer(
    snapshot: HeatDesignProject,
    options: { surfaceError?: boolean } = {},
  ) {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const generation = ++saveGenerationRef.current;
    try {
      const res = await fetch(`/api/heat-design/projects/${encodeURIComponent(snapshot.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) {
        if (options.surfaceError) throw new Error(`Could not save heat design (${res.status})`);
        setSaveStatus((current) => (current === "offline" ? current : "error"));
        return;
      }
      if (generation !== saveGenerationRef.current) return;
      setProjects((current) => upsertProjectList(current, snapshot));
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("offline");
      if (options.surfaceError) {
        throw err instanceof Error ? err : new Error("Could not save heat design");
      }
      /* Ask Blake still sends the client snapshot — save race is non-fatal */
    }
  }

  async function askBlakeLive() {
    if (!project?.id) return;
    if (
      !project.chosenSystemId
      && !project.heatingLayout?.pipes?.length
      && !project.heatingLayout?.plants?.length
      && !project.rooms?.length
    ) {
      setNotice("Pick a system, place plant, or design on plan first, then Ask Blake.");
      return;
    }
    setBlakeBusy(true);
    const snapshot: HeatDesignProject = {
      ...project,
      // Ensure a system id so server seed can run even if engineer only placed plant.
      chosenSystemId:
        project.chosenSystemId
        || project.heatingLayout?.systemOptionId
        || project.reportOptionIds?.[0]
        || "opt-ashp",
      updatedAt: new Date().toISOString(),
    };
    try {
      // Flush + send snapshot so Ask Blake never designs against a stale server project
      // (autosave is debounced — plant placed moments ago would otherwise be missing).
      await flushProjectToServer(snapshot);
      const res = await fetch("/api/heat-design/blake-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: snapshot.id,
          project: snapshot,
          message: blakeMessage.trim() || undefined,
          regenerateLayout: true,
          apply: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        aiUsed?: boolean;
        connected?: boolean;
        summary?: string;
        narrative?: string;
        fittings?: HeatingFittingsSummary;
        project?: HeatDesignProject;
        pipeCount?: number;
        routeNotes?: string[];
        clarifyingQuestions?: Array<{ key: string; question: string; why: string }>;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Ask Blake failed (${res.status})`);
      }
      if (body.project) {
        patchProject({
          blakeProposal: body.project.blakeProposal,
          heatingLayout: body.project.heatingLayout ?? snapshot.heatingLayout,
          chosenSystemId: body.project.chosenSystemId || snapshot.chosenSystemId,
          emitterMode: body.project.emitterMode || snapshot.emitterMode,
        });
      }
      if (body.fittings) setFittingsSummary(body.fittings);
      setLayoutMode(true);
      setTab("plan");
      const qCount = body.clarifyingQuestions?.length || 0;
      const pipes =
        body.pipeCount
        ?? body.project?.heatingLayout?.pipes?.length
        ?? 0;
      setNotice(
        body.aiUsed
          ? `Blake (live AI) · ${pipes} pipe run${pipes === 1 ? "" : "s"}${qCount ? ` · ${qCount} question${qCount === 1 ? "" : "s"}` : ""} — ${body.summary || "design ready."}`
          : body.connected
            ? `Blake rule design · ${pipes} pipes — ${body.summary || "OpenAI could not finish; geometry still drawn."}`
            : `OpenAI not connected — rule design drew ${pipes} pipe run${pipes === 1 ? "" : "s"}. Set OPENAI_API_KEY on Render for live Blake.`,
      );
      setBlakeMessage("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ask Blake could not reply.");
    } finally {
      setBlakeBusy(false);
    }
  }

  async function sendLayoutToTakeoff(options: { createNew?: boolean } = {}) {
    if (!project?.id) return;
    if (!project.heatingLayout?.pipes?.length) {
      setNotice("Design on plan first — nothing to send to Takeoff yet.");
      setTab("plan");
      return;
    }
    setTakeoffBusy(true);
    try {
      // Ensure sizes before handoff.
      const layout = applyBlakePipeSizing(project.heatingLayout);
      patchProject({ heatingLayout: layout });
      const res = await fetch("/api/heat-design/send-to-takeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          takeoffId: options.createNew ? undefined : project.linkedTakeoffId,
          createNew: Boolean(options.createNew) || !project.linkedTakeoffId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        takeoff?: { id: string; reference: string; name: string };
        fittings?: HeatingFittingsSummary;
        project?: HeatDesignProject;
        created?: boolean;
      };
      if (!res.ok || !body.ok || !body.takeoff) {
        throw new Error(body.error || `Send failed (${res.status})`);
      }
      if (body.project) {
        patchProject({
          linkedTakeoffId: body.project.linkedTakeoffId,
          linkedTakeoffRef: body.project.linkedTakeoffRef,
          heatingLayout: body.project.heatingLayout ?? layout,
        });
      }
      if (body.fittings) setFittingsSummary(body.fittings);
      setNotice(
        `${body.created ? "Created" : "Updated"} takeoff ${body.takeoff.reference} with sized routes + fittings. Open Takeoff to Push.`,
      );
      window.open(
        `/takeoff?projectId=${encodeURIComponent(body.takeoff.id)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not send to Takeoff.");
    } finally {
      setTakeoffBusy(false);
    }
  }

  function patchLayout(layout: HeatingSystemLayout) {
    patchProject({ heatingLayout: layout });
    if (layout.pipes.some((pipe) => pipe.diameterMm)) {
      setFittingsSummary(summariseHeatingFittings(layout));
    }
  }

  function changeEmitterMode(mode: HeatingEmitterMode) {
    patchProject({ emitterMode: mode });
    if (project?.chosenSystemId) regenerateLayout(mode);
  }

  if (!project || !design) {
    return (
      <main className="hd-lab">
        <div className="hd-shell hd-loading-shell">
          <div className="hd-loading-pulse" aria-hidden />
          <p className="hd-lead">Loading Heat Design…</p>
        </div>
      </main>
    );
  }

  const selectedPump =
    heatPumpCatalogue.find((pump) => pump.id === project.selectedHeatPumpId) ?? design.selectedPump;
  const selectedRoom = project.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const chosenOption =
    heatingSystemOptions.find((item) => item.id === project.chosenSystemId) ??
    optionResults.find((row) => row.recommended)?.option ??
    null;
  const flowOptions = flowTempOptionsForSystem(chosenOption?.kind);
  const showHeatPumpPicker = (project.reportOptionIds ?? []).some(
    (id) => id === "opt-ashp" || id === "opt-hybrid",
  ) || chosenOption?.kind === "ashp" || chosenOption?.kind === "hybrid";
  const projectOptions = projects.length ? projects : [project];
  const revisionHistory = project.revisions ?? [];
  const saveStatusLabel =
    saveStatus === "saved"
      ? "Saved to server"
      : saveStatus === "saving"
        ? "Saving…"
        : saveStatus === "loading"
          ? "Loading projects…"
          : saveStatus === "error"
            ? "Save failed — try Save"
            : "Offline — saved locally";

  return (
    <main className={`hd-lab${tab === "plan" ? " is-plan-mode" : ""}`}>
      <div className="hd-shell">
        <header className="hd-topbar">
          <div className="hd-brand-row">
            <div className="hd-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="hd-brand-logo" src={resolveBrandLogoUrl(brand, "heat-design")} alt={brand.companyName} />
              <div className="hd-brand-kicker">Live · links to Core quotes, tenders & jobs</div>
              <h1>{brand.heatDesignAppName}</h1>
              {tab !== "plan" ? (
                <p className="hd-brand-lead">
                  Draw the house, size the system, then push materials into a Core quote, tender, or job — or create a
                  new one.
                </p>
              ) : null}
            </div>
            <Link href="/" className="hd-btn hd-btn-core" aria-label="Back to Core">
              <LayoutDashboard size={16} aria-hidden />
              Core
            </Link>
          </div>
          <div className="hd-top-actions">
            <label className="hd-project-switcher">
              <span>Project</span>
              <select value={project.id} onChange={(event) => selectProject(event.target.value)}>
                {projectOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || "Untitled heat design"}
                  </option>
                ))}
              </select>
            </label>
            <span className={`hd-save-status is-${saveStatus}`}>{saveStatusLabel}</span>
            <div className="hd-action-cluster" role="group" aria-label="Project actions">
              <button
                type="button"
                className="hd-btn hd-btn-primary"
                onClick={() => void saveProjectNow()}
                disabled={saveStatus === "saving" || saveStatus === "loading"}
              >
                Save
              </button>
              <button type="button" className="hd-btn hd-btn-ghost" onClick={startBlankPlan}>
                New project
              </button>
              <button
                type="button"
                className="hd-btn hd-btn-ghost hd-btn-danger"
                onClick={() => void deleteActiveProject()}
                disabled={saveStatus === "saving" || saveStatus === "loading"}
              >
                Delete
              </button>
              <button type="button" className="hd-btn hd-btn-ghost hd-btn-desktop" onClick={resetDemo}>
                Load sample
              </button>
              <button type="button" className="hd-btn" onClick={addRoom}>
                Add room
              </button>
              <button type="button" className="hd-btn hd-btn-desktop" onClick={requestPrint}>
                Print report
              </button>
              <button type="button" className="hd-btn hd-btn-primary" onClick={autoPickPump}>
                Auto-size pump
              </button>
            </div>
          </div>
        </header>

        {notice ? (
          <div className="hd-banner is-toast" role="status">
            {notice}
          </div>
        ) : null}

        <nav className="hd-tabs" aria-label="Heat design sections">
          {(
            [
              ["project", "Project"],
              ["plan", "Floor plan"],
              ["materials", "Materials"],
              ["rooms", "Rooms"],
              ["system", "System"],
              ["options", "Options"],
              ["kit", "Kit & link"],
              ["forms", "MCS / DNO"],
              ["report", "Report"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`hd-tab${tab === key ? " is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className={`hd-layout${tab === "plan" ? " is-plan" : ""}`}>
          <section className={`hd-panel${tab === "plan" ? " is-plan-panel" : ""}`}>
            {tab === "project" ? (
              <>
                <h2>Project</h2>
                <p className="hd-lead">Customer, property and tariff inputs for design load and savings.</p>
                <div className="hd-grid-2">
                  <label className="hd-field">
                    Project name
                    <input value={project.name} onChange={(event) => patchProject({ name: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Customer
                    <input
                      value={project.customerName}
                      onChange={(event) => patchProject({ customerName: event.target.value })}
                    />
                  </label>
                  <label className="hd-field">
                    Address
                    <input value={project.address} onChange={(event) => patchProject({ address: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Postcode
                    <input value={project.postcode} onChange={(event) => patchProject({ postcode: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Property type
                    <select
                      value={project.propertyType}
                      onChange={(event) => patchProject({ propertyType: event.target.value })}
                    >
                      {propertyTypes.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="hd-field">
                    Build era
                    <select value={project.buildEra} onChange={(event) => patchProject({ buildEra: event.target.value })}>
                      {buildEras.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="hd-field">
                    Occupants
                    <input
                      inputMode="numeric"
                      value={project.occupants}
                      onChange={(event) => patchProject({ occupants: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Design external temp °C
                    <input
                      inputMode="decimal"
                      value={designExternalTempDraft ?? String(project.designExternalTemp)}
                      onFocus={() => setDesignExternalTempDraft(String(project.designExternalTemp))}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw !== "" && !isSignedDecimalDraft(raw)) return;
                        setDesignExternalTempDraft(raw);
                        if (raw === "" || raw === "-" || /[.,]$/.test(raw)) return;
                        const value = numberFromInput(raw);
                        if (Number.isFinite(value)) {
                          patchProject({ designExternalTemp: clampDesignExternalTemp(value) });
                        }
                      }}
                      onBlur={() => {
                        const raw = designExternalTempDraft;
                        setDesignExternalTempDraft(null);
                        if (raw == null || raw === "" || raw === "-") return;
                        const value = numberFromInput(raw, project.designExternalTemp);
                        if (Number.isFinite(value)) {
                          patchProject({ designExternalTemp: clampDesignExternalTemp(value) });
                        }
                      }}
                    />
                  </label>
                  <label className="hd-field">
                    Current fuel
                    <select
                      value={project.currentFuel}
                      onChange={(event) =>
                        patchProject({ currentFuel: event.target.value as HeatDesignProject["currentFuel"] })
                      }
                    >
                      <option>Gas</option>
                      <option>Oil</option>
                      <option>LPG</option>
                      <option>Electric</option>
                    </select>
                  </label>
                  <label className="hd-field">
                    Current annual heat use kWh
                    <input
                      inputMode="numeric"
                      value={project.currentAnnualKwh}
                      onChange={(event) => patchProject({ currentAnnualKwh: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Electricity £/kWh
                    <input
                      inputMode="decimal"
                      value={project.electricityUnitRate}
                      onChange={(event) => patchProject({ electricityUnitRate: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Gas £/kWh
                    <input
                      inputMode="decimal"
                      value={project.gasUnitRate}
                      onChange={(event) => patchProject({ gasUnitRate: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Cylinder litres
                    <input
                      inputMode="numeric"
                      value={project.cylinderLitres}
                      onChange={(event) => patchProject({ cylinderLitres: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Daily hot water litres
                    <input
                      inputMode="numeric"
                      value={project.dailyHotWaterLitres}
                      onChange={(event) => patchProject({ dailyHotWaterLitres: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {tab === "plan" ? (
              <>
                <h2>Floor plan</h2>
                <p className="hd-lead">
                  Heating design (UFH v1): calibrate scale → draw rooms → place plant → Generate UFH circuits → kit /
                  BoQ lengths. Geometric design + heat-loss estimate — not an MCS certificate.
                </p>
                <div className="hd-emitter-picker">
                  <strong>Emitters for this design</strong>
                  <div className="hd-emitter-choices" role="group" aria-label="Emitter type">
                    {(
                      [
                        ["ufh", "Underfloor heating", "Serpentine / spiral circuits + manifold tails"],
                        ["radiators", "Radiators", "Sized radiator per room (model × mm)"],
                        ["mixed", "Mixed", "UFH in wet rooms, radiators elsewhere"],
                      ] as const
                    ).map(([id, label, hint]) => (
                      <button
                        key={id}
                        type="button"
                        className={`hd-emitter-choice${(project.emitterMode ?? "radiators") === id ? " is-on" : ""}`}
                        onClick={() => changeEmitterMode(id)}
                      >
                        <strong>{label}</strong>
                        <span>{hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <FloorPlanCanvas
                  rooms={project.rooms}
                  selectedRoomId={selectedRoomId}
                  activeFloor={project.activeFloor ?? "ground"}
                  designExternalTemp={project.designExternalTemp}
                  summary={{
                    heatLossW: design.totalHeatLossW,
                    floorAreaM2: project.rooms.reduce(
                      (sum, room) =>
                        sum +
                        calculateRoomHeatLoss(
                          { ...room, meanWaterTemperature: String(project.flowTemperature) },
                          project.designExternalTemp,
                        ).floorArea,
                      0,
                    ),
                    roomCount: project.rooms.length,
                  }}
                  onSelectRoom={setSelectedRoomId}
                  onPatchRoom={patchRoom}
                  onDeleteRoom={removeRoom}
                  onChangeFloor={(floor) => patchProject({ activeFloor: floor })}
                  onAddRoom={addRoom}
                  onPlaceRoom={placeRoom}
                  onReconcileWalls={reconcileWalls}
                  heatingLayout={project.heatingLayout}
                  layoutMode={layoutMode}
                  onLayoutModeChange={setLayoutMode}
                  onPatchLayout={patchLayout}
                  onRegenerateLayout={
                    project.heatingLayout || project.chosenSystemId
                      ? () => {
                          const systemOptionId =
                            project.chosenSystemId || project.reportOptionIds?.[0] || "opt-ashp";
                          const emitterMode = project.emitterMode ?? "radiators";
                          const next = { ...project, chosenSystemId: systemOptionId, emitterMode };
                          const userPlants = project.heatingLayout?.plants?.filter((p) => p.placedByUser) ?? [];
                          let layout = seedHeatingLayout(next, systemOptionId, emitterMode, {
                            preservePlants: project.heatingLayout?.plants,
                          });
                          if (emitterMode === "ufh") {
                            const built = buildUfhCircuitsOnLayout(next, layout, { pattern: "serpentine" });
                            layout = built.layout;
                            setUfhSummary(built.summary);
                          } else {
                            setUfhSummary(null);
                          }
                          patchProject({
                            chosenSystemId: systemOptionId,
                            emitterMode,
                            heatingLayout: layout,
                          });
                          setFittingsSummary(summariseHeatingFittings(layout));
                          setLayoutMode(true);
                          setNotice(
                            userPlants.length
                              ? `Routed pipes + emitters around your ${userPlants.length} placed plant piece${userPlants.length === 1 ? "" : "s"} — nothing else added on plan.`
                              : "Designed heating layout for the selected system.",
                          );
                        }
                      : undefined
                  }
                  onPlacePlant={placePlant}
                  layoutSystemLabel={chosenOption?.label}
                  emitterMode={project.emitterMode ?? "radiators"}
                  onEmitterModeChange={changeEmitterMode}
                  planUnderlay={project.planUnderlay}
                  onPlanUnderlayChange={setPlanUnderlay}
                  onApplyPlanScale={applyPlanScale}
                  onGenerateUfh={generateUfhCircuits}
                  ufhSummary={ufhSummary}
                  workflowSteps={ufhWorkflowStatus(project).steps}
                  onUseTakeoffDrawing={() => void useLinkedTakeoffDrawing()}
                  takeoffDrawingBusy={underlayBusy}
                  linkedTakeoffRef={project.linkedTakeoffRef}
                  onFinishSurveyedPlan={() => {
                    setTab("system");
                    setNotice("Surveyed plan locked in — pick a system and design flow temperature next.");
                  }}
                />
                <div className="hd-blake-route-panel" aria-label="Blake kit assist">
                  <header>
                    <strong className="hd-blake-title">
                      <BuddyCharacter mood={blakeBusy ? "thinking" : "idle"} size="sm" interactive={false} />
                      Blake kit assist
                    </strong>
                    <span>
                      Optional: sizes defined kit / BoQ notes after Generate UFH has drawn circuits. Does not invent room
                      loops — generation is rule-based. Not an MCS certificate.
                    </span>
                  </header>
                  <label className="hd-blake-ask-label">
                    <span className="sr-only">Message for Blake</span>
                    <textarea
                      className="hd-blake-ask-input"
                      rows={2}
                      value={blakeMessage}
                      onChange={(event) => setBlakeMessage(event.target.value)}
                      placeholder="Optional — e.g. existing TRVs stay, cylinder in airing cupboard, UFH in kitchen only…"
                      disabled={blakeBusy}
                    />
                  </label>
                  <div className="hd-blake-route-actions">
                    <button
                      type="button"
                      className="hd-btn hd-btn-primary"
                      disabled={blakeBusy}
                      onClick={() => void askBlakeLive()}
                    >
                      <BuddyCharacter mood={blakeBusy ? "thinking" : "idle"} size="sm" interactive={false} />
                      {blakeBusy ? "Blake thinking…" : "Ask Blake (kit)"}
                    </button>
                    <button
                      type="button"
                      className="hd-btn"
                      disabled={takeoffBusy || !project.heatingLayout?.pipes?.length}
                      onClick={() => void sendLayoutToTakeoff()}
                    >
                      {takeoffBusy ? "Sending…" : project.linkedTakeoffRef ? "Update Takeoff" : "Send to Takeoff"}
                    </button>
                    <button
                      type="button"
                      className="hd-btn hd-btn-ghost"
                      disabled={!project.heatingLayout?.pipes?.length || blakeBusy}
                      onClick={blakeSizeRoutes}
                      title="Local rule tiers only"
                    >
                      Size only (rules)
                    </button>
                    {project.linkedTakeoffRef ? (
                      <button
                        type="button"
                        className="hd-btn hd-btn-ghost"
                        disabled={takeoffBusy}
                        onClick={() => void sendLayoutToTakeoff({ createNew: true })}
                      >
                        New takeoff
                      </button>
                    ) : null}
                  </div>
                  {project.blakeProposal ? (
                    <div className="hd-blake-ai-output">
                      <p className="hd-blake-ai-badge">
                        {project.blakeProposal.aiUsed
                          ? `Live AI${project.blakeProposal.model ? ` · ${project.blakeProposal.model}` : ""}`
                          : project.blakeProposal.connected
                            ? "Rule fallback (OpenAI error)"
                            : "Rule fallback (OpenAI not connected)"}
                      </p>
                      <p className="hd-blake-ai-summary">{project.blakeProposal.summary}</p>
                      {project.blakeProposal.narrative ? (
                        <p className="hd-blake-ai-narrative">{project.blakeProposal.narrative}</p>
                      ) : null}
                      {project.blakeProposal.routeNotes?.length ? (
                        <ul className="hd-blake-ai-notes">
                          {project.blakeProposal.routeNotes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      ) : null}
                      {project.blakeProposal.clarifyingQuestions?.length ? (
                        <div className="hd-blake-ai-questions">
                          <strong>Blake still needs</strong>
                          <ul>
                            {project.blakeProposal.clarifyingQuestions.map((q) => (
                              <li key={q.key}>
                                <button
                                  type="button"
                                  className="hd-blake-q-btn"
                                  onClick={() => setBlakeMessage(q.question)}
                                >
                                  {q.question}
                                </button>
                                {q.why ? <small>{q.why}</small> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {project.linkedTakeoffRef ? (
                    <p className="hd-lead" style={{ margin: 0 }}>
                      Linked takeoff{" "}
                      {project.linkedTakeoffId ? (
                        <a href={`/takeoff?projectId=${encodeURIComponent(project.linkedTakeoffId)}`}>
                          <strong>{project.linkedTakeoffRef}</strong>
                        </a>
                      ) : (
                        <strong>{project.linkedTakeoffRef}</strong>
                      )}
                    </p>
                  ) : null}
                  {project.heatingLayout?.pipes?.length &&
                  (fittingsSummary || project.heatingLayout.pipes.some((p) => p.diameterMm)) ? (
                    <ul className="hd-blake-fit-list">
                      {(fittingsSummary || summariseHeatingFittings(project.heatingLayout)).bySize.map((row) => (
                        <li key={row.diameterMm}>
                          <strong>
                            {row.diameterMm} mm {row.material || (row.diameterMm === 16 ? "PEX" : "Copper")}
                          </strong>
                          <span>
                            {row.metres} m
                            {row.diameterMm === 16 || row.material === "PEX"
                              ? " · coil (no copper fittings)"
                              : ` · ${row.elbows} elbow${row.elbows === 1 ? "" : "s"} · ${row.couplings} coupling${row.couplings === 1 ? "" : "s"}`}
                          </span>
                        </li>
                      ))}
                      {(fittingsSummary || summariseHeatingFittings(project.heatingLayout)).reducers.map((row) => (
                        <li key={`${row.fromMm}-${row.toMm}`}>
                          <strong>
                            {row.fromMm}→{row.toMm}
                          </strong>
                          <span>
                            {row.count} reducer{row.count === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {design.kit.length ? (
                    <div className="hd-defined-kit" aria-label="Defined kit">
                      <div className="hd-defined-kit-head">
                        <strong>Defined kit</strong>
                        <span>
                          {design.kit.length} lines · {money(design.kitTotal)} ex VAT
                          {project.blakeProposal?.kitLines?.length
                            ? " · plant + Blake ancillaries (budget until Firm)"
                            : " · catalogue + rule ancillaries"}
                        </span>
                      </div>
                      <div className="hd-kit-table hd-kit-table-compact">
                        <div className="hd-kit-row hd-kit-head">
                          <span>Item</span>
                          <span>Qty</span>
                          <span>Cost</span>
                        </div>
                        {design.kit.slice(0, 14).map((line) => {
                          const state = derivePricingState(line);
                          return (
                            <div key={line.id} className="hd-kit-row">
                              <span>
                                <strong>
                                  {line.description}
                                  <span
                                    className={`hd-price-chip ${chipClassForPricingState(state)}`}
                                    title={line.pricingNote || PRICING_STATE_HINT[state]}
                                  >
                                    {PRICING_STATE_LABEL[state]}
                                  </span>
                                </strong>
                                <small>{line.category}</small>
                              </span>
                              <span>
                                {line.qty}
                                {line.unit ? ` ${line.unit}` : ""}
                              </span>
                              <span>
                                {state === "rfq" && !(line.unitCost > 0) ? "RFQ" : money(line.qty * line.unitCost)}
                              </span>
                            </div>
                          );
                        })}
                        {design.kit.length > 14 ? (
                          <div className="hd-kit-row">
                            <span>
                              <small>+{design.kit.length - 14} more on the Kit tab</small>
                            </span>
                            <span />
                            <span>
                              <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setTab("kit")}>
                                Full kit
                              </button>
                            </span>
                          </div>
                        ) : null}
                        <div className="hd-kit-row hd-kit-total">
                          <span>Kit total (materials ex VAT — provisional until Firm)</span>
                          <span />
                          <span>{money(design.kitTotal)}</span>
                        </div>
                      </div>
                      <p className="hd-defined-kit-note">
                        Generate UFH first for loop + tail metres. Blake kit assist refreshes ancillaries / budget prices.
                        Send to Takeoff pushes this BOQ — not a full hydraulic calculation.
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {tab === "materials" ? (
              <MaterialsWizard project={project} onChange={patchProject} />
            ) : null}

            {tab === "rooms" ? (
              <>
                <div className="hd-room-head" style={{ marginBottom: 8 }}>
                  <div>
                    <h2>Rooms & heat loss</h2>
                    <p className="hd-lead" style={{ marginBottom: 0 }}>
                      Fabric + ventilation at {project.designExternalTemp}°C external · emitters at{" "}
                      {project.flowTemperature}°C flow.
                    </p>
                  </div>
                  <button type="button" className="hd-btn" onClick={addRoom}>
                    Add room
                  </button>
                </div>
                <div className="hd-room-list">
                  {project.rooms.map((room) => {
                    const loss = calculateRoomHeatLoss(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    const radiators = recommendedRadiatorsForRoom(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    const picked = pickRadiatorForRoom(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    return (
                      <article key={room.id} className="hd-room">
                        <div className="hd-room-head">
                          <strong>{room.name || "Untitled room"}</strong>
                          <button type="button" className="hd-btn hd-btn-ghost" onClick={() => removeRoom(room.id)}>
                            Remove
                          </button>
                        </div>
                        <div className="hd-grid-3">
                          <label className="hd-field">
                            Name
                            <input value={room.name} onChange={(event) => patchRoom(room.id, { name: event.target.value })} />
                          </label>
                          <label className="hd-field">
                            Type
                            <select
                              value={room.roomType}
                              onChange={(event) => patchRoom(room.id, { roomType: event.target.value })}
                            >
                              {roomTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Exterior walls
                            <select
                              value={room.exteriorWalls}
                              onChange={(event) => patchRoom(room.id, { exteriorWalls: Number(event.target.value) })}
                            >
                              {[0, 1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Design °C
                            <input
                              type="number"
                              step="0.5"
                              value={
                                room.targetTemp ??
                                roomTypes.find((item) => item.id === room.roomType)?.targetTemp ??
                                21
                              }
                              onChange={(event) =>
                                patchRoom(room.id, { targetTemp: Number(event.target.value) || undefined })
                              }
                            />
                          </label>
                          <label className="hd-field">
                            Air changes (ACH)
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={
                                room.airChanges ??
                                roomTypes.find((item) => item.id === room.roomType)?.airChanges ??
                                0.5
                              }
                              onChange={(event) =>
                                patchRoom(room.id, { airChanges: Number(event.target.value) || undefined })
                              }
                            />
                          </label>
                          <label className="hd-field">
                            Length m
                            <input
                              inputMode="decimal"
                              value={room.length}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { length: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Width m
                            <input
                              inputMode="decimal"
                              value={room.width}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { width: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Height m
                            <input
                              inputMode="decimal"
                              value={room.height}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { height: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Wall
                            <select
                              value={room.wallType}
                              onChange={(event) => patchRoom(room.id, { wallType: event.target.value })}
                            >
                              {wallTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Glazing
                            <select
                              value={room.glazingType}
                              onChange={(event) => patchRoom(room.id, { glazingType: event.target.value })}
                            >
                              {glazingTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Window area m²
                            <input
                              inputMode="decimal"
                              value={room.windowArea}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { windowArea: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Floor
                            <select
                              value={room.floorType}
                              onChange={(event) => patchRoom(room.id, { floorType: event.target.value })}
                            >
                              {floorTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Ceiling
                            <select
                              value={room.ceilingType}
                              onChange={(event) => patchRoom(room.id, { ceilingType: event.target.value })}
                            >
                              {ceilingTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Radiator
                            <select
                              value={room.selectedRadiatorId ?? picked?.id ?? ""}
                              onChange={(event) => patchRoom(room.id, { selectedRadiatorId: event.target.value })}
                            >
                              {radiators.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.range} {item.model} · {item.outputWatts} W
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="hd-room-meta">
                          <span className="hd-chip">{wattsLabel(loss.watts)}</span>
                          <span className="hd-chip">{loss.floorArea.toFixed(1)} m²</span>
                          <span className="hd-chip">ΔT50 ~{wattsLabel(loss.radiatorOutputAtDeltaT50)}</span>
                          {picked ? <span className="hd-chip">{picked.model}</span> : <span className="hd-chip warn">Upgrade</span>}
                        </div>
                        <div className="hd-loss-row" aria-label="Heat loss breakdown">
                          <span>Walls {wattsLabel(loss.wallLoss)}</span>
                          <span>Glazing {wattsLabel(loss.glazingLoss)}</span>
                          <span>Floor {wattsLabel(loss.floorLoss)}</span>
                          <span>Ceiling {wattsLabel(loss.ceilingLoss)}</span>
                          <span>Vent {wattsLabel(loss.ventilationLoss)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}

            {tab === "system" ? (
              <>
                <h2>System & benefits</h2>
                <p className="hd-lead">
                  Compare every system ticked under <strong>Options</strong> — not just heat pumps. ASHP / hybrid also
                  get a unit picker and sound check below.
                </p>
                {!optionResults.length ? (
                  <div className="hd-banner warn">
                    No systems selected — open Options and tick the systems you want to compare.
                  </div>
                ) : (
                  <div className="hd-benefits-grid">
                    {optionResults.map((row) => (
                      <article
                        key={row.option.id}
                        className={`hd-benefit-card${row.recommended ? " is-best" : ""}${project.chosenSystemId === row.option.id ? " is-chosen" : ""}`}
                      >
                        <header>
                          <strong>{row.option.label}</strong>
                          {row.recommended ? <span className="ewg-pill">Best fit</span> : null}
                        </header>
                        <p>{row.option.description}</p>
                        <ul>
                          <li>Running cost {money(row.annualCost)} / yr</li>
                          <li>
                            vs current{" "}
                            {row.annualSavingVsCurrent >= 0 ? "+" : ""}
                            {money(row.annualSavingVsCurrent)}
                          </li>
                          <li>CO₂e {Math.round(row.co2Kg).toLocaleString("en-GB")} kg / yr</li>
                          <li>
                            Install from {money(row.option.installedFrom)}–{money(row.option.installedTo)}
                          </li>
                          {row.pump ? (
                            <li>
                              {row.pump.model} · coverage {Math.round(row.coveragePercent)}%
                            </li>
                          ) : null}
                        </ul>
                        <p className="hd-benefit-notes">{row.option.notes.join(" · ")}</p>
                        <button
                          type="button"
                          className="hd-btn hd-btn-primary"
                          onClick={() => designSystemOnPlan(row.option.id)}
                        >
                          Design on plan
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                <>
                    <h3 className="hd-subhead">Design flow temperature</h3>
                    <p className="hd-lead" style={{ marginTop: 0 }}>
                      {chosenOption
                        ? `Matched to ${chosenOption.label} — boilers go up to 80°C; heat pumps stay lower.`
                        : "Pick a system (Design on plan) to unlock the matching flow range."}
                    </p>
                    <div className="hd-grid-2" style={{ marginBottom: 16 }}>
                      <label className="hd-field">
                        Design flow temperature °C
                        <select
                          value={
                            flowOptions.some((item) => item.value === project.flowTemperature)
                              ? project.flowTemperature
                              : clampFlowTempToSystem(chosenOption?.kind, project.flowTemperature)
                          }
                          onChange={(event) => {
                            const flowTemperature = Number(event.target.value);
                            const patch: Partial<HeatDesignProject> = { flowTemperature };
                            if (chosenOption?.kind === "ashp" || chosenOption?.kind === "hybrid") {
                              const nextLoad = calculateSystemDesign({ ...project, flowTemperature });
                              const pump = suggestHeatPump(nextLoad.designLoadKw, flowTemperature);
                              patch.selectedHeatPumpId = pump.id;
                            }
                            patchProject(patch);
                          }}
                        >
                          {flowOptions.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {showHeatPumpPicker ? (
                        <label className="hd-field">
                          Outdoor unit → neighbour m
                          <input
                            inputMode="decimal"
                            value={project.nearestNeighbourDistanceM}
                            onChange={(event) =>
                              patchProject({ nearestNeighbourDistanceM: Number(event.target.value) || 0 })
                            }
                          />
                        </label>
                      ) : (
                        <label className="hd-field">
                          Chosen system
                          <input value={chosenOption?.label || "None yet — Design on plan"} readOnly />
                        </label>
                      )}
                    </div>
                  </>

                {showHeatPumpPicker ? (
                  <>
                    <h3 className="hd-subhead">Heat pump unit (ASHP / hybrid)</h3>
                    <div className="hd-pump-list">
                      {heatPumpCatalogue.map((pump) => {
                        const atFlow =
                          project.flowTemperature <= 35
                            ? pump.capacityKwAt35
                            : project.flowTemperature >= 55
                              ? pump.capacityKwAt55
                              : project.flowTemperature <= 45
                                ? pump.capacityKwAt35 +
                                  ((pump.capacityKwAt45 - pump.capacityKwAt35) * (project.flowTemperature - 35)) / 10
                                : pump.capacityKwAt45 +
                                  ((pump.capacityKwAt55 - pump.capacityKwAt45) * (project.flowTemperature - 45)) / 10;
                        return (
                          <button
                            key={pump.id}
                            type="button"
                            className={`hd-pump${selectedPump?.id === pump.id ? " is-selected" : ""}`}
                            onClick={() => patchProject({ selectedHeatPumpId: pump.id })}
                          >
                            <strong>
                              {pump.brand} {pump.model}
                            </strong>
                            <small>
                              {atFlow.toFixed(1)} kW @ {Math.min(55, project.flowTemperature)}°C · from{" "}
                              {money(pump.typicalInstalledFrom)} · {pump.soundPowerDb} dB(A)
                            </small>
                          </button>
                        );
                      })}
                    </div>
                    <div className={`hd-banner${design.soundOk ? "" : " warn"}`} style={{ marginTop: 16, marginBottom: 0 }}>
                      Sound at neighbour ≈ {design.soundAssessmentDb} dB —{" "}
                      {design.soundOk ? "within common planning band" : "review siting or quieter unit"}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {tab === "kit" ? (
              <>
                <h2>Kit & link to Core</h2>
                <p className="hd-lead">
                  Built for{" "}
                  <strong>{chosenOption?.label || "the design system"}</strong> at {project.flowTemperature}°C flow.
                  Push materials into an existing Core quote, tender, or job — or create a new one.
                </p>
                <div className={`hd-banner${design.materialsComplete ? "" : " warn"}`} style={{ marginBottom: 12 }}>
                  {design.materialsComplete
                    ? "Materials checklist complete for this design."
                    : `Still needed: ${design.materialsNotes.join(" ")}`}
                </div>

                <div className="hd-job-link-panel">
                  <strong className="hd-blake-title">
                    <BuddyCharacter mood="guide" size="sm" interactive={false} />
                    Ask Blake → Takeoff
                  </strong>
                  <p>
                    Live Blake proposes sizes and the ancillaries kit from OpenAI. Send to Takeoff builds that BOQ;
                    kit push below still sends the full materials list into Core.
                  </p>
                  {project.blakeProposal ? (
                    <div className={`hd-banner${project.blakeProposal.aiUsed ? "" : " warn"}`} style={{ marginBottom: 10 }}>
                      {project.blakeProposal.aiUsed ? "Live AI kit on this design" : "Rule fallback kit"}
                      {" — "}
                      {project.blakeProposal.summary}
                    </div>
                  ) : null}
                  <div className="hd-blake-route-actions" style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      className="hd-btn hd-btn-primary"
                      disabled={blakeBusy}
                      onClick={() => {
                        setTab("plan");
                        void askBlakeLive();
                      }}
                    >
                      <BuddyCharacter mood={blakeBusy ? "thinking" : "idle"} size="sm" interactive={false} />
                      {blakeBusy ? "Blake thinking…" : "Ask Blake"}
                    </button>
                    <button
                      type="button"
                      className="hd-btn"
                      disabled={takeoffBusy || !project.heatingLayout?.pipes?.length}
                      onClick={() => void sendLayoutToTakeoff()}
                    >
                      {takeoffBusy ? "Sending…" : project.linkedTakeoffRef ? "Update Takeoff" : "Send to Takeoff"}
                    </button>
                  </div>
                  {project.linkedTakeoffRef ? (
                    <div className="hd-banner" style={{ marginBottom: 10 }}>
                      Takeoff{" "}
                      {project.linkedTakeoffId ? (
                        <a href={`/takeoff?projectId=${encodeURIComponent(project.linkedTakeoffId)}`}>
                          <strong>{project.linkedTakeoffRef}</strong>
                        </a>
                      ) : (
                        <strong>{project.linkedTakeoffRef}</strong>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="hd-job-link-panel">
                  <strong>Link to Core</strong>
                  <p>
                    Pick a quote, tender, or job, then push the Defined kit. Quotes/jobs get a{" "}
                    <em>Heating design</em> cost centre; tenders get a <em>Heating design</em> BoQ sheet (PEX UFH and
                    copper plant stay separate).
                  </p>
                  {(project.linkedJobRef || project.linkedQuoteRef || project.linkedTenderRef) && (
                    <div className="hd-banner" style={{ marginBottom: 10 }}>
                      {project.linkedQuoteRef ? (
                        <>
                          Quote{" "}
                          {project.linkedQuoteId ? (
                            <a href={`/?quote=${encodeURIComponent(project.linkedQuoteId)}`}>
                              <strong>{project.linkedQuoteRef}</strong>
                            </a>
                          ) : (
                            <strong>{project.linkedQuoteRef}</strong>
                          )}
                          {project.linkedTenderRef || project.linkedJobRef ? " · " : null}
                        </>
                      ) : null}
                      {project.linkedTenderRef ? (
                        <>
                          Tender{" "}
                          {project.linkedTenderId ? (
                            <a href="/tenders">
                              <strong>{project.linkedTenderRef}</strong>
                            </a>
                          ) : (
                            <strong>{project.linkedTenderRef}</strong>
                          )}
                          {project.linkedJobRef ? " · " : null}
                        </>
                      ) : null}
                      {project.linkedJobRef ? (
                        <>
                          Job{" "}
                          {project.linkedJobId ? (
                            <a href={`/?job=${encodeURIComponent(project.linkedJobId)}`}>
                              <strong>{project.linkedJobRef}</strong>
                            </a>
                          ) : (
                            <strong>{project.linkedJobRef}</strong>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                  <div className="hd-link-target-toggle" role="group" aria-label="Link target">
                    <button
                      type="button"
                      className={`hd-btn${linkTarget === "quote" ? " hd-btn-primary" : " hd-btn-ghost"}`}
                      onClick={() => setLinkTarget("quote")}
                    >
                      Quote
                    </button>
                    <button
                      type="button"
                      className={`hd-btn${linkTarget === "tender" ? " hd-btn-primary" : " hd-btn-ghost"}`}
                      onClick={() => setLinkTarget("tender")}
                    >
                      Tender
                    </button>
                    <button
                      type="button"
                      className={`hd-btn${linkTarget === "job" ? " hd-btn-primary" : " hd-btn-ghost"}`}
                      onClick={() => setLinkTarget("job")}
                    >
                      Job
                    </button>
                  </div>
                  <div className="hd-quote-push">
                    {linkTarget === "quote" ? (
                      <label className="hd-field">
                        Quote
                        <select value={selectedQuoteId} onChange={(event) => setSelectedQuoteId(event.target.value)}>
                          <option value="">Create new quote</option>
                          {quoteOptions.map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {quote.ref} — {quote.customer}
                              {quote.status ? ` · ${quote.status}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : linkTarget === "tender" ? (
                      <label className="hd-field">
                        Tender
                        <select value={selectedTenderId} onChange={(event) => setSelectedTenderId(event.target.value)}>
                          <option value="">Create new tender</option>
                          {tenderOptions.map((tender) => (
                            <option key={tender.id} value={tender.id}>
                              {tender.name} — {tender.client}
                              {tender.status ? ` · ${tender.status}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="hd-field">
                        Job
                        <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
                          <option value="">Create new job</option>
                          {jobOptions.map((job) => (
                            <option key={job.id} value={job.id}>
                              {job.ref} — {job.customer}
                              {job.site ? ` · ${job.site}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      className="hd-btn hd-btn-primary"
                      disabled={linkBusy || !design.kit.length || !project.chosenSystemId}
                      title={
                        !project.chosenSystemId
                          ? "Design a system on plan first"
                          : !design.kit.length
                            ? "Kit is empty — run Design on plan"
                            : undefined
                      }
                      onClick={() => void pushKitToCore()}
                    >
                      {linkBusy
                        ? "Pushing…"
                        : linkTarget === "quote"
                          ? selectedQuoteId
                            ? "Push materials to quote"
                            : "Create quote + push materials"
                          : linkTarget === "tender"
                            ? selectedTenderId
                              ? "Push materials to tender"
                              : "Create tender + push materials"
                            : selectedJobId
                              ? "Push materials to job"
                              : "Create job + push materials"}
                    </button>
                  </div>
                  {!linkBusy && !project.chosenSystemId ? (
                    <p className="hd-lead" style={{ marginTop: 8 }}>
                      Push is disabled until you design a system on plan — the kit must match gas / ASHP / oil etc.
                    </p>
                  ) : !linkBusy && !design.kit.length ? (
                    <p className="hd-lead" style={{ marginTop: 8 }}>
                      Push is disabled — kit is empty. Open System, run Design on plan, then return here to push
                      materials.
                    </p>
                  ) : null}
                  {!project.customerName.trim() ? (
                    <p className="hd-lead" style={{ marginTop: 8 }}>
                      Tip: fill customer name on the Project tab before creating a new quote, tender, or job.
                    </p>
                  ) : null}
                </div>

                <div className="hd-extras">
                  {kitExtraOptions.map((extra) => {
                    const on = project.kitExtras.includes(extra.id);
                    return (
                      <label key={extra.id} className="hd-check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            patchProject({
                              kitExtras: on
                                ? project.kitExtras.filter((id) => id !== extra.id)
                                : [...project.kitExtras, extra.id],
                            })
                          }
                        />
                        {extra.label} · {money(extra.unitCost)}
                      </label>
                    );
                  })}
                </div>
                <div className="hd-blake-route-actions" style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className="hd-btn hd-btn-primary"
                    disabled={budgetBusy || blakeBusy}
                    onClick={() => void refreshBlakeBudgetPrices()}
                  >
                    {budgetBusy ? "Pricing…" : "Blake budget prices"}
                  </button>
                  <span className="hd-lead" style={{ margin: 0 }}>
                    Live AI UK trade ballpark — replace with supplier quotes when uploaded.
                  </span>
                </div>
                <div className="hd-banner" style={{ marginBottom: 12 }}>
                  Price Ledger: <strong>Budget</strong> / <strong>Guide</strong> are planning figures.{" "}
                  <strong>RFQ</strong> awaits the merchant. <strong>Firm</strong> is a confirmed supplier cost —
                  that wins, and feeds the rate library.
                </div>
                <div className="hd-kit-table">
                  <div className="hd-kit-row hd-kit-head">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Cost</span>
                  </div>
                  {design.kit.map((line) => {
                    const state = derivePricingState(line);
                    return (
                      <div key={line.id} className="hd-kit-row">
                        <span>
                          <strong>
                            {line.description}
                            <span
                              className={`hd-price-chip ${chipClassForPricingState(state)}`}
                              title={line.pricingNote || PRICING_STATE_HINT[state]}
                            >
                              {PRICING_STATE_LABEL[state]}
                            </span>
                          </strong>
                          <small>{line.category}</small>
                        </span>
                        <span>
                          {line.qty}
                          {line.unit ? ` ${line.unit}` : ""}
                        </span>
                        <span>{state === "rfq" && !(line.unitCost > 0) ? "RFQ" : money(line.qty * line.unitCost)}</span>
                      </div>
                    );
                  })}
                  <div className="hd-kit-row hd-kit-total">
                    <span>Kit total (materials ex VAT — provisional until Firm)</span>
                    <span />
                    <span>{money(design.kitTotal)}</span>
                  </div>
                </div>
              </>
            ) : null}

            {tab === "forms" ? (
              <>
                <h2>MCS / DNO paperwork</h2>
                <p className="hd-lead">
                  Lab checklist aligned to common MCS MIS 3005 / DNO notification content — not a certified certificate
                  yet.
                </p>
                <div className="hd-forms">
                  <article className="hd-form-card">
                    <h3>Heat pump design summary</h3>
                    <ul>
                      <li>Design external temperature: {project.designExternalTemp}°C</li>
                      <li>Space heat loss: {kw(design.totalHeatLossKw)}</li>
                      <li>DHW daily energy: {design.dhwDailyKwh.toFixed(1)} kWh · peak allowance {kw(design.dhwPeakKw)}</li>
                      <li>Design capacity target: {kw(design.designLoadKw)}</li>
                      <li>
                        Selected unit: {selectedPump?.brand} {selectedPump?.model} · {kw(design.capacityAtFlowKw)} @{" "}
                        {project.flowTemperature}°C · SCOP {design.scop.toFixed(1)}
                      </li>
                      <li>Emitter upgrades flagged: {design.emitterUpgradeCount}</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>Performance estimate</h3>
                    <ul>
                      <li>Estimated annual heat demand: {Math.round(design.estimatedAnnualHeatKwh).toLocaleString("en-GB")} kWh</li>
                      <li>Estimated HP electricity: {Math.round(design.estimatedHpElectricityKwh).toLocaleString("en-GB")} kWh</li>
                      <li>Current fuel cost: {money(design.estimatedCurrentCost)}</li>
                      <li>HP running cost: {money(design.estimatedHpCost)}</li>
                      <li>Indicative saving: {money(design.estimatedAnnualSaving)} / yr</li>
                      <li>Indicative CO₂e saving: {Math.round(design.co2SavingKg).toLocaleString("en-GB")} kg</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>Sound assessment</h3>
                    <ul>
                      <li>Outdoor unit sound power: {selectedPump?.soundPowerDb} dB(A)</li>
                      <li>Distance to nearest neighbour: {project.nearestNeighbourDistanceM} m</li>
                      <li>Assessed level at receptor: {design.soundAssessmentDb} dB</li>
                      <li>Status: {design.soundOk ? "Pass — common planning band" : "Review siting / quieter unit"}</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>DNO notification checklist</h3>
                    <ul>
                      <li>Installer MCS / competent person scheme details to attach</li>
                      <li>Property MPAN / supply capacity to confirm on site</li>
                      <li>Outdoor unit location sketch (use floor plan + photos)</li>
                      <li>Single-phase / three-phase confirmation</li>
                      <li>Export / generation notice if PV diverter selected</li>
                    </ul>
                  </article>
                </div>
              </>
            ) : null}

            {tab === "options" ? (
              <>
                <h2>Heating system options</h2>
                <p className="hd-lead">
                  Tick systems to compare (report + System & benefits). Pick radiators or UFH, then{" "}
                  <strong>Design on plan</strong>.
                </p>
                <div className="hd-emitter-picker">
                  <strong>Emitters</strong>
                  <div className="hd-emitter-choices" role="group" aria-label="Emitter type">
                    {(
                      [
                        ["radiators", "Radiators", "Sized radiator for each room"],
                        ["ufh", "Underfloor heating", "UFH zone in each room"],
                        ["mixed", "Mixed", "UFH wet rooms · radiators elsewhere"],
                      ] as const
                    ).map(([id, label, hint]) => (
                      <button
                        key={id}
                        type="button"
                        className={`hd-emitter-choice${(project.emitterMode ?? "radiators") === id ? " is-on" : ""}`}
                        onClick={() => patchProject({ emitterMode: id })}
                      >
                        <strong>{label}</strong>
                        <span>{hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hd-options-actions">
                  <button
                    type="button"
                    className="hd-btn hd-btn-ghost"
                    onClick={() => patchProject({ reportOptionIds: heatingSystemOptions.map((item) => item.id) })}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="hd-btn hd-btn-ghost"
                    onClick={() => patchProject({ reportOptionIds: ["opt-ashp", "opt-gas"] })}
                  >
                    ASHP + gas
                  </button>
                  <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setTab("system")}>
                    View benefits
                  </button>
                  <button type="button" className="hd-btn hd-btn-primary" onClick={() => setTab("report")}>
                    View report
                  </button>
                </div>
                <div className="hd-options-grid">
                  {heatingSystemOptions.map((option) => {
                    const on = (project.reportOptionIds ?? []).includes(option.id);
                    const result = optionResults.find((row) => row.option.id === option.id);
                    const chosen = project.chosenSystemId === option.id;
                    return (
                      <div
                        key={option.id}
                        className={`hd-option-card${on ? " is-on" : ""}${result?.recommended ? " is-best" : ""}${chosen ? " is-chosen" : ""}`}
                      >
                        <label className="hd-option-check">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const current = project.reportOptionIds ?? [];
                              const next = on ? current.filter((id) => id !== option.id) : [...current, option.id];
                              patchProject({ reportOptionIds: next.length ? next : [option.id] });
                            }}
                          />
                          <div>
                            <strong>
                              {option.label}
                              {result?.recommended ? <span className="ewg-pill">Best for this home</span> : null}
                              {chosen ? <span className="ewg-pill ewg-pill-chosen">On plan</span> : null}
                            </strong>
                            <p>{option.description}</p>
                            {result ? (
                              <small>
                                {money(result.annualCost)}/yr · save {money(result.annualSavingVsCurrent)} · install from{" "}
                                {money(result.option.installedFrom)}
                              </small>
                            ) : (
                              <small>Install from {money(option.installedFrom)}</small>
                            )}
                          </div>
                        </label>
                        <button
                          type="button"
                          className="hd-btn hd-btn-primary hd-option-design"
                          onClick={() => designSystemOnPlan(option.id)}
                        >
                          Design on plan
                        </button>
                      </div>
                    );
                  })}
                </div>
                {optionResults[0] ? (
                  <div className="hd-banner" style={{ marginTop: 14, marginBottom: 0 }}>
                    Recommended: {optionResults[0].option.label}
                    {optionResults[0].pump ? ` (${optionResults[0].pump.model})` : ""} —{" "}
                    {money(optionResults[0].annualCost)}/yr running cost. Emitters:{" "}
                    {project.emitterMode === "ufh"
                      ? "underfloor heating"
                      : project.emitterMode === "mixed"
                        ? "mixed"
                        : "radiators"}
                    .
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === "report" ? (
              <div className="hd-room-head no-print" style={{ marginBottom: 8 }}>
                <div>
                  <h2>Heating options report</h2>
                  <p className="hd-lead" style={{ marginBottom: 0 }}>
                    Professional Errol Watson Group report — includes the systems ticked under Options.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setTab("options")}>
                    Edit options
                  </button>
                  <button type="button" className="hd-btn hd-btn-primary" onClick={requestPrint}>
                    Print / PDF
                  </button>
                </div>
              </div>
            ) : null}
            <DesignReport
              project={project}
              design={design}
              options={optionResults}
              companyName={brand.companyName}
              className={tab === "report" ? undefined : "is-print-source"}
            />
          </section>

          <aside className={`hd-sticky${tab === "plan" ? " is-hidden-on-plan" : ""}`}>
            <section className="hd-panel">
              <h2>Design snapshot</h2>
              <p className="hd-lead">
                {project.linkedQuoteRef || project.linkedTenderRef || project.linkedJobRef
                  ? [
                      project.linkedQuoteRef ? `Quote ${project.linkedQuoteRef}` : null,
                      project.linkedTenderRef ? `Tender ${project.linkedTenderRef}` : null,
                      project.linkedJobRef ? `Job ${project.linkedJobRef}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Not linked yet — open Kit & link to push materials into Core."}
              </p>
              <div className="hd-stat-grid">
                <div className="hd-stat">
                  <span>Space heat loss</span>
                  <strong>{kw(design.totalHeatLossKw)}</strong>
                </div>
                <div className="hd-stat">
                  <span>Design load</span>
                  <strong>{kw(design.designLoadKw)}</strong>
                </div>
                <div className="hd-stat">
                  <span>Flow</span>
                  <strong>{project.flowTemperature}°C</strong>
                </div>
                <div className="hd-stat">
                  <span>System</span>
                  <strong>{chosenOption?.shortLabel || "—"}</strong>
                </div>
                <div className="hd-stat warm">
                  <span>Kit materials</span>
                  <strong>{money(design.kitTotal)}</strong>
                </div>
                <div className="hd-stat warm">
                  <span>Core link</span>
                  <strong>
                    {project.linkedQuoteRef || project.linkedTenderRef || project.linkedJobRef || "Not linked"}
                  </strong>
                </div>
              </div>
              {chosenOption?.kind === "ashp" || chosenOption?.kind === "hybrid" ? (
                design.coveragePercent < 95 ? (
                <div className="hd-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  Pump covers {Math.round(design.coveragePercent)}% — pick a larger unit.
                </div>
              ) : (
                <div className="hd-banner" style={{ marginTop: 14, marginBottom: 0 }}>
                  Coverage {Math.round(design.coveragePercent)}% · {selectedPump?.model}
                </div>
              )
              ) : project.chosenSystemId ? (
                <div className="hd-banner" style={{ marginTop: 14, marginBottom: 0 }}>
                  {chosenOption?.label} @ {project.flowTemperature}°C flow
                </div>
              ) : (
                <div className="hd-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  Choose a system and Design on plan to build the kit.
                </div>
              )}
            </section>
            <section className="hd-panel hd-history-panel no-print">
              <div className="hd-history-head">
                <h2>History</h2>
                <span>{revisionHistory.length} revision{revisionHistory.length === 1 ? "" : "s"}</span>
              </div>
              {revisionHistory.length ? (
                <ol className="hd-history-list">
                  {revisionHistory.slice(0, 5).map((revision) => (
                    <li key={revision.id}>
                      <time dateTime={revision.at}>{formatRevisionTimestamp(revision.at)}</time>
                      <span>{revision.summary}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="hd-history-empty">No server saves recorded yet.</p>
              )}
            </section>
          </aside>
        </div>

        <p className="hd-lab-note">
          Open at <code>/heat-design</code> or from Core → Quick access. Push materials from{" "}
          <strong>Kit &amp; link</strong> into a quote, tender, or job (existing or new). They appear under{" "}
          <em>Heating design</em>.
        </p>
      </div>
    </main>
  );
}
