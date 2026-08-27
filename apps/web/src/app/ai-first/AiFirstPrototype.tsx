"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Archive,
  Camera,
  Check,
  ClipboardList,
  FileText,
  ImagePlus,
  Mail,
  Mic,
  Send,
  Sparkles,
  ThumbsDown,
  Upload,
} from "lucide-react";
import {
  EXAMPLE_PROMPT,
  applyKnownFromPrompt,
  commercialSummary,
  conversationSeed,
  detectPlaybook,
  extractCustomerName,
  firstOpenField,
  formatMoney,
  healthAlertsSeed,
  jobTasks,
  navScreens,
  playbookAnswers,
  playbooks,
  questionForField,
  quoteSections,
  scheduleSuggestion,
  type AuditEvent,
  type HealthAlert,
  type InvoiceGate,
  type MandatoryField,
  type PlaybookId,
  type ScreenId,
} from "./data";
import "./ai-first.css";

type LeadStatus = "none" | "thinking" | "draft" | "enriching" | "ready";
type QuoteStatus = "locked" | "draft" | "approved" | "sent" | "accepted";
type JobStatus = "none" | "active" | "complete";
type ScheduleStatus = "none" | "suggested" | "approved";
type InvoiceStatus = "locked" | "prepared" | "approved" | "sent";

