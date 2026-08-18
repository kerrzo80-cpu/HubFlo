"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calculator, RefreshCw, Send, Sparkles } from "lucide-react";

import type {
  AiTakeoffAssumption,
  AiTakeoffLine,
  AiTakeoffPricingRules,
  TenderAiTakeoffState,
} from "@/lib/ai-takeoff-assistant-types";
import { calculateProjectTotals, calculateTakeoffLine } from "@/lib/ai-takeoff-calc";

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

type Props = {
  tenderId: string;
  tenderName: string;
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  onBoqApplied?: () => void;
};

type ApiPayload = {
  state?: TenderAiTakeoffState;
  totals?: ReturnType<typeof calculateProjectTotals>;
  validation?: string[];
  ai?: { connected?: boolean; model?: string; keyName?: string };
  error?: string;
  applied?: number;
  sheetName?: string;
};

export function TenderAiTakeoffPanel({
  tenderId,
  tenderName,
  requestHeaders,
  onNotice,
  onBoqApplied,
}: Props) {
  const [state, setState] = useState<TenderAiTakeoffState | null>(null);
  const [totals, setTotals] = useState<ReturnType<typeof calculateProjectTotals> | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [aiMeta, setAiMeta] = useState<{ connected?: boolean; model?: string; keyName?: string }>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/ai-takeoff`, {
      headers: requestHeaders,
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as ApiPayload | null;
    if (!response.ok) {
      onNotice(payload?.error || "Could not load Blake takeoff workspace.");
      return;
    }
    if (payload?.state) setState(payload.state);
    if (payload?.totals) setTotals(payload.totals);
    setValidation(payload?.validation || []);
    setAiMeta(payload?.ai || {});
  }, [onNotice, requestHeaders, tenderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveTotals = useMemo(() => {
    if (!state) return totals;
    return calculateProjectTotals(state.lines, state.plots, state.pricingRules);
  }, [state, totals]);

  async function postAction(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/ai-takeoff`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (payload?.state) setState(payload.state);
      if (payload?.totals) setTotals(payload.totals);
      if (payload?.validation) setValidation(payload.validation);
      if (payload?.ai) setAiMeta(payload.ai);
      if (!response.ok) {
        onNotice(payload?.error || "Blake takeoff request failed.");
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const text = message.trim();
    if (!text) return;
    setMessage("");
    await postAction({ action: "chat", message: text });
  }

  async function applyToBoq(onlyAccepted: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/ai-takeoff/apply`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ onlyAccepted }),
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok) {
        onNotice(payload?.error || "Could not apply lines to BoQ.");
        return;
      }
      if (payload?.state) setState(payload.state);
      onNotice(
        `Applied ${payload?.applied || 0} Blake takeoff line(s) to BoQ sheet “${payload?.sheetName || "Blake Takeoff"}”.`,
      );
      onBoqApplied?.();
    } finally {
      setBusy(false);
    }
  }

  async function saveRules(patch: Partial<AiTakeoffPricingRules>) {
    await postAction({ action: "update-rules", pricingRules: patch });
  }

  if (!state) {
    return (
      <div className="tenders-ai-takeoff">
        <p className="setup-inline-note">Loading Blake…</p>
      </div>
    );
  }

  const openAssumptions = state.assumptions.filter((row) => row.status === "open");
  const proposedCount = state.lines.filter((line) => line.status === "proposed" || line.status === "accepted").length;

  return (
    <div className="tenders-ai-takeoff">
      <div className="tenders-ai-takeoff-header">
        <div>
          <span className="permission-heading">Blake proposes · NeXa calculates</span>
          <h3>
            <Sparkles size={16} /> Blake
          </h3>
          <p>
            Takeoff chat for <strong>{tenderName}</strong>. Works for housing estates <em>and</em> commercial /
            single-building jobs — no fake house types required. Upload the issued BoQ under Documents, then ask Blake
            to import and price it. Sell totals and markups are calculated in NeXa before Apply to BoQ.
          </p>
        </div>
        <div className="tenders-toolbar-actions">
          <span className={aiMeta.connected ? "status-pill green" : "status-pill amber"}>
            {aiMeta.connected ? `Blake connected · ${aiMeta.model || "model"}` : "OpenAI not connected"}
          </span>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowRules((v) => !v)}>
            Pricing rules
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || proposedCount === 0}
            onClick={() => void applyToBoq(false)}
          >
            Apply to BoQ ({proposedCount})
          </button>
        </div>
      </div>

      {showRules ? (
        <div className="tenders-ai-takeoff-rules">
          <label>
            Labour £/h
            <input
              type="number"
              value={state.pricingRules.labourRatePerHour}
              onChange={(event) => void saveRules({ labourRatePerHour: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            Daywork £/h
            <input
              type="number"
              value={state.pricingRules.dayworkRatePerHour}
              onChange={(event) => void saveRules({ dayworkRatePerHour: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            Materials markup %
            <input
              type="number"
              value={state.pricingRules.materialsMarkupPercent}
              onChange={(event) => void saveRules({ materialsMarkupPercent: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            Sanitary markup %
            <input
              type="number"
              value={state.pricingRules.sanitarywareMarkupPercent}
              onChange={(event) => void saveRules({ sanitarywareMarkupPercent: Number(event.target.value) || 0 })}
            />
          </label>
        </div>
      ) : null}

      <div className="tenders-metric-row">
        <article>
          <span>Project sell</span>
          <strong>{money(liveTotals?.totalSell)}</strong>
        </article>
        <article>
          <span>VAT</span>
          <strong>{money(liveTotals?.vat)}</strong>
        </article>
        <article>
          <span>Grand total</span>
          <strong>{money(liveTotals?.grandTotal)}</strong>
        </article>
        <article>
          <span>Plots / lines</span>
          <strong>
            {state.plots.length} / {state.lines.length}
          </strong>
        </article>
      </div>

      {validation.length ? (
        <div className="tenders-ai-takeoff-validation">
          <AlertTriangle size={15} />
          <div>
            {validation.map((row) => (
              <p key={row}>{row}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="tenders-ai-takeoff-grid">
        <section className="tenders-ai-takeoff-chat">
          <div className="tenders-ai-takeoff-messages">
            {state.messages.length === 0 ? (
              <p className="setup-inline-note">
                Try: “This is a health club refurb — treat as one area, import Plumbing.xlsx from Documents, price with
                30% materials markup and labour at £70/h, then I’ll Apply to BoQ.”
              </p>
            ) : (
              state.messages.map((row) => (
                <article key={row.id} className={`tenders-ai-msg tenders-ai-msg-${row.role}`}>
                  <span>{row.role === "user" ? "You" : row.role === "assistant" ? "Blake" : "System"}</span>
                  <p>{row.text}</p>
                  {row.toolCalls?.length ? (
                    <ul>
                      {row.toolCalls.map((call, index) => (
                        <li key={`${row.id}-tool-${index}`}>
                          <code>{call.name}</code> — {call.result}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            )}
          </div>
          <div className="tenders-ai-takeoff-composer">
            <textarea
              rows={3}
              value={message}
              placeholder="Ask the assistant to take off quantities, assign plots, or record assumptions…"
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
            />
            <button type="button" className="primary-button" disabled={busy || !message.trim()} onClick={() => void sendChat()}>
              <Send size={14} /> Send
            </button>
          </div>
        </section>

        <aside className="tenders-ai-takeoff-side">
          <div>
            <h4>House types</h4>
            <p>{state.houseTypes.length ? state.houseTypes.join(", ") : "None yet"}</p>
          </div>
          <div>
            <h4>Plots</h4>
            <p>
              {state.plots.length
                ? state.plots
                    .slice(0, 12)
                    .map((row) => `${row.plot}→${row.houseType}`)
                    .join(", ") + (state.plots.length > 12 ? ` (+${state.plots.length - 12})` : "")
                : "None yet"}
            </p>
          </div>
          <div>
            <h4>Assumptions / exclusions</h4>
            {openAssumptions.length === 0 ? (
              <p className="setup-inline-note">None open</p>
            ) : (
              <ul>
                {openAssumptions.map((row: AiTakeoffAssumption) => (
                  <li key={row.id}>
                    <strong>{row.kind}</strong> — {row.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4>Documents linked</h4>
            <p>{state.files.length ? state.files.map((file) => file.name).join(", ") : "Syncs from Documents tab"}</p>
          </div>
        </aside>
      </div>

      <div className="tenders-table-wrap">
        <table className="tenders-boq-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>House / plot</th>
              <th>Phase</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Cost</th>
              <th>Markup</th>
              <th>Labour</th>
              <th>Sell</th>
            </tr>
          </thead>
          <tbody>
            {state.lines.length === 0 ? (
              <tr>
                <td colSpan={10}>No proposed lines yet — use chat to add takeoff items.</td>
              </tr>
            ) : (
              state.lines.map((line: AiTakeoffLine) => {
                const calc = calculateTakeoffLine(line, state.pricingRules);
                return (
                  <tr key={line.id}>
                    <td>{line.status}</td>
                    <td>
                      {[line.houseType, line.plotNumber].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td>{line.phase || "—"}</td>
                    <td>{line.description}</td>
                    <td>{calc.quantity}</td>
                    <td>{calc.unit}</td>
                    <td>{money(calc.unitCost)}</td>
                    <td>{calc.markupPercent}%</td>
                    <td>
                      {calc.labourHours}h @ {money(calc.labourRate)}
                    </td>
                    <td>
                      <Calculator size={12} /> {money(calc.lineTotalSell)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
