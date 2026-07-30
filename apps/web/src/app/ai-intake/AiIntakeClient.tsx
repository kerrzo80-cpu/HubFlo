"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ClipboardList,
  Send,
  Sparkles,
} from "lucide-react";
import {
  EXAMPLE_PROMPT,
  applyKnownFromPrompt,
  detectPlaybook,
  extractCustomerName,
  firstOpenField,
  playbookAnswers,
  playbooks,
  questionForField,
  type MandatoryField,
  type PlaybookId,
} from "../ai-first/data";
import "../ai-first/ai-first.css";

type LeadSource = "Phone call" | "Checkatrade" | "Email" | "Website" | "Referral";
type Phase = "need" | "thinking" | "questions" | "book" | "saving" | "done";

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

export function AiIntakeClient() {
  const [phase, setPhase] = useState<Phase>("need");
  const [prompt, setPrompt] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [playbookId, setPlaybookId] = useState<PlaybookId>("heating");
  const [customerName, setCustomerName] = useState("");
  const [fields, setFields] = useState<MandatoryField[]>(() => cloneFields("heating"));
  const [conversation, setConversation] = useState<Array<{ role: "customer" | "ai"; text: string }>>([]);
  const [source, setSource] = useState<LeadSource>("Phone call");
  const [surveyor, setSurveyor] = useState(surveyors[0] || "Brian Kerr");
  const [surveyDate, setSurveyDate] = useState(tomorrowIso());
  const [surveyTime, setSurveyTime] = useState("09:30");
  const [bookSurvey, setBookSurvey] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [savedLead, setSavedLead] = useState<LeadApiResponse["lead"] | null>(null);

  const playbook = playbooks[playbookId];
  const missingCount = fields.filter((field) => field.status !== "answered").length;
  const answeredCount = fields.filter((field) => field.status === "answered").length;
  const progress = Math.round((answeredCount / Math.max(fields.length, 1)) * 100);
  const currentQuestion = firstOpenField(fields);
  const questionNumber = Math.min(answeredCount + 1, fields.length);

  const address = useMemo(() => {
    const full = fieldValue(fields, "address");
    const postcode = fieldValue(fields, "postcode");
    if (full && postcode && !full.toLowerCase().includes(postcode.toLowerCase())) {
      return `${full}, ${postcode}`;
    }
    return full || postcode || "Address to confirm";
  }, [fields]);

  const description = useMemo(() => {
    const captured = fields
      .filter((field) => field.status === "answered" && field.answer)
      .map((field) => `${field.label}: ${field.answer}`)
      .join(" · ");
    return `${playbook.jobType}. ${prompt.trim()}${captured ? ` | ${captured}` : ""}`.slice(0, 1800);
  }, [fields, playbook.jobType, prompt]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(message: string) {
    setToast(message);
  }

  function reset() {
    setPhase("need");
    setPrompt("");
    setAnswerDraft("");
    setPlaybookId("heating");
    setCustomerName("");
    setFields(cloneFields("heating"));
    setConversation([]);
    setError("");
    setSavedLead(null);
    setBookSurvey(true);
    setSurveyDate(tomorrowIso());
    setSurveyTime("09:30");
  }

  function startIntake(text: string) {
    const value = text.trim();
    if (!value) return;
    const detected = detectPlaybook(value);
    const name = extractCustomerName(value);
    const seeded = applyKnownFromPrompt(cloneFields(detected), value, detected);
    const known = seeded.filter((field) => field.status === "answered").map((field) => field.label);

    setPrompt(value);
    setPlaybookId(detected);
    setCustomerName(name);
    setFields(seeded);
    setPhase("thinking");
    setError("");
    setConversation([
      { role: "customer", text: value },
      {
        role: "ai",
        text: known.length
          ? `Draft lead for ${name} · ${playbooks[detected].jobType}. Loaded ${playbooks[detected].name}. Already captured: ${known.join(", ")}. I’ll ask the remaining mandatory questions.`
          : `Draft lead for ${name} · ${playbooks[detected].jobType}. Loaded ${playbooks[detected].name}. I’ll ask the mandatory questions now.`,
      },
    ]);

    window.setTimeout(() => {
      const next = firstOpenField(seeded);
      if (!next) {
        setPhase("book");
        setConversation((prev) => [
          ...prev,
          { role: "ai", text: "All mandatory details are in. Book the surveyor when ready, then save into NeXa." },
        ]);
        return;
      }
      setPhase("questions");
      setConversation((prev) => [...prev, { role: "ai", text: questionForField(next, name) }]);
      setAnswerDraft("");
    }, 650);
  }

  function submitAnswer(raw?: string) {
    const value = (raw ?? answerDraft).trim();
    const current = firstOpenField(fields);
    if (!current || !value || phase !== "questions") return;

    const updated = fields.map((field) =>
      field.id === current.id ? { ...field, status: "answered" as const, answer: value } : field,
    );
    setFields(updated);
    setAnswerDraft("");
    setConversation((prev) => [...prev, { role: "customer", text: value }]);

    const next = firstOpenField(updated);
    if (!next) {
      setPhase("book");
      setConversation((prev) => [
        ...prev,
        {
          role: "ai",
          text: `That’s everything mandatory from the ${playbook.name}. Book the surveyor, then I’ll save this lead into NeXa.`,
        },
      ]);
      showToast("Mandatory questions complete");
      return;
    }

    window.setTimeout(() => {
      setConversation((prev) => [...prev, { role: "ai", text: questionForField(next, customerName) }]);
    }, 220);
  }

  function useDemoAnswer() {
    const current = firstOpenField(fields);
    if (!current) return;
    const suggested = playbookAnswers[playbookId][current.id] || "Confirmed";
    submitAnswer(suggested);
  }

  function fillRemaining() {
    const answers = playbookAnswers[playbookId];
    const updated = fields.map((field) =>
      field.status === "answered"
        ? field
        : { ...field, status: "answered" as const, answer: answers[field.id] || "Confirmed" },
    );
    setFields(updated);
    setPhase("book");
    setConversation((prev) => [
      ...prev,
      { role: "ai", text: `Remaining mandatory answers filled. Book the surveyor, then save into NeXa.` },
    ]);
    showToast("Remaining answers filled");
  }

  async function saveIntoNexa() {
    setError("");
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!address || address === "Address to confirm") {
      setError("Full address is required before saving.");
      return;
    }
    if (bookSurvey && (!surveyor || !surveyDate || !surveyTime)) {
      setError("Add surveyor, date and time, or turn off survey booking.");
      return;
    }

    setPhase("saving");
    const payload = {
      source,
      customerName: customerName.trim(),
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
        line1: fieldValue(fields, "address") || address,
        line2: "",
        town: "",
        county: "",
        postcode: fieldValue(fields, "postcode"),
      },
      mainContact: {
        id: "ai-intake-main",
        name: customerName.trim(),
        role: "Customer",
        phone: fieldValue(fields, "phone"),
        email: fieldValue(fields, "email"),
        notes: "Captured via AI intake",
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

      // Best-effort linked survey workspace for the surveyor.
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
              name: customerName.trim(),
              phone: fieldValue(fields, "phone"),
              email: fieldValue(fields, "email"),
            },
            jobLink: { type: "Lead", id: result.lead.id, reference: result.lead.ref },
            surveyorName: bookSurvey ? surveyor : undefined,
            surveyDate: bookSurvey ? surveyDate : undefined,
            notes: fields
              .filter((field) => field.status === "answered")
              .map((field) => `${field.label}: ${field.answer}`)
              .join("\n"),
          }),
        });
      } catch {
        // Lead is saved; survey workspace is optional.
      }

      setSavedLead(result.lead);
      setPhase("done");
      showToast(`${result.lead.ref} saved into NeXa`);
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
              <span>AI intake · creates a real lead in Core</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="ai-first-principle">AI First · Human Approved</div>
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
            <p className="ai-first-eyebrow">AI Intake · Live NeXa</p>
            <div className="ai-header-row">
              <div>
                <h1 className="ai-first-title">
                  {phase === "need" || phase === "thinking"
                    ? "Tell NeXa what the customer needs…"
                    : phase === "questions"
                      ? "Mandatory playbook questions"
                      : phase === "book" || phase === "saving"
                        ? "Book surveyor & save lead"
                        : "Lead saved"}
                </h1>
                <p className="ai-first-lede">
                  Carol’s path: create the lead here, book the survey, then continue in Core — convert to quote,
                  build with AI, send, wait for online accept, schedule the job, complete, then ready to invoice.
                </p>
              </div>
              <button className="ai-btn-ghost" type="button" onClick={reset}>
                Reset
              </button>
            </div>

            {(phase === "need" || phase === "thinking") && (
              <>
                <div className={`ai-prompt-shell${phase === "thinking" ? " listening" : ""}`}>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={EXAMPLE_PROMPT}
                    aria-label="Customer need"
                  />
                  <div className="ai-prompt-actions">
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
                    <button
                      className="ai-btn ai-btn-primary"
                      type="button"
                      disabled={!prompt.trim() || phase === "thinking"}
                      onClick={() => startIntake(prompt)}
                    >
                      <Sparkles size={16} /> Start AI intake
                    </button>
                  </div>
                </div>
                <div className="ai-example-row">
                  <span style={{ color: "var(--steel)", fontSize: "0.9rem" }}>Try:</span>
                  <button type="button" onClick={() => startIntake(EXAMPLE_PROMPT)}>
                    Heating · Mrs Smith
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      startIntake(
                        "Mr Patel on Oak Road needs a full bathroom refurbishment with new suite and tiling.",
                      )
                    }
                  >
                    Bathroom · Mr Patel
                  </button>
                </div>
                {phase === "thinking" && (
                  <div className="ai-thinking">
                    <div className="ai-thinking-dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                    Creating draft lead · loading playbook…
                  </div>
                )}
              </>
            )}

            {(phase === "questions" || phase === "book" || phase === "saving" || phase === "done") && (
              <div className="ai-draft-card">
                <div className="ai-draft-grid">
                  <div className="ai-stat">
                    <label>Customer</label>
                    <strong>{customerName}</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Job type</label>
                    <strong>{playbook.jobType}</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Playbook</label>
                    <strong>{playbook.name}</strong>
                  </div>
                </div>

                <div className="ai-progress">
                  <div className="ai-progress-head">
                    <strong>
                      {answeredCount} of {fields.length} mandatory
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
                    <h3>Conversation</h3>
                    <div className="ai-chat">
                      {conversation.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                          {message.text}
                        </div>
                      ))}
                    </div>

                    {phase === "questions" && currentQuestion ? (
                      <div className="ai-question-box">
                        <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                          Question {questionNumber} of {fields.length} · {currentQuestion.label}
                        </p>
                        <h3 style={{ marginTop: 0 }}>{questionForField(currentQuestion, customerName)}</h3>
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
                                style={{ width: "100%", border: 0, background: "transparent", font: "inherit", fontWeight: 700 }}
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
                                style={{ width: "100%", border: 0, background: "transparent", font: "inherit", fontWeight: 700 }}
                              />
                            </div>
                            <div className="ai-stat">
                              <label>Time</label>
                              <input
                                type="time"
                                value={surveyTime}
                                onChange={(event) => setSurveyTime(event.target.value)}
                                style={{ width: "100%", border: 0, background: "transparent", font: "inherit", fontWeight: 700 }}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="ai-summary" style={{ marginTop: 10 }}>
                            Lead will save as <strong>Needs scheduling</strong>. Book later from the lead record.
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
                        <ClipboardList size={16} /> Fill remaining (demo)
                      </button>
                    ) : null}
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
