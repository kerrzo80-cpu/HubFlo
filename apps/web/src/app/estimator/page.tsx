"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSearch,
  Loader2,
  PackageSearch,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type { EstimateLabourLine, EstimateMaterialLine, EstimateRecord, SurveyRecord } from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

type EstimateTab = "summary" | "materials" | "labour" | "rfq" | "simpro" | "source";
type EditableLine =
  | { type: "Material"; line: EstimateMaterialLine }
  | { type: "Labour"; line: EstimateLabourLine };

const tabs: Array<{ key: EstimateTab; label: string; icon: typeof ClipboardList }> = [
  { key: "summary", label: "Summary", icon: ClipboardList },
  { key: "materials", label: "Materials", icon: PackageSearch },
  { key: "labour", label: "Labour", icon: Users },
  { key: "rfq", label: "Supplier RFQ", icon: Send },
  { key: "simpro", label: "simPRO mapping", icon: Settings2 },
  { key: "source", label: "Source trace", icon: FileSearch },
];

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function numberValue(value: string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateTotals(estimate: EstimateRecord) {
  const materialCost = estimate.materialLines.reduce((sum, line) => sum + (line.unitCost || 0) * line.quantity, 0);
  const materialSell = estimate.materialLines.reduce((sum, line) => sum + (line.unitCost || 0) * line.quantity * (1 + line.markupPercent / 100), 0);
  const labourCost = estimate.labourLines.reduce((sum, line) => sum + line.costRate * line.hours, 0);
  const labourSell = estimate.labourLines.reduce((sum, line) => sum + line.sellRate * line.hours, 0);
  const cost = materialCost + labourCost;
  const sell = materialSell + labourSell;
  return {
    materialCost,
    materialSell,
    labourCost,
    labourSell,
    cost,
    sell,
    profit: sell - cost,
    margin: sell ? ((sell - cost) / sell) * 100 : 0,
    unpriced: estimate.materialLines.filter((line) => line.unitCost === undefined).length,
  };
}

export default function EstimatorPage() {
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [survey, setSurvey] = useState<SurveyRecord | null>(null);
  const [activeTab, setActiveTab] = useState<EstimateTab>("summary");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<EditableLine | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [reusableCorrection, setReusableCorrection] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingValues, setPricingValues] = useState<Record<string, string>>({});
  const [pricingReason, setPricingReason] = useState("");

  async function openEstimate(id: string) {
    setLoading(true);
    setError("");
    try {
      const estimateResponse = await fetch(`/api/estimates/${encodeURIComponent(id)}`, { headers: requestHeaders });
      if (!estimateResponse.ok) throw new Error("Unable to open this estimate.");
      const loaded = await estimateResponse.json() as EstimateRecord;
      setEstimate(loaded);
      const surveyResponse = await fetch(`/api/surveys/${encodeURIComponent(loaded.surveyId)}`, { headers: requestHeaders });
      setSurvey(surveyResponse.ok ? await surveyResponse.json() as SurveyRecord : null);
      window.history.replaceState(null, "", `/estimator?estimate=${encodeURIComponent(loaded.id)}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load estimate.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/estimates", { headers: requestHeaders });
        if (!response.ok) throw new Error("Unable to load estimates.");
        const loaded = await response.json() as EstimateRecord[];
        setEstimates(loaded);
        const requested = new URLSearchParams(window.location.search).get("estimate");
        const first = loaded.find((item) => item.id === requested || item.reference === requested) || loaded[0];
        if (first) await openEstimate(first.id);
        else setLoading(false);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load estimates.");
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => estimate ? estimateTotals(estimate) : null, [estimate]);
  const rfqLines = useMemo(() => estimate?.materialLines.filter((line) => line.status === "Supplier RFQ" || line.unitCost === undefined) || [], [estimate]);
  const groupedMaterials = useMemo(() => {
    const groups = new Map<string, EstimateMaterialLine[]>();
    estimate?.materialLines.forEach((line) => groups.set(line.costCentre, [...(groups.get(line.costCentre) || []), line]));
    return [...groups.entries()];
  }, [estimate]);
  const groupedLabour = useMemo(() => {
    const groups = new Map<string, EstimateLabourLine[]>();
    estimate?.labourLines.forEach((line) => groups.set(line.trade, [...(groups.get(line.trade) || []), line]));
    return [...groups.entries()];
  }, [estimate]);

  function startEdit(line: EditableLine) {
    setEditing(line);
    setCorrectionReason("");
    setReusableCorrection(false);
    setEditValues(line.type === "Material" ? {
      quantity: String(line.line.quantity),
      unitCost: line.line.unitCost === undefined ? "" : String(line.line.unitCost),
      markupPercent: String(line.line.markupPercent),
      supplier: line.line.supplier || "",
      notes: line.line.notes,
    } : {
      hours: String(line.line.hours),
      costRate: String(line.line.costRate),
      sellRate: String(line.line.sellRate),
      notes: line.line.notes,
    });
  }

  function openPricing() {
    if (!estimate) return;
    setPricingValues({
      name: estimate.pricingProfile.name,
      labourSellRate: String(estimate.pricingProfile.labourSellRate),
      materialMarkupPercent: String(estimate.pricingProfile.materialMarkupPercent),
      plantMarkupPercent: String(estimate.pricingProfile.plantMarkupPercent),
      vatPercent: String(estimate.pricingProfile.vatPercent),
    });
    setPricingReason("");
    setPricingOpen(true);
  }

  async function savePricing() {
    if (!estimate || !pricingReason.trim()) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimate.id)}/pricing`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: estimate.version,
          patch: {
            name: pricingValues.name,
            labourSellRate: numberValue(pricingValues.labourSellRate),
            materialMarkupPercent: numberValue(pricingValues.materialMarkupPercent),
            plantMarkupPercent: numberValue(pricingValues.plantMarkupPercent),
            vatPercent: numberValue(pricingValues.vatPercent),
          },
          correctionReason: pricingReason,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save this pricing profile.");
      setEstimate(body as EstimateRecord);
      setEstimates((current) => current.map((item) => item.id === body.id ? body as EstimateRecord : item));
      setPricingOpen(false);
      setNotice("Pricing profile updated and recorded in estimate history.");
    } catch (pricingError) {
      setError(pricingError instanceof Error ? pricingError.message : "Unable to save pricing profile.");
    } finally {
      setWorking(false);
    }
  }

  async function saveCorrection() {
    if (!estimate || !editing || !correctionReason.trim()) return;
    setWorking(true);
    setError("");
    try {
      const patch = editing.type === "Material" ? {
        quantity: numberValue(editValues.quantity),
        unitCost: (editValues.unitCost || "").trim() ? numberValue(editValues.unitCost) : undefined,
        markupPercent: numberValue(editValues.markupPercent),
        supplier: editValues.supplier,
        notes: editValues.notes,
      } : {
        hours: numberValue(editValues.hours),
        costRate: numberValue(editValues.costRate),
        sellRate: numberValue(editValues.sellRate),
        notes: editValues.notes,
      };
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimate.id)}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: estimate.version,
          lineType: editing.type,
          lineId: editing.line.id,
          patch,
          correctionReason,
          reusable: reusableCorrection,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save this correction.");
      setEstimate(body as EstimateRecord);
      setEstimates((current) => current.map((item) => item.id === body.id ? body as EstimateRecord : item));
      setEditing(null);
      setNotice("Correction saved and recorded in the estimate history.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save correction.");
    } finally {
      setWorking(false);
    }
  }

  async function regenerate() {
    if (!estimate) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimate.id)}/regenerate`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: estimate.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to regenerate the estimate.");
      setEstimate(body as EstimateRecord);
      setEstimates((current) => current.map((item) => item.id === body.id ? body as EstimateRecord : item));
      setNotice(`Regenerated from ${survey?.reference || "the source survey"}.`);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to regenerate estimate.");
    } finally {
      setWorking(false);
    }
  }

  async function pushToQuote() {
    if (!estimate) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimate.id)}/push-to-quote`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: estimate.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to push this estimate into the quote.");
      setEstimate(body.estimate as EstimateRecord);
      setEstimates((current) => current.map((item) => item.id === body.estimate.id ? body.estimate as EstimateRecord : item));
      setNotice(`${body.quote.ref} now contains ${body.costCentres.length} itemised cost centre(s) from this estimate.`);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "Unable to push estimate into quote.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="estimator-app">
      <header className="estimator-header">
        <div>
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa Estimator" />
          <span><strong>NeXa Estimator</strong><small>Survey to priced work package</small></span>
        </div>
        <nav><a href="/"><ArrowLeft size={17} /> Core</a><a href="/survey/guided"><ClipboardList size={17} /> Surveys</a></nav>
      </header>

      <div className="estimator-shell">
        <aside className="estimator-directory">
          <div><span>Estimate packs</span><b>{estimates.length}</b></div>
          {estimates.map((item) => (
            <button type="button" key={item.id} className={estimate?.id === item.id ? "active" : ""} onClick={() => void openEstimate(item.id)}>
              <span><strong>{item.reference}</strong><b>{item.status}</b></span>
              <small>{item.scopeOfWorks[0] || "Survey estimate"}</small>
              <em>Survey v{item.sourceSurveyVersion} · {new Date(item.updatedAt).toLocaleDateString("en-GB")}</em>
            </button>
          ))}
          {!estimates.length && !loading ? <p>Complete a guided survey and send it to Estimator to create the first pack.</p> : null}
        </aside>

        <section className="estimator-workspace">
          {loading ? <div className="estimator-loading"><Loader2 className="spin" size={24} /> Loading estimate</div> : null}
          {!loading && !estimate ? <div className="estimator-loading"><Calculator size={28} /><strong>No estimate selected</strong><a href="/survey/guided">Open guided surveys</a></div> : null}
          {estimate && totals ? (
            <>
              <div className="estimator-titlebar">
                <div><span className="guided-eyebrow">{estimate.reference} · {estimate.pricingProfile.name}</span><h1>{survey?.customerName || "Survey estimate"}</h1><p>{survey?.siteAddress || estimate.scopeOfWorks[0]}</p></div>
                <div><b data-status={estimate.status}>{estimate.coreQuoteRef ? `${estimate.status} · ${estimate.coreQuoteRef}` : estimate.status}</b><button type="button" className="secondary" onClick={() => void regenerate()} disabled={working}><RefreshCw className={working ? "spin" : ""} size={16} /> Regenerate</button><button type="button" title={totals.unpriced ? "Price the supplier RFQ items before pushing this estimate" : undefined} onClick={() => void pushToQuote()} disabled={working || Boolean(totals.unpriced) || !estimate.scopeOfWorks.length}><Send size={16} /> {estimate.coreQuoteRef ? `Update ${estimate.coreQuoteRef}` : "Push to quote"}</button></div>
              </div>
              {error ? <p className="estimator-message error"><AlertTriangle size={16} /> {error}</p> : null}
              {notice ? <p className="estimator-message"><CheckCircle2 size={16} /> {notice}</p> : null}

              <nav className="estimator-tabs" aria-label="Estimate views">
                {tabs.map((tab) => <button type="button" key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}><tab.icon size={16} /> {tab.label}{tab.key === "rfq" ? <b>{rfqLines.length}</b> : null}</button>)}
              </nav>

              {activeTab === "summary" ? (
                <div className="estimator-content">
                  <div className="estimator-metrics">
                    <article><span>Estimated cost</span><strong>{money(totals.cost)}</strong><small>Materials and labour</small></article>
                    <article><span>Sell value</span><strong>{money(totals.sell)}</strong><small>Excluding VAT</small></article>
                    <article><span>Potential profit</span><strong>{money(totals.profit)}</strong><small>{totals.margin.toFixed(1)}% margin</small></article>
                    <article className={totals.unpriced ? "warning" : ""}><span>Unpriced materials</span><strong>{totals.unpriced}</strong><small>{totals.unpriced ? "Supplier prices required" : "All material costs entered"}</small></article>
                  </div>
                  <section className="estimator-pricing-strip"><div><span>Active pricing profile</span><strong>{estimate.pricingProfile.name}</strong></div><p><b>{money(estimate.pricingProfile.labourSellRate)}</b> labour sell / hr</p><p><b>{estimate.pricingProfile.materialMarkupPercent}%</b> materials uplift</p><p><b>{estimate.pricingProfile.vatPercent}%</b> VAT</p><button type="button" onClick={openPricing}><Pencil size={15} /> Edit pricing</button></section>
                  <section className="estimator-summary-grid">
                    <div><h2>Scope of works</h2>{estimate.scopeOfWorks.map((item) => <p key={item}>{item}</p>)}</div>
                    <div><h2>Estimator checks</h2>{estimate.questions.length ? estimate.questions.map((item) => <p className="check" key={item}><AlertTriangle size={15} /> {item}</p>) : <p className="check ok"><CheckCircle2 size={15} /> No open survey questions</p>}</div>
                    <div><h2>Assumptions</h2>{estimate.assumptions.map((item) => <p key={item}>{item}</p>)}</div>
                    <div><h2>Exclusions / by others</h2>{estimate.exclusions.map((item) => <p key={item}>{item}</p>)}</div>
                  </section>
                </div>
              ) : null}

              {activeTab === "materials" ? (
                <div className="estimator-content">
                  {groupedMaterials.map(([costCentre, lines]) => <section className="estimate-line-section" key={costCentre}><div><h2>{costCentre}</h2><span>{lines.length} component{lines.length === 1 ? "" : "s"}</span></div><EstimateMaterialTable lines={lines} onEdit={(line) => startEdit({ type: "Material", line })} /></section>)}
                </div>
              ) : null}

              {activeTab === "labour" ? (
                <div className="estimator-content">
                  {groupedLabour.map(([trade, lines]) => <section className="estimate-line-section" key={trade}><div><h2>{trade}</h2><span>{lines.reduce((sum, line) => sum + line.hours, 0)} hours</span></div><EstimateLabourTable lines={lines} onEdit={(line) => startEdit({ type: "Labour", line })} /></section>)}
                </div>
              ) : null}

              {activeTab === "rfq" ? (
                <div className="estimator-content"><section className="estimate-line-section"><div><h2>Supplier price request</h2><span>{rfqLines.length} items need a price or confirmation</span></div><EstimateMaterialTable lines={rfqLines} onEdit={(line) => startEdit({ type: "Material", line })} /><div className="estimator-rfq-action"><p>Every material without a ratebook or confirmed supplier cost is collected here. Add prices manually after the quote returns, or export one request.</p><a href={`/api/estimates/${encodeURIComponent(estimate.id)}/supplier-rfq`}><Download size={16} /> Export supplier RFQ</a></div></section></div>
              ) : null}

              {activeTab === "simpro" ? (
                <div className="estimator-content"><section className="estimate-mapping"><h2>Cost-centre mapping</h2><div>{Object.entries(estimate.simproMappings.costCentres).map(([name, id]) => <p key={name}><span>{name}</span><strong>simPRO {id}</strong></p>)}</div><h2>Labour mapping</h2><div>{Object.entries(estimate.simproMappings.labourTypes).map(([name, id]) => <p key={name}><span>{name}</span><strong>simPRO {id}</strong></p>)}</div><a className="estimate-export-link" href={`/api/estimates/${encodeURIComponent(estimate.id)}/simpro-payload`}><Download size={16} /> Export simPRO-ready breakdown</a></section></div>
              ) : null}

              {activeTab === "source" ? (
                <div className="estimator-content"><section className="estimate-source"><div><h2>Source survey</h2><a href={`/survey/guided/${encodeURIComponent(estimate.surveyId)}`}>{survey?.reference || estimate.surveyId} · version {estimate.sourceSurveyVersion}</a><a className="estimate-pdf-link" href={`/api/surveys/${encodeURIComponent(estimate.surveyId)}/pdf`} target="_blank" rel="noreferrer"><Download size={15} /> Open branded survey PDF</a><p>Every generated line names the survey record or reusable assembly that produced it.</p></div><div><h2>Generation history</h2>{estimate.generationRuns.map((run) => <p key={`${run.id}-${run.completedAt}`}><strong>{new Date(run.completedAt).toLocaleString("en-GB")}</strong><span>{run.summary}</span></p>)}</div><div><h2>Manual corrections</h2>{estimate.corrections.length ? estimate.corrections.map((item) => <p key={item.id}><strong>{item.actor}</strong><span>{item.reason}</span></p>) : <p>No manual corrections recorded.</p>}</div></section></div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      {editing ? (
        <div className="estimator-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <section className="estimator-modal" role="dialog" aria-modal="true" aria-labelledby="estimate-edit-title">
            <header><div><span className="guided-eyebrow">Manual correction</span><h2 id="estimate-edit-title">{editing.line.description}</h2></div><button type="button" aria-label="Close" onClick={() => setEditing(null)}><X size={19} /></button></header>
            <div className="estimator-edit-grid">
              {editing.type === "Material" ? <>
                <label>Quantity<input type="number" step="0.01" value={editValues.quantity} onChange={(event) => setEditValues({ ...editValues, quantity: event.target.value })} /></label>
                <label>Unit cost (£)<input type="number" step="0.01" value={editValues.unitCost} onChange={(event) => setEditValues({ ...editValues, unitCost: event.target.value })} /></label>
                <label>Markup (%)<input type="number" step="0.1" value={editValues.markupPercent} onChange={(event) => setEditValues({ ...editValues, markupPercent: event.target.value })} /></label>
                <label>Supplier<input value={editValues.supplier} onChange={(event) => setEditValues({ ...editValues, supplier: event.target.value })} /></label>
              </> : <>
                <label>Hours<input type="number" step="0.25" value={editValues.hours} onChange={(event) => setEditValues({ ...editValues, hours: event.target.value })} /></label>
                <label>Cost rate (£)<input type="number" step="0.01" value={editValues.costRate} onChange={(event) => setEditValues({ ...editValues, costRate: event.target.value })} /></label>
                <label>Sell rate (£)<input type="number" step="0.01" value={editValues.sellRate} onChange={(event) => setEditValues({ ...editValues, sellRate: event.target.value })} /></label>
              </>}
              <label className="wide">Line notes<textarea rows={3} value={editValues.notes} onChange={(event) => setEditValues({ ...editValues, notes: event.target.value })} /></label>
              <label className="wide">Correction reason <em>required</em><textarea rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Why is this different from the generated allowance?" /></label>
              <label className="wide checkbox"><input type="checkbox" checked={reusableCorrection} onChange={(event) => setReusableCorrection(event.target.checked)} /> Flag this correction for review as a reusable estimating rule</label>
            </div>
            <footer><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="primary" onClick={() => void saveCorrection()} disabled={working || !correctionReason.trim()}>{working ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save correction</button></footer>
          </section>
        </div>
      ) : null}
      {pricingOpen && estimate ? (
        <div className="estimator-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPricingOpen(false)}>
          <section className="estimator-modal" role="dialog" aria-modal="true" aria-labelledby="estimate-pricing-title">
            <header><div><span className="guided-eyebrow">Estimate controls</span><h2 id="estimate-pricing-title">Active pricing profile</h2></div><button type="button" aria-label="Close" onClick={() => setPricingOpen(false)}><X size={19} /></button></header>
            <div className="estimator-edit-grid">
              <label className="wide">Profile name<input value={pricingValues.name || ""} onChange={(event) => setPricingValues({ ...pricingValues, name: event.target.value })} /></label>
              <label>Labour sell rate (£)<input type="number" step="0.01" value={pricingValues.labourSellRate || ""} onChange={(event) => setPricingValues({ ...pricingValues, labourSellRate: event.target.value })} /></label>
              <label>Material uplift (%)<input type="number" step="0.1" value={pricingValues.materialMarkupPercent || ""} onChange={(event) => setPricingValues({ ...pricingValues, materialMarkupPercent: event.target.value })} /></label>
              <label>Plant uplift (%)<input type="number" step="0.1" value={pricingValues.plantMarkupPercent || ""} onChange={(event) => setPricingValues({ ...pricingValues, plantMarkupPercent: event.target.value })} /></label>
              <label>VAT (%)<input type="number" step="0.1" value={pricingValues.vatPercent || ""} onChange={(event) => setPricingValues({ ...pricingValues, vatPercent: event.target.value })} /></label>
              <label className="wide">Change reason <em>required</em><textarea rows={3} value={pricingReason} onChange={(event) => setPricingReason(event.target.value)} placeholder="For example: commercial daywork rates agreed for this client" /></label>
            </div>
            <footer><button type="button" onClick={() => setPricingOpen(false)}>Cancel</button><button type="button" className="primary" onClick={() => void savePricing()} disabled={working || !pricingReason.trim()}>{working ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save profile</button></footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function EstimateMaterialTable({ lines, onEdit }: { lines: EstimateMaterialLine[]; onEdit: (line: EstimateMaterialLine) => void }) {
  return <div className="estimate-table material"><div className="head"><span>Description</span><span>Qty</span><span>Cost</span><span>Markup</span><span>Sell</span><span>Status</span><span /></div>{lines.map((line) => { const cost = (line.unitCost || 0) * line.quantity; const sell = cost * (1 + line.markupPercent / 100); return <div className="row" key={line.id}><span data-label="Description"><strong>{line.description}</strong><small>{line.calculationExplanation}</small></span><span data-label="Qty">{line.quantity} {line.unit}</span><span data-label="Cost">{line.unitCost === undefined ? "Unpriced" : money(cost)}</span><span data-label="Markup">{line.markupPercent}%</span><span data-label="Sell">{line.unitCost === undefined ? "-" : money(sell)}</span><span data-label="Status"><b data-line-status={line.status}>{line.status}</b></span><span><button type="button" title="Edit material line" onClick={() => onEdit(line)}><Pencil size={15} /></button></span></div>; })}</div>;
}

function EstimateLabourTable({ lines, onEdit }: { lines: EstimateLabourLine[]; onEdit: (line: EstimateLabourLine) => void }) {
  return <div className="estimate-table labour"><div className="head"><span>Task</span><span>Hours</span><span>Cost rate</span><span>Sell rate</span><span>Sell</span><span>Status</span><span /></div>{lines.map((line) => <div className="row" key={line.id}><span data-label="Task"><strong>{line.description}</strong><small>{line.calculationBasis}</small></span><span data-label="Hours">{line.hours}</span><span data-label="Cost rate">{money(line.costRate)}</span><span data-label="Sell rate">{money(line.sellRate)}</span><span data-label="Sell">{money(line.sellRate * line.hours)}</span><span data-label="Status"><b data-line-status={line.status}>{line.status}</b></span><span><button type="button" title="Edit labour line" onClick={() => onEdit(line)}><Pencil size={15} /></button></span></div>)}</div>;
}
