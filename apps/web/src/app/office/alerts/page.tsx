"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  MessageCircle,
  Phone,
  Send,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { getOfficeAlerts, getOfficePoRequests, type OfficeAlert, type OfficeAlertType } from "@/lib/engineer-data";

type AlertFilter = {
  label: string;
  types: OfficeAlertType[];
};

const alertFilters: AlertFilter[] = [
  { label: "All", types: [] },
  { label: "Variations", types: ["Variation detected"] },
  { label: "Parts / PO", types: ["Parts needed", "PO requested"] },
  { label: "Rebook / access", types: ["Rebook required", "Could not access"] },
  { label: "Time", types: ["Missing daily time check"] },
  { label: "Stop / go", types: ["Stop/go missing"] },
];

const defaultAlertFilter = alertFilters[0]!;

function reviewCopy(alert: OfficeAlert) {
  if (alert.type === "Variation detected") {
    return {
      title: "Draft variation quote",
      body: "Extra controls wiring captured from site. Office reviews the engineer notes, edits the description and sends an approval link before the engineer proceeds.",
      rows: [
        ["Labour", "3.5 hrs engineer time"],
        ["Materials", "Cable, clips, spur, containment sundries"],
        ["Estimated cost", "£226.00"],
        ["Client sell", "£338.00"],
      ],
      actions: ["Open variation", "Send approval", "Approve to proceed"],
    };
  }

  if (alert.type === "Parts needed" || alert.type === "PO requested") {
    return {
      title: "Supplier / PO review",
      body: "Engineer has asked for parts support. The office confirms supplier, checks cost, then marks ordered or asks for more detail.",
      rows: [
        ["Supplier", "Pipe Center Aberdeen"],
        ["Engineer note", "Pump valves likely needed before reattendance"],
        ["Status", "Waiting office approval"],
        ["Visibility", "Internal only"],
      ],
      actions: ["Approve PO", "Mark ordered", "Ask engineer"],
    };
  }

  if (alert.type === "Missing daily time check") {
    return {
      title: "Timesheet chase",
      body: "NeXa has not had the engineer confirmation for the day. Chase privately so clients and other engineers do not see hours or pay details.",
      rows: [
        ["Expected reply", "Confirmed / changed hours / no work"],
        ["Last chase", "09:00 today"],
        ["Visibility", "Engineer private"],
        ["Office action", "Chase or mark exempt"],
      ],
      actions: ["Chase engineer", "Mark exempt", "Open schedule"],
    };
  }

  if (alert.type === "Stop/go missing") {
    return {
      title: "Missing completion evidence",
      body: "The job cannot be closed until the required photo, serial number, note or form field is supplied by the engineer.",
      rows: [
        ["Missing item", alert.detail.replace(" is missing before completion can be confirmed.", "")],
        ["Blocks", "Completion and customer handover"],
        ["Visibility", "Office and engineer"],
        ["Next step", "Request evidence"],
      ],
      actions: ["Request evidence", "Mark received", "Open job"],
    };
  }

  return {
    title: "Schedule exception",
    body: "Access or attendance needs office handling before the job can continue.",
    rows: [
      ["Customer", alert.customer ?? "Customer TBC"],
      ["Site", alert.address ?? "Address TBC"],
      ["Engineer", alert.engineerName],
      ["Next step", "Call customer or rebook"],
    ],
    actions: ["Open scheduler", "Call customer", "Notify engineer"],
  };
}

