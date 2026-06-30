"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, MessageCircle, ShieldCheck, Smartphone, UserPlus } from "lucide-react";

const pilotMessages = [
  {
    audience: "Engineer private",
    title: "Daily time check",
    message: "Kerr, confirm your time for J-1052: 11:00-15:00. Reply CONFIRM or send the change.",
    outcome: "Creates private time entry and office exception if changed.",
  },
  {
    audience: "Internal team",
    title: "Variation captured",
    message: "Variation raised on J-1052: extra pipe route needed. Office review required before client approval.",
    outcome: "Creates draft variation quote for office pricing.",
  },
  {
    audience: "Client visible",
    title: "Approval link",
    message: "Variation V-004 is ready to review. Open the secure NeXa link to approve before works proceed.",
    outcome: "Logs viewed/approved and alerts engineer to proceed.",
  },
  {
    audience: "Supplier + office",
    title: "Material request",
    message: "Please price materials for J-1052. Reply with PDF quote or use the NeXa supplier link.",
    outcome: "Links supplier quote to job/cost centre privately.",
  },
];

const defaultPilotMessage = pilotMessages[0]!;

function interpretWhatsAppReply(reply: string) {
  const text = reply.toLowerCase();

  if (!reply.trim()) {
    return {
      type: "Waiting for reply",
      visibility: "Engineer private",
      detail: "Type a WhatsApp-style reply to see what NeXa would create.",
    };
  }

  if (text.includes("variation") || text.includes("extra") || text.includes("additional")) {
    return {
      type: "Draft variation quote",
      visibility: "Internal team",
      detail: "Creates a detected variation with engineer description, likely labour/materials, and office pricing review.",
    };
  }

  if (text.includes("part") || text.includes("po") || text.includes("supplier") || text.includes("valve")) {
    return {
      type: "Parts / PO request",
      visibility: "Office only",
      detail: "Creates an office alert with supplier/material note. Office approves or orders before updating the job.",
    };
  }

  if (text.includes("rebook") || text.includes("return") || text.includes("come back")) {
    return {
      type: "Rebook alert",
      visibility: "Internal team",
      detail: "Creates a scheduler alert and keeps the job open for another visit.",
    };
  }

  if (text.includes("access") || text.includes("not home") || text.includes("no answer")) {
    return {
      type: "Could not access",
      visibility: "Internal team",
      detail: "Creates a could-not-access alert with the engineer note for the office to chase.",
    };
  }

  if (text.includes("confirm") || text.includes("confirmed") || /\d/.test(text)) {
    return {
      type: "Time check update",
      visibility: "Engineer private",
      detail: "Creates or updates the engineer time entry. If it differs from schedule, office sees an exception.",
    };
  }

  return {
    type: "Job note",
    visibility: "Internal team",
    detail: "Adds the reply as an internal job note linked to the job timeline.",
  };
}

