"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Plus, RefreshCw, Shield, Tags, Warehouse, Boxes } from "lucide-react";

type RequestHeaders = HeadersInit;

type SetupConfig = {
  statuses: Array<{ id: string; bucket: string; label: string }>;
  lostReasons: Array<{ id: string; label: string }>;
  taxCodes: Array<{ id: string; code: string; name: string; rate: number; xeroTaxType?: string }>;
  emailTemplates: Array<{ id: string; key: string; name: string; subject: string; body: string }>;
  assetTypes: Array<{ id: string; name: string; serviceIntervalMonths: number; certificateRequired: boolean }>;
  securityGroups: Array<{ id: string; name: string; role: string; permissions: Record<string, boolean> }>;
};

type StockSnapshot = {
  locations: Array<{ id: string; name: string; kind: string; engineerName?: string }>;
};

export function SetupStockLocationsPanel({
  requestHeaders,
  onNotice,
}: {
  requestHeaders: HeadersInit;
  onNotice: (message: string) => void;
}) {
  const [locations, setLocations] = useState<StockSnapshot["locations"]>([]);
  const [draft, setDraft] = useState({ id: "", name: "", kind: "Van", engineerName: "" });
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/stock", { headers: requestHeaders });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load stock locations");
      setLocations(body.locations || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load locations");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft.name.trim()) {
      onNotice("Enter a location name.");
      return;
    }
    const response = await fetch("/api/stock", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert-location",
        location: {
          id: draft.id || undefined,
          name: draft.name,
          kind: draft.kind,
          engineerName: draft.engineerName || undefined,
        },
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Unable to save location");
      return;
    }
    setLocations(body.locations || []);
    setDraft({ id: "", name: "", kind: "Van", engineerName: "" });
    onNotice(draft.id ? "Stock location updated." : "Stock location saved.");
  }

  async function removeLocation(location: StockSnapshot["locations"][number]) {
    if (!window.confirm(`Remove location “${location.name}”?`)) return;
    const response = await fetch("/api/stock", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive-location", locationId: location.id }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Unable to remove location");
      return;
    }
    setLocations(body.locations || []);
    if (draft.id === location.id) setDraft({ id: "", name: "", kind: "Van", engineerName: "" });
    onNotice(`${location.name} removed.`);
  }

  return (
    <section className="ops-module-panel">
      <header className="ops-module-header">
        <div>
          <span className="permission-heading">Materials</span>
          <h2><Warehouse size={18} /> Stock locations</h2>
          <p>Warehouse and named vans used for receipts, transfers and van stock.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}
      <div className="ops-form-grid">
        <label>Name<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Murray van" /></label>
        <label>
          Kind
          <select value={draft.kind} onChange={(e) => setDraft((c) => ({ ...c, kind: e.target.value }))}>
            <option>Warehouse</option>
            <option>Van</option>
          </select>
        </label>
        <label>Engineer (vans)<input value={draft.engineerName} onChange={(e) => setDraft((c) => ({ ...c, engineerName: e.target.value }))} /></label>
      </div>
      <div className="setup-template-actions">
        <button className="primary-button" type="button" onClick={() => void save()}>
          <Plus size={15} /> {draft.id ? "Update location" : "Add location"}
        </button>
        {draft.id ? (
          <button className="secondary-button" type="button" onClick={() => setDraft({ id: "", name: "", kind: "Van", engineerName: "" })}>
            Cancel edit
          </button>
        ) : null}
      </div>
      <div className="ops-table">
        <div className="ops-table-head"><span>Name</span><span>Kind</span><span>Engineer</span><span>Actions</span></div>
        {locations.map((location) => (
          <div className="ops-table-row" key={location.id}>
            <strong>{location.name}</strong>
            <span>{location.kind}</span>
            <span>{location.engineerName || "—"}</span>
            <div className="ops-row-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setDraft({
                    id: location.id,
                    name: location.name,
                    kind: location.kind,
                    engineerName: location.engineerName || "",
                  })
                }
              >
                Edit
              </button>
              <button className="secondary-button" type="button" onClick={() => void removeLocation(location)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SetupConfigPanel({
  requestHeaders,
  onNotice,
  mode,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  mode: "statuses" | "assets" | "tax" | "email-templates" | "security";
}) {
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const editingTemplateId = draft.id || "";

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/setup-config", { headers: requestHeaders });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load setup config");
      setConfig(body as SetupConfig);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load setup");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function upsert(list: string, item: Record<string, unknown>) {
    const response = await fetch("/api/setup-config", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert", list, item }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Unable to save");
      return;
    }
    setConfig(body as SetupConfig);
    setDraft({});
    onNotice("Setup saved.");
  }

  if (mode === "statuses") {
    return (
      <section className="ops-module-panel">
        <header className="ops-module-header">
          <div>
            <span className="permission-heading">Workflow</span>
            <h2><Tags size={18} /> Statuses &amp; lost reasons</h2>
            <p>Lead, quote, job and invoice stage labels plus quote/lead lost reasons.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
        </header>
        {error ? <p className="ops-module-error">{error}</p> : null}
        <div className="ops-form-grid">
          <label>
            Bucket
            <select value={draft.bucket || "lead"} onChange={(e) => setDraft((c) => ({ ...c, bucket: e.target.value }))}>
              <option value="lead">Lead</option>
              <option value="quote">Quote</option>
              <option value="job">Job</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>
          <label>Status label<input value={draft.label || ""} onChange={(e) => setDraft((c) => ({ ...c, label: e.target.value }))} /></label>
        </div>
        <button className="primary-button" type="button" onClick={() => void upsert("statuses", { bucket: draft.bucket || "lead", label: draft.label || "" })}>
          <Plus size={15} /> Add status
        </button>
        <div className="ops-table">
          <div className="ops-table-head"><span>Bucket</span><span>Status</span><span /><span /><span /></div>
          {(config?.statuses || []).map((row) => (
            <div className="ops-table-row" key={row.id}><span>{row.bucket}</span><strong>{row.label}</strong><span /><span /><span /></div>
          ))}
        </div>
        <h3>Lost reasons</h3>
        <div className="ops-form-grid">
          <label className="full">Reason<input value={draft.lost || ""} onChange={(e) => setDraft((c) => ({ ...c, lost: e.target.value }))} /></label>
        </div>
        <button className="primary-button" type="button" onClick={() => void upsert("lostReasons", { label: draft.lost || "" })}>
          <Plus size={15} /> Add lost reason
        </button>
        <ul className="ops-simple-list">
          {(config?.lostReasons || []).map((row) => <li key={row.id}><strong>{row.label}</strong></li>)}
        </ul>
      </section>
    );
  }

  if (mode === "assets") {
    return (
      <section className="ops-module-panel">
        <header className="ops-module-header">
          <div>
            <span className="permission-heading">Assets</span>
            <h2>Asset types</h2>
            <p>Gas / Oil / Pipework and service interval defaults for the site asset register.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
        </header>
        {error ? <p className="ops-module-error">{error}</p> : null}
        <div className="ops-form-grid">
          <label>Type name<input value={draft.name || ""} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>Service months<input value={draft.months || "12"} onChange={(e) => setDraft((c) => ({ ...c, months: e.target.value }))} /></label>
          <label>
            Certificate required
            <select value={draft.cert || "yes"} onChange={(e) => setDraft((c) => ({ ...c, cert: e.target.value }))}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            void upsert("assetTypes", {
              name: draft.name || "",
              serviceIntervalMonths: Number(draft.months) || 12,
              certificateRequired: (draft.cert || "yes") === "yes",
            })
          }
        >
          <Plus size={15} /> Add asset type
        </button>
        <div className="ops-table">
          <div className="ops-table-head"><span>Type</span><span>Interval</span><span>Certificate</span><span /><span /></div>
          {(config?.assetTypes || []).map((row) => (
            <div className="ops-table-row" key={row.id}>
              <strong>{row.name}</strong>
              <span>{row.serviceIntervalMonths} months</span>
              <span>{row.certificateRequired ? "Required" : "Optional"}</span>
              <span /><span />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "tax") {
    return (
      <section className="ops-module-panel">
        <header className="ops-module-header">
          <div>
            <span className="permission-heading">Finance</span>
            <h2>Tax codes</h2>
            <p>VAT / tax treatments mapped toward Xero tax types.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
        </header>
        {error ? <p className="ops-module-error">{error}</p> : null}
        <div className="ops-form-grid">
          <label>Code<input value={draft.code || ""} onChange={(e) => setDraft((c) => ({ ...c, code: e.target.value }))} /></label>
          <label>Name<input value={draft.name || ""} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>Rate %<input value={draft.rate || "20"} onChange={(e) => setDraft((c) => ({ ...c, rate: e.target.value }))} /></label>
          <label>Xero tax type<input value={draft.xero || ""} onChange={(e) => setDraft((c) => ({ ...c, xero: e.target.value }))} /></label>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            void upsert("taxCodes", {
              code: draft.code || "",
              name: draft.name || "",
              rate: Number(draft.rate) || 0,
              xeroTaxType: draft.xero || undefined,
            })
          }
        >
          <Plus size={15} /> Add tax code
        </button>
        <div className="ops-table">
          <div className="ops-table-head"><span>Code</span><span>Name</span><span>Rate</span><span>Xero</span><span /></div>
          {(config?.taxCodes || []).map((row) => (
            <div className="ops-table-row" key={row.id}>
              <strong>{row.code}</strong>
              <span>{row.name}</span>
              <span>{row.rate}%</span>
              <span>{row.xeroTaxType || "—"}</span>
              <span />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "email-templates") {
    return (
      <section className="ops-module-panel">
        <header className="ops-module-header">
          <div>
            <span className="permission-heading">Communications</span>
            <h2>Email templates</h2>
            <p>Default subjects and bodies for quote, invoice, overdue chase, PO, follow-up and job confirmation. Invoice emails include a unique {{portalLink}} per invoice for SumUp pay-online. Click Edit on any row to change premade templates.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
        </header>
        {error ? <p className="ops-module-error">{error}</p> : null}
        <div className="ops-table">
          <div className="ops-table-head"><span>Template</span><span>Subject</span><span>Key</span><span>Actions</span><span /></div>
          {(config?.emailTemplates || []).map((row) => (
            <div className="ops-table-row" key={row.id}>
              <strong>{row.name}</strong>
              <span>{row.subject}</span>
              <span>{row.key}</span>
              <div className="ops-row-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: row.id,
                      name: row.name,
                      key: row.key,
                      subject: row.subject,
                      body: row.body,
                    })
                  }
                >
                  Edit
                </button>
              </div>
              <span />
            </div>
          ))}
        </div>
        <div className="ops-form-grid">
          <label>Name<input value={draft.name || ""} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>
            Key
            <select value={draft.key || "follow-up"} onChange={(e) => setDraft((c) => ({ ...c, key: e.target.value }))} disabled={Boolean(editingTemplateId)}>
              <option value="quote">quote</option>
              <option value="invoice">invoice</option>
              <option value="invoice-overdue">invoice-overdue</option>
              <option value="statement">statement</option>
              <option value="remittance">remittance</option>
              <option value="po">po</option>
              <option value="follow-up">follow-up</option>
              <option value="job-confirmation">job-confirmation</option>
              <option value="job-eta">job-eta</option>
              <option value="job-complete">job-complete</option>
            </select>
          </label>
          <label className="full">Subject<input value={draft.subject || ""} onChange={(e) => setDraft((c) => ({ ...c, subject: e.target.value }))} /></label>
          <label className="full">Body<textarea value={draft.body || ""} onChange={(e) => setDraft((c) => ({ ...c, body: e.target.value }))} rows={5} /></label>
        </div>
        <div className="setup-template-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              void upsert("emailTemplates", {
                ...(editingTemplateId ? { id: editingTemplateId } : {}),
                name: draft.name || "Custom template",
                key: draft.key || "follow-up",
                subject: draft.subject || "",
                body: draft.body || "",
              })
            }
          >
            <Plus size={15} /> {editingTemplateId ? "Update template" : "Add template"}
          </button>
          {editingTemplateId ? (
            <button className="secondary-button" type="button" onClick={() => setDraft({})}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="ops-module-panel">
      <header className="ops-module-header">
        <div>
          <span className="permission-heading">Security</span>
          <h2><Shield size={18} /> Security groups</h2>
          <p>Role permission templates you can copy onto employee cards.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}
      <div className="ops-table">
        <div className="ops-table-head"><span>Group</span><span>Role</span><span>Permissions on</span><span /><span /></div>
        {(config?.securityGroups || []).map((row) => (
          <div className="ops-table-row" key={row.id}>
            <strong>{row.name}</strong>
            <span>{row.role}</span>
            <span>{Object.values(row.permissions).filter(Boolean).length}</span>
            <span /><span />
          </div>
        ))}
      </div>
    </section>
  );
}

type PrebuildKit = {
  id: string;
  name: string;
  category: string;
  notes?: string;
  lines: Array<{
    id: string;
    kind: "Material" | "Labour";
    description: string;
    quantity: number;
    unitCost: number;
    unitSell?: number;
    unit?: string;
  }>;
};

function normalizeLoadedKits(raw: unknown): PrebuildKit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((kit, index) => ({
      id: String(kit.id || `kit-${index + 1}`),
      name: String(kit.name || "Kit"),
      category: String(kit.category || "General"),
      notes: typeof kit.notes === "string" ? kit.notes : undefined,
      lines: Array.isArray(kit.lines) ? kit.lines : [],
    }));
}

