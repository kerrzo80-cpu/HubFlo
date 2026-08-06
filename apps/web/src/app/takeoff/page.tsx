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
  const saveTimer = useRef<number | null>(null);

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

  function show(message: string) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  async function persistStudio(nextStudio: StudioState, extras: Partial<TakeoffProject> = {}) {
    if (!selected) return;
    const optimistic: TakeoffProject = {
      ...selected,
      ...extras,
      studio: nextStudio,
      updatedAt: new Date().toISOString(),
    };
    upsert(optimistic);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: nextStudio, ...extras }),
      });
      if (!response.ok) {
        setError("Could not save studio takeoff");
        return;
      }
      const project = (await response.json()) as TakeoffProject;
      upsert({ ...project, studio: project.studio ?? nextStudio });
    }, 450);
  }

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

  async function runAiAssist() {
    if (!selected) return;
    setBusy("ai");
    try {
      // Use existing skill analyse + measure pipeline when available; keep studio primary UI.
      const analyse = await apiFetch(`/api/takeoff-projects/${selected.id}/skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyse" }),
      });
      if (analyse.ok) {
        show("NeXa scanned the drawings — review classifications, or keep measuring manually.");
      } else {
        show("AI scan needs drawings + OpenAI on the server. Manual Count / Area / Linear still work.");
      }
      await refresh();
    } catch {
      setError("AI assist failed — keep taking off manually.");
    } finally {
      setBusy(null);
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
            <span>AI takeoff studio · {brand.tradingName || "Errol Watson Group"}</span>
          </div>
        </div>
        <nav className="nexa-studio-modes" aria-label="Takeoff modes">
          <Link href="/takeoff" className="on">Studio</Link>
          <Link href="/takeoff/routes">Pipe routes</Link>
          <Link href="/takeoff/skill">Skill board</Link>
          <Link href="/">Core</Link>
        </nav>
        <div className="nexa-studio-top-actions">
          {authName ? <span className="pill">{authName}</span> : null}
          <button type="button" className="nexa-studio-ai" disabled={busy === "ai" || !selected} onClick={() => void runAiAssist()}>
            {busy === "ai" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            Run NeXa AI
          </button>
        </div>
      </header>

      {(notice || error) ? (
        <div className={`nexa-studio-banner ${error ? "error" : "ok"}`}>{error || notice}</div>
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
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void uploadDrawings(e)} />
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
                  {studio.classifications.map((cls) => (
                    <button
                      key={cls.id}
                      type="button"
                      className={cls.id === studio.activeClassificationId ? "on" : undefined}
                      onClick={() => void persistStudio({
                        ...studio,
                        activeClassificationId: cls.id,
                        tool: cls.kind,
                      })}
                    >
                      <i style={{ background: cls.colour }} />
                      <span>
                        <strong>{cls.name}</strong>
                        <small>{cls.kind}</small>
                      </span>
                    </button>
                  ))}
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
              </section>

              <section>
                <header>
                  <h2>Quantities</h2>
                </header>
                <div className="nexa-studio-qty">
                  {quantities.map((row) => (
                    <div key={row.classificationId}>
                      <i style={{ background: row.colour }} />
                      <span>{row.name}</span>
                      <strong>
                        {row.quantity} {row.unit}
                      </strong>
                    </div>
                  ))}
                </div>
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
            />
          ) : (
            <div className="nexa-studio-empty-main">
              <h1>Start a NeXa takeoff</h1>
              <p>Create a project, upload drawings, set scale, then Count / Linear / Area — or run NeXa AI.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
