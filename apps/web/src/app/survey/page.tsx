"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from "react";
import {
  ArrowLeft,
  Bot,
  Camera,
  CheckCircle2,
  FileText,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  Ruler,
  ScanLine,
  Send,
  Sparkles,
  ThermometerSun,
  Trash2,
  Upload,
} from "lucide-react";
import type { ClientSite } from "@/lib/people-data";
import type { Quote } from "@/lib/workflow-data";
import type {
  TakeoffDocument,
  TakeoffDocumentKind,
  TakeoffProject,
  TakeoffRadiator,
  TakeoffRoom,
  TakeoffRoomScanPreview,
  TakeoffSurveyChatMessage,
} from "@/lib/takeoff-data";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
};

const publicPilotBaseUrl = "https://nexa-pilot.onrender.com";

type SurveyHeatLossDraft = {
  roomName: string;
  sourceRoomId?: string;
  roomType: "Living Room" | "Bedroom" | "Bathroom" | "Kitchen" | "Hall" | "Office";
  lengthM: string;
  widthM: string;
  heightM: string;
  outsideWalls: string;
  glazing: "Double glazed" | "Single glazed" | "Large glazing";
  windowAreaM2: string;
  construction: "Modern / insulated" | "Average" | "Older / exposed";
};

const blankHeatLossDraft: SurveyHeatLossDraft = {
  roomName: "",
  sourceRoomId: "",
  roomType: "Living Room",
  lengthM: "",
  widthM: "",
  heightM: "2.4",
  outsideWalls: "1",
  glazing: "Double glazed",
  windowAreaM2: "",
  construction: "Average",
};

const radiatorRecommendations = [
  { model: "Classic Compact K1 600 x 800", outputWatts: 740 },
  { model: "Classic Compact P+ 600 x 1000", outputWatts: 1180 },
  { model: "Classic Compact K2 600 x 1000", outputWatts: 1680 },
  { model: "Classic Compact K2 600 x 1200", outputWatts: 2010 },
  { model: "Softline Compact K2 600 x 1400", outputWatts: 2275 },
  { model: "Classic Compact K3 600 x 1200", outputWatts: 2720 },
  { model: "Vertical K2 1800 x 600", outputWatts: 2095 },
];

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultOpening(project: TakeoffProject): TakeoffSurveyChatMessage[] {
  return [
    {
      id: makeId("survey-chat"),
      role: "assistant",
      text: `What are we pricing today for ${project.customer}? Start with the customer outcome, then I will ask for the photos, room scan, measurements and exclusions we need.`,
      createdAt: nowIso(),
    },
  ];
}

function quoteSite(quote: Quote, clientSites: ClientSite[]) {
  return quote.siteId ? clientSites.find((site) => site.id === quote.siteId) : undefined;
}

function quoteSearchLabel(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [quote.ref, quote.customer, site?.address, quote.description].filter(Boolean).join(" - ");
}

