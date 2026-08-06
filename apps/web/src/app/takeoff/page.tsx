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
  createDefaultStudioState,
  nextClassificationColour,
  studioId,
  studioQuantitiesToMaterialAllowances,
  summariseStudioQuantities,
  type StudioClassKind,
  type StudioClassification,
  type StudioState,
} from "@/lib/takeoff-studio";
import { extractTakeoffPdfInBrowser } from "@/lib/takeoff-pdf-browser";

import StudioCanvas from "./studio/StudioCanvas";
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
  const [newClassKind, setNewClassKind] = useState<StudioClassKind>("count");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [blakeStep, setBlakeStep] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const historyRef = useRef<StudioState[]>([]);
  const futureRef = useRef<StudioState[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const studio: StudioState = selected?.studio ?? createDefaultStudioState();
  const drawingDocs = (selected?.documents || []).filter(
    (doc) => doc.kind === "Drawing" || doc.kind === "Marked-up drawing" || (doc.mimeType || "").includes("pdf"),
  );
  const activeDoc =
    drawingDocs.find((doc) => doc.id === studio.activeDocumentId) || drawingDocs[0] || null;
  const quantities = summariseStudioQuantities(studio);
  const linkedQuote = quotes.find((q) => q.id === selected?.linkedQuoteId);
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
  }, [selectedId]);

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
          description: "NeXa Takeoff Studio",
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
    const cls: StudioClassification = {
      id: studioId("cls"),
      kind: newClassKind,
      name,
      colour: nextClassificationColour(studio.classifications),
      unit: newClassKind === "area" ? "m2" : newClassKind === "linear" ? "m" : "nr",
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
      "Reading PDF text tags…",
      "Placing count pins on the sheet…",
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

      setBlakeStep("Blake is analysing your drawings…");
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/blake-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientExtracts }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        pinCount?: number;
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
      setBlakeStep(payload.pinCount ? `Done — ${payload.pinCount} pin(s) placed.` : "Done — no tags found.");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if ((payload.pinCount || 0) > 0) {
        show(message, 12000);
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

  async function pushToCore() {
    if (!selected) return;
    if (!selected.linkedQuoteId) {
      setError("Link a Core quote before pushing.");
      return;
    }
    setBusy("push");
    try {
      const materials = studioQuantitiesToMaterialAllowances(studio, selected.id);
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
        body: JSON.stringify({ quoteId: selected.linkedQuoteId, actor: authName || "Office" }),
      });
      if (!push.ok) {
        const body = (await push.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Push failed");
      }
      const result = (await push.json()) as { project: TakeoffProject; quote: { id: string; ref: string } };
      upsert(result.project);
      show(`Pushed into Core quote ${result.quote.ref}`);
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
  const flowStep: "upload" | "scale" | "blake" | "mark" | "push" = !drawingDocs.length
    ? "upload"
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
        Opening NeXa Takeoff…
      </div>
    );
  }

  if (authState === "signed-out") {
    return (
      <div className="nexa-studio-gate">
        <h1>Sign in to NeXa Takeoff</h1>
        <p>Use your Core login. This studio is linked to Errol Watson Group quotes and jobs.</p>
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
            <strong>NeXa Takeoff</strong>
            <span>Blake · {brand.tradingName || "Errol Watson Group"}</span>
          </div>
        </div>
        <nav className="nexa-studio-flow" aria-label="Takeoff steps">
          {(
            [
              ["upload", "Upload"],
              ["scale", "Scale"],
              ["blake", "Blake"],
              ["mark", "Mark"],
              ["push", "Push"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={flowStep === id ? "on" : undefined}
              disabled={id === "blake" && busy === "ai"}
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

      <div className="nexa-studio-body">
        <aside className="nexa-studio-rail">
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
                  <h2>Classifications</h2>
                </header>
                <div className="nexa-studio-class-list">
                  {studio.classifications.map((cls) => {
                    const qty = quantities.find((row) => row.classificationId === cls.id);
                    return (
                      <div
                        key={cls.id}
                        className={`nexa-studio-class-row${cls.id === studio.activeClassificationId ? " on" : ""}`}
                      >
                        <button
                          type="button"
                          className="nexa-studio-class-pick"
                          onClick={() => void persistStudio({
                            ...studio,
                            activeClassificationId: cls.id,
                            tool: cls.kind,
                          })}
                        >
                          <i style={{ background: cls.colour }} />
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
                    <option value="count">Count</option>
                    <option value="linear">Linear</option>
                    <option value="area">Area</option>
                  </select>
                  <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="Name" />
                  <button type="button" className="ghost" onClick={addClassification}>Add</button>
                </div>
                <p className="muted nexa-studio-hint">
                  Pick a classification, then draw. Green <strong>Ask Blake</strong> auto-counts PDF text tags onto the sheet.
                </p>
              </section>

              <section className="nexa-studio-core-link">
                <header>
                  <h2>Core link</h2>
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
                <button
                  type="button"
                  className="nexa-studio-primary"
                  disabled={busy === "push" || !selected.linkedQuoteId}
                  onClick={() => void pushToCore()}
                >
                  {busy === "push" ? <Loader2 className="spin" size={14} /> : null}
                  Push BOQ to Core
                </button>
              </section>
            </>
          ) : null}
        </aside>

        <main className="nexa-studio-main">
          {selected ? (
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
