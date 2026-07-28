"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Shield, Tags, Warehouse } from "lucide-react";

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
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
}) {
  const [locations, setLocations] = useState<StockSnapshot["locations"]>([]);
  const [draft, setDraft] = useState({ name: "", kind: "Van", engineerName: "" });
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
    setDraft({ name: "", kind: "Van", engineerName: "" });
    onNotice("Stock location saved.");
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
      <button className="primary-button" type="button" onClick={() => void save()}><Plus size={15} /> Add location</button>
      <div className="ops-table">
        <div className="ops-table-head"><span>Name</span><span>Kind</span><span>Engineer</span><span /><span /></div>
        {locations.map((location) => (
          <div className="ops-table-row" key={location.id}>
            <strong>{location.name}</strong>
            <span>{location.kind}</span>
            <span>{location.engineerName || "—"}</span>
            <span />
            <span />
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
            <p>Default subjects and bodies for quote, invoice, PO, follow-up and job confirmation.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
        </header>
        {error ? <p className="ops-module-error">{error}</p> : null}
        <div className="ops-table">
          <div className="ops-table-head"><span>Template</span><span>Subject</span><span>Key</span><span /><span /></div>
          {(config?.emailTemplates || []).map((row) => (
            <div className="ops-table-row" key={row.id}>
              <strong>{row.name}</strong>
              <span>{row.subject}</span>
              <span>{row.key}</span>
              <span />
              <span />
            </div>
          ))}
        </div>
        <div className="ops-form-grid">
          <label>Name<input value={draft.name || ""} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>
            Key
            <select value={draft.key || "follow-up"} onChange={(e) => setDraft((c) => ({ ...c, key: e.target.value }))}>
              <option value="quote">quote</option>
              <option value="invoice">invoice</option>
              <option value="po">po</option>
              <option value="follow-up">follow-up</option>
              <option value="job-confirmation">job-confirmation</option>
            </select>
          </label>
          <label className="full">Subject<input value={draft.subject || ""} onChange={(e) => setDraft((c) => ({ ...c, subject: e.target.value }))} /></label>
          <label className="full">Body<textarea value={draft.body || ""} onChange={(e) => setDraft((c) => ({ ...c, body: e.target.value }))} rows={5} /></label>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            void upsert("emailTemplates", {
              name: draft.name || "Custom template",
              key: draft.key || "follow-up",
              subject: draft.subject || "",
              body: draft.body || "",
            })
          }
        >
          <Plus size={15} /> Add template
        </button>
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