function nextTime(baseHour: number, baseMinute: number, offset: number): string {
  const total = baseHour * 60 + baseMinute + offset;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function cloneFields(playbookId: PlaybookId): MandatoryField[] {
  return playbooks[playbookId].fields.map((field) => ({ ...field }));
}

export function AiFirstPrototype() {
  const [screen, setScreen] = useState<ScreenId>("intake");
  const [prompt, setPrompt] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("none");
  const [playbookId, setPlaybookId] = useState<PlaybookId>("heating");
  const [customerName, setCustomerName] = useState("Mrs Smith");
  const [fields, setFields] = useState<MandatoryField[]>(() => cloneFields("heating"));
  const [conversation, setConversation] = useState(conversationSeed);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("locked");
  const [jobStatus, setJobStatus] = useState<JobStatus>("none");
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus>("none");
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>("locked");
  const [tasks, setTasks] = useState(jobTasks);
  const [alerts, setAlerts] = useState<HealthAlert[]>(healthAlertsSeed);
  const [toast, setToast] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [photosAttached, setPhotosAttached] = useState(false);
  const [invoiceGates, setInvoiceGates] = useState<InvoiceGate[]>([
    { id: "complete", label: "Job complete", ready: false },
    { id: "photos", label: "Required photos uploaded", ready: false },
    { id: "checklists", label: "Checklists complete", ready: false },
    { id: "variations", label: "Variations priced", ready: true },
    { id: "hours", label: "Engineer hours approved", ready: false },
    { id: "materials", label: "Materials confirmed", ready: false },
  ]);

  const fileRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const clock = useRef({ hour: 9, minute: 12, tick: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playbook = playbooks[playbookId];
  const missingCount = fields.filter((field) => field.status !== "answered").length;
  const answeredCount = fields.filter((field) => field.status === "answered").length;
  const progress = Math.round((answeredCount / Math.max(fields.length, 1)) * 100);
  const quoteReady = missingCount === 0 && leadStatus === "ready";
  const currentQuestion = firstOpenField(fields);
  const questionNumber = answeredCount + 1;
  const gatesReady = invoiceGates.every((gate) => gate.ready);

  const unlockedScreens = useMemo(() => {
    const set = new Set<ScreenId>(["intake", "audit"]);
    if (leadStatus !== "none" && leadStatus !== "thinking") {
      set.add("lead");
    }
    if (quoteStatus !== "locked" || quoteReady) {
      set.add("quote");
    }
    if (jobStatus !== "none") {
      set.add("job");
      set.add("scheduler");
    }
    if (scheduleStatus === "approved" || jobStatus === "complete" || invoiceStatus !== "locked") {
      set.add("invoice");
    }
    return set;
  }, [leadStatus, quoteStatus, quoteReady, jobStatus, scheduleStatus, invoiceStatus]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  function pushAudit(actor: AuditEvent["actor"], action: string, detail?: string) {
    clock.current.tick += 1;
    const time = nextTime(clock.current.hour, clock.current.minute, clock.current.tick);
    setAudit((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}-${prev.length}`,
        time,
        actor,
        action,
        detail,
      },
    ]);
  }

  function resetFlow() {
    setScreen("intake");
    setPrompt("");
    setAnswerDraft("");
    setListening(false);
    setLeadStatus("none");
    setPlaybookId("heating");
    setCustomerName("Mrs Smith");
    setFields(cloneFields("heating"));
    setConversation(conversationSeed);
    setQuoteStatus("locked");
    setJobStatus("none");
    setScheduleStatus("none");
    setInvoiceStatus("locked");
    setTasks(jobTasks);
    setAlerts(healthAlertsSeed);
    setAudit([]);
    setPhotosAttached(false);
    setInvoiceGates([
      { id: "complete", label: "Job complete", ready: false },
      { id: "photos", label: "Required photos uploaded", ready: false },
      { id: "checklists", label: "Checklists complete", ready: false },
      { id: "variations", label: "Variations priced", ready: true },
      { id: "hours", label: "Engineer hours approved", ready: false },
      { id: "materials", label: "Materials confirmed", ready: false },
    ]);
    clock.current = { hour: 9, minute: 12, tick: 0 };
  }

  function askNextQuestion(
    nextFields: MandatoryField[],
    name: string,
    bookName: string,
    priorMessages?: Array<{ role: "customer" | "ai"; text: string }>,
  ) {
    const next = firstOpenField(nextFields);
    if (!next) {
      setLeadStatus("ready");
      setPhotosAttached(true);
      setQuoteStatus("draft");
      setConversation((prev) => [
        ...(priorMessages || prev),
        {
          role: "ai",
          text: `That’s everything mandatory from the ${bookName}. I’m building the quote now.`,
        },
      ]);
      pushAudit("AI", "AI completed mandatory questions", `${nextFields.length} fields from playbook`);
      pushAudit("AI", "AI generated Quote", `AI Draft · ${playbooks[playbookId].jobType}`);
      showToast("Mandatory information complete — quote drafted");
      window.setTimeout(() => setScreen("quote"), 700);
      return;
    }

    const question = questionForField(next, name);
    setConversation((prev) => [
      ...(priorMessages || prev),
      {
        role: "ai",
        text: question,
      },
    ]);
    setAnswerDraft("");
    pushAudit("AI", "AI asked mandatory question", next.label);
  }

  function runIntake(sourceText: string) {
    const text = sourceText.trim();
    if (!text) return;

    const detected = detectPlaybook(text);
    const name = extractCustomerName(text);
    const seeded = applyKnownFromPrompt(cloneFields(detected), text, detected);
    const knownLabels = seeded
      .filter((field) => field.status === "answered")
      .map((field) => field.label);

    setPrompt(text);
    setAnswerDraft("");
    setPlaybookId(detected);
    setCustomerName(name);
    setFields(seeded);
    setLeadStatus("thinking");
    setQuoteStatus("locked");
    setJobStatus("none");
    setScheduleStatus("none");
    setInvoiceStatus("locked");
    setPhotosAttached(false);

    const opener = [
      { role: "customer" as const, text },
      {
        role: "ai" as const,
        text: knownLabels.length
          ? `Understood. Draft lead created for ${name} · ${playbooks[detected].jobType}. I’ve loaded the ${playbooks[detected].name} and already captured: ${knownLabels.join(", ")}. I’ll ask only the remaining mandatory questions.`
          : `Understood. Draft lead created for ${name} · ${playbooks[detected].jobType}. I’ve loaded the ${playbooks[detected].name} — I’ll ask the mandatory questions now, one at a time.`,
      },
    ];
    setConversation(opener);

    window.setTimeout(() => {
      setLeadStatus("draft");
      pushAudit("AI", "AI created Lead", `${name} · Draft`);
      pushAudit("AI", `AI loaded ${playbooks[detected].name}`, playbooks[detected].jobType);
      showToast("Playbook loaded — asking mandatory questions");
      askNextQuestion(seeded, name, playbooks[detected].name, opener);
    }, 700);
  }

  function handleVoice() {
    setListening(true);
    showToast("Listening… (prototype simulates voice capture)");
    window.setTimeout(() => {
      setListening(false);
      setPrompt(EXAMPLE_PROMPT);
      runIntake(EXAMPLE_PROMPT);
    }, 1100);
  }

  function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotosAttached(true);
    pushAudit("Brian", "Photo uploaded", file.name);
    showToast(`Photo attached: ${file.name}`);
    if (leadStatus === "draft" || leadStatus === "ready") {
      setFields((prev) =>
        prev.map((field) =>
          field.id === "photos"
            ? { ...field, status: "answered", answer: file.name }
            : field,
        ),
      );
    }
    event.target.value = "";
  }

  function handleEmailUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const inferred =
      file.name.toLowerCase().includes("bathroom")
        ? "Please quote for a full bathroom refurbishment for Mr Patel at Oak Road."
        : EXAMPLE_PROMPT;
    pushAudit("Brian", "Email uploaded", file.name);
    showToast(`Email imported: ${file.name}`);
    runIntake(inferred);
    event.target.value = "";
  }

  function askCustomer() {
    const current = firstOpenField(fields);
    const labels = current
      ? current.label
      : fields
          .filter((field) => field.status !== "answered")
          .slice(0, 4)
          .map((field) => field.label)
          .join(", ");
    setConversation((prev) => [
      ...prev,
      {
        role: "ai",
        text: current
          ? `I’ve messaged the customer: “${questionForField(current, customerName)}”`
          : `I’ve messaged the customer for: ${labels || "remaining details"}.`,
      },
    ]);
    pushAudit("AI", "AI asked customer for missing info", labels || "remaining details");
    showToast("Customer request sent (simulated)");
  }

  function requestPhotos() {
    setConversation((prev) => [
      ...prev,
      {
        role: "ai",
        text: "Photo request sent — boiler plate, flue, cylinder cupboard, and radiator locations.",
      },
    ]);
    pushAudit("AI", "AI requested photos", "Boiler, flue, cupboard, radiators");
    showToast("Photo request sent to customer");
  }

  function bookSurvey() {
    pushAudit("Brian", "Survey booking requested", "AI drafted survey brief");
    showToast("Survey brief ready — schedule from Scheduler when converted");
    setScreen("lead");
  }

  function submitAnswer(raw?: string) {
    const value = (raw ?? answerDraft).trim();
    const current = firstOpenField(fields);
    if (!current || !value || leadStatus === "enriching") return;

    const updated = fields.map((field) =>
      field.id === current.id ? { ...field, status: "answered" as const, answer: value } : field,
    );
    setFields(updated);
    setAnswerDraft("");
    if (current.id === "photos") setPhotosAttached(true);

    const withReply = [
      ...conversation,
      { role: "customer" as const, text: value },
    ];
    setConversation(withReply);
    pushAudit("Brian", "Answered mandatory question", `${current.label}: ${value}`);

    const next = firstOpenField(updated);
    if (!next) {
      setLeadStatus("ready");
      setPhotosAttached(true);
      setQuoteStatus("draft");
      setConversation([
        ...withReply,
        {
          role: "ai",
          text: `That’s everything mandatory from the ${playbook.name}. I’m building the quote now.`,
        },
      ]);
      pushAudit("AI", "AI completed mandatory questions", `${updated.length} fields from playbook`);
      pushAudit("AI", "AI generated Quote", `AI Draft · ${playbook.jobType}`);
      showToast("Mandatory information complete — quote drafted");
      window.setTimeout(() => setScreen("quote"), 700);
      return;
    }

    window.setTimeout(() => {
      const question = questionForField(next, customerName);
      setConversation((prev) => [...prev, { role: "ai", text: question }]);
      pushAudit("AI", "AI asked mandatory question", next.label);
    }, 280);
  }

  function useSuggestedAnswer() {
    const current = firstOpenField(fields);
    if (!current) return;
    const suggested = playbookAnswers[playbookId][current.id] || "Confirmed";
    setAnswerDraft(suggested);
    submitAnswer(suggested);
  }

  function completeMissingInfo() {
    setLeadStatus("enriching");
    showToast("Filling remaining mandatory answers…");

    const answers = playbookAnswers[playbookId];
    const target = fields.map((field) =>
      field.status === "answered"
        ? field
        : {
            ...field,
            status: "answered" as const,
            answer: answers[field.id] || field.answer || "Confirmed",
          },
    );

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setFields((prev) =>
        prev.map((field, fieldIndex) => {
          const next = target[fieldIndex];
          return fieldIndex < index && next ? next : field;
        }),
      );
      if (index >= target.length) {
        window.clearInterval(interval);
        setFields(target);
        setLeadStatus("ready");
        setPhotosAttached(true);
        setConversation((prev) => [
          ...prev,
          {
            role: "ai",
            text: `All mandatory ${playbook.name} questions are complete. I’m building the quote now.`,
          },
        ]);
        pushAudit("AI", "AI completed mandatory questions", `${target.length} fields from playbook`);
        pushAudit("AI", "AI generated Quote", `AI Draft · ${playbook.jobType}`);
        setQuoteStatus("draft");
        showToast("Mandatory information complete — quote drafted");
        window.setTimeout(() => setScreen("quote"), 700);
      }
    }, 70);
  }

  function continueFromIntake() {
    if (leadStatus === "draft" && missingCount > 0) {
      showToast("Answer the mandatory playbook questions first");
      return;
    }
    if (quoteReady || leadStatus === "ready") {
      setScreen("quote");
    }
  }

  function approveQuote() {
    setQuoteStatus("approved");
    pushAudit("Brian", "Brian approved Quote", formatMoney(commercialSummary.gross));
    showToast("Quote approved — ready to send");
  }

  function sendQuote() {
    if (quoteStatus !== "approved") {
      showToast("Quote cannot be sent until approved");
      return;
    }
    setQuoteStatus("sent");
    pushAudit("Brian", "Brian sent Quote", "Awaiting customer decision");
    showToast("Quote sent to Mrs Smith");
  }

  function acceptQuote() {
    setQuoteStatus("accepted");
    pushAudit("Customer", "Customer accepted Quote", formatMoney(commercialSummary.gross));
    showToast("Customer accepted — convert to job when ready");
  }

  function convertToJob() {
    setJobStatus("active");
    setScheduleStatus("suggested");
    pushAudit("AI", "AI converted to Job", "JOB-2418 · Heating System Renewal");
    pushAudit("AI", "AI suggested schedule", `${scheduleSuggestion.engineer} · ${scheduleSuggestion.slot}`);
    showToast("Job created — AI watching project health");
    setScreen("job");
  }

  function approveSchedule() {
    setScheduleStatus("approved");
    pushAudit("Brian", "Brian approved Schedule", `${scheduleSuggestion.engineer} · ${scheduleSuggestion.slot}`);
    showToast("Schedule approved — engineer allocated");
  }

  function markJobComplete() {
    setJobStatus("complete");
    setTasks((prev) => prev.map((task) => ({ ...task, done: true })));
    setAlerts((prev) =>
      prev.filter((alert) => alert.id !== "h1").concat({
        id: "h4",
        severity: "info",
        title: "Job complete",
        detail: "All install tasks finished. Invoice gates can now be cleared.",
      }),
    );
    setInvoiceGates([
      { id: "complete", label: "Job complete", ready: true },
      { id: "photos", label: "Required photos uploaded", ready: true },
      { id: "checklists", label: "Checklists complete", ready: true },
      { id: "variations", label: "Variations priced", ready: true },
      { id: "hours", label: "Engineer hours approved", ready: true },
      { id: "materials", label: "Materials confirmed", ready: true },
    ]);
    setInvoiceStatus("prepared");
    pushAudit("Brian", "Brian marked Job complete", "All checklists passed");
    pushAudit("AI", "AI prepared Invoice", "Locked until approval");
    showToast("Job complete — invoice prepared by AI");
    setScreen("invoice");
  }

  function approveInvoice() {
    if (!gatesReady) {
      showToast("Invoice remains locked until all checks pass");
      return;
    }
    setInvoiceStatus("approved");
    pushAudit("Brian", "Brian approved Invoice", formatMoney(commercialSummary.gross));
    showToast("Invoice approved — ready to send");
  }

  function sendInvoice() {
    if (invoiceStatus !== "approved") {
      showToast("Approve the invoice before sending");
      return;
    }
    setInvoiceStatus("sent");
    pushAudit("Brian", "Brian sent Invoice", "INV-2418 issued");
    showToast("Invoice sent");
  }

  function goTo(next: ScreenId) {
    if (!unlockedScreens.has(next)) {
      showToast("Complete the previous step to unlock this screen");
      return;
    }
    if (next === "quote" && quoteStatus === "locked" && quoteReady) {
      setQuoteStatus("draft");
    }
    if (next === "scheduler" && scheduleStatus === "none" && jobStatus !== "none") {
      setScheduleStatus("suggested");
    }
    setScreen(next);
  }

  return (
    <div className="ai-first-root">
      <div className="ai-first-shell">
        <header className="ai-first-topbar">
          <div className="ai-first-brand">
            <img src="/brand/blake-mark.svg" alt="blake." />
            <div className="ai-first-brand-copy">
              <strong>Ayla</strong>
              <span>AI-first operating system · clickable prototype</span>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <a
              className="ai-first-principle"
              href="https://nexa-pilot.onrender.com/ai-first"
              style={{ textDecoration: "none" }}
            >
              AI First · Human Approved
            </a>
            <a className="ai-btn-ghost" href="/" style={{ textDecoration: "none" }}>
              Back to Command Center
            </a>
          </div>
        </header>

        <nav className="ai-first-rail" aria-label="Prototype screens">
          {navScreens.map((item) => (
            <button
              key={item.id}
              type="button"
              className={screen === item.id ? "active" : undefined}
              disabled={!unlockedScreens.has(item.id)}
              onClick={() => goTo(item.id)}
            >
              <span className="step">{item.step}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="ai-first-stage">
          {screen === "intake" && (
            <section className="ai-first-panel" key="intake">
              <p className="ai-first-eyebrow">Screen 1 · AI Intake</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">
                    {leadStatus === "draft" || leadStatus === "enriching"
                      ? "Mandatory playbook questions"
                      : leadStatus === "ready"
                        ? "Intake complete"
                        : "Tell Ayla what the customer needs…"}
                  </h1>
                  <p className="ai-first-lede">
                    {leadStatus === "draft" || leadStatus === "enriching"
                      ? `Ayla loaded the ${playbook.name}. Answer each mandatory question here — nothing invented, nothing skipped.`
                      : "No forms. Speak, type, attach a photo, or drop in an email — Ayla creates the lead, loads the playbook, and asks only the mandatory questions."}
                  </p>
                </div>
                <button className="ai-btn-ghost" type="button" onClick={resetFlow}>
                  Reset demo
                </button>
              </div>

              <div className="ai-intake-hero">
                {leadStatus === "none" || leadStatus === "thinking" ? (
                  <>
                    <div className={`ai-prompt-shell${listening ? " listening" : ""}`}>
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="Mrs Smith from Hillside Avenue wants a complete heating system replacement."
                        aria-label="Customer need"
                      />
                      <div className="ai-prompt-actions">
                        <button
                          className={`ai-chip${listening ? " active" : ""}`}
                          type="button"
                          onClick={handleVoice}
                        >
                          <Mic size={16} /> Voice
                        </button>
                        <button className="ai-chip" type="button" onClick={() => fileRef.current?.click()}>
                          <Camera size={16} /> Photo
                        </button>
                        <button className="ai-chip" type="button" onClick={() => emailRef.current?.click()}>
                          <Mail size={16} /> Email
                        </button>
                        <button
                          className="ai-btn ai-btn-primary"
                          type="button"
                          disabled={!prompt.trim() || leadStatus === "thinking"}
                          onClick={() => runIntake(prompt)}
                        >
                          <Sparkles size={16} /> Let Ayla handle it
                        </button>
                      </div>
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
                      <input
                        ref={emailRef}
                        type="file"
                        accept=".eml,.txt,.msg,message/rfc822,text/plain"
                        hidden
                        onChange={handleEmailUpload}
                      />
                    </div>

                    <div className="ai-example-row">
                      <span style={{ color: "var(--steel)", fontSize: "0.9rem" }}>Try an example:</span>
                      <button type="button" onClick={() => runIntake(EXAMPLE_PROMPT)}>
                        Heating system for Mrs Smith
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runIntake(
                            "Mr Patel on Oak Road needs a full bathroom refurbishment with new suite and tiling.",
                          )
                        }
                      >
                        Bathroom for Mr Patel
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runIntake("Please replace three radiators at 22 Mill Lane for the Thompson family.")
                        }
                      >
                        Radiators at Mill Lane
                      </button>
                    </div>

                    {leadStatus === "thinking" && (
                      <div className="ai-thinking">
                        <div className="ai-thinking-dots" aria-hidden>
                          <span />
                          <span />
                          <span />
                        </div>
                        Creating draft lead · detecting job type · loading playbook…
                      </div>
                    )}
                  </>
                ) : null}

                {(leadStatus === "draft" || leadStatus === "ready" || leadStatus === "enriching") && (
                  <div className="ai-draft-card">
                    <div className="ai-header-row">
                      <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>
                        Draft Lead
                      </h2>
                      <span className="ai-badge ai-badge-ai">
                        <Sparkles size={12} /> AI Draft
                      </span>
                    </div>

                    <div className="ai-draft-grid">
                      <div className="ai-stat">
                        <label>Customer</label>
                        <strong>{customerName}</strong>
                      </div>
                      <div className="ai-stat">
                        <label>Job Type</label>
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

                    <div className="ai-split" style={{ marginTop: 4 }}>
                      <div className="ai-section">
                        <h3>Conversation</h3>
                        <div className="ai-chat">
                          {conversation.map((message, index) => (
                            <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                              {message.text}
                            </div>
                          ))}
                        </div>

                        {currentQuestion && leadStatus === "draft" ? (
                          <div className="ai-question-box">
                            <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                              Question {questionNumber} of {fields.length} · {currentQuestion.label}
                            </p>
                            <h3 style={{ marginTop: 0 }}>{questionForField(currentQuestion, customerName)}</h3>
                            <div className={`ai-prompt-shell`} style={{ marginTop: 10 }}>
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
                                aria-label="Answer mandatory question"
                                style={{ minHeight: 72 }}
                              />
                              <div className="ai-prompt-actions">
                                <button className="ai-chip" type="button" onClick={useSuggestedAnswer}>
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

                        {leadStatus === "ready" ? (
                          <div className="ai-lock-note ready" style={{ marginTop: 14 }}>
                            All mandatory questions answered. Quote is ready for review.
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
                                {currentQuestion?.id === field.id && field.status !== "answered" ? (
                                  <span className="answer">Asking now</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="ai-action-row">
                      <button className="ai-btn-ghost" type="button" onClick={askCustomer}>
                        <Send size={16} /> Ask Customer
                      </button>
                      <button className="ai-btn-ghost" type="button" onClick={bookSurvey}>
                        <ClipboardList size={16} /> Book Survey
                      </button>
                      <button className="ai-btn-ghost" type="button" onClick={requestPhotos}>
                        <ImagePlus size={16} /> Request Photos
                      </button>
                      {missingCount > 0 ? (
                        <button
                          className="ai-btn"
                          type="button"
                          disabled={leadStatus === "enriching"}
                          onClick={completeMissingInfo}
                        >
                          Fill remaining (demo)
                        </button>
                      ) : (
                        <button className="ai-btn ai-btn-primary" type="button" onClick={continueFromIntake}>
                          Continue to Quote
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {screen === "lead" && (
            <section className="ai-first-panel" key="lead">
              <p className="ai-first-eyebrow">Screen 2 · Lead</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">{customerName}</h1>
                  <p className="ai-first-lede">
                    {playbook.jobType} · {playbook.name} · AI organises the record while you approve the next move.
                  </p>
                </div>
                <span className="ai-badge ai-badge-ai">
                  <Sparkles size={12} /> AI Draft
                </span>
              </div>

              <div className="ai-progress">
                <div className="ai-progress-head">
                  <strong>{progress}% Complete</strong>
                  {quoteReady ? (
                    <span className="ai-badge ai-badge-ok">Quote unlocked</span>
                  ) : (
                    <span className="ai-badge ai-badge-lock">Quote Locked</span>
                  )}
                </div>
                <div className="ai-progress-track">
                  <div className="ai-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className={`ai-lock-note${quoteReady ? " ready" : ""}`}>
                  {quoteReady
                    ? "All mandatory playbook questions answered. AI can build the quote."
                    : `Reason: ${missingCount} mandatory question${missingCount === 1 ? "" : "s"} outstanding`}
                </div>
              </div>

              <div className="ai-split">
                <div className="ai-section">
                  <h3>Customer details</h3>
                  <dl className="ai-dl">
                    <div>
                      <dt>Name</dt>
                      <dd>{customerName}</dd>
                    </div>
                    <div>
                      <dt>Job type</dt>
                      <dd>{playbook.jobType}</dd>
                    </div>
                    <div>
                      <dt>Playbook</dt>
                      <dd>{playbook.name}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{leadStatus === "ready" ? "Ready to quote" : "Draft · gathering"}</dd>
                    </div>
                  </dl>

                  <h3 style={{ marginTop: 20 }}>AI summary</h3>
                  <p className="ai-summary">
                    {customerName} requested a {playbook.jobType.toLowerCase()}. Ayla loaded the correct playbook
                    and is collecting only mandatory commercial questions. No invented fields — human approval
                    stays on every commercial action.
                  </p>

                  <h3 style={{ marginTop: 20 }}>Missing information checklist</h3>
                  <ul className="ai-missing-list">
                    {fields.map((field) => (
                      <li key={field.id} className={field.status === "answered" ? "answered" : undefined}>
                        <span className="mark">{field.status === "answered" ? "✓" : ""}</span>
                        <span>
                          {field.label}
                          {field.answer ? <span className="answer">{field.answer}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  <div className="ai-section">
                    <h3>Conversation history</h3>
                    <div className="ai-chat">
                      {conversation.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                          {message.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ai-section">
                    <h3>
                      Uploaded photos
                      <span className="ai-badge ai-badge-draft">{photosAttached ? "4" : "0"}</span>
                    </h3>
                    {photosAttached ? (
                      <div className="ai-photos">
                        <div className="ai-photo">Boiler plate</div>
                        <div className="ai-photo">Utility cupboard</div>
                        <div className="ai-photo">Flue route</div>
                        <div className="ai-photo">Radiator run</div>
                      </div>
                    ) : (
                      <p className="ai-summary">No photos yet. Request them or attach from intake.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="ai-action-row" style={{ marginTop: 18 }}>
                <button
                  className="ai-btn ai-btn-primary"
                  type="button"
                  disabled={leadStatus === "enriching" || leadStatus === "ready"}
                  onClick={completeMissingInfo}
                >
                  <ClipboardList size={16} /> {missingCount ? "Fill remaining answers" : "Survey complete"}
                </button>
                <button className="ai-btn-ghost" type="button" onClick={askCustomer}>
                  Request Missing Info
                </button>
                <button
                  className="ai-btn-danger"
                  type="button"
                  onClick={() => {
                    pushAudit("Brian", "Brian rejected Lead", customerName);
                    showToast("Lead rejected (prototype)");
                  }}
                >
                  <ThumbsDown size={16} /> Reject Lead
                </button>
                <button
                  className="ai-btn-ghost"
                  type="button"
                  onClick={() => {
                    pushAudit("Brian", "Brian archived Lead", customerName);
                    showToast("Lead archived (prototype)");
                  }}
                >
                  <Archive size={16} /> Archive
                </button>
                {quoteReady && (
                  <button className="ai-btn ai-btn-brass" type="button" onClick={() => goTo("quote")}>
                    Open Quote
                  </button>
                )}
              </div>
            </section>
          )}

          {screen === "quote" && (
            <section className="ai-first-panel" key="quote">
              <p className="ai-first-eyebrow">Screen 3 · AI Quote Builder</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">{playbook.jobType} Quote</h1>
                  <p className="ai-first-lede">
                    Built automatically from the playbook answers. Everything below is an AI Draft until you approve.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="ai-badge ai-badge-ai">
                    <Sparkles size={12} /> AI Draft
                  </span>
                  {quoteStatus === "approved" && <span className="ai-badge ai-badge-ok">Approved</span>}
                  {quoteStatus === "sent" && <span className="ai-badge ai-badge-live">Sent</span>}
                  {quoteStatus === "accepted" && <span className="ai-badge ai-badge-ok">Customer accepted</span>}
                </div>
              </div>

              {!quoteReady && quoteStatus === "locked" ? (
                <div className="ai-empty-state">
                  Quote is locked until mandatory playbook questions are complete.
                  <div style={{ marginTop: 14 }}>
                    <button className="ai-btn" type="button" onClick={() => goTo("lead")}>
                      Return to Lead
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="ai-quote-grid">
                    {quoteSections.map((section) => (
                      <article key={section.id} className="ai-quote-card">
                        <h3>
                          {section.title}
                          <span className="ai-badge ai-badge-ai">AI Draft</span>
                        </h3>
                        <ul>
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>

                  <div className="ai-commercial">
                    <div>
                      <label>Net</label>
                      <strong>{formatMoney(commercialSummary.net)}</strong>
                    </div>
                    <div>
                      <label>VAT</label>
                      <strong>{formatMoney(commercialSummary.vat)}</strong>
                    </div>
                    <div>
                      <label>Gross</label>
                      <strong>{formatMoney(commercialSummary.gross)}</strong>
                    </div>
                    <div>
                      <label>Margin</label>
                      <strong>{commercialSummary.margin}</strong>
                    </div>
                  </div>

                  <div className="ai-action-row" style={{ marginTop: 18 }}>
                    <button
                      className="ai-btn-ghost"
                      type="button"
                      onClick={() => showToast("Edit opens a controlled review — prototype keeps AI draft intact")}
                    >
                      Edit Quote
                    </button>
                    <button
                      className="ai-btn ai-btn-primary"
                      type="button"
                      disabled={quoteStatus === "approved" || quoteStatus === "sent" || quoteStatus === "accepted"}
                      onClick={approveQuote}
                    >
                      <Check size={16} /> Approve Quote
                    </button>
                    <button
                      className="ai-btn"
                      type="button"
                      disabled={quoteStatus === "sent" || quoteStatus === "accepted"}
                      onClick={sendQuote}
                    >
                      <Send size={16} /> Send Quote
                    </button>
                    {(quoteStatus === "sent" || quoteStatus === "accepted") && (
                      <button
                        className="ai-btn ai-btn-brass"
                        type="button"
                        disabled={quoteStatus === "accepted"}
                        onClick={acceptQuote}
                      >
                        Simulate Customer Accept
                      </button>
                    )}
                    {quoteStatus === "accepted" && (
                      <button className="ai-btn ai-btn-primary" type="button" onClick={convertToJob}>
                        Convert to Job
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {screen === "job" && (
            <section className="ai-first-panel" key="job">
              <p className="ai-first-eyebrow">Screen 4 · Job</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">JOB-2418 · {customerName}</h1>
                  <p className="ai-first-lede">
                    Live project health. AI alerts you — it never changes commercial or field decisions without approval.
                  </p>
                </div>
                <span className={`ai-badge ${jobStatus === "complete" ? "ai-badge-ok" : "ai-badge-live"}`}>
                  {jobStatus === "complete" ? "Complete" : "Live"}
                </span>
              </div>

              <div className="ai-split">
                <div style={{ display: "grid", gap: 14 }}>
                  <div className="ai-section">
                    <h3>Timeline</h3>
                    <ul className="ai-timeline">
                      <li>
                        <span>Today</span>
                        Quote accepted · job opened
                      </li>
                      <li>
                        <span>Schedule</span>
                        {scheduleStatus === "approved"
                          ? `${scheduleSuggestion.slot} · ${scheduleSuggestion.engineer}`
                          : "Awaiting schedule approval"}
                      </li>
                      <li>
                        <span>Programme</span>
                        {scheduleSuggestion.durationDays}-day heating renewal
                      </li>
                      <li>
                        <span>Handover</span>
                        {jobStatus === "complete" ? "Complete with certificates" : "Pending commissioning"}
                      </li>
                    </ul>
                  </div>

                  <div className="ai-section">
                    <h3>Tasks</h3>
                    <ul className="ai-task-list">
                      {tasks.map((task) => (
                        <li key={task.id} className={task.done ? "done" : undefined}>
                          <span className="ai-check">{task.done ? "✓" : ""}</span>
                          {task.label}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="ai-section">
                    <h3>
                      Documents & photos
                      <span className="ai-badge ai-badge-draft">AI watched</span>
                    </h3>
                    <p className="ai-summary">
                      Quote PDF, Gas Safe cert template, programme, and site photos bound into the job record.
                      Variations stay visible until priced.
                    </p>
                    <div className="ai-assistant-box">
                      <strong>AI assistant:</strong> Watching for missing photos, engineer overruns, delays,
                      variation opportunities, missing materials, programme issues, and invoice risks. Alerts
                      only — no automatic changes.
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  <div className="ai-section">
                    <h3>Live project health</h3>
                    <div className="ai-health">
                      {alerts.map((alert) => (
                        <div key={alert.id} className={`ai-alert ${alert.severity}`}>
                          <div className="bar" />
                          <div>
                            <h4>{alert.title}</h4>
                            <p>{alert.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ai-section">
                    <h3>Engineer allocation</h3>
                    <dl className="ai-dl">
                      <div>
                        <dt>Suggested</dt>
                        <dd>{scheduleSuggestion.engineer}</dd>
                      </div>
                      <div>
                        <dt>Skills</dt>
                        <dd>{scheduleSuggestion.skills.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt>Travel</dt>
                        <dd>{scheduleSuggestion.travelMinutes} minutes</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="ai-action-row" style={{ marginTop: 18 }}>
                <button className="ai-btn" type="button" onClick={() => goTo("scheduler")}>
                  Open Scheduler
                </button>
                <button
                  className="ai-btn ai-btn-primary"
                  type="button"
                  disabled={jobStatus === "complete" || scheduleStatus !== "approved"}
                  onClick={markJobComplete}
                >
                  Mark Job Complete
                </button>
                {scheduleStatus !== "approved" && (
                  <span className="ai-summary" style={{ alignSelf: "center" }}>
                    Approve the schedule before completing the job.
                  </span>
                )}
              </div>
            </section>
          )}

          {screen === "scheduler" && (
            <section className="ai-first-panel" key="scheduler">
              <p className="ai-first-eyebrow">Screen 5 · Scheduler</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">AI schedule suggestion</h1>
                  <p className="ai-first-lede">
                    Ayla proposes the best engineer and slot. Nothing is booked until you approve.
                  </p>
                </div>
                <span className="ai-badge ai-badge-ai">
                  <Sparkles size={12} /> AI Draft
                </span>
              </div>

              <div className="ai-schedule-hero">
                <div className="ai-header-row">
                  <div>
                    <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                      Best engineer
                    </p>
                    <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.55rem" }}>
                      {scheduleSuggestion.engineer}
                    </h2>
                  </div>
                  {scheduleStatus === "approved" ? (
                    <span className="ai-badge ai-badge-ok">Approved</span>
                  ) : (
                    <span className="ai-badge ai-badge-lock">Awaiting approval</span>
                  )}
                </div>

                <div className="ai-schedule-grid">
                  <div className="ai-stat">
                    <label>Available slot</label>
                    <strong>{scheduleSuggestion.slot}</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Travel time</label>
                    <strong>{scheduleSuggestion.travelMinutes} min</strong>
                  </div>
                  <div className="ai-stat">
                    <label>Required duration</label>
                    <strong>{scheduleSuggestion.durationDays} days</strong>
                  </div>
                </div>

                <div className="ai-skills">
                  {scheduleSuggestion.skills.map((skill) => (
                    <span key={skill}>{skill}</span>
                  ))}
                </div>

                <p className="ai-clash-ok">
                  {scheduleSuggestion.clashes.length === 0
                    ? "No potential clashes detected on this engineer’s board."
                    : scheduleSuggestion.clashes.join(", ")}
                </p>
              </div>

              <div className="ai-action-row" style={{ marginTop: 18 }}>
                <button
                  className="ai-btn ai-btn-primary"
                  type="button"
                  disabled={scheduleStatus === "approved"}
                  onClick={approveSchedule}
                >
                  <Check size={16} /> Approve Schedule
                </button>
                <button className="ai-btn-ghost" type="button" onClick={() => goTo("job")}>
                  Back to Job
                </button>
              </div>
            </section>
          )}

          {screen === "invoice" && (
            <section className="ai-first-panel" key="invoice">
              <p className="ai-first-eyebrow">Screen 6 · Invoice</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">Invoice readiness</h1>
                  <p className="ai-first-lede">
                    Locked until the job is complete, photos are in, checklists pass, variations are priced,
                    hours are approved, and materials are confirmed.
                  </p>
                </div>
                <span className={`ai-badge ${gatesReady ? "ai-badge-ok" : "ai-badge-lock"}`}>
                  {gatesReady ? "Ready" : "Locked"}
                </span>
              </div>

              <div className="ai-gates">
                {invoiceGates.map((gate) => (
                  <div key={gate.id} className={`ai-gate${gate.ready ? " ready" : ""}`}>
                    <span>{gate.label}</span>
                    <span className={`ai-badge ${gate.ready ? "ai-badge-ok" : "ai-badge-draft"}`}>
                      {gate.ready ? "Passed" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>

              <div className={`ai-invoice-preview${gatesReady ? " unlocked" : ""}`}>
                <div className="ai-header-row">
                  <h3 style={{ margin: 0, fontFamily: "var(--font-display)" }}>INV-2418 · {customerName}</h3>
                  <span className="ai-badge ai-badge-ai">
                    <Sparkles size={12} /> AI Draft
                  </span>
                </div>
                <div className="ai-invoice-lines">
                  <div>
                    <span>Heating system renewal</span>
                    <span>{formatMoney(commercialSummary.net)}</span>
                  </div>
                  <div>
                    <span>VAT 20%</span>
                    <span>{formatMoney(commercialSummary.vat)}</span>
                  </div>
                </div>
                <div className="ai-invoice-total">
                  <span>Total due</span>
                  <span>{formatMoney(commercialSummary.gross)}</span>
                </div>
              </div>

              <div className="ai-action-row" style={{ marginTop: 18 }}>
                {!gatesReady && (
                  <button className="ai-btn" type="button" onClick={() => goTo("job")}>
                    Complete job checks
                  </button>
                )}
                <button
                  className="ai-btn ai-btn-primary"
                  type="button"
                  disabled={!gatesReady || invoiceStatus === "approved" || invoiceStatus === "sent"}
                  onClick={approveInvoice}
                >
                  <Check size={16} /> Approve Invoice
                </button>
                <button
                  className="ai-btn"
                  type="button"
                  disabled={invoiceStatus !== "approved"}
                  onClick={sendInvoice}
                >
                  <FileText size={16} /> Send Invoice
                </button>
                {invoiceStatus === "sent" && <span className="ai-badge ai-badge-ok">Invoice sent</span>}
              </div>
            </section>
          )}

          {screen === "audit" && (
            <section className="ai-first-panel" key="audit">
              <p className="ai-first-eyebrow">Screen 7 · AI Audit Log</p>
              <div className="ai-header-row">
                <div>
                  <h1 className="ai-first-title">Everything is traceable</h1>
                  <p className="ai-first-lede">
                    Every AI action and every human approval is recorded. Commercial decisions stay with people.
                  </p>
                </div>
                <button className="ai-btn-ghost" type="button" onClick={resetFlow}>
                  <Upload size={16} /> Restart prototype
                </button>
              </div>

              {audit.length === 0 ? (
                <div className="ai-empty-state">
                  Run the intake flow to populate the audit trail. Start with Mrs Smith’s heating enquiry.
                </div>
              ) : (
                <ul className="ai-audit-list">
                  {audit.map((event) => (
                    <li key={event.id}>
                      <span className="time">{event.time}</span>
                      <span className={`actor ${event.actor.toLowerCase()}`}>{event.actor}</span>
                      <div>
                        <div>{event.action}</div>
                        {event.detail ? <div className="detail">{event.detail}</div> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </main>
      </div>

      {toast ? <div className="ai-toast">{toast}</div> : null}
    </div>
  );
}
