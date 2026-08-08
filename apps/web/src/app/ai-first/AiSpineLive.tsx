"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

type SpineStep = {
  id: string;
  label: string;
  href: string;
  status: "ready" | "next" | "optional";
  detail: string;
};

type SpineResult = {
  ok?: boolean;
  error?: string;
  summary?: string;
  narrative?: string;
  aiUsed?: boolean;
  connected?: boolean;
  heatDesign?: { id: string; name: string };
  takeoff?: { id: string; reference: string; name: string };
  steps?: SpineStep[];
  clarifyingQuestions?: string[];
};

export function AiSpineLive() {
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [jobType, setJobType] = useState("Full heating replacement");
  const [notes, setNotes] = useState("");
  const [preferAshp, setPreferAshp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSpine() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/ai-spine/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hubflo-role": "Office",
        },
        body: JSON.stringify({
          customerName: customerName.trim() || undefined,
          siteAddress: siteAddress.trim() || undefined,
          postcode: postcode.trim() || undefined,
          jobType: jobType.trim() || undefined,
          notes: notes.trim() || undefined,
          preferAshp,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as SpineResult;
      if (!response.ok || !body.ok) {
        throw new Error(body.error || `Spine failed (${response.status})`);
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the AI spine.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-spine-live" aria-label="Live AI spine">
      <header>
        <p className="eyebrow">
          <Sparkles size={14} /> Live · not a prototype
        </p>
        <h2>Open the job spine</h2>
        <p>
          One Blake handoff creates linked <strong>Heat Design</strong> + <strong>Takeoff</strong>, then
          points you at Survey / Quote. OpenAI plans the system when connected.
        </p>
      </header>

      <div className="ai-spine-grid">
        <label>
          Customer
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Mrs Smith" />
        </label>
        <label>
          Site
          <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="12 Example Road" />
        </label>
        <label>
          Postcode
          <input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="AB12 3CD" />
        </label>
        <label>
          Job type
          <input value={jobType} onChange={(e) => setJobType(e.target.value)} placeholder="Full heating replacement" />
        </label>
      </div>

      <label className="ai-spine-notes">
        Brief for Blake
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Replace gas boiler with ASHP, keep most rads, UFH in kitchen, 4-bed 1990s semi…"
        />
      </label>

      <label className="ai-spine-check">
        <input type="checkbox" checked={preferAshp} onChange={(e) => setPreferAshp(e.target.checked)} />
        Prefer ASHP when the brief is unclear
      </label>

      <div className="ai-spine-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void runSpine()}>
          {busy ? "Blake opening spine…" : "Run AI spine"}
        </button>
        <a className="ghost" href="/ai-intake">
          Or full AI intake → Core
        </a>
      </div>

      {error ? <p className="ai-spine-error">{error}</p> : null}

      {result ? (
        <div className="ai-spine-result">
          <p className="ai-spine-badge">
            {result.aiUsed ? "Live AI plan" : result.connected ? "Rule plan (AI miss)" : "Rule plan (OpenAI off)"}
          </p>
          <strong>{result.summary}</strong>
          {result.narrative ? <p>{result.narrative}</p> : null}
          <p className="muted">
            Heat Design <code>{result.heatDesign?.name}</code>
            {" · "}
            Takeoff <code>{result.takeoff?.reference}</code>
          </p>
          <ol className="ai-spine-steps">
            {(result.steps || []).map((step) => (
              <li key={step.id} data-status={step.status}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>
                  Open <ArrowRight size={14} />
                </a>
              </li>
            ))}
          </ol>
          {result.clarifyingQuestions?.length ? (
            <ul className="ai-spine-qs">
              {result.clarifyingQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
