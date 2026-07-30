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
type RecordMode = "lead" | "quote" | "job";
type Phase = "recordType" | "jobType" | "thinking" | "questions" | "book" | "saving" | "done";

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

type ClientApiResponse = {
  client?: { id: string; name: string };
  site?: { id: string; address: string };
  error?: string;
};

type QuoteApiResponse = {
  id?: string;
  ref?: string;
  error?: string;
  message?: string;
};

type JobApiResponse = {
  id?: string;
  ref?: string;
  error?: string;
  message?: string;
};

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
};

const surveyors = ["Brian Kerr", "Errol Watson", "James Walsh"];
const sources: LeadSource[] = ["Phone call", "Email", "Website", "Referral", "Checkatrade"];

const recordModeOptions: Array<{ id: RecordMode; label: string; hint: string }> = [
  { id: "lead", label: "Lead", hint: "Enquiry + book survey" },
  { id: "quote", label: "Quote", hint: "Skip lead — go straight to quote" },
  { id: "job", label: "Job", hint: "Skip lead/quote — create a job" },
];

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

function modeFromSearch(): RecordMode | null {
  if (typeof window === "undefined") return null;
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "lead" || mode === "quote" || mode === "job") return mode;
  return null;
}

function blakeOpener(mode: RecordMode | null) {
  if (mode === "quote") {
    return "Hi — I’m Blake. We’re creating a quote (no lead). What is the work for?";
  }
  if (mode === "job") {
    return "Hi — I’m Blake. We’re creating a job directly. What is the work for?";
  }
  if (mode === "lead") {
    return "Hi — I’m Blake. What is this lead for? Pick the job type and I’ll load the right playbook.";
  }
  return "Hi — I’m Blake. Are we creating a Lead, a Quote, or a Job?";
}

function modeLabel(mode: RecordMode | null) {
  if (mode === "quote") return "Quote";
  if (mode === "job") return "Job";
  return "Lead";
}

function stageCopy(mode: RecordMode | null) {
  if (mode === "quote") {
    return {
      titleJobType: "What is this quote for?",
      titleQuestions: "Quote details",
      titleBook: "Confirm & save quote",
      titleDone: "Quote saved",
      lede: "Same Blake intake as a lead — customer, site, phone and email — then save straight into a Draft quote.",
      detailsLabel: "quote details",
      saveLabel: "Save quote into NeXa",
      classicHref: "/?view=quote-create",
      classicLabel: "Use classic form instead",
      completeMessage: "Quote details are complete. Confirm and I’ll save a Draft quote into NeXa Core.",
      fillMessage: "I’ve filled the remaining details. Confirm when ready to save the quote.",
      flowHighlight: "Quote" as const,
    };
  }
  if (mode === "job") {
    return {
      titleJobType: "What is this job for?",
      titleQuestions: "Job details",
      titleBook: "Confirm & save job",
      titleDone: "Job saved",
      lede: "Same Blake intake as a lead — customer, site, phone and email — then create a job directly (Enquiry).",
      detailsLabel: "job details",
      saveLabel: "Save job into NeXa",
      classicHref: "/?view=job-create",
      classicLabel: "Use classic form instead",
      completeMessage: "Job details are complete. Confirm and I’ll create the job in NeXa Core.",
      fillMessage: "I’ve filled the remaining details. Confirm when ready to save the job.",
      flowHighlight: "Job" as const,
    };
  }
  return {
    titleJobType: "What is this lead for?",
    titleQuestions: "Lead details",
    titleBook: "Book surveyor & save lead",
    titleDone: "Lead saved",
    lede: "Blake starts with the job type, then only lead info — customer, site address, phone and email. Survey detail comes after the site visit.",
    detailsLabel: "lead details",
    saveLabel: "Save lead into NeXa",
    classicHref: "/?view=lead-create",
    classicLabel: "Use classic form instead",
    completeMessage: "Lead details are complete. Book the surveyor and I’ll save this into NeXa Core.",
    fillMessage: "I’ve filled the remaining lead details. Book the surveyor when ready.",
    flowHighlight: "Lead" as const,
  };
}

