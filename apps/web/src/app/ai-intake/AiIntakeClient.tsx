"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  MapPin,
  Send,
  Sparkles,
} from "lucide-react";
import {
  firstOpenField,
  leadJobTypeOptions,
  playbookAnswers,
  playbooks,
  questionForField,
  type MandatoryField,
  type PlaybookId,
} from "../ai-first/data";
import "../ai-first/ai-first.css";

type LeadSource = "Phone call" | "Checkatrade" | "Email" | "Website" | "Referral";
type Phase = "jobType" | "thinking" | "questions" | "book" | "saving" | "done";

type AddressMatch = {
  postcode: string;
  address: string;
  line1?: string;
  town?: string;
  county?: string;
};

type LeadApiResponse = {
  lead?: {
    id: string;
    ref: string;
    customerName: string;
    clientId?: string;
    siteId?: string;
  };
  error?: string;
  message?: string;
  conflict?: boolean;
};

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
};

const surveyors = ["Brian Kerr", "Errol Watson", "James Walsh"];
const sources: LeadSource[] = ["Phone call", "Email", "Website", "Referral", "Checkatrade"];

function cloneFields(playbookId: PlaybookId): MandatoryField[] {
  return playbooks[playbookId].fields.map((field) => ({ ...field }));
}

function fieldValue(fields: MandatoryField[], id: string): string {
  return fields.find((field) => field.id === id)?.answer?.trim() || "";
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function splitSiteAddress(value: string) {
  const postcodeMatch = value.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const postcode = postcodeMatch?.[1]?.toUpperCase().replace(/\s+/, " ") || "";
  const line1 = postcode ? value.replace(postcodeMatch![0], "").replace(/,\s*$/, "").trim() : value.trim();
  return { line1, postcode };
}

export function AiIntakeClient() {
  const [phase, setPhase] = useState<Phase>("jobType");
  const [answerDraft, setAnswerDraft] = useState("");
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [addressMatches, setAddressMatches] = useState<AddressMatch[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [playbookId, setPlaybookId] = useState<PlaybookId>("heating");
  const [customerName, setCustomerName] = useState("");
  const [fields, setFields] = useState<MandatoryField[]>(() => cloneFields("heating"));
  const [conversation, setConversation] = useState<Array<{ role: "customer" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "Hi — I’m Blake. What is this lead for? Pick the job type and I’ll load the right playbook.",
    },
  ]);
  const [source, setSource] = useState<LeadSource>("Phone call");
  const [surveyor, setSurveyor] = useState(surveyors[0] || "Brian Kerr");
  const [surveyDate, setSurveyDate] = useState(tomorrowIso());
  const [surveyTime, setSurveyTime] = useState("09:30");
  const [bookSurvey, setBookSurvey] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [savedLead, setSavedLead] = useState<LeadApiResponse["lead"] | null>(null);
  const lookupGen = useRef(0);

  const playbook = playbooks[playbookId];
  const missingCount = fields.filter((field) => field.status !== "answered").length;
  const answeredCount = fields.filter((field) => field.status === "answered").length;
  const progress = Math.round((answeredCount / Math.max(fields.length, 1)) * 100);
  const currentQuestion = firstOpenField(fields);
  const questionNumber = Math.min(answeredCount + 1, fields.length);
  const askingAddress = phase === "questions" && currentQuestion?.id === "site_address";

  const siteAddress = fieldValue(fields, "site_address") || "Address to confirm";
  const description = useMemo(() => {
    const captured = fields
      .filter((field) => field.status === "answered" && field.answer)
      .map((field) => `${field.label}: ${field.answer}`)
      .join(" · ");
    return `${playbook.jobType}${captured ? ` | ${captured}` : ""}`.slice(0, 1800);
  }, [fields, playbook.jobType]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!askingAddress) return;
    const query = postcodeQuery.trim();
    if (query.length < 2) {
      setAddressMatches([]);
      return;
    }
    const gen = ++lookupGen.current;
    setAddressBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/postcode-lookup?q=${encodeURIComponent(query)}`, {
            headers: requestHeaders,
          });
          const body = (await response.json().catch(() => null)) as { matches?: AddressMatch[] } | null;
          if (gen !== lookupGen.current) return;
          setAddressMatches(Array.isArray(body?.matches) ? body!.matches! : []);
        } catch {
          if (gen === lookupGen.current) setAddressMatches([]);
        } finally {
          if (gen === lookupGen.current) setAddressBusy(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [askingAddress, postcodeQuery]);

  function showToast(message: string) {
    setToast(message);
  }

  function reset() {
    setPhase("jobType");
    setAnswerDraft("");
    setPostcodeQuery("");
    setAddressMatches([]);
    setPlaybookId("heating");
    setCustomerName("");
    setFields(cloneFields("heating"));
    setConversation([
      {
        role: "ai",
        text: "Hi — I’m Blake. What is this lead for? Pick the job type and I’ll load the right playbook.",
      },
    ]);
    setError("");
    setSavedLead(null);
    setBookSurvey(true);
    setSurveyDate(tomorrowIso());
    setSurveyTime("09:30");
  }

  function selectJobType(id: PlaybookId) {
    const option = leadJobTypeOptions.find((item) => item.id === id);
    const seeded = cloneFields(id);
    setPlaybookId(id);
    setFields(seeded);
    setCustomerName("");
    setPhase("thinking");
    setConversation((prev) => [
      ...prev,
      { role: "customer", text: option?.label || id },
      {
        role: "ai",
        text: `Got it — ${playbooks[id].jobType}. I’ve loaded the ${playbooks[id].name}. Lead stage only needs contact and site details; survey detail comes after the visit.`,
      },
    ]);

    window.setTimeout(() => {
      const next = firstOpenField(seeded);
      if (!next) {
        setPhase("book");
        return;
      }
      setPhase("questions");
      setConversation((prev) => [
        ...prev,
        { role: "ai", text: questionForField(next, "New customer") },
      ]);
      setAnswerDraft("");
      setPostcodeQuery("");
      setAddressMatches([]);
    }, 500);
  }

  function applyAnswer(updated: MandatoryField[], value: string) {
    setFields(updated);
    setAnswerDraft("");
    setPostcodeQuery("");
    setAddressMatches([]);
    setConversation((prev) => [...prev, { role: "customer", text: value }]);

    const customerField = updated.find((field) => field.id === "customer");
    if (customerField?.answer) setCustomerName(customerField.answer);

    const next = firstOpenField(updated);
    if (!next) {
      setPhase("book");
      setConversation((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Lead details are complete. Book the surveyor and I’ll save this into NeXa Core.",
        },
      ]);
      showToast("Lead details complete");
      return;
    }

    const name = customerField?.answer || customerName || "New customer";
    window.setTimeout(() => {
      setConversation((prev) => [...prev, { role: "ai", text: questionForField(next, name) }]);
    }, 220);
  }

  function submitAnswer(raw?: string) {
    const value = (raw ?? answerDraft).trim();
    const current = firstOpenField(fields);
    if (!current || !value || phase !== "questions") return;
    if (current.id === "site_address" && value.length < 5) return;

    const updated = fields.map((field) =>
      field.id === current.id ? { ...field, status: "answered" as const, answer: value } : field,
    );
    applyAnswer(updated, value);
  }

  function selectAddress(match: AddressMatch) {
    submitAnswer(match.address);
  }

  function useDemoAnswer() {
    const current = firstOpenField(fields);
    if (!current) return;
    const suggested = playbookAnswers[playbookId][current.id] || "Confirmed";
    if (current.id === "site_address") {
      submitAnswer(suggested);
      return;
    }
    submitAnswer(suggested);
  }

  function fillRemaining() {
    const answers = playbookAnswers[playbookId];
    const updated = fields.map((field) =>
      field.status === "answered"
        ? field
        : { ...field, status: "answered" as const, answer: answers[field.id] || "Confirmed" },
    );
    const name = updated.find((field) => field.id === "customer")?.answer || customerName;
    setCustomerName(name);
    setFields(updated);
    setPhase("book");
    setConversation((prev) => [
      ...prev,
      { role: "ai", text: "I’ve filled the remaining lead details. Book the surveyor when ready." },
    ]);
    showToast("Remaining lead details filled");
  }

  async function saveIntoNexa() {
    setError("");
    const name = fieldValue(fields, "customer") || customerName;
    const address = fieldValue(fields, "site_address");
    if (!name.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!address || address === "Address to confirm") {
      setError("Site address is required before saving.");
      return;
    }
    if (bookSurvey && (!surveyor || !surveyDate || !surveyTime)) {
      setError("Add surveyor, date and time, or turn off survey booking.");
      return;
    }

    setPhase("saving");
    const parts = splitSiteAddress(address);
    const payload = {
      source,
      customerName: name.trim(),
      address,
      description,
      phone: fieldValue(fields, "phone"),
      email: fieldValue(fields, "email"),
      createdBy: "Carol",
      status: bookSurvey ? "Survey booked" : "Needs scheduling",
      surveyor: bookSurvey ? surveyor : "",
      surveyDate: bookSurvey ? surveyDate : "",
      surveyTime: bookSurvey ? surveyTime : "",
      next: bookSurvey
        ? `Survey booked and notification sent to ${surveyor}.`
        : "Check diary and book survey appointment.",
      addressParts: {
        line1: parts.line1 || address,
        line2: "",
        town: "",
        county: "",
        postcode: parts.postcode,
      },
      mainContact: {
        id: "ai-intake-main",
        name: name.trim(),
        role: "Customer",
        phone: fieldValue(fields, "phone"),
        email: fieldValue(fields, "email"),
        notes: "Captured via Blake AI intake",
      },
    };

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as LeadApiResponse;
      if (!response.ok || !result.lead) {
        setPhase("book");
        setError(result.message || result.error || "Could not save the lead.");
        return;
      }

      try {
        await fetch("/api/surveys", {
          method: "POST",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            clientMutationId: `ai-intake-${result.lead.id}-${Date.now()}`,
            customerName: result.lead.customerName,
            siteAddress: address,
            customerId: result.lead.clientId,
            siteId: result.lead.siteId,
            customerRequirements: description,
            primaryContact: {
              name: name.trim(),
              phone: fieldValue(fields, "phone"),
              email: fieldValue(fields, "email"),
            },
            jobLink: { type: "Lead", id: result.lead.id, reference: result.lead.ref },
            surveyorName: bookSurvey ? surveyor : "",
            surveyDate: bookSurvey ? surveyDate : "",
            jobType: playbookId === "bathroom" ? "Bathroom" : "Heating",
          }),
        });
      } catch {
        // Lead saved; survey optional.
      }

      setSavedLead(result.lead);
      setPhase("done");
      showToast(`${result.lead.ref} saved — Blake handed it to Core`);
      window.setTimeout(() => {
        window.location.assign(`/?lead=${encodeURIComponent(result.lead!.id)}`);
      }, 900);
    } catch {
      setPhase("book");
      setError("NeXa could not be reached. Check you are signed in and try again.");
    }
  }

  return (
    <div className="ai-first-root">
      <div className="ai-first-shell">
        <header className="ai-first-topbar">
          <div className="ai-first-brand">
            <img src="/brand/nexa-command-mark.svg" alt="NeXa" />
            <div className="ai-first-brand-copy">
              <strong>NeXa</strong>
              <span>Blake AI intake · creates a real lead in Core</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="ai-first-principle">Blake · Human Approved</div>
            <a className="ai-btn-ghost" href="/" style={{ textDecoration: "none" }}>
              <ArrowLeft size={16} /> Command Center
            </a>
          </div>
        </header>

        <div className="ai-flow-strip" aria-label="NeXa operating flow">
          <span className="on">Lead</span>
          <span>Survey</span>
          <span>Quote</span>
          <span>Accept</span>
          <span>Job</span>
          <span>Schedule</span>
          <span>In progress</span>
          <span>Ready to invoice</span>
        </div>

        <main className="ai-first-stage">
          <section className="ai-first-panel">
            <p className="ai-first-eyebrow">Blake · Live NeXa intake</p>
            <div className="ai-header-row">
              <div>
                <h1 className="ai-first-title">
                  {phase === "jobType" || phase === "thinking"
                    ? "What is this lead for?"
                    : phase === "questions"
                      ? "Lead details"
                      : phase === "book" || phase === "saving"
                        ? "Book surveyor & save lead"
                        : "Lead saved"}
                </h1>
                <p className="ai-first-lede">
                  Blake starts with the job type, then only lead info — customer, site address, phone and email.
                  Survey detail (boiler, radiators, photos) comes after the site visit.
                </p>
              </div>
              <button className="ai-btn-ghost" type="button" onClick={reset}>
                Reset
              </button>
            </div>

            {(phase === "jobType" || phase === "thinking") && (
              <>
                <div className="ai-job-type-grid">
                  {leadJobTypeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="ai-job-type-card"
                      disabled={phase === "thinking"}
                      onClick={() => selectJobType(option.id)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="ai-prompt-actions" style={{ marginTop: 14 }}>
                  <label className="ai-chip" style={{ cursor: "pointer" }}>
                    Source
                    <select
                      value={source}
                      onChange={(event) => setSource(event.target.value as LeadSource)}
                      style={{ border: 0, background: "transparent", font: "inherit", fontWeight: 600 }}
                    >
                      {sources.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {phase === "thinking" && (
                  <div className="ai-thinking">
                    <div className="ai-thinking-dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                    Blake is loading the playbook…
                  </div>
                )}
              </>
            )}

            {(phase === "questions" || phase === "book" || phase === "saving" || phase === "done") && (
              <div className="ai-draft-card">
                <div className="ai-draft-grid">
                  <div className="ai-stat">
                    <label>Customer</label>
                    <strong>{fieldValue(fields, "customer") || customerName || "—"}</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Job type</label>
                    <strong>{playbook.jobType}</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Blake playbook</label>
                    <strong>{playbook.name}</strong>
                  </div>
                </div>

                <div className="ai-progress">
                  <div className="ai-progress-head">
                    <strong>
                      {answeredCount} of {fields.length} lead details
                    </strong>
                    <span className={`ai-badge ${missingCount ? "ai-badge-lock" : "ai-badge-ok"}`}>
                      {missingCount ? `${missingCount} remaining` : "Complete"}
                    </span>
                  </div>
                  <div className="ai-progress-track">
                    <div className="ai-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="ai-split">
                  <div className="ai-section">
                    <h3>Blake</h3>
                    <div className="ai-chat">
                      {conversation.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                          {message.text}
                        </div>
                      ))}
                    </div>

                    {phase === "questions" && currentQuestion && !askingAddress ? (
                      <div className="ai-question-box">
                        <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                          Question {questionNumber} of {fields.length} · {currentQuestion.label}
                        </p>
                        <h3 style={{ marginTop: 0 }}>
                          {questionForField(currentQuestion, customerName || "New customer")}
                        </h3>
                        <div className="ai-prompt-shell" style={{ marginTop: 10 }}>
                          <textarea
                            value={answerDraft}
                            onChange={(event) => setAnswerDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                submitAnswer();
                              }
                            }}
                            placeholder="Type the answer…"
                            style={{ minHeight: 72 }}
                          />
                          <div className="ai-prompt-actions">
                            <button className="ai-chip" type="button" onClick={useDemoAnswer}>
                              Use demo answer
                            </button>
                            <button
                              className="ai-btn ai-btn-primary"
                              type="button"
                              disabled={!answerDraft.trim()}
                              onClick={() => submitAnswer()}
                            >
                              <Send size={16} /> Submit answer
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {askingAddress ? (
                      <div className="ai-question-box">
                        <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                          Question {questionNumber} of {fields.length} · Site address
                        </p>
                        <h3 style={{ marginTop: 0 }}>
                          <MapPin size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
                          Site address
                        </h3>
                        <p className="ai-summary">
                          Enter the postcode and Blake will offer matching addresses to select.
                        </p>
                        <div className="ai-prompt-shell" style={{ marginTop: 10 }}>
                          <input
                            value={postcodeQuery}
                            onChange={(event) => setPostcodeQuery(event.target.value.toUpperCase())}
                            placeholder="e.g. AB10 1AA or HG2 7PL"
                            aria-label="Postcode lookup"
                            style={{
                              width: "100%",
                              border: 0,
                              background: "transparent",
                              font: "inherit",
                              fontSize: "1.15rem",
                              outline: "none",
                              padding: "4px 0 10px",
                            }}
                          />
                          {addressBusy ? (
                            <p className="ai-summary" style={{ margin: "0 0 8px" }}>
                              Blake is looking up addresses…
                            </p>
                          ) : null}
                          {addressMatches.length > 0 ? (
                            <div className="ai-address-matches">
                              {addressMatches.slice(0, 12).map((match) => (
                                <button
                                  key={`${match.postcode}-${match.address}`}
                                  type="button"
                                  className="ai-address-match"
                                  onClick={() => selectAddress(match)}
                                >
                                  {match.address}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className="ai-prompt-actions" style={{ marginTop: 10 }}>
                            <button className="ai-chip" type="button" onClick={useDemoAnswer}>
                              Use demo address
                            </button>
                            <button
                              className="ai-btn ai-btn-primary"
                              type="button"
                              disabled={postcodeQuery.trim().length < 5 && !answerDraft.trim()}
                              onClick={() => submitAnswer(answerDraft.trim() || postcodeQuery.trim())}
                            >
                              <Send size={16} /> Use typed address
                            </button>
                          </div>
                          <textarea
                            value={answerDraft}
                            onChange={(event) => setAnswerDraft(event.target.value)}
                            placeholder="Or type the full address manually…"
                            style={{ minHeight: 56, marginTop: 8 }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {(phase === "book" || phase === "saving") && (
                      <div className="ai-question-box" style={{ marginTop: 16 }}>
                        <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                          Survey booking
                        </p>
                        <h3 style={{ marginTop: 0 }}>
                          <CalendarDays size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
                          Schedule the surveyor
                        </h3>
                        <label className="ai-chip" style={{ marginTop: 10, display: "inline-flex" }}>
                          <input
                            type="checkbox"
                            checked={bookSurvey}
                            onChange={(event) => setBookSurvey(event.target.checked)}
                          />
                          Book survey now
                        </label>
                        {bookSurvey ? (
                          <div className="ai-draft-grid" style={{ marginTop: 12 }}>
                            <div className="ai-stat">
                              <label>Surveyor</label>
                              <select
                                value={surveyor}
                                onChange={(event) => setSurveyor(event.target.value)}
                                style={{
                                  width: "100%",
                                  border: 0,
                                  background: "transparent",
                                  font: "inherit",
                                  fontWeight: 700,
                                }}
                              >
                                {surveyors.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="ai-stat">
                              <label>Date</label>
                              <input
                                type="date"
                                value={surveyDate}
                                onChange={(event) => setSurveyDate(event.target.value)}
                                style={{
                                  width: "100%",
                                  border: 0,
                                  background: "transparent",
                                  font: "inherit",
                                  fontWeight: 700,
                                }}
                              />
                            </div>
                            <div className="ai-stat">
                              <label>Time</label>
                              <input
                                type="time"
                                value={surveyTime}
                                onChange={(event) => setSurveyTime(event.target.value)}
                                style={{
                                  width: "100%",
                                  border: 0,
                                  background: "transparent",
                                  font: "inherit",
                                  fontWeight: 700,
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="ai-summary" style={{ marginTop: 10 }}>
                            Lead will save as <strong>Needs scheduling</strong>.
                          </p>
                        )}
                        {error ? <p className="ai-lock-note" style={{ marginTop: 12 }}>{error}</p> : null}
                        <div className="ai-action-row" style={{ marginTop: 14 }}>
                          <button
                            className="ai-btn ai-btn-primary"
                            type="button"
                            disabled={phase === "saving"}
                            onClick={() => void saveIntoNexa()}
                          >
                            <Check size={16} /> {phase === "saving" ? "Saving…" : "Save lead into NeXa"}
                          </button>
                          <a className="ai-btn-ghost" href="/?view=lead-create" style={{ textDecoration: "none" }}>
                            Use classic form instead
                          </a>
                        </div>
                      </div>
                    )}

                    {phase === "done" && savedLead ? (
                      <div className="ai-lock-note ready" style={{ marginTop: 14 }}>
                        {savedLead.ref} saved. Opening lead in Command Center…
                      </div>
                    ) : null}
                  </div>

                  <div className="ai-section">
                    <h3>
                      Captured so far
                      <span className="ai-badge ai-badge-draft">{answeredCount}</span>
                    </h3>
                    <ul className="ai-missing-list" style={{ gridTemplateColumns: "1fr" }}>
                      {fields.map((field) => (
                        <li
                          key={field.id}
                          className={
                            field.status === "answered"
                              ? "answered"
                              : currentQuestion?.id === field.id
                                ? "current"
                                : undefined
                          }
                        >
                          <span className="mark">{field.status === "answered" ? "✓" : ""}</span>
                          <span>
                            {field.label}
                            {field.answer ? <span className="answer">{field.answer}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {phase === "questions" && missingCount > 0 ? (
                      <button className="ai-btn" type="button" style={{ marginTop: 12 }} onClick={fillRemaining}>
                        <Sparkles size={16} /> Fill remaining (demo)
                      </button>
                    ) : null}
                    <p className="ai-summary" style={{ marginTop: 14 }}>
                      Survey questions (boiler, cylinder, radiators, photos, etc.) stay for the site visit — not
                      lead stage.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
      {toast ? <div className="ai-toast">{toast}</div> : null}
    </div>
  );
}
