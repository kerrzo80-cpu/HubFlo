"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";

import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";
import { roleHeaderName } from "@/lib/access";
import {
  TAKEOFF_SKILL_STEPS,
  TAKEOFF_TRADES,
  createDefaultTakeoffSkill,
  focusOptionsForTrade,
  methodLabel,
  type TakeoffAssemblyItem,
  type TakeoffSkillStep,
  type TakeoffSkillWorkflow,
  type TakeoffTradeId,
} from "@/lib/takeoff-skill";

import TakeoffOverlayReview from "./TakeoffOverlayReview";
import "./takeoff-skill.css";

type QuoteOption = { id: string; ref: string; customer: string; site: string };
type AiStatus = { connected: boolean; model?: string; source?: string };
type AuthState = "checking" | "signed-in" | "signed-out" | "pilot";

const requestHeaders: HeadersInit = {
  [roleHeaderName]: "Office",
};

async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (!headers.has(key) && typeof value === "string") headers.set(key, value);
  }
  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}

function stepIndex(step: TakeoffSkillStep) {
  return TAKEOFF_SKILL_STEPS.findIndex((row) => row.id === step);
}

export default function TakeoffSkillPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authName, setAuthName] = useState<string | null>(null);
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", customer: "", site: "", description: "", linkedQuoteId: "" });
  const [focusOptions, setFocusOptions] = useState<string[]>([]);
  const [invokePrompt, setInvokePrompt] = useState(
    "Perform a quantity takeoff on the plumbing drawings — WCs, basins, baths, showers, sinks, hot & cold pipe + fittings, waste / soil. Output Excel BOQ + marked-up PDF.",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  );
  const skill: TakeoffSkillWorkflow = selected?.skill ?? createDefaultTakeoffSkill();

  const refresh = useCallback(async () => {
    const [projectRes, quoteRes, aiRes] = await Promise.all([
      apiFetch("/api/takeoff-projects"),
      apiFetch("/api/quotes"),
      apiFetch("/api/takeoff-ai/status"),
    ]);
    if (projectRes.status === 401 || quoteRes.status === 401) {
      setAuthState("signed-out");
      setError("Sign in to Core first, then open Takeoff again.");
      return;
    }
    if (!projectRes.ok) {
      const body = await projectRes.json().catch(() => null) as { error?: string } | null;
      setError(body?.error || "Unable to load takeoff projects");
      return;
    }
    const list = (await projectRes.json()) as TakeoffProject[];
    setProjects(list.map((project) => ({
      ...project,
      skill: project.skill ?? createDefaultTakeoffSkill(),
    })));
    setSelectedId((current) => current ?? list[0]?.id ?? null);
    if (quoteRes.ok) {
      const quoteList = (await quoteRes.json()) as Array<Record<string, unknown>>;
      setQuotes(
        quoteList.map((quote) => ({
          id: String(quote.id || ""),
          ref: String(quote.ref || ""),
          customer: String(quote.customer || ""),
          site: String(quote.site || ""),
        })).filter((quote) => quote.id),
      );
    }
    if (aiRes.ok) {
      const body = await aiRes.json() as AiStatus;
      setAiStatus(body);
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
        const body = await response.json().catch(() => null) as {
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
        if (active) {
          setAuthState("signed-out");
          setError("Unable to reach NeXa auth. Refresh and try again.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    setFocusOptions(focusOptionsForTrade(skill.scope.trade));
  }, [selected?.id, skill.scope.trade]);

  function show(message: string) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 4500);
  }

  function upsertProject(project: TakeoffProject) {
    setProjects((current) => {
      const next = current.filter((row) => row.id !== project.id);
      return [{ ...project, skill: project.skill ?? createDefaultTakeoffSkill() }, ...next];
    });
    setSelectedId(project.id);
  }

  async function createProject() {
    setBusy("create");
    setError(null);
    try {
      const response = await apiFetch("/api/takeoff-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name || "Construction takeoff",
          customer: draft.customer,
          site: draft.site,
          description: draft.description || "AI quantity takeoff",
          linkedQuoteId: draft.linkedQuoteId || undefined,
          skill: createDefaultTakeoffSkill(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401) {
          setAuthState("signed-out");
          throw new Error("Sign in to Core first, then create a takeoff project.");
        }
        throw new Error(body?.error || "Unable to create takeoff project");
      }
      const project = await response.json() as TakeoffProject;
      upsertProject(project);
      setDraft({ name: "", customer: "", site: "", description: "", linkedQuoteId: "" });
      show(`Created ${project.reference}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  async function uploadDrawings(event: ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("kind", "Drawing");
      for (const file of files) {
        form.append("files", file);
      }
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/documents`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401) {
          setAuthState("signed-out");
          throw new Error("Sign in to Core first, then upload drawings.");
        }
        if (response.status === 403) {
          throw new Error("Your login cannot upload takeoff files. Use an Office / Manager account.");
        }
        throw new Error(body?.error || `Upload failed (${response.status})`);
      }
      const body = await response.json() as { project?: TakeoffProject; parseWarnings?: string[] };
      if (body.project) upsertProject(body.project);
      if (body.parseWarnings?.length) {
        show(`Uploaded ${files.length} file(s). ${body.parseWarnings[0]}`);
      } else {
        show(`Uploaded ${files.length} drawing file(s)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSkill(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return null;
    setBusy(action);
    setError(null);
    try {
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        project?: TakeoffProject;
        skill?: TakeoffSkillWorkflow;
        focusOptions?: string[];
      } | null;
      if (!response.ok) throw new Error(body?.error || `Skill action ${action} failed`);
      if (body?.project) upsertProject(body.project);
      if (body?.focusOptions) setFocusOptions(body.focusOptions);
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill action failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function approveAndContinue(assemblies: TakeoffAssemblyItem[]) {
    const saved = await runSkill("save-plan", { assemblies });
    if (!saved) return;
    await runSkill("approve-plan", { assemblies });
    show("Plan approved — ready to measure");
  }

  async function downloadExport(format: "xlsx" | "marked-pdf") {
    if (!selected) return;
    setBusy(`export-${format}`);
    setError(null);
    try {
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/skill/export?format=${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format === "xlsx"
        ? `${selected.reference}-takeoff-boq.xlsx`
        : `${selected.reference}-marked-takeoff.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      show(format === "xlsx" ? "Excel BOQ downloaded" : "Marked-up PDF downloaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function pushToQuote() {
    if (!selected?.linkedQuoteId) {
      setError("Link a Core quote on the project before pushing the BOQ.");
      return;
    }
    setBusy("push");
    try {
      // Apply BOQ materials first
      await runSkill("apply-boq");
      // Approve if needed
      if (selected.status === "Draft" || selected.status === "In review") {
        await apiFetch(`/api/takeoff-projects/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "Approved",
            review: {
              ...selected.review,
              approvedBy: "NeXa Takeoff",
              approvedAt: new Date().toISOString(),
            },
          }),
        });
      }
      const response = await apiFetch(`/api/takeoff-projects/${selected.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: selected.linkedQuoteId }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Push failed");
      show("BOQ pushed into Core quote");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setBusy(null);
    }
  }

  const currentStep = skill.step;
  const assemblies = skill.assemblies;

  return (
    <div className="takeoff-skill-shell">
      <header className="takeoff-skill-topbar">
        <div className="takeoff-skill-brand">
          <Link href="/" className="takeoff-skill-back">
            <ArrowLeft size={16} />
            Core
          </Link>
          <div>
            <strong>NeXa Takeoff</strong>
            <span>Blake quantity takeoff · primary / secondary · confidence scored</span>
          </div>
        </div>
        <div className="takeoff-skill-top-actions">
            <span className={`takeoff-skill-ai ${aiStatus?.connected ? "on" : "off"}`}>
              <Sparkles size={14} />
              {aiStatus?.connected
                ? `Blake is connected · ${aiStatus.model || "ready"}`
                : "Blake offline · text-tag mode"}
            </span>
            {authName ? <span className="takeoff-skill-ai on">{authName}</span> : null}
            <Link className="takeoff-skill-link" href="/takeoff/markup">
              Classic markup
            </Link>
        </div>
      </header>

      {(notice || error) ? (
        <div className={`takeoff-skill-banner ${error ? "error" : "ok"}`}>
          {error || notice}
        </div>
      ) : null}

      {authState === "checking" ? (
        <section className="takeoff-skill-auth">
          <h1>Opening Takeoff…</h1>
          <p>Checking your NeXa sign-in.</p>
        </section>
      ) : null}

      {authState === "signed-out" ? (
        <section className="takeoff-skill-auth">
          <h1>Sign in to use Takeoff</h1>
          <p>
            Takeoff uses your Core login. Sign in first, then you’ll be able to create projects,
            upload drawings, run the skill, and push a BOQ into a quote.
          </p>
          <p className="takeoff-skill-note">No special AI setup is required to start — vector PDF text-tag counts work without OpenAI.</p>
          <a className="takeoff-skill-primary" href="/login?next=/takeoff">
            Sign in to NeXa
          </a>
        </section>
      ) : null}

      {authState === "signed-in" || authState === "pilot" ? (
      <div className="takeoff-skill-layout">
        <aside className="takeoff-skill-sidebar">
          <div className="takeoff-skill-card">
            <header>
              <FolderOpen size={16} />
              <h2>Projects</h2>
            </header>
            <div className="takeoff-skill-project-list">
              {projects.length ? projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={project.id === selectedId ? "active" : ""}
                  onClick={() => setSelectedId(project.id)}
                >
                  <strong>{project.reference}</strong>
                  <span>{project.name}</span>
                  <small>{project.documents.length} drawings · {project.status}</small>
                </button>
              )) : (
                <p className="takeoff-skill-empty">No projects yet — create one below.</p>
              )}
            </div>
          </div>

          <div className="takeoff-skill-card">
            <header>
              <h2>New project folder</h2>
            </header>
            <label>
              Name
              <input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="Warehouse takeoff" />
            </label>
            <label>
              Customer
              <input value={draft.customer} onChange={(e) => setDraft((c) => ({ ...c, customer: e.target.value }))} />
            </label>
            <label>
              Site
              <input value={draft.site} onChange={(e) => setDraft((c) => ({ ...c, site: e.target.value }))} />
            </label>
            <label>
              Link Core quote
              <select value={draft.linkedQuoteId} onChange={(e) => setDraft((c) => ({ ...c, linkedQuoteId: e.target.value }))}>
                <option value="">Optional</option>
                {quotes.map((quote) => (
                  <option key={quote.id} value={quote.id}>{quote.ref} · {quote.customer}</option>
                ))}
              </select>
            </label>
            <button className="takeoff-skill-primary" type="button" disabled={busy === "create"} onClick={() => void createProject()}>
              {busy === "create" ? <Loader2 className="spin" size={16} /> : null}
              Create project
            </button>
          </div>
        </aside>

        <main className="takeoff-skill-main">
          {!selected ? (
            <section className="takeoff-skill-empty-state">
              <h1>Ready to take off</h1>
              <p>
                Create a project on the left, upload drawings, then run the skill prompt.
                You can use it now — text-tag counting works without OpenAI. AI is optional for harder sheets.
              </p>
            </section>
          ) : (
            <>
              <section className="takeoff-skill-hero">
                <div>
                  <p className="eyebrow">{selected.reference}</p>
                  <h1>{selected.name}</h1>
                  <p>{selected.customer} · {selected.site}</p>
                  <div className="takeoff-skill-hero-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.dwg"
                      onChange={(e) => void uploadDrawings(e)}
                      hidden
                    />
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={busy === "upload"}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {busy === "upload" ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
                      Upload drawings
                    </button>
                    <span className="takeoff-skill-note">
                      {selected.documents.length
                        ? `${selected.documents.length} file(s) in folder`
                        : "PDF preferred · selectable text works best"}
                    </span>
                  </div>
                </div>
                <form
                  className="takeoff-skill-invoke"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void (async () => {
                      const result = await runSkill("invoke", { prompt: invokePrompt });
                      if (result) show("Skill invoked — review the assembly plan, then approve to measure");
                    })();
                  }}
                >
                  <label>
                    <span>Skill invoke</span>
                    <textarea
                      value={invokePrompt}
                      onChange={(event) => setInvokePrompt(event.target.value)}
                      rows={2}
                      placeholder='e.g. "Perform a quantity takeoff on the architectural drawings — slab and floor area"'
                    />
                  </label>
                  <button className="takeoff-skill-primary" type="submit" disabled={busy === "invoke" || !selected.documents.length}>
                    {busy === "invoke" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                    Run takeoff skill
                  </button>
                </form>
                <div className="takeoff-skill-steps" aria-label="Takeoff skill steps">
                  {TAKEOFF_SKILL_STEPS.map((step, index) => {
                    const active = step.id === currentStep;
                    const done = stepIndex(currentStep) > index;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        className={`${active ? "active" : ""} ${done ? "done" : ""}`}
                        onClick={() => void runSkill("set-step", { step: step.id })}
                      >
                        <b>{index + 1}</b>
                        <span>
                          <strong>{step.label}</strong>
                          <small>{step.detail}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {currentStep === "drawings" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>1. Drawing folder</h2>
                      <p>Upload the construction set into this project. Vector PDFs with selectable text are preferred — image-only scans score lower confidence later.</p>
                    </div>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={busy === "upload"}
                      onClick={() => {
                        void runSkill("set-step", { step: "drawings" });
                        fileInputRef.current?.click();
                      }}
                    >
                      {busy === "upload" ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
                      Upload drawings
                    </button>
                  </header>
                  <div className="takeoff-skill-doc-grid">
                    {selected.documents.length ? selected.documents.map((document: TakeoffDocument) => (
                      <article key={document.id}>
                        <strong>{document.fileName}</strong>
                        <span>{document.kind}</span>
                        <small>{document.status}</small>
                      </article>
                    )) : (
                      <p className="takeoff-skill-empty">No drawings yet.</p>
                    )}
                  </div>
                  <footer>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={!selected.documents.length || busy === "analyse"}
                      onClick={async () => {
                        const result = await runSkill("analyse");
                        if (result) show("Drawing index ready — choose scope");
                      }}
                    >
                      {busy === "analyse" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                      Analyse drawings
                    </button>
                  </footer>
                </section>
              ) : null}

              {currentStep === "analyse" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>2. Drawing analysis</h2>
                      <p>{skill.drawingIndex.summary || "Build a structured map of sheets before measuring."}</p>
                    </div>
                    <button className="takeoff-skill-primary" type="button" disabled={busy === "analyse"} onClick={() => void runSkill("analyse")}>
                      {busy === "analyse" ? <Loader2 className="spin" size={16} /> : null}
                      Re-run analysis
                    </button>
                  </header>
                  <div className="takeoff-skill-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Sheet</th>
                          <th>Discipline</th>
                          <th>Reliability</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skill.drawingIndex.sheets.map((sheet) => (
                          <tr key={sheet.id}>
                            <td>
                              <strong>{sheet.title}</strong>
                              <small>{sheet.fileName}</small>
                            </td>
                            <td>{sheet.discipline}</td>
                            <td><span className={`conf ${sheet.reliability.toLowerCase()}`}>{sheet.reliability}</span></td>
                            <td>{sheet.notes.join("; ") || (sheet.hasSelectableText ? "Selectable text" : "Likely image PDF")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {skill.drawingIndex.objectHints.length ? (
                    <ul className="takeoff-skill-hints">
                      {skill.drawingIndex.objectHints.map((hint) => <li key={hint}>{hint}</li>)}
                    </ul>
                  ) : null}
                  <footer>
                    <button className="takeoff-skill-primary" type="button" onClick={() => void runSkill("set-step", { step: "scope" })}>
                      Continue to scope
                    </button>
                  </footer>
                </section>
              ) : null}

              {currentStep === "scope" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>3. Scope — what should we take off?</h2>
                      <p>Narrow the trade and focus so AI only measures reliable primaries. Secondary quantities are derived with ratios / formulas.</p>
                    </div>
                  </header>
                  <div className="takeoff-skill-trade-grid">
                    {TAKEOFF_TRADES.map((trade) => (
                      <button
                        key={trade.id}
                        type="button"
                        className={skill.scope.trade === trade.id ? "active" : ""}
                        onClick={async () => {
                          await runSkill("set-scope", { trade: trade.id as TakeoffTradeId, focusLabels: [] });
                          setFocusOptions(focusOptionsForTrade(trade.id));
                        }}
                      >
                        <strong>{trade.label}</strong>
                        <span>{trade.blurb}</span>
                      </button>
                    ))}
                  </div>
                  <div className="takeoff-skill-focus">
                    <h3>Focus quantities</h3>
                    <div className="takeoff-skill-chip-row">
                      {focusOptions.map((label) => {
                        const on = skill.scope.focusLabels.includes(label);
                        return (
                          <button
                            key={label}
                            type="button"
                            className={on ? "chip on" : "chip"}
                            onClick={() => {
                              const focusLabels = on
                                ? skill.scope.focusLabels.filter((row) => row !== label)
                                : [...skill.scope.focusLabels, label];
                              void runSkill("set-scope", { focusLabels, trade: skill.scope.trade });
                            }}
                          >
                            {on ? <Check size={12} /> : null}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <footer>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={busy === "build-plan"}
                      onClick={async () => {
                        const result = await runSkill("build-plan", {
                          trade: skill.scope.trade,
                          focusLabels: skill.scope.focusLabels,
                        });
                        if (result) show("Assembly plan ready for review");
                      }}
                    >
                      {busy === "build-plan" ? <Loader2 className="spin" size={16} /> : null}
                      Build primary / secondary plan
                    </button>
                  </footer>
                </section>
              ) : null}

              {currentStep === "plan" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>4. Assembly plan</h2>
                      <p>{skill.planSummary || "Primaries are counted on the drawing. Secondaries (taps, traps, elbows, couplings) are derived from those counts — not counted separately as duplicates."}</p>
                    </div>
                  </header>
                  <div className="takeoff-skill-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Include</th>
                          <th>Kind</th>
                          <th>Code</th>
                          <th>Description</th>
                          <th>Method</th>
                          <th>Expected confidence</th>
                          <th>Derivation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assemblies.map((row) => (
                          <tr key={row.id} className={row.kind}>
                            <td>
                              <input
                                type="checkbox"
                                checked={row.included}
                                onChange={(event) => {
                                  const next = assemblies.map((item) =>
                                    item.id === row.id ? { ...item, included: event.target.checked } : item,
                                  );
                                  void runSkill("save-plan", { assemblies: next });
                                }}
                              />
                            </td>
                            <td><span className={`kind ${row.kind}`}>{row.kind}</span></td>
                            <td>{row.code}</td>
                            <td>{row.description}</td>
                            <td>{methodLabel(row.method)}</td>
                            <td><span className={`conf ${row.expectedConfidence.toLowerCase()}`}>{row.expectedConfidence}</span></td>
                            <td>{row.derivation || row.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer>
                    <button className="takeoff-skill-secondary" type="button" onClick={() => void runSkill("set-step", { step: "scope" })}>
                      Back to scope
                    </button>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={!assemblies.some((row) => row.included) || busy === "approve-plan"}
                      onClick={() => void approveAndContinue(assemblies)}
                    >
                      {busy === "approve-plan" ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                      Approve plan
                    </button>
                  </footer>
                </section>
              ) : null}

              {currentStep === "measure" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>5. Measure</h2>
                      <p>Measure only approved primaries using the most reliable method (text tags / schedules / dimensions). Secondaries are derived by formula.</p>
                    </div>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={!skill.planApproved || busy === "measure"}
                      onClick={async () => {
                        const result = await runSkill("measure");
                        if (result) {
                          await runSkill("sanity");
                          show("Measurement complete — review confidence & sanity");
                        }
                      }}
                    >
                      {busy === "measure" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                      Run measurement
                    </button>
                  </header>
                  {!skill.planApproved ? <p className="takeoff-skill-empty">Approve the plan first.</p> : null}
                  <p className="takeoff-skill-note">{skill.measureSummary}</p>
                </section>
              ) : null}

              {currentStep === "review" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>6. Review · overlay, confidence & sanity</h2>
                      <p>{skill.sanitySummary || skill.measureSummary || "Approve counted tags on the drawing, then audit confidence before the BOQ."}</p>
                    </div>
                    <button className="takeoff-skill-secondary" type="button" disabled={busy === "sanity"} onClick={() => void runSkill("sanity")}>
                      Re-run sanity checks
                    </button>
                  </header>

                  <div className="takeoff-skill-callout">
                    <strong>How to read this schedule</strong>
                    <p>
                      <span className="kind primary">Primary</span> rows are counted from the drawing (WC, basin, bath…).
                      <span className="kind secondary">Secondary</span> rows are <em>not</em> “18 of everything” —
                      they are fittings derived from each primary (e.g. 1 tap set + 1 waste per basin, elbows/tees/couplings from pipe metres).
                    </p>
                  </div>

                  <TakeoffOverlayReview
                    projectId={selected.id}
                    measured={skill.measured}
                    busy={busy === "approve-overlay"}
                    onApply={async (measured) => {
                      const result = await runSkill("approve-overlay", { measured });
                      if (result) show("Overlay counts applied — secondaries re-derived");
                    }}
                  />

                  <div className="takeoff-skill-table-wrap" style={{ marginTop: 16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Kind</th>
                          <th>Code</th>
                          <th>Description</th>
                          <th>Qty</th>
                          <th>Method</th>
                          <th>Confidence</th>
                          <th>Sanity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skill.measured.map((row) => (
                          <tr key={row.id}>
                            <td><span className={`kind ${row.kind}`}>{row.kind}</span></td>
                            <td>{row.code}</td>
                            <td>
                              {row.description}
                              {row.derivation ? <small>{row.derivation}</small> : null}
                            </td>
                            <td><strong>{row.quantity}</strong> {row.unit}</td>
                            <td>{methodLabel(row.method)}</td>
                            <td><span className={`conf ${row.confidence.toLowerCase()}`}>{row.confidence}</span></td>
                            <td className={row.sanityCheck && !row.sanityCheck.ok ? "bad" : "ok"}>
                              {row.sanityCheck?.detail || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer>
                    <button className="takeoff-skill-primary" type="button" onClick={() => void runSkill("set-step", { step: "boq" })}>
                      Continue to BOQ
                    </button>
                  </footer>
                </section>
              ) : null}

              {currentStep === "boq" ? (
                <section className="takeoff-skill-panel">
                  <header>
                    <div>
                      <h2>7. Bill of quantities</h2>
                      <p>Export the measured schedule into materials and push into the linked Core quote.</p>
                    </div>
                    <FileSpreadsheet size={20} />
                  </header>
                  <div className="takeoff-skill-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th>Item</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skill.measured.map((row) => (
                          <tr key={row.id}>
                            <td>{row.kind === "primary" ? "Primary" : "Secondary"}</td>
                            <td>{row.code} · {row.description}</td>
                            <td>{row.quantity}</td>
                            <td>{row.unit}</td>
                            <td><span className={`conf ${row.confidence.toLowerCase()}`}>{row.confidence}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer>
                    <label className="takeoff-skill-inline-link">
                      Linked quote
                      <select
                        value={selected.linkedQuoteId || ""}
                        onChange={(event) => {
                          const linkedQuoteId = event.target.value || undefined;
                          void apiFetch(`/api/takeoff-projects/${selected.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ linkedQuoteId }),
                          }).then(async (response) => {
                            if (!response.ok) return;
                            const project = await response.json() as TakeoffProject;
                            upsertProject(project);
                          });
                        }}
                      >
                        <option value="">Select quote</option>
                        {quotes.map((quote) => (
                          <option key={quote.id} value={quote.id}>{quote.ref} · {quote.customer}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="takeoff-skill-secondary"
                      type="button"
                      onClick={() => void downloadExport("xlsx")}
                      disabled={!skill.measured.length || busy === "export-xlsx"}
                    >
                      {busy === "export-xlsx" ? <Loader2 className="spin" size={16} /> : null}
                      Download Excel BOQ
                    </button>
                    <button
                      className="takeoff-skill-secondary"
                      type="button"
                      onClick={() => void downloadExport("marked-pdf")}
                      disabled={!skill.measured.length || busy === "export-marked-pdf"}
                    >
                      {busy === "export-marked-pdf" ? <Loader2 className="spin" size={16} /> : null}
                      Download marked PDF
                    </button>
                    <button
                      className="takeoff-skill-secondary"
                      type="button"
                      disabled={busy === "apply-boq"}
                      onClick={async () => {
                        const result = await runSkill("apply-boq");
                        if (result) show("BOQ applied to takeoff materials");
                      }}
                    >
                      Apply BOQ to project
                    </button>
                    <button
                      className="takeoff-skill-primary"
                      type="button"
                      disabled={busy === "push" || !selected.linkedQuoteId}
                      onClick={() => void pushToQuote()}
                    >
                      {busy === "push" ? <Loader2 className="spin" size={16} /> : null}
                      Push to Core quote
                    </button>
                  </footer>
                  {!selected.linkedQuoteId ? (
                    <p className="takeoff-skill-note">Select a Core quote above before pushing.</p>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>
      ) : null}
    </div>
  );
}