export default function OfficeAlertsPage() {
  const alerts = getOfficeAlerts();
  const poRequests = getOfficePoRequests();
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedAlertId, setSelectedAlertId] = useState(alerts[0]?.id ?? "");
  const [actionMessage, setActionMessage] = useState("");
  const highPriority = alerts.filter((alert) => alert.priority === "High").length;
  const newAlerts = alerts.filter((alert) => alert.status === "New").length;
  const currentFilter = alertFilters.find((filter) => filter.label === activeFilter) ?? defaultAlertFilter;
  const filteredAlerts = useMemo(() => {
    if (!currentFilter.types.length) return alerts;
    return alerts.filter((alert) => currentFilter.types.includes(alert.type));
  }, [alerts, currentFilter]);
  const selectedAlert =
    filteredAlerts.find((alert) => alert.id === selectedAlertId) ??
    filteredAlerts[0] ??
    alerts[0];
  const selectedReview = selectedAlert ? reviewCopy(selectedAlert) : null;

  function selectFilter(filter: AlertFilter) {
    const nextAlerts = filter.types.length ? alerts.filter((alert) => filter.types.includes(alert.type)) : alerts;
    setActiveFilter(filter.label);
    setSelectedAlertId(nextAlerts[0]?.id ?? "");
    setActionMessage("");
  }

  function runAction(action: string) {
    if (!selectedAlert) return;
    setActionMessage(`${action} noted for ${selectedAlert.jobRef ?? selectedAlert.engineerName}. This would write to the job log and notify the right people.`);
  }

  return (
    <main className="office-shell">
      <Link href="/engineer" className="engineer-back-link"><ArrowLeft size={17} /> Back to engineer view</Link>

      <section className="office-hero">
        <p className="eyebrow">Office exceptions</p>
        <h1>Alerts queue</h1>
        <p>Engineer exceptions, missing stop/go evidence and time-check issues land here before the office needs to chase.</p>
        <div className="office-summary-grid">
          <div><strong>{alerts.length}</strong><span>Total alerts</span></div>
          <div><strong>{highPriority}</strong><span>High priority</span></div>
          <div><strong>{poRequests.length}</strong><span>PO requests</span></div>
          <div><strong>{newAlerts}</strong><span>New</span></div>
        </div>
      </section>

      <section className="office-action-strip">
        <Link href="/office/po-requests" className="engineer-primary-action"><ShoppingCart size={17} /> PO requests</Link>
        <Link href="/office/whatsapp-pilot" className="engineer-secondary-action"><MessageCircle size={17} /> WhatsApp pilot</Link>
        <a href="tel:+441224000000" className="engineer-secondary-action"><Phone size={17} /> Call office</a>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Live queue</p>
            <h2>Needs office action</h2>
          </div>
          <AlertTriangle size={22} />
        </div>

        <div className="office-filter-strip" aria-label="Alert filters">
          {alertFilters.map((filter) => {
            const count = filter.types.length
              ? alerts.filter((alert) => filter.types.includes(alert.type)).length
              : alerts.length;
            return (
              <button
                className={filter.label === activeFilter ? "active" : ""}
                key={filter.label}
                type="button"
                onClick={() => selectFilter(filter)}
              >
                {filter.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="office-review-layout">
          <div className="office-alert-list compact">
            {filteredAlerts.map((alert) => (
              <button
                className={`office-alert-card ${alert.priority.toLowerCase()} ${selectedAlert?.id === alert.id ? "selected" : ""}`}
                key={alert.id}
                type="button"
                onClick={() => {
                  setSelectedAlertId(alert.id);
                  setActionMessage("");
                }}
              >
                <div>
                  <span className="office-alert-type">{alert.type}</span>
                  <h3>{alert.jobRef ? `${alert.jobRef} · ${alert.customer}` : alert.engineerName}</h3>
                  <p>{alert.detail}</p>
                  {alert.address ? <small>{alert.address}</small> : null}
                </div>
                <div className="office-alert-meta">
                  <strong>{alert.priority}</strong>
                  <span>{alert.status}</span>
                  <small>{alert.createdAt}</small>
                </div>
              </button>
            ))}
          </div>

          {selectedAlert && selectedReview ? (
            <aside className="office-alert-review" aria-label="Selected alert review">
              <div className="office-review-title">
                <div>
                  <span className="office-alert-type">{selectedAlert.type}</span>
                  <h3>{selectedAlert.jobRef ? `${selectedAlert.jobRef} · ${selectedAlert.customer}` : selectedAlert.engineerName}</h3>
                </div>
                {selectedAlert.priority === "High" ? <AlertTriangle size={22} /> : <Clock3 size={22} />}
              </div>

              <div className="office-review-context">
                <div><span>Engineer</span><strong>{selectedAlert.engineerName}</strong></div>
                <div><span>Status</span><strong>{selectedAlert.status}</strong></div>
                <div><span>Raised</span><strong>{selectedAlert.createdAt}</strong></div>
                <div><span>Priority</span><strong>{selectedAlert.priority}</strong></div>
              </div>

              {selectedAlert.address ? (
                <div className="office-review-address">
                  <strong>{selectedAlert.customer}</strong>
                  <span>{selectedAlert.address}</span>
                </div>
              ) : null}

              <div className="office-review-box">
                <div className="office-review-box-heading">
                  {selectedAlert.type === "Variation detected" ? <FileText size={18} /> : selectedAlert.type.includes("Parts") ? <ShoppingCart size={18} /> : <Wrench size={18} />}
                  <h4>{selectedReview.title}</h4>
                </div>
                <p>{selectedReview.body}</p>
                <div className="office-review-rows">
                  {selectedReview.rows.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="office-review-actions">
                {selectedReview.actions.map((action, index) => (
                  <button
                    className={index === 0 ? "primary" : ""}
                    key={action}
                    type="button"
                    onClick={() => runAction(action)}
                  >
                    {index === 0 ? <CheckCircle2 size={16} /> : index === 1 ? <Send size={16} /> : <CalendarClock size={16} />}
                    {action}
                  </button>
                ))}
              </div>

              {actionMessage ? <div className="office-action-message">{actionMessage}</div> : null}
            </aside>
          ) : (
            <aside className="office-alert-review empty">
              <AlertTriangle size={24} />
              <h3>No alerts in this filter</h3>
              <p>When an engineer raises one, it will appear here for office review.</p>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