export default function WhatsAppPilotPage() {
  const [selectedMessage, setSelectedMessage] = useState(defaultPilotMessage);
  const [pilotNumber, setPilotNumber] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [pilotReply, setPilotReply] = useState("Confirmed, but add 30 mins materials.");
  const interpretedReply = interpretWhatsAppReply(pilotReply);

  async function sendLiveTest() {
    if (!pilotNumber.trim()) {
      setSendResult("Enter your WhatsApp number first, including country code, for example +44...");
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch("/api/whatsapp/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: pilotNumber,
          message: selectedMessage.message,
        }),
      });
      const body = await response.json();

      if (body.status === "sent") {
        setSendResult("Live WhatsApp test sent.");
      } else if (body.status === "not_configured") {
        setSendResult(`Ready to send, but missing setup: ${body.missing.join(", ")}.`);
      } else {
        setSendResult(body.error || "WhatsApp test could not be sent.");
      }
    } catch {
      setSendResult("WhatsApp test could not reach the NeXa API.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="office-shell">
      <Link href="/office/alerts" className="engineer-back-link"><ArrowLeft size={17} /> Back to alerts</Link>

      <section className="office-hero whatsapp-pilot-hero">
        <p className="eyebrow">WhatsApp pilot</p>
        <h1>Use what we already use</h1>
        <p>We will pilot with you first. WhatsApp is the doorway; NeXa keeps the job record, permissions, approvals, times and audit trail.</p>
        <div className="office-summary-grid">
          <div><strong>1</strong><span>Test pilot</span></div>
          <div><strong>4</strong><span>Message flows</span></div>
          <div><strong>5</strong><span>Visibility lanes</span></div>
          <div><strong>0</strong><span>Live sends yet</span></div>
        </div>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Pilot setup</p>
            <h2>Your WhatsApp test profile</h2>
          </div>
          <Smartphone size={22} />
        </div>

        <div className="whatsapp-pilot-grid">
          <label>
            Pilot name
            <input defaultValue="Kerr / NeXa" />
          </label>
          <label>
            WhatsApp number
            <input placeholder="+44..." value={pilotNumber} onChange={(event) => setPilotNumber(event.target.value)} />
          </label>
          <label>
            Role
            <select defaultValue="Manager / engineer pilot">
              <option>Manager / engineer pilot</option>
              <option>Engineer</option>
              <option>Office</option>
              <option>Client test contact</option>
            </select>
          </label>
          <label>
            Default visibility
            <select defaultValue="Engineer private">
              <option>Engineer private</option>
              <option>Internal team</option>
              <option>Office only</option>
              <option>Client visible</option>
            </select>
          </label>
        </div>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Behaviour test</p>
            <h2>Messages NeXa will try first</h2>
          </div>
          <MessageCircle size={22} />
        </div>

        <div className="whatsapp-message-flow">
          {pilotMessages.map((item) => (
            <article key={item.title}>
              <span>{item.audience}</span>
              <h3>{item.title}</h3>
              <p>{item.message}</p>
              <small>{item.outcome}</small>
              <button type="button" onClick={() => setSelectedMessage(item)}>Preview send</button>
            </article>
          ))}
        </div>
      </section>

      <section className="office-panel whatsapp-sim-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Live behaviour simulation</p>
            <h2>{selectedMessage.title}</h2>
          </div>
          <MessageCircle size={22} />
        </div>
        <div className="whatsapp-sim-thread">
          <div className="whatsapp-sim-message hubflo">
            <span>NeXa to {selectedMessage.audience}</span>
            <p>{selectedMessage.message}</p>
          </div>
          <div className="whatsapp-sim-message reply">
            <span>Test pilot reply</span>
            <p>
              {selectedMessage.title === "Daily time check"
                ? "Confirmed, but add 30 mins materials."
                : selectedMessage.title === "Variation captured"
                  ? "Extra pipe route needed, approx 4 hrs and copper fittings."
                  : selectedMessage.title === "Approval link"
                    ? "Approved."
                    : "PDF quote attached, delivery tomorrow."}
            </p>
          </div>
          <div className="whatsapp-sim-message structured">
            <span>NeXa creates</span>
            <p>{selectedMessage.outcome}</p>
          </div>
        </div>
        <div className="whatsapp-live-test">
          <label>
            Send to WhatsApp number
            <input placeholder="+44..." value={pilotNumber} onChange={(event) => setPilotNumber(event.target.value)} />
          </label>
          <button disabled={isSending} type="button" onClick={sendLiveTest}>
            {isSending ? "Checking..." : "Check live setup / send test"}
          </button>
          {sendResult ? <strong>{sendResult}</strong> : <span>Without WhatsApp API credentials this will only confirm setup is missing.</span>}
        </div>
      </section>

      <section className="office-panel whatsapp-sim-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Inbound reply test</p>
            <h2>Type a WhatsApp reply</h2>
          </div>
          <MessageCircle size={22} />
        </div>
        <div className="whatsapp-reply-tester">
          <label>
            Test reply
            <textarea
              rows={4}
              value={pilotReply}
              onChange={(event) => setPilotReply(event.target.value)}
              placeholder="Try: variation extra pipe route 4 hrs copper fittings"
            />
          </label>
          <div className="whatsapp-structured-card">
            <span>{interpretedReply.visibility}</span>
            <strong>{interpretedReply.type}</strong>
            <p>{interpretedReply.detail}</p>
          </div>
        </div>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Safety rules</p>
            <h2>What WhatsApp will not control</h2>
          </div>
          <ShieldCheck size={22} />
        </div>
        <div className="whatsapp-safety-list">
          <div><CheckCircle2 size={16} /><span>NeXa stores the real job timeline and audit log.</span></div>
          <div><CheckCircle2 size={16} /><span>Client messages are sent as separate approval links, not internal group chatter.</span></div>
          <div><CheckCircle2 size={16} /><span>Engineer time checks stay private to that engineer and the office.</span></div>
          <div><CheckCircle2 size={16} /><span>Costs, margin and supplier prices stay office-only unless deliberately sent.</span></div>
        </div>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Next connection</p>
            <h2>Live WhatsApp API</h2>
          </div>
          <UserPlus size={22} />
        </div>
        <p className="whatsapp-muted-copy">
          To send real WhatsApp messages we will add a WhatsApp Business sender, access token, phone number ID and webhook verification token. Until then, this page lets us test wording, permissions and workflow safely.
        </p>
      </section>
    </main>
  );
}