export function AiIntakeClient() {
  const initialMode = modeFromSearch();
  const [recordMode, setRecordMode] = useState<RecordMode | null>(initialMode);
  const [phase, setPhase] = useState<Phase>(initialMode ? "jobType" : "recordType");
  const [answerDraft, setAnswerDraft] = useState("");
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [addressMatches, setAddressMatches] = useState<AddressMatch[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [playbookId, setPlaybookId] = useState<PlaybookId>("heating");
  const [customerName, setCustomerName] = useState("");
  const [fields, setFields] = useState<MandatoryField[]>(() => cloneFields("heating"));
  const [conversation, setConversation] = useState<Array<{ role: "customer" | "ai"; text: string }>>([
    { role: "ai", text: blakeOpener(initialMode) },
  ]);
  const [source, setSource] = useState<LeadSource>("Phone call");
  const [surveyor, setSurveyor] = useState(surveyors[0] || "Brian Kerr");
  const [surveyDate, setSurveyDate] = useState(tomorrowIso());
  const [surveyTime, setSurveyTime] = useState("09:30");
  const [bookSurvey, setBookSurvey] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [savedLead, setSavedLead] = useState<LeadApiResponse["lead"] | null>(null);
  const [savedRef, setSavedRef] = useState("");
  const [savedKind, setSavedKind] = useState<RecordMode>("lead");
  const lookupGen = useRef(0);

  const copy = stageCopy(recordMode);
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
    const mode = modeFromSearch();
    setRecordMode(mode);
    setPhase(mode ? "jobType" : "recordType");
    setAnswerDraft("");
    setPostcodeQuery("");
    setAddressMatches([]);
    setPlaybookId("heating");
    setCustomerName("");
    setFields(cloneFields("heating"));
    setConversation([{ role: "ai", text: blakeOpener(mode) }]);
    setError("");
    setSavedLead(null);
    setSavedRef("");
    setSavedKind(mode || "lead");
    setBookSurvey(true);
    setSurveyDate(tomorrowIso());
    setSurveyTime("09:30");
  }

  function selectRecordMode(mode: RecordMode) {
    setRecordMode(mode);
    setPhase("jobType");
    setConversation((prev) => [
      ...prev,
      { role: "customer", text: modeLabel(mode) },
      { role: "ai", text: blakeOpener(mode) },
    ]);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState(null, "", url.toString());
    }
  }

  function selectJobType(id: PlaybookId) {
    const option = leadJobTypeOptions.find((item) => item.id === id);
    const seeded = cloneFields(id);
    const modeName = modeLabel(recordMode).toLowerCase();
    setPlaybookId(id);
    setFields(seeded);
    setCustomerName("");
    setPhase("thinking");
    setConversation((prev) => [
      ...prev,
      { role: "customer", text: option?.label || id },
      {
        role: "ai",
        text: `Got it — ${playbooks[id].jobType}. I’ve loaded the ${playbooks[id].name}. ${
          recordMode === "lead"
            ? "Lead stage only needs contact and site details; survey detail comes after the visit."
            : `We’ll capture contact and site details, then save the ${modeName}.`
        }`,
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
          text: stageCopy(recordMode).completeMessage,
        },
      ]);
      showToast(`${modeLabel(recordMode)} details complete`);
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
      { role: "ai", text: stageCopy(recordMode).fillMessage },
    ]);
    showToast(`Remaining ${stageCopy(recordMode).detailsLabel} filled`);
  }

  async function ensureClient(name: string, address: string) {
    const phone = fieldValue(fields, "phone");
    const email = fieldValue(fields, "email");
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        address,
        siteAddress: address,
        phone: phone || undefined,
        email: email || undefined,
        primaryContact: name.trim(),
        source: `Blake AI ${modeLabel(recordMode).toLowerCase()} intake`,
        actor: "Carol",
        serviceLine: playbook.jobType,
        status: "Prospect",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as ClientApiResponse;
    if (!response.ok || !result.client) {
      throw new Error(result.error || "Could not create the customer.");
    }
    return result;
  }

  async function saveLead(name: string, address: string) {
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

    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => ({}))) as LeadApiResponse;
    if (!response.ok || !result.lead) {
      throw new Error(result.message || result.error || "Could not save the lead.");
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
    setSavedRef(result.lead.ref);
    setSavedKind("lead");
    setPhase("done");
    showToast(`${result.lead.ref} saved — Blake handed it to Core`);
    window.setTimeout(() => {
      window.location.assign(`/?lead=${encodeURIComponent(result.lead!.id)}`);
    }, 900);
  }

  async function saveQuote(name: string, address: string) {
    const clientResult = await ensureClient(name, address);
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: name.trim(),
        description,
        status: "Draft",
        owner: "Carol",
        value: 0,
        next: "Build estimate and send for approval.",
        due: "Today",
        clientId: clientResult.client?.id,
        siteId: clientResult.site?.id,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as QuoteApiResponse;
    if (!response.ok || !result.id) {
      throw new Error(result.message || result.error || "Could not save the quote.");
    }
    setSavedRef(result.ref || result.id);
    setSavedKind("quote");
    setPhase("done");
    showToast(`${result.ref || "Quote"} saved — Blake handed it to Core`);
    window.setTimeout(() => {
      window.location.assign(`/?quote=${encodeURIComponent(result.id!)}`);
    }, 900);
  }

  async function saveJob(name: string, address: string) {
    const clientResult = await ensureClient(name, address);
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: name.trim(),
        site: address,
        description,
        manager: "Carol",
        status: "Enquiry",
        value: 0,
        next: "Schedule the work and confirm with the customer.",
        due: "Today",
        clientId: clientResult.client?.id,
        siteId: clientResult.site?.id,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as JobApiResponse;
    if (!response.ok || !result.id) {
      throw new Error(result.message || result.error || "Could not save the job.");
    }
    setSavedRef(result.ref || result.id);
    setSavedKind("job");
    setPhase("done");
    showToast(`${result.ref || "Job"} saved — Blake handed it to Core`);
    window.setTimeout(() => {
      window.location.assign(`/?job=${encodeURIComponent(result.id!)}`);
    }, 900);
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
    if (recordMode === "lead" && bookSurvey && (!surveyor || !surveyDate || !surveyTime)) {
      setError("Add surveyor, date and time, or turn off survey booking.");
      return;
    }
    if (!recordMode) {
      setError("Choose Lead, Quote, or Job first.");
      return;
    }

    setPhase("saving");
    try {
      if (recordMode === "quote") {
        await saveQuote(name, address);
        return;
      }
      if (recordMode === "job") {
        await saveJob(name, address);
        return;
      }
      await saveLead(name, address);
    } catch (err) {
      setPhase("book");
      setError(err instanceof Error ? err.message : "NeXa could not be reached. Check you are signed in and try again.");
    }
  }

  const pageTitle =
    phase === "recordType"
      ? "Lead, Quote, or Job?"
      : phase === "jobType" || phase === "thinking"
        ? copy.titleJobType
        : phase === "questions"
          ? copy.titleQuestions
          : phase === "book" || phase === "saving"
            ? copy.titleBook
            : copy.titleDone;

  const brandSubtitle =
    recordMode === "quote"
      ? "Blake AI intake · creates a real quote in Core"
      : recordMode === "job"
        ? "Blake AI intake · creates a real job in Core"
        : "Blake AI intake · creates a real lead in Core";

  return (
    <div className="ai-first-root">
      <div className="ai-first-shell">
        <header className="ai-first-topbar">
          <div className="ai-first-brand">
            <img src="/brand/nexa-command-mark.svg" alt="NeXa" />
            <div className="ai-first-brand-copy">
              <strong>NeXa</strong>
              <span>{brandSubtitle}</span>
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
          {(
            [
              "Lead",
              "Survey",
              "Quote",
              "Accept",
              "Job",
              "Schedule",
              "In progress",
              "Ready to invoice",
            ] as const
          ).map((step) => (
            <span key={step} className={step === copy.flowHighlight ? "on" : undefined}>
              {step}
            </span>
          ))}
        </div>

        <main className="ai-first-stage">
          <section className="ai-first-panel">
            <p className="ai-first-eyebrow">Blake · Live NeXa intake</p>
            <div className="ai-header-row">
              <div>
                <h1 className="ai-first-title">{pageTitle}</h1>
                <p className="ai-first-lede">
                  {phase === "recordType"
                    ? "Same Blake setup either way — pick whether we’re starting a Lead, skipping straight to a Quote, or creating a Job."
                    : copy.lede}
                </p>
              </div>
              <button className="ai-btn-ghost" type="button" onClick={reset}>
                Reset
              </button>
            </div>

            {phase === "recordType" && (
              <div className="ai-job-type-grid">
                {recordModeOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="ai-job-type-card"
                    onClick={() => selectRecordMode(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                ))}
              </div>
            )}

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
                  {recordMode ? (
                    <span className="ai-chip" style={{ fontWeight: 700 }}>
                      Creating: {modeLabel(recordMode)}
                    </span>
                  ) : null}
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
                    <label>Creating</label>
                    <strong>{modeLabel(recordMode)}</strong>
                  </div>
                </div>

                <div className="ai-progress">
                  <div className="ai-progress-head">
                    <strong>
                      {answeredCount} of {fields.length} {copy.detailsLabel}
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
                        {recordMode === "lead" ? (
                          <>
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
                          </>
                        ) : (
                          <>
                            <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                              Ready to save
                            </p>
                            <h3 style={{ marginTop: 0 }}>
                              <Check size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
                              {recordMode === "quote" ? "Create Draft quote" : "Create Enquiry job"}
                            </h3>
                            <p className="ai-summary" style={{ marginTop: 10 }}>
                              Blake will create the customer/site if needed, then save the{" "}
                              {modeLabel(recordMode).toLowerCase()} for{" "}
                              <strong>{fieldValue(fields, "customer") || customerName}</strong> at{" "}
                              <strong>{siteAddress}</strong>.
                            </p>
                          </>
                        )}
                        {error ? <p className="ai-lock-note" style={{ marginTop: 12 }}>{error}</p> : null}
                        <div className="ai-action-row" style={{ marginTop: 14 }}>
                          <button
                            className="ai-btn ai-btn-primary"
                            type="button"
                            disabled={phase === "saving"}
                            onClick={() => void saveIntoNexa()}
                          >
                            <Check size={16} /> {phase === "saving" ? "Saving…" : copy.saveLabel}
                          </button>
                          <a className="ai-btn-ghost" href={copy.classicHref} style={{ textDecoration: "none" }}>
                            {copy.classicLabel}
                          </a>
                        </div>
                      </div>
                    )}

                    {phase === "done" && savedRef ? (
                      <div className="ai-lock-note ready" style={{ marginTop: 14 }}>
                        {savedRef} saved. Opening {modeLabel(savedKind).toLowerCase()} in Command Center…
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
                      this intake stage.
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
