"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";

import {
  TENDER_AREAS,
  TENDER_CATEGORIES,
  TENDER_STATUSES,
  alertForDeadline,
  boqProgress,
  computeBoqTotal,
  daysLeftForDeadline,
  type Tender,
  type TenderBoqLine,
  type TenderStatus,
} from "@/lib/tenders-types";

type RequestHeaders = HeadersInit;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return gbp.format(value);
}

type TabKey = "overview" | "boq" | "documents" | "submit";

export function TendersPanel({
  requestHeaders,
  onNotice,
  businessName = "Errol Watson Group Ltd",
  actorName = "NeXa user",
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  businessName?: string;
  actorName?: string;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | TenderStatus>("all");
  const [tab, setTab] = useState<TabKey>("overview");
  const [boqImportText, setBoqImportText] = useState("");
  const [qualificationDraft, setQualificationDraft] = useState("");

  const selected = useMemo(
    () => tenders.find((tender) => tender.id === selectedId) ?? null,
    [selectedId, tenders],
  );

  async function loadTenders() {
    setLoading(true);
    try {
      const response = await fetch("/api/tenders", { headers: requestHeaders });
      if (!response.ok) throw new Error("Unable to load tenders");
      const payload = (await response.json()) as { tenders?: Tender[] };
      setTenders(Array.isArray(payload.tenders) ? payload.tenders : []);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to load tenders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function postAction(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch("/api/tenders", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; tenders?: Tender[]; tender?: Tender };
      if (!response.ok) throw new Error(payload.error || "Request failed");
      if (Array.isArray(payload.tenders)) setTenders(payload.tenders);
      if (payload.tender?.id) setSelectedId(payload.tender.id);
      return payload;
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    if (statusFilter === "all") return tenders;
    return tenders.filter((tender) => tender.status === statusFilter);
  }, [statusFilter, tenders]);

  const pipelineValue = useMemo(
    () =>
      tenders
        .filter((tender) => !["Lost", "Won"].includes(tender.status))
        .reduce((sum, tender) => sum + (tender.tenderSum || tender.bidValue || 0), 0),
    [tenders],
  );

  async function createTender() {
    try {
      await postAction({
        action: "upsert",
        tender: {
          name: "New tender opportunity",
          client: "Client TBC",
          category: "Plumbing",
          area: "Aberdeen",
          status: "Not Started",
          owner: actorName,
          bidValue: 0,
          tenderSum: 0,
        },
      });
      setTab("overview");
      onNotice("Tender created.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to create tender");
    }
  }

  async function saveSelected(patch: Partial<Tender>) {
    if (!selected) return;
    try {
      await postAction({ action: "update", id: selected.id, patch });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to save tender");
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!window.confirm(`Delete tender "${selected.name}"?`)) return;
    try {
      await postAction({ action: "delete", id: selected.id });
      setSelectedId(null);
      onNotice("Tender deleted.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to delete tender");
    }
  }

  async function importBoq() {
    if (!selected || !boqImportText.trim()) return;
    try {
      await postAction({
        action: "import-boq",
        id: selected.id,
        boqText: boqImportText,
      });
      setBoqImportText("");
      setTab("boq");
      onNotice("BoQ imported — price rates on their item refs.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to import BoQ");
    }
  }

  async function onBoqFile(file: File | null) {
    if (!file || !selected) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      onNotice("Excel .xlsx — save/export the BoQ as CSV (or copy-paste) then import. Native Excel import is next.");
      return;
    }
    const text = await file.text();
    setBoqImportText(text);
  }

  async function patchBoqLine(lineId: string, linePatch: Partial<TenderBoqLine>) {
    if (!selected) return;
    try {
      await postAction({
        action: "update-boq-line",
        id: selected.id,
        lineId,
        linePatch,
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to update BoQ line");
    }
  }

  async function downloadFormOfTender() {
    if (!selected) return;
    const params = new URLSearchParams({
      businessName,
      signatoryName: actorName,
      signatoryTitle: "Commercial Manager",
    });
    const response = await fetch(`/api/tenders/${selected.id}/form-of-tender?${params}`, {
      headers: requestHeaders,
    });
    if (!response.ok) {
      onNotice("Unable to generate Form of Tender.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Form_of_Tender_${selected.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotice("Form of Tender downloaded.");
  }

  async function submitTender() {
    if (!selected) return;
    try {
      await postAction({
        action: "submit",
        id: selected.id,
        tenderSum: selected.tenderSum ?? computeBoqTotal(selected.boqLines),
      });
      await downloadFormOfTender();
      onNotice("Tender marked Sent — attach the FoT PDF + priced BoQ for return.");
      setTab("submit");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to submit tender");
    }
  }

  if (selected) {
    const progress = boqProgress(selected.boqLines);
    const boqTotal = computeBoqTotal(selected.boqLines);
    const daysLeft = daysLeftForDeadline(selected.submissionDeadline);
    const alert = alertForDeadline(selected.submissionDeadline);

    return (
      <section className="tenders-workspace" aria-label="Tender record">
        <div className="tenders-toolbar">
          <button type="button" className="secondary-button" onClick={() => setSelectedId(null)}>
            <ArrowLeft size={15} />
            Tracker
          </button>
          <div>
            <span className="permission-heading">Tender</span>
            <h2>{selected.name}</h2>
            <p>
              {selected.client} · {selected.category} · {selected.area}
              {selected.submissionDeadline ? ` · due ${selected.submissionDeadline}` : ""}
              {daysLeft !== null ? ` · ${daysLeft}d` : ""}
              {alert ? ` · ${alert}` : ""}
            </p>
          </div>
          <div className="tenders-toolbar-actions">
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void downloadFormOfTender()}>
              <Download size={15} />
              Form of Tender
            </button>
            <button type="button" className="primary-button" disabled={saving} onClick={() => void submitTender()}>
              <Send size={15} />
              Mark submitted
            </button>
            <button type="button" className="secondary-button" onClick={() => void deleteSelected()}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="tenders-tabs" role="tablist">
          {(
            [
              ["overview", "Overview"],
              ["boq", "BoQ pricing"],
              ["documents", "Documents"],
              ["submit", "Submit pack"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={tab === key ? "active" : ""}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="tenders-detail-grid">
            <label>
              Opportunity name
              <input
                value={selected.name}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, name: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ name: event.target.value })}
              />
            </label>
            <label>
              Client
              <input
                value={selected.client}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, client: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ client: event.target.value })}
              />
            </label>
            <label>
              Category
              <select
                value={selected.category}
                onChange={(event) => void saveSelected({ category: event.target.value })}
              >
                {TENDER_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Area
              <select value={selected.area} onChange={(event) => void saveSelected({ area: event.target.value })}>
                {TENDER_AREAS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={selected.status}
                onChange={(event) => void saveSelected({ status: event.target.value as TenderStatus })}
              >
                {TENDER_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <input
                value={selected.owner}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, owner: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ owner: event.target.value })}
              />
            </label>
            <label>
              Submission deadline
              <input
                type="date"
                value={selected.submissionDeadline || ""}
                onChange={(event) => void saveSelected({ submissionDeadline: event.target.value || undefined })}
              />
            </label>
            <label>
              Tender ID
              <input
                value={selected.externalId || ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, externalId: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ externalId: event.target.value || undefined })}
              />
            </label>
            <label>
              Bid value (BoQ)
              <input value={money(boqTotal)} readOnly />
            </label>
            <label>
              Tender sum (FoT)
              <input
                type="number"
                step="0.01"
                value={selected.tenderSum ?? ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id ? { ...row, tenderSum: Number(event.target.value) || 0 } : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ tenderSum: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              Win probability %
              <input
                type="number"
                min={0}
                max={100}
                value={selected.winProbability ?? ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id
                        ? { ...row, winProbability: Number(event.target.value) || undefined }
                        : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ winProbability: Number(event.target.value) || undefined })}
              />
            </label>
            <label className="tenders-span-2">
              Materials / supplier notes
              <input
                value={selected.materialsNote || ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id ? { ...row, materialsNote: event.target.value } : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ materialsNote: event.target.value })}
                placeholder="e.g. awaiting Plumbase prices"
              />
            </label>
            <div className="tenders-span-2 tenders-qualifications">
              <div className="tenders-inline-head">
                <strong>Qualifications</strong>
                <span>{progress.priced} priced · {progress.unpriced} unpriced · {progress.excluded} excluded</span>
              </div>
              <ul>
                {selected.qualifications.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>
                    <span>{item}</span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void saveSelected({
                          qualifications: selected.qualifications.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="tenders-inline-add">
                <input
                  value={qualificationDraft}
                  onChange={(event) => setQualificationDraft(event.target.value)}
                  placeholder="Add qualification / caveat"
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    if (!qualificationDraft.trim()) return;
                    void saveSelected({
                      qualifications: [...selected.qualifications, qualificationDraft.trim()],
                    });
                    setQualificationDraft("");
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "boq" ? (
          <div className="tenders-boq">
            <div className="tenders-boq-summary">
              <div>
                <span className="permission-heading">Client BoQ</span>
                <h3>{selected.boqTitle || "Import their spreadsheet structure"}</h3>
                <p>
                  Price on their refs (e.g. 8/1/A). Leave unpriced items blank or mark excluded — same return format they issued.
                </p>
              </div>
              <div className="tenders-metric-row">
                <article>
                  <span>BoQ total</span>
                  <strong>{money(boqTotal)}</strong>
                </article>
                <article>
                  <span>FoT sum</span>
                  <strong>{money(selected.tenderSum ?? boqTotal)}</strong>
                </article>
                <article>
                  <span>Progress</span>
                  <strong>
                    {progress.priced}/{progress.measured}
                  </strong>
                </article>
              </div>
            </div>

            <div className="tenders-boq-import">
              <label>
                Import CSV / paste (columns: Ref, Description, Quantity, Units, Rate, Value)
                <textarea
                  rows={5}
                  value={boqImportText}
                  onChange={(event) => setBoqImportText(event.target.value)}
                  placeholder={`Plumbing e-Enquiry [...]\nRef,Description,Quantity,Units,Rate,Value\n8/1/A,Doc M Toilet Pack,1,nr,1836,1836`}
                />
              </label>
              <div className="tenders-inline-add">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv"
                  onChange={(event) => void onBoqFile(event.target.files?.[0] ?? null)}
                />
                <button type="button" className="primary-button" disabled={saving || !boqImportText.trim()} onClick={() => void importBoq()}>
                  <FileSpreadsheet size={15} />
                  Import BoQ
                </button>
              </div>
            </div>

            <div className="tenders-boq-table-wrap">
              <table className="tenders-boq-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Value</th>
                    <th>Note</th>
                    <th>Excl.</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.boqLines.length ? (
                    selected.boqLines.map((line) =>
                      line.kind === "header" ? (
                        <tr key={line.id} className="tenders-boq-header-row">
                          <td colSpan={8}>{line.description}</td>
                        </tr>
                      ) : (
                        <tr key={line.id} className={line.excluded ? "excluded" : ""}>
                          <td>{line.ref || "—"}</td>
                          <td>{line.description}</td>
                          <td>{line.quantity ?? ""}</td>
                          <td>{line.unit || ""}</td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={line.rate ?? ""}
                              disabled={Boolean(line.excluded)}
                              onBlur={(event) => {
                                const rate = event.target.value === "" ? null : Number(event.target.value);
                                void patchBoqLine(line.id, { rate, excluded: false });
                              }}
                            />
                          </td>
                          <td>{money(line.value)}</td>
                          <td>
                            <input
                              defaultValue={line.note || ""}
                              onBlur={(event) => void patchBoqLine(line.id, { note: event.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(line.excluded)}
                              onChange={(event) =>
                                void patchBoqLine(line.id, {
                                  excluded: event.target.checked,
                                  rate: event.target.checked ? null : line.rate,
                                  value: event.target.checked ? null : line.value,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ),
                    )
                  ) : (
                    <tr>
                      <td colSpan={8}>No BoQ lines yet — import their issued bill as CSV/paste.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "documents" ? (
          <div className="tenders-docs">
            <p>
              Store issued pack, priced BoQ, drawings and supplier quotes here. Upload into this tender folder on the file
              server next; for now documents are tracked as a checklist against the pack you already keep.
            </p>
            <ul className="tenders-doc-list">
              {(
                [
                  ["issued-boq", "Issued BoQ"],
                  ["priced-boq", "Priced BoQ return"],
                  ["form-of-tender", "Form of Tender"],
                  ["drawing", "Drawings"],
                  ["specification", "Specification"],
                  ["supplier-quote", "Supplier quotes"],
                ] as const
              ).map(([kind, label]) => {
                const matched = selected.documents.filter((doc) => doc.kind === kind);
                return (
                  <li key={kind}>
                    <strong>{label}</strong>
                    <span>{matched.length ? matched.map((doc) => doc.name).join(", ") : "Not attached yet"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="tenders-hint">
              Harlaw pattern: Architect + Mechanical drawings, Appendix specs, blank BoQ, priced Plumbing.xlsx, FoT PDF,
              supplier quotation.
            </p>
          </div>
        ) : null}

        {tab === "submit" ? (
          <div className="tenders-submit">
            <article>
              <span className="permission-heading">Return pack</span>
              <h3>What goes back to the main contractor</h3>
              <ol>
                <li>Priced BoQ on <em>their</em> spreadsheet structure (export/CSV you imported and priced).</li>
                <li>Form of Tender PDF (NeXa generated from this record).</li>
                <li>Optional covering note with qualifications already on the FoT appendix.</li>
              </ol>
              <div className="tenders-metric-row">
                <article>
                  <span>Status</span>
                  <strong>{selected.status}</strong>
                </article>
                <article>
                  <span>Submitted</span>
                  <strong>{selected.submittedAt ? selected.submittedAt.slice(0, 10) : "Not yet"}</strong>
                </article>
                <article>
                  <span>FoT sum</span>
                  <strong>{money(selected.tenderSum ?? boqTotal)}</strong>
                </article>
              </div>
              <div className="tenders-toolbar-actions" style={{ marginTop: 16 }}>
                <button type="button" className="secondary-button" onClick={() => void downloadFormOfTender()}>
                  <Download size={15} />
                  Download Form of Tender
                </button>
                <button type="button" className="primary-button" disabled={saving} onClick={() => void submitTender()}>
                  <Send size={15} />
                  Mark Sent + download FoT
                </button>
              </div>
            </article>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="tenders-workspace" aria-label="Tender tracker">
      <div className="tenders-toolbar">
        <div>
          <span className="permission-heading">Commercial</span>
          <h2>Tender tracker</h2>
          <p>Deadlines, owners and bid values — open a row to price their BoQ and generate the Form of Tender.</p>
        </div>
        <div className="tenders-toolbar-actions">
          <button type="button" className="secondary-button" onClick={() => void loadTenders()} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" className="primary-button" onClick={() => void createTender()} disabled={saving}>
            <Plus size={15} />
            New tender
          </button>
        </div>
      </div>

      <div className="tenders-metric-row">
        <article>
          <span>Live tenders</span>
          <strong>{tenders.filter((t) => !["Won", "Lost"].includes(t.status)).length}</strong>
        </article>
        <article>
          <span>Pipeline value</span>
          <strong>{money(pipelineValue)}</strong>
        </article>
        <article>
          <span>Due this week</span>
          <strong>
            {tenders.filter((t) => alertForDeadline(t.submissionDeadline) === "Due this week").length}
          </strong>
        </article>
      </div>

      <div className="tenders-filters">
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | TenderStatus)}
          >
            <option value="all">All</option>
            {TENDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tenders-table-wrap">
        {loading ? (
          <p className="tenders-hint">Loading tenders…</p>
        ) : filtered.length === 0 ? (
          <p className="tenders-hint">
            <ClipboardList size={16} style={{ marginRight: 6 }} />
            No tenders yet — create one or import from your tracker next.
          </p>
        ) : (
          <table className="tenders-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Client</th>
                <th>Category</th>
                <th>Area</th>
                <th>Deadline</th>
                <th>Days</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Bid value</th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tender) => {
                const days = daysLeftForDeadline(tender.submissionDeadline);
                const alert = alertForDeadline(tender.submissionDeadline);
                return (
                  <tr key={tender.id} onClick={() => { setSelectedId(tender.id); setTab("overview"); }}>
                    <td>
                      <strong>{tender.name}</strong>
                      {tender.externalId ? <small> #{tender.externalId}</small> : null}
                      {tender.materialsNote ? <div className="tenders-note">{tender.materialsNote}</div> : null}
                    </td>
                    <td>{tender.client}</td>
                    <td>{tender.category}</td>
                    <td>{tender.area}</td>
                    <td>{tender.submissionDeadline || "—"}</td>
                    <td>{days === null ? "—" : days}</td>
                    <td>
                      <span className={`tenders-status ${tender.status.replace(/\s+/g, "-").toLowerCase()}`}>
                        {tender.status}
                      </span>
                    </td>
                    <td>{tender.owner || "—"}</td>
                    <td>{money(tender.tenderSum || tender.bidValue)}</td>
                    <td>
                      {alert ? (
                        <span className={`tenders-alert ${alert.replace(/\s+/g, "-").toLowerCase()}`}>
                          {alert === "Overdue" || alert === "Due this week" ? <AlertTriangle size={12} /> : null}
                          {alert}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