async function readJsonBody(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Try the upload again.");
  }
}

export function SetupPrebuildsPanel({
  requestHeaders,
  onNotice,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
}) {
  const [kits, setKits] = useState<PrebuildKit[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [draft, setDraft] = useState({
    name: "",
    category: "Bathroom",
    notes: "",
    materialName: "",
    materialQty: "1",
    materialCost: "0",
    labourName: "",
    labourHours: "1",
    labourCost: "40",
  });

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/prebuilds", { headers: requestHeaders });
      const body = await readJsonBody(response);
      if (!response.ok) throw new Error(body.error || "Unable to load kits");
      setKits(normalizeLoadedKits(body.kits));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load kits");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveKit() {
    if (!draft.name.trim()) {
      onNotice("Enter a kit name.");
      return;
    }
    const lines = [];
    if (draft.materialName.trim()) {
      lines.push({
        kind: "Material" as const,
        description: draft.materialName.trim(),
        quantity: Number(draft.materialQty) || 1,
        unitCost: Number(draft.materialCost) || 0,
      });
    }
    if (draft.labourName.trim()) {
      lines.push({
        kind: "Labour" as const,
        description: draft.labourName.trim(),
        quantity: Number(draft.labourHours) || 1,
        unitCost: Number(draft.labourCost) || 0,
      });
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/prebuilds", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          name: draft.name.trim(),
          category: draft.category.trim() || "General",
          notes: draft.notes.trim(),
          lines,
        }),
      });
      const body = await readJsonBody(response);
      if (!response.ok) throw new Error(body.error || "Unable to save kit");
      setKits(normalizeLoadedKits(body.kits));
      setDraft((current) => ({
        ...current,
        name: "",
        notes: "",
        materialName: "",
        labourName: "",
      }));
      onNotice("Kit saved. Apply it from quote/job cost centres.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save kit");
    } finally {
      setBusy(false);
    }
  }

  async function archiveKit(id: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/prebuilds", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", id }),
      });
      const body = await readJsonBody(response);
      if (!response.ok) throw new Error(body.error || "Unable to archive");
      setKits(normalizeLoadedKits(body.kits));
      onNotice("Kit archived.");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive");
    } finally {
      setBusy(false);
    }
  }

  async function importKitsFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      onNotice("Use an Excel .xlsx kits file (the Pre builds template).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("action", "import-xlsx");
      form.set("mode", importMode);
      form.set("file", file);
      const response = await fetch("/api/prebuilds", {
        method: "POST",
        headers: requestHeaders,
        body: form,
      });
      const body = await readJsonBody(response);
      if (!response.ok) throw new Error(body.error || "Unable to import kits");
      setKits(normalizeLoadedKits(body.kits));
      const optionalNote = body.skippedOptional ? ` · skipped ${body.skippedOptional} optional/blank row(s)` : "";
      const rowErrors = Array.isArray(body.rowErrors) ? body.rowErrors as Array<{ row?: number; message?: string }> : [];
      if (rowErrors.length) {
        setError(rowErrors.slice(0, 8).map((row) => row.message || `Row ${row.row} skipped`).join(" "));
      }
      onNotice(
        `Imported ${body.imported || 0} kit(s)${
          body.created ? ` · ${body.created} new` : ""
        }${body.updated ? ` · ${body.updated} updated` : ""}${optionalNote}. Apply from quote/job cost centres — the kit explodes into catalogue lines, not one sell item.`,
      );
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import kits");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ops-module-panel">
      <header className="ops-module-header">
        <div>
          <span className="permission-heading">Catalogue</span>
          <h2><Boxes size={18} /> Kits</h2>
          <p>
            Reusable assemblies: name the kit (e.g. Bath), list catalogue parts + labour hours.
            Applying it on a job cost centre explodes every child line — it does not post as one “Bath” sell item.
            Optional blank rows (TMV?) are skipped instead of crashing.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}

      <div className="ops-form-grid" style={{ marginBottom: 12 }}>
        <label>
          Import mode
          <select
            value={importMode}
            onChange={(event) => setImportMode(event.target.value === "replace" ? "replace" : "merge")}
          >
            <option value="merge">Merge (update matching kit names)</option>
            <option value="replace">Replace (archive current kits first)</option>
          </select>
        </label>
        <label className="full">
          Import kits .xlsx
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            type="file"
            disabled={busy}
            onChange={(event) => void importKitsFile(event)}
          />
          <small>Column A = kit name, B = item, D = qty. Labour rows are detected automatically.</small>
        </label>
      </div>

      <div className="ops-table">
        <div className="ops-table-head"><span>Kit</span><span>Category</span><span>Lines</span><span /><span /></div>
        {kits.map((kit) => (
          <div className="ops-table-row" key={kit.id}>
            <strong>{kit.name}</strong>
            <span>{kit.category}</span>
            <span>{Array.isArray(kit.lines) ? kit.lines.length : 0}</span>
            <span />
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void archiveKit(kit.id)}>
              Archive
            </button>
          </div>
        ))}
        {!kits.length ? <p className="muted">No kits yet — import your Excel template or add one below.</p> : null}
      </div>
      <div className="ops-form-grid">
        <label>Name<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Close coupled toilet" /></label>
        <label>Category<input value={draft.category} onChange={(e) => setDraft((c) => ({ ...c, category: e.target.value }))} /></label>
        <label className="full">Notes<input value={draft.notes} onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))} /></label>
        <label>Material line<input value={draft.materialName} onChange={(e) => setDraft((c) => ({ ...c, materialName: e.target.value }))} placeholder="Optional starter material" /></label>
        <label>Qty<input value={draft.materialQty} onChange={(e) => setDraft((c) => ({ ...c, materialQty: e.target.value }))} /></label>
        <label>Material cost<input value={draft.materialCost} onChange={(e) => setDraft((c) => ({ ...c, materialCost: e.target.value }))} /></label>
        <label>Labour line<input value={draft.labourName} onChange={(e) => setDraft((c) => ({ ...c, labourName: e.target.value }))} placeholder="Optional starter labour" /></label>
        <label>Hours<input value={draft.labourHours} onChange={(e) => setDraft((c) => ({ ...c, labourHours: e.target.value }))} /></label>
        <label>Labour £/hr<input value={draft.labourCost} onChange={(e) => setDraft((c) => ({ ...c, labourCost: e.target.value }))} /></label>
      </div>
      <button className="primary-button" type="button" disabled={busy} onClick={() => void saveKit()}>
        <Plus size={15} /> Add kit
      </button>
    </section>
  );
}