function quoteSearchText(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [
    quote.ref,
    quote.customer,
    site?.name,
    site?.address,
    quote.description,
    quote.owner,
    quote.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

function shouldReplaceProjectText(value: string) {
  const normalised = value.trim().toLowerCase();
  return [
    "",
    "new survey pricing chat",
    "customer to confirm",
    "site to confirm",
    "takeoff scope to review.",
    "survey conversation started from nexa survey.",
  ].includes(normalised);
}

function numberFromInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function btuFromWatts(watts: number) {
  return Math.round(watts * 3.412);
}

function calculateHeatLoss(draft: SurveyHeatLossDraft) {
  const lengthM = numberFromInput(draft.lengthM);
  const widthM = numberFromInput(draft.widthM);
  const heightM = numberFromInput(draft.heightM);
  const windowAreaM2 = numberFromInput(draft.windowAreaM2);
  const outsideWalls = Math.max(0, numberFromInput(draft.outsideWalls));
  const areaM2 = lengthM * widthM;
  const baseWattsPerM2 = draft.construction === "Modern / insulated" ? 55 : draft.construction === "Older / exposed" ? 100 : 75;
  const roomTempUplift = draft.roomType === "Bathroom" ? 1.06 : draft.roomType === "Hall" ? 0.95 : 1;
  const glazingUplift = draft.glazing === "Single glazed" ? 0.14 : draft.glazing === "Large glazing" ? 0.18 : 0;
  const wallUplift = Math.min(0.35, outsideWalls * 0.075);
  const heightUplift = heightM > 2.4 ? Math.min(0.18, (heightM - 2.4) * 0.12) : 0;
  const windowAllowance = windowAreaM2 * (draft.glazing === "Single glazed" ? 70 : 42);
  const watts = Math.round(((areaM2 * baseWattsPerM2) + windowAllowance) * (1 + wallUplift + glazingUplift + heightUplift) * roomTempUplift);
  const recommendations = radiatorRecommendations
    .filter((radiator) => radiator.outputWatts >= watts)
    .slice(0, 3);

  return {
    areaM2: Math.round(areaM2 * 100) / 100,
    heightM,
    lengthM,
    outsideWalls,
    recommendations: recommendations.length ? recommendations : radiatorRecommendations.slice(-3),
    watts,
    widthM,
    windowAreaM2,
  };
}

function formatHeatLossDimension(value?: number) {
  if (!value || !Number.isFinite(value)) return "";
  return `${Math.round(value * 100) / 100}`;
}

function inferRoomTypeFromName(roomName: string): SurveyHeatLossDraft["roomType"] {
  const normalised = roomName.toLowerCase();
  if (/bath|ensuite|en-suite|wc|toilet|shower/.test(normalised)) return "Bathroom";
  if (/bed/.test(normalised)) return "Bedroom";
  if (/kitchen/.test(normalised)) return "Kitchen";
  if (/hall|landing|corridor/.test(normalised)) return "Hall";
  if (/office|study/.test(normalised)) return "Office";
  return "Living Room";
}

function isLidarRoom(room: TakeoffRoom) {
  return room.id.startsWith("lidar-room-") || /lidar|roomplan|room scan/i.test(room.notes);
}

function heatLossDraftFromRoom(room: TakeoffRoom): Partial<SurveyHeatLossDraft> {
  return {
    sourceRoomId: room.id,
    roomName: room.name,
    roomType: inferRoomTypeFromName(room.name),
    lengthM: formatHeatLossDimension(room.lengthM),
    widthM: formatHeatLossDimension(room.widthM),
    heightM: formatHeatLossDimension(room.heightM) || "2.4",
    outsideWalls: `${room.outsideWalls ?? 1}`,
    windowAreaM2: formatHeatLossDimension(room.windowAreaM2),
    construction: room.construction ?? "Average",
    glazing: room.glazing ?? "Double glazed",
  };
}

function roomScanDeepLink(project: TakeoffProject) {
  const baseUrl = typeof window !== "undefined"
    && !["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? window.location.origin
    : publicPilotBaseUrl;
  const returnPath = typeof window !== "undefined" && window.location.pathname.startsWith("/estimator")
    ? "/estimator"
    : "/survey";
  const params = new URLSearchParams({
    baseUrl,
    projectId: project.id,
    reference: project.reference,
    projectName: project.name,
    returnUrl: `${baseUrl}${returnPath}`,
  });
  return `nexa-field://room-scan?${params.toString()}`;
}

function fallbackRoomScanPreview(document: TakeoffDocument | undefined, rooms: TakeoffRoom[]): TakeoffRoomScanPreview | null {
  if (document?.roomScanPreview) return document.roomScanPreview;

  const lidarRoom = rooms.find((room) => /lidar|roomplan|room scan/i.test(room.notes))
    ?? rooms.find((room) => room.lengthM && room.widthM && room.heightM);
  if (!lidarRoom) return null;

  return {
    roomName: lidarRoom.name,
    lengthM: lidarRoom.lengthM,
    widthM: lidarRoom.widthM,
    heightM: lidarRoom.heightM,
    areaM2: lidarRoom.areaM2,
    wallCount: lidarRoom.lengthM && lidarRoom.widthM ? 4 : 0,
    windowCount: lidarRoom.windowAreaM2 && lidarRoom.windowAreaM2 > 0 ? 1 : 0,
    doorCount: 0,
    openingCount: lidarRoom.windowAreaM2 && lidarRoom.windowAreaM2 > 0 ? 1 : 0,
    objectCount: 0,
    surfaces: [],
    objects: [],
  };
}

function roomPreviewBounds(preview: TakeoffRoomScanPreview) {
  const xs = [
    ...preview.surfaces.map((surface) => surface.centerX),
    ...preview.objects.map((object) => object.centerX),
  ];
  const zs = [
    ...preview.surfaces.map((surface) => surface.centerZ),
    ...preview.objects.map((object) => object.centerZ),
  ];

  if (preview.widthM) {
    xs.push(-preview.widthM / 2, preview.widthM / 2);
  }
  if (preview.lengthM) {
    zs.push(-preview.lengthM / 2, preview.lengthM / 2);
  }

  const minX = Math.min(...xs, -1.5);
  const maxX = Math.max(...xs, 1.5);
  const minZ = Math.min(...zs, -1.5);
  const maxZ = Math.max(...zs, 1.5);
  const xPad = Math.max((maxX - minX) * 0.16, 0.35);
  const zPad = Math.max((maxZ - minZ) * 0.16, 0.35);

  return {
    minX: minX - xPad,
    maxX: maxX + xPad,
    minZ: minZ - zPad,
    maxZ: maxZ + zPad,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function SurveyPage() {
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clientSites, setClientSites] = useState<ClientSite[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [isQuoteSearchOpen, setIsQuoteSearchOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [showRoomScanBridge, setShowRoomScanBridge] = useState(false);
  const [showHeatLossPanel, setShowHeatLossPanel] = useState(false);
  const [heatLossDraft, setHeatLossDraft] = useState<SurveyHeatLossDraft>(blankHeatLossDraft);
  const [roomViewRotation, setRoomViewRotation] = useState(28);
  const [roomViewZoom, setRoomViewZoom] = useState(1);
  const roomDragRef = useRef<{ x: number; rotation: number } | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const messages = selectedProject?.surveyChat?.length ? selectedProject.surveyChat : selectedProject ? defaultOpening(selectedProject) : [];
  const projectDocuments = selectedProject?.documents ?? [];
  const photoCount = projectDocuments.filter((document) => document.kind === "Survey photo").length;
  const scanCount = projectDocuments.filter((document) => document.kind === "LiDAR scan").length;
  const latestScanDocument = projectDocuments.find((document) => document.kind === "LiDAR scan");
  const latestRoomPreview = selectedProject ? fallbackRoomScanPreview(latestScanDocument, selectedProject.rooms) : null;
  const lidarRoomsForHeatLoss = useMemo(
    () => selectedProject?.rooms.filter((room) => isLidarRoom(room)) ?? [],
    [selectedProject],
  );
  const roomBounds = latestRoomPreview ? roomPreviewBounds(latestRoomPreview) : null;
  const heatLossRoomCount = selectedProject?.rooms.filter((room) => room.heatLoadWatts > 0).length ?? 0;
  const documentCount = projectDocuments.filter((document) => ["Drawing", "Contractor BOQ", "Specification"].includes(document.kind)).length;
  const heatLossResult = useMemo(() => calculateHeatLoss(heatLossDraft), [heatLossDraft]);
  const linkedQuote = useMemo(
    () => selectedProject
      ? quotes.find((quote) => quote.id === selectedProject.linkedQuoteId || quote.ref === selectedProject.linkedQuoteRef) ?? null
      : null,
    [quotes, selectedProject],
  );
  const quoteSearchMatches = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase();
    const source = query
      ? quotes.filter((quote) => quoteSearchText(quote, clientSites).includes(query))
      : quotes;
    return source.slice(0, 6);
  }, [clientSites, quoteSearch, quotes]);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const returnedProjectId = params.get("roomScanProjectId");
    const returnedReference = params.get("roomScanReference");
    const scanStatus = params.get("roomScanStatus");
    if (!scanStatus && !returnedProjectId) return;

    if (returnedProjectId) {
      setSelectedProjectId(returnedProjectId);
    }
    if (scanStatus === "received") {
      setNotice(`LiDAR scan received${returnedReference ? ` for ${returnedReference}` : ""}. Review the scan evidence, then push the survey into the linked quote.`);
      void loadData();
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    setQuoteSearch(linkedQuote ? quoteSearchLabel(linkedQuote, clientSites) : "");
  }, [clientSites, linkedQuote]);

  function startRoomDrag(event: PointerEvent<HTMLDivElement>) {
    roomDragRef.current = { x: event.clientX, rotation: roomViewRotation };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveRoomDrag(event: PointerEvent<HTMLDivElement>) {
    if (!roomDragRef.current) return;
    const delta = event.clientX - roomDragRef.current.x;
    setRoomViewRotation(roomDragRef.current.rotation + delta * 0.35);
  }

  function stopRoomDrag(event: PointerEvent<HTMLDivElement>) {
    roomDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function plotRoomX(value: number) {
    if (!roomBounds) return 50;
    const range = Math.max(roomBounds.maxX - roomBounds.minX, 1);
    return 8 + ((value - roomBounds.minX) / range) * 84;
  }

  function plotRoomZ(value: number) {
    if (!roomBounds) return 50;
    const range = Math.max(roomBounds.maxZ - roomBounds.minZ, 1);
    return 8 + ((value - roomBounds.minZ) / range) * 84;
  }

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [projectResponse, quoteResponse, siteResponse] = await Promise.all([
        fetch("/api/takeoff-projects", { headers: requestHeaders }),
        fetch("/api/quotes", { headers: requestHeaders }),
        fetch("/api/client-sites", { headers: requestHeaders }),
      ]);
      if (!projectResponse.ok) throw new Error("Unable to load survey jobs");
      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = quoteResponse.ok ? ((await quoteResponse.json()) as Quote[]) : [];
      const nextClientSites = siteResponse.ok ? ((await siteResponse.json()) as ClientSite[]) : [];
      setProjects(nextProjects);
      setQuotes(nextQuotes);
      setClientSites(nextClientSites);
      setSelectedProjectId((current) => current || nextProjects[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load survey app");
    } finally {
      setIsLoading(false);
    }
  }

  async function linkQuoteToProject(quote: Quote) {
    if (!selectedProject) return;
    const site = quoteSite(quote, clientSites);
    setQuoteSearch(quoteSearchLabel(quote, clientSites));
    setIsQuoteSearchOpen(false);
    await patchProject(selectedProject.id, {
      linkedQuoteId: quote.id,
      customer: quote.customer,
      site: site?.address ?? selectedProject.site,
      name: shouldReplaceProjectText(selectedProject.name) ? `${quote.description} survey` : selectedProject.name,
      description: shouldReplaceProjectText(selectedProject.description) ? quote.description : selectedProject.description,
    }, `Linked to ${quote.ref}.`);
  }

  async function clearQuoteLinkIfEmpty(value: string) {
    if (!selectedProject || value.trim() || !selectedProject.linkedQuoteId) return;
    await patchProject(selectedProject.id, { linkedQuoteId: "" }, "Quote link cleared.");
  }

  function replaceProject(project: TakeoffProject) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
    setSelectedProjectId(project.id);
  }

  async function patchProject(projectId: string, patch: Partial<TakeoffProject>, successMessage?: string) {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Unable to save survey");
      const updated = (await response.json()) as TakeoffProject;
      replaceProject(updated);
      if (successMessage) setNotice(successMessage);
      return updated;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save survey");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function createSurveyChat() {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "New survey pricing chat",
          customer: "Customer to confirm",
          site: "Site to confirm",
          description: "Survey conversation started from NeXa Survey.",
          surveyChat: [
            {
              id: makeId("survey-chat"),
              role: "assistant",
              text: "What are we pricing today?",
              createdAt: nowIso(),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error("Unable to create survey chat");
      const created = (await response.json()) as TakeoffProject;
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.id);
      setNotice("Survey chat created.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey chat");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSurveyChat(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const shouldDelete = window.confirm(`Delete survey chat ${project.reference}? This removes the test chat and its captured evidence from this pilot.`);
    if (!shouldDelete) return;

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        headers: requestHeaders,
      });
      if (!response.ok) throw new Error("Unable to delete survey chat");
      setProjects((current) => {
        const nextProjects = current.filter((item) => item.id !== projectId);
        setSelectedProjectId((currentSelected) => currentSelected === projectId ? nextProjects[0]?.id ?? "" : currentSelected);
        return nextProjects;
      });
      setNotice("Survey chat deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete survey chat");
    } finally {
      setIsSaving(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !draft.trim()) return;
    const messageText = draft.trim();
    const userMessage: TakeoffSurveyChatMessage = {
      id: makeId("survey-chat"),
      role: "user",
      text: messageText,
      createdAt: nowIso(),
    };
    setDraft("");
    setIsSaving(true);
    setError("");
    replaceProject({
      ...selectedProject,
      surveyChat: [...messages, userMessage],
    });

    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/survey-chat`, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: messageText }),
      });
      const result = (await response.json()) as {
        project?: TakeoffProject;
        provider?: "OpenAI" | "Pilot";
        warning?: string;
        error?: string;
      };
      if (!response.ok || !result.project) throw new Error(result.error ?? "Unable to send survey chat");
      replaceProject(result.project);
      setNotice(result.provider === "OpenAI" ? "OpenAI replied live." : result.warning || "Pilot chat fallback replied.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send survey chat");
      replaceProject(selectedProject);
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadEvidence(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    if (!selectedProject || !event.target.files?.length) return;
    const files = Array.from(event.target.files);
    const formData = new FormData();
    formData.append("kind", kind);
    files.forEach((file) => formData.append("files", file));
    setIsUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/documents`, {
        method: "POST",
        headers: requestHeaders,
        body: formData,
      });
      if (!response.ok) throw new Error("Unable to import evidence");
      const result = (await response.json()) as { project: TakeoffProject };
      const attachmentNames = files.map((file) => file.name);
      const assistantMessage: TakeoffSurveyChatMessage = {
        id: makeId("survey-chat"),
        role: "assistant",
        text: kind === "LiDAR scan"
          ? "LiDAR room scan received. I will use this as dimensional evidence for heat loss, quantities and the quote pack."
          : kind === "Drawing" || kind === "Contractor BOQ" || kind === "Specification"
            ? `${kind} received. I will use it as takeoff evidence and ask back if quantities, specs or exclusions are unclear.`
            : "Photos received. Tell me what each photo proves or what the office should check when pricing.",
        createdAt: nowIso(),
        attachments: attachmentNames,
      };
      replaceProject({
        ...result.project,
        surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage],
      });
      await patchProject(result.project.id, { surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage] }, `${kind} imported.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to import evidence");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  async function prepareQuotePack() {
    if (!selectedProject) return;
    const quoteId = selectedProject.linkedQuoteId || linkedQuote?.id;
    if (!quoteId) {
      setError("Search and select the NeXa quote before pushing this survey.");
      return;
    }
    setIsBuilding(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/survey-push`, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ actor: "NeXa Survey", quoteId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to push survey into quote");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        quote: Quote;
        totalSell?: number;
        costCentres?: Array<{ id: string }>;
        generated: {
          materialAllowances: number;
          labourAllowances: number;
          supplierRequests: number;
        };
      };
      const assistantMessage: TakeoffSurveyChatMessage = {
        id: makeId("survey-chat"),
        role: "assistant",
        text: `Survey pushed into ${result.quote.ref}: ${result.costCentres?.length ?? 0} cost centre(s), ${result.generated.materialAllowances} material line(s), ${result.generated.labourAllowances} labour allowance(s) and ${result.generated.supplierRequests} supplier request item(s). Quote value is now £${(result.totalSell ?? result.quote.value).toLocaleString()}.`,
        createdAt: nowIso(),
      };
      const nextProject = {
        ...result.project,
        surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage],
      };
      replaceProject(nextProject);
      setQuotes((current) => current.map((quote) => (quote.id === result.quote.id ? result.quote : quote)));
      await patchProject(nextProject.id, { surveyChat: nextProject.surveyChat }, `${result.quote.ref} updated from survey.`);
      window.location.href = `/?quote=${encodeURIComponent(result.quote.id)}`;
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Unable to push survey into quote");
    } finally {
      setIsBuilding(false);
    }
  }

  function openRoomScanBridge() {
    if (!selectedProject) return;
    setShowRoomScanBridge(true);
    setNotice("Opening NeXa Field LiDAR scanner. If iOS does not open it, use the import fallback below.");
    window.location.href = roomScanDeepLink(selectedProject);
  }

  function updateHeatLossDraft(patch: Partial<SurveyHeatLossDraft>) {
    setHeatLossDraft((current) => ({ ...current, ...patch }));
  }

  function applyLidarRoomToHeatLoss(roomId: string) {
    if (!roomId) {
      setHeatLossDraft(blankHeatLossDraft);
      return;
    }
    const room = lidarRoomsForHeatLoss.find((item) => item.id === roomId);
    if (!room) return;
    setHeatLossDraft((current) => ({
      ...current,
      ...heatLossDraftFromRoom(room),
    }));
  }

  async function addHeatLossToSurvey() {
    if (!selectedProject) return;
    const roomName = heatLossDraft.roomName.trim() || "Room to confirm";
    const sourceRoom = heatLossDraft.sourceRoomId
      ? selectedProject.rooms.find((room) => room.id === heatLossDraft.sourceRoomId)
      : undefined;
    const roomId = sourceRoom?.id ?? makeId("survey-room");
    const primaryRadiator = heatLossResult.recommendations[0];
    const room: TakeoffRoom = {
      ...(sourceRoom ?? {}),
      id: roomId,
      name: roomName,
      level: sourceRoom?.level ?? "Ground",
      lengthM: heatLossResult.lengthM || undefined,
      widthM: heatLossResult.widthM || undefined,
      heightM: heatLossResult.heightM || undefined,
      outsideWalls: heatLossResult.outsideWalls,
      windowAreaM2: heatLossResult.windowAreaM2,
      construction: heatLossDraft.construction,
      glazing: heatLossDraft.glazing,
      areaM2: heatLossResult.areaM2 || sourceRoom?.areaM2 || 0,
      heatLoadWatts: heatLossResult.watts,
      notes: [
        sourceRoom?.notes,
        sourceRoom
          ? "Heat loss linked to this LiDAR/RoomPlan room scan in NeXa Survey. Confirm assumptions before quote issue."
          : "Captured in NeXa AI Surveyor from chat heat loss tool. Confirm assumptions before quote issue.",
      ].filter(Boolean).join(" "),
    };
    const radiator: TakeoffRadiator = {
      id: makeId("survey-radiator"),
      roomId,
      roomName,
      outputWatts: heatLossResult.watts,
      model: primaryRadiator?.model ?? "Radiator model to confirm",
      quantity: 1,
      supplierRequired: true,
      notes: `Heat loss ${heatLossResult.watts}W / ${btuFromWatts(heatLossResult.watts)} BTU. Supplier to price final size/range.`,
    };
    const assistantMessage: TakeoffSurveyChatMessage = {
      id: makeId("survey-chat"),
      role: "assistant",
      text: `Heat loss added for ${roomName}: ${heatLossResult.watts}W / ${btuFromWatts(heatLossResult.watts)} BTU.${sourceRoom ? " Linked to the LiDAR room scan." : ""} Suggested radiator options: ${heatLossResult.recommendations.map((item) => `${item.model} (${item.outputWatts}W)`).join("; ")}. I have added this to the quote pack as a supplier-price item.`,
      createdAt: nowIso(),
    };
    const nextRooms = sourceRoom
      ? selectedProject.rooms.map((item) => (item.id === sourceRoom.id ? room : item))
      : [room, ...selectedProject.rooms];
    const nextRadiators = selectedProject.radiators.some((item) => item.roomId === roomId)
      ? selectedProject.radiators.map((item) => (item.roomId === roomId ? { ...radiator, id: item.id } : item))
      : [radiator, ...selectedProject.radiators];
    await patchProject(selectedProject.id, {
      rooms: nextRooms,
      radiators: nextRadiators,
      surveyChat: [...messages, assistantMessage],
    }, "Heat loss added to survey chat.");
    setHeatLossDraft(blankHeatLossDraft);
    setShowHeatLossPanel(false);
  }

  async function copyRoomScanLink() {
    if (!selectedProject) return;
    try {
      await navigator.clipboard.writeText(roomScanDeepLink(selectedProject));
      setNotice("NeXa Field scanner link copied. Use it after the native iPad/iPhone app is installed.");
    } catch {
      setError("Could not copy the scanner link. Use Import scan file for now.");
    }
  }

  return (
    <main className="survey-app">
      <header className="takeoff-header">
        <div className="takeoff-brand">
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa Estimator" />
          <span>NeXa Survey</span>
        </div>
        <div className="takeoff-header-actions">
          <a className="takeoff-ghost-button" href="/">
            <ArrowLeft size={16} />
            Core
          </a>
          <a className="takeoff-ghost-button" href="/takeoff">
            <FileText size={16} />
            Takeoff
          </a>
        </div>
      </header>

      <div className="survey-shell">
        <aside className="survey-sidebar">
          <div className="takeoff-sidebar-title">
            <span>Site surveys</span>
            <button className="takeoff-create-project-button" type="button" onClick={createSurveyChat} disabled={isSaving}>
              <Plus size={16} />
              New
            </button>
          </div>
          <div className="takeoff-project-list">
            {projects.map((project) => (
              <article className="takeoff-project-card" key={project.id}>
                <button
                  className={project.id === selectedProject?.id ? "takeoff-project-button active" : "takeoff-project-button"}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <span>
                    <strong>{project.reference}</strong>
                    <small>{project.status}</small>
                  </span>
                  <b>{project.name}</b>
                  <em>{project.customer}</em>
                </button>
                <button
                  className="takeoff-delete-project-button"
                  type="button"
                  aria-label={`Delete ${project.reference}`}
                  onClick={() => void deleteSurveyChat(project.id)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
            {!projects.length && !isLoading ? <p className="takeoff-empty">No survey chats yet.</p> : null}
          </div>
        </aside>

        <section className="survey-main">
          {selectedProject ? (
            <>
              <section className="survey-hero">
                <div>
                  <span className="takeoff-kicker"><b>{selectedProject.reference}</b></span>
                  <h1>Site survey chat</h1>
                  <div className="survey-hero-summary">
                    <strong>{selectedProject.name}</strong>
                    <span>{selectedProject.customer}</span>
                    <span>{selectedProject.site}</span>
                  </div>
                </div>
                <div className="takeoff-quote-link">
                  <Link2 size={16} />
                  <div className="quote-search-control">
                    <input
                      type="search"
                      value={quoteSearch}
                      placeholder="Search quote, client or address..."
                      onChange={(event) => {
                        setQuoteSearch(event.target.value);
                        setIsQuoteSearchOpen(true);
                        void clearQuoteLinkIfEmpty(event.target.value);
                      }}
                      onFocus={() => setIsQuoteSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsQuoteSearchOpen(false), 140)}
                    />
                    {isQuoteSearchOpen ? (
                      <div className="quote-search-results">
                        {quoteSearchMatches.length ? quoteSearchMatches.map((quote) => {
                          const site = quoteSite(quote, clientSites);
                          return (
                            <button type="button" key={quote.id} onClick={() => void linkQuoteToProject(quote)}>
                              <strong>{quote.ref} - {quote.customer}</strong>
                              <small>{site?.address ?? quote.description}</small>
                            </button>
                          );
                        }) : (
                          <span>No matching quote, client or site address.</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              {notice ? <p className="takeoff-notice">{notice}</p> : null}
              {error ? <p className="takeoff-error">{error}</p> : null}

              <section className="estimate-flow-strip" aria-label="Estimate workflow">
                <article className="active">
                  <span>1</span>
                  <strong>Survey</strong>
                  <small>Chat, photos, LiDAR, heat loss</small>
                </article>
                <article>
                  <span>2</span>
                  <strong>Takeoff</strong>
                  <small>Drawings, specs, contractor BOQs</small>
                </article>
                <article>
                  <span>3</span>
                  <strong>NeXa quote</strong>
                  <small>Job description, cost centres, quote value</small>
                </article>
              </section>

              {showHeatLossPanel || showRoomScanBridge ? (
                <section className="survey-tool-drawer" aria-label="Survey tools">
                  {showHeatLossPanel ? (
                    <section className="survey-heat-panel" aria-label="Chat heat loss calculator">
                      <header>
                        <div>
                          <ThermometerSun size={20} />
                          <span>
                            <strong>Heat loss inside the chat</strong>
                            <small>Add one room at a time. NeXa stores the room and suggested radiator with this survey.</small>
                          </span>
                        </div>
                        <button className="takeoff-secondary-button" type="button" onClick={() => setShowHeatLossPanel(false)}>
                          Close
                        </button>
                      </header>
                      {lidarRoomsForHeatLoss.length ? (
                        <div className="survey-lidar-room-picker">
                          <div>
                            <strong>Use LiDAR room measurements</strong>
                            <span>Pick a scanned room to pre-fill dimensions and opening area. Confirm outside walls, glazing and construction before adding the radiator.</span>
                          </div>
                          <select value={heatLossDraft.sourceRoomId ?? ""} onChange={(event) => applyLidarRoomToHeatLoss(event.target.value)}>
                            <option value="">Manual room</option>
                            {lidarRoomsForHeatLoss.map((room) => (
                              <option key={room.id} value={room.id}>
                                {room.name} {room.lengthM && room.widthM ? `- ${formatHeatLossDimension(room.lengthM)}m x ${formatHeatLossDimension(room.widthM)}m` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="survey-lidar-room-picker empty">
                          <strong>No LiDAR rooms linked yet</strong>
                          <span>Use LiDAR scan for each room, then return here to pre-fill the heat loss dimensions from the scanned rooms.</span>
                        </div>
                      )}
                      <div className="survey-heat-grid">
                        <label>
                          Room name
                          <input value={heatLossDraft.roomName} onChange={(event) => updateHeatLossDraft({ roomName: event.target.value })} placeholder="Lounge, Bedroom 1..." />
                        </label>
                        <label>
                          Room type
                          <select value={heatLossDraft.roomType} onChange={(event) => updateHeatLossDraft({ roomType: event.target.value as SurveyHeatLossDraft["roomType"] })}>
                            {["Living Room", "Bedroom", "Bathroom", "Kitchen", "Hall", "Office"].map((item) => <option key={item}>{item}</option>)}
                          </select>
                        </label>
                        <label>
                          Length (m)
                          <input inputMode="decimal" value={heatLossDraft.lengthM} onChange={(event) => updateHeatLossDraft({ lengthM: event.target.value })} placeholder="5.4" />
                        </label>
                        <label>
                          Width (m)
                          <input inputMode="decimal" value={heatLossDraft.widthM} onChange={(event) => updateHeatLossDraft({ widthM: event.target.value })} placeholder="3.8" />
                        </label>
                        <label>
                          Height (m)
                          <input inputMode="decimal" value={heatLossDraft.heightM} onChange={(event) => updateHeatLossDraft({ heightM: event.target.value })} />
                        </label>
                        <label>
                          Outside walls
                          <input inputMode="numeric" value={heatLossDraft.outsideWalls} onChange={(event) => updateHeatLossDraft({ outsideWalls: event.target.value })} />
                        </label>
                        <label>
                          Window type
                          <select value={heatLossDraft.glazing} onChange={(event) => updateHeatLossDraft({ glazing: event.target.value as SurveyHeatLossDraft["glazing"] })}>
                            {["Double glazed", "Single glazed", "Large glazing"].map((item) => <option key={item}>{item}</option>)}
                          </select>
                        </label>
                        <label>
                          Glazed area (m2)
                          <input inputMode="decimal" value={heatLossDraft.windowAreaM2} onChange={(event) => updateHeatLossDraft({ windowAreaM2: event.target.value })} placeholder="2.1" />
                        </label>
                        <label>
                          Construction
                          <select value={heatLossDraft.construction} onChange={(event) => updateHeatLossDraft({ construction: event.target.value as SurveyHeatLossDraft["construction"] })}>
                            {["Modern / insulated", "Average", "Older / exposed"].map((item) => <option key={item}>{item}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="survey-heat-result">
                        <div>
                          <span>Heat required</span>
                          <strong>{heatLossResult.watts}W / {btuFromWatts(heatLossResult.watts)} BTU</strong>
                        </div>
                        <div>
                          <span>Suggested radiators</span>
                          <strong>{heatLossResult.recommendations.map((item) => item.model).join(" - ")}</strong>
                        </div>
                        <button className="takeoff-primary-button" type="button" onClick={() => void addHeatLossToSurvey()} disabled={!heatLossResult.watts}>
                          Add to chat and quote pack
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {showRoomScanBridge ? (
                    <section className="survey-roomscan-bridge" aria-label="LiDAR room scan setup">
                      <div>
                        <ScanLine size={22} />
                        <span>
                          <strong>LiDAR camera scan</strong>
                          <small>NeXa has tried to open the native iPad/iPhone scanner for this survey. Use import only if the scanner cannot open on this device.</small>
                        </span>
                      </div>
                      <ol>
                        <li>Scan the room in NeXa Field on the iPad/iPhone.</li>
                        <li>Send the scan back to this linked survey/quote.</li>
                        <li>If the native scanner does not open, import an existing RoomPlan/3D scan file below.</li>
                      </ol>
                      <div className="survey-roomscan-actions">
                        <label className={isUploading ? "takeoff-upload-button disabled" : "takeoff-upload-button"}>
                          <Upload size={15} />
                          Import scan file
                          <input hidden type="file" accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply" onChange={(event) => void uploadEvidence("LiDAR scan", event)} />
                        </label>
                        <button className="takeoff-secondary-button" type="button" onClick={() => void copyRoomScanLink()}>
                          <Link2 size={15} />
                          Copy app link
                        </button>
                        <button className="takeoff-secondary-button" type="button" onClick={() => setShowRoomScanBridge(false)}>
                          Close
                        </button>
                      </div>
                      <p>
                        <Info size={14} />
                        Safari showed "address is invalid" because the native NeXa Field scanner is not installed on this device yet.
                      </p>
                    </section>
                  ) : null}
                </section>
              ) : null}

              <section className="survey-workspace">
                <article className="survey-chat-panel">
                  <header className="survey-chat-title">
                    <div>
                      <MessageCircle size={18} />
                      <span>
                        <strong>NeXa conversation</strong>
                        <small>Answer naturally. NeXa asks what is missing and keeps the quote pack together.</small>
                      </span>
                    </div>
                    <b>{messages.length} messages</b>
                  </header>
                  <div className="survey-action-strip">
                    <span className="survey-action-label">Site tools</span>
                    <label className={isUploading ? "takeoff-upload-button disabled" : "takeoff-upload-button"}>
                      <Camera size={15} />
                      Photos
                      <input hidden type="file" accept="image/*,video/*" multiple onChange={(event) => void uploadEvidence("Survey photo", event)} />
                    </label>
                    <button className="takeoff-secondary-button" type="button" onClick={() => setDraft("Site note: ")}>
                      <MessageCircle size={15} />
                      Add note
                    </button>
                    <button className="takeoff-secondary-button" type="button" onClick={openRoomScanBridge}>
                      <ScanLine size={15} />
                      LiDAR scan
                    </button>
                    <button className="takeoff-secondary-button" type="button" onClick={() => setShowHeatLossPanel((current) => !current)}>
                      <ThermometerSun size={15} />
                      Heat loss
                    </button>
                    <button className="takeoff-secondary-button" type="button" onClick={prepareQuotePack} disabled={isBuilding}>
                      {isBuilding ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                      Push into quote
                    </button>
                    <a className="takeoff-secondary-button" href={linkedQuote ? `/?quote=${encodeURIComponent(linkedQuote.id)}` : "/"}>
                      <Send size={15} />
                      Open quote
                    </a>
                  </div>

                  <div className="survey-chat-log">
                    {messages.map((message) => (
                      <div className={`survey-message ${message.role}`} key={message.id}>
                        <b>{message.role === "assistant" ? <Bot size={15} /> : "You"}</b>
                        <span>
                          {message.text}
                          {message.attachments?.length ? (
                            <small>{message.attachments.join(", ")}</small>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>

                  <form className="survey-composer" onSubmit={sendMessage}>
                    <textarea
                      placeholder="Tell NeXa what you are pricing, what you can see, or what the customer has asked for..."
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <button className="takeoff-primary-button" type="submit" disabled={!draft.trim() || isSaving}>
                      {isSaving ? <Loader2 className="spin" size={15} /> : <MessageCircle size={15} />}
                      Send
                    </button>
                  </form>
                </article>

                <aside className="survey-capture-panel">
                  <div className="survey-capture-heading">
                    <strong>Survey pack</strong>
                    <small>Site evidence feeding the estimate</small>
                  </div>
                  <article>
                    <ImagePlus size={18} />
                    <span>Photos</span>
                    <strong>{photoCount}</strong>
                  </article>
                  <article>
                    <Ruler size={18} />
                    <span>LiDAR scans</span>
                    <strong>{scanCount}</strong>
                  </article>
                  {latestRoomPreview ? (
                    <article className="survey-room-viewer-card">
                      <div className="survey-room-viewer-title">
                        <span>
                          <strong>{latestRoomPreview.roomName}</strong>
                          <small>
                            {latestRoomPreview.lengthM && latestRoomPreview.widthM
                              ? `${latestRoomPreview.lengthM}m x ${latestRoomPreview.widthM}m`
                              : "RoomPlan geometry"}
                            {latestRoomPreview.heightM ? ` · ${latestRoomPreview.heightM}m high` : ""}
                          </small>
                        </span>
                        <b>{latestRoomPreview.areaM2 ? `${latestRoomPreview.areaM2}m2` : "Review"}</b>
                      </div>
                      <div
                        className="survey-room-viewer"
                        onPointerDown={startRoomDrag}
                        onPointerMove={moveRoomDrag}
                        onPointerUp={stopRoomDrag}
                        onPointerCancel={stopRoomDrag}
                      >
                        <div
                          className="survey-room-model"
                          style={{
                            transform: `rotateX(58deg) rotateZ(${roomViewRotation}deg) scale(${roomViewZoom})`,
                          }}
                        >
                          <svg aria-label="Interactive LiDAR room preview" viewBox="0 0 100 100" role="img">
                            <defs>
                              <linearGradient id="surveyRoomFloor" x1="0%" x2="100%" y1="0%" y2="100%">
                                <stop offset="0%" stopColor="#eefaff" />
                                <stop offset="100%" stopColor="#d8eef8" />
                              </linearGradient>
                            </defs>
                            <rect className="survey-room-floor" x="8" y="8" width="84" height="84" rx="8" />
                            {latestRoomPreview.surfaces.length ? (
                              latestRoomPreview.surfaces.map((surface, index) => {
                                const surfaceWidth = clamp(surface.widthM / Math.max(latestRoomPreview.lengthM ?? 4, latestRoomPreview.widthM ?? 4, 1) * 76, 8, 52);
                                const surfaceDepth = /window|door|opening/i.test(surface.type) ? 3 : 4.5;
                                const x = plotRoomX(surface.centerX);
                                const y = plotRoomZ(surface.centerZ);
                                return (
                                  <rect
                                    className={`survey-room-surface ${/window/i.test(surface.type) ? "window" : /door|opening/i.test(surface.type) ? "opening" : "wall"}`}
                                    height={surfaceDepth}
                                    key={`${surface.type}-${index}`}
                                    rx={surfaceDepth / 2}
                                    transform={`translate(${x} ${y}) rotate(${surface.rotationDegrees ?? 0}) translate(${-surfaceWidth / 2} ${-surfaceDepth / 2})`}
                                    width={surfaceWidth}
                                  />
                                );
                              })
                            ) : (
                              <rect className="survey-room-outline" x="14" y="14" width="72" height="72" rx="6" />
                            )}
                            {latestRoomPreview.objects.map((object, index) => {
                              const maxDimension = Math.max(latestRoomPreview.lengthM ?? 4, latestRoomPreview.widthM ?? 4, 1);
                              const width = clamp(object.widthM / maxDimension * 72, 4, 18);
                              const depth = clamp(object.depthM / maxDimension * 72, 4, 18);
                              const x = plotRoomX(object.centerX);
                              const y = plotRoomZ(object.centerZ);
                              return (
                                <rect
                                  className="survey-room-object"
                                  height={depth}
                                  key={`${object.category}-${index}`}
                                  rx="2"
                                  transform={`translate(${x} ${y}) rotate(${object.rotationDegrees ?? 0}) translate(${-width / 2} ${-depth / 2})`}
                                  width={width}
                                />
                              );
                            })}
                          </svg>
                        </div>
                      </div>
                      <div className="survey-room-viewer-meta">
                        <span>{latestRoomPreview.wallCount} walls</span>
                        <span>{latestRoomPreview.windowCount} windows</span>
                        <span>{latestRoomPreview.doorCount + latestRoomPreview.openingCount} doors/openings</span>
                        <span>{latestRoomPreview.objectCount} objects</span>
                      </div>
                      <div className="survey-room-viewer-controls">
                        <button type="button" onClick={() => setRoomViewRotation((current) => current - 30)}>Rotate left</button>
                        <button type="button" onClick={() => setRoomViewRotation((current) => current + 30)}>Rotate right</button>
                        <button type="button" onClick={() => setRoomViewZoom((current) => Math.min(current + 0.12, 1.45))}>Zoom</button>
                        <button type="button" onClick={() => { setRoomViewRotation(28); setRoomViewZoom(1); }}>Reset</button>
                      </div>
                      {latestScanDocument?.previewImageDataUrl ? (
                        <img className="survey-room-static-preview" src={latestScanDocument.previewImageDataUrl} alt={`${latestScanDocument.fileName} room scan preview`} />
                      ) : null}
                    </article>
                  ) : null}
                  <article>
                    <ThermometerSun size={18} />
                    <span>Heat loss</span>
                    <strong>{heatLossRoomCount}</strong>
                  </article>
                  <article>
                    <FileText size={18} />
                    <span>Office docs</span>
                    <strong>{documentCount}</strong>
                  </article>
                  <article>
                    <CheckCircle2 size={18} />
                    <span>Linked quote</span>
                    <strong>{linkedQuote?.ref ?? selectedProject.linkedQuoteRef ?? "Not linked"}</strong>
                  </article>
                  <div className="survey-next-steps">
                    <strong>Handoff rule</strong>
                    <p>Survey captures site truth and pushes straight into the linked quote. Takeoff stays separate for drawings, specs and contractor BOQs.</p>
                  </div>
                </aside>
              </section>
            </>
          ) : (
            <section className="takeoff-panel takeoff-empty-state">
              <Upload size={18} />
              <strong>{isLoading ? "Loading survey app" : "Create a survey chat to begin"}</strong>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
