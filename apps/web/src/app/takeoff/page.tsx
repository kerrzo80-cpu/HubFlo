"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
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

import "./takeoff-skill.css";

type QuoteOption = { id: string; ref: string; customer: string; site: string };
type AiStatus = { connected: boolean; model?: string; source?: string };

const requestHeaders: HeadersInit = {
  [roleHeaderName]: "Office",
};

function stepIndex(step: TakeoffSkillStep) {
  return TAKEOFF_SKILL_STEPS.findIndex((row) => row.id === step);
}

export default function TakeoffSkillPage() {
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", customer: "", site: "", description: "", linkedQuoteId: "" });
  const [focusOptions, setFocusOptions] = useState<string[]>([]);

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  );
  const skill: TakeoffSkillWorkflow = selected?.skill ?? createDefaultTakeoffSkill();

  const refresh = useCallback(async () => {
    const headers = requestHeaders;
    const [projectRes, quoteRes, aiRes] = await Promise.all([
      fetch("/api/takeoff-projects", { headers }),
      fetch("/api/quotes", { headers }),
      fetch("/api/takeoff-ai/status", { headers }),
    ]);
    if (projectRes.ok) {
      const list = (await projectRes.json()) as TakeoffProject[];
      setProjects(list.map((project) => ({
        ...project,
        skill: project.skill ?? createDefaultTakeoffSkill(),
      })));
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    }
    if (quoteRes.ok) {
      const list = (await quoteRes.json()) as Array<Record<string, unknown>>;
      setQuotes(
        list.map((quote) => ({
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
    void refresh();
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
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name || "Construction takeoff",
          customer: draft.customer,
          site: draft.site,
          description: draft.description || "AI quantity takeoff",
          linkedQuoteId: draft.linkedQuoteId || undefined,
          skill: createDefaultTakeoffSkill(),
        }),
      });
      if (!response.ok) throw new Error("Unable to create takeoff project");
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
      for (const file of files) {
        const form = new FormData();
        form.append("kind", "Drawing");
        form.append("file", file);
        const response = await fetch(`/api/takeoff-projects/${selected.id}/documents`, {
          method: "POST",
          headers: requestHeaders,
          body: form,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || `Upload failed for ${file.name}`);
        }
        const body = await response.json() as { project?: TakeoffProject };
        if (body.project) upsertProject(body.project);
      }
      show(`Uploaded ${files.length} drawing file(s)`);
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
      const response = await fetch(`/api/takeoff-projects/${selected.id}/skill`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
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
        await fetch(`/api/takeoff-projects/${selected.id}`, {
          method: "PATCH",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
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
      const response = await fetch(`/api/takeoff-projects/${selected.id}/push`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
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
            <span>AI quantity takeoff skill · primary / secondary · confidence scored</span>
          </div>
        </div>
        <div className="takeoff-skill-top-actions">
          <span className={`takeoff-skill-ai ${aiStatus?.connected ? "on" : "off"}`}>
            <Sparkles size={14} />
            {aiStatus?.connected ? `AI connected · ${aiStatus.model || "model"}` : "AI offline · heuristic mode"}
          </span>
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
              <h1>Construction quantity takeoff</h1>
              <p>
                Same architecture as a packaged AI takeoff skill: index the drawings, choose the trade,
                plan primary vs secondary quantities, measure with confidence scores, sanity-check, then export a BOQ.
              </p>
            </section>
          ) : (
            <>
              <section className="takeoff-skill-hero">
                <div>
                  <p className="eyebrow">{selected.reference}</p>
                  <h1>{selected.name}</h1>
                  <p>{selected.customer} · {selected.site}</p>
                </div>
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
                    <label className="takeoff-skill-primary file">
                      <Upload size={16} />
                      Upload drawings
                      <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.dwg" onChange={(e) => void uploadDrawings(e)} hidden />
                    </label>
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
                      <p>{skill.planSummary || "Review what will be measured (primary) vs derived (secondary). Toggle anything you do not want."}</p>
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
                      <h2>6. Review · confidence & sanity</h2>
                      <p>{skill.sanitySummary || skill.measureSummary || "Audit low-confidence and failed sanity rows before the BOQ."}</p>
                    </div>
                    <button className="takeoff-skill-secondary" type="button" disabled={busy === "sanity"} onClick={() => void runSkill("sanity")}>
                      Re-run sanity checks
                    </button>
                  </header>
                  <div className="takeoff-skill-table-wrap">
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
                          void fetch(`/api/takeoff-projects/${selected.id}`, {
                            method: "PATCH",
                            headers: { ...requestHeaders, "Content-Type": "application/json" },
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
    </div>
  );
}
