"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  MapPin,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import {
  firstOpenField,
  playbookAnswers,
  questionForField,
  type MandatoryField,
} from "../ai-first/data";
import "../ai-first/ai-first.css";

type LeadSource = "Phone call" | "Checkatrade" | "Email" | "Website" | "Referral";
type RecordMode = "lead" | "quote" | "job";
type Phase =
  | "recordType"
  | "workType"
  | "thinking"
  | "questions"
  | "book"
  | "saving"
  | "done";

type AddressMatch = {
  postcode: string;
  address: string;
  line1?: string;
  town?: string;
  county?: string;
};

type ClientMatch = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  primaryContact?: string;
  billingAddress?: string;
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

type SiteApiResponse = {
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

const intakeFields: MandatoryField[] = [
  { id: "customer", label: "Customer / contractor", status: "missing" },
  { id: "site_address", label: "Site address", status: "missing" },
  { id: "phone", label: "Phone number", status: "missing" },
  { id: "email", label: "Email", status: "missing" },
];

function cloneIntakeFields(): MandatoryField[] {
  return intakeFields.map((field) => ({ ...field }));
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
    return "Hi — I’m Blake. We’re creating a quote (no lead). In a sentence, what is the work?";
  }
  if (mode === "job") {
    return "Hi — I’m Blake. We’re creating a job directly. In a sentence, what is the work?";
  }
  if (mode === "lead") {
    return "Hi — I’m Blake. In a sentence, what is this lead for?";
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
      titleWorkType: "What is the work?",
      titleQuestions: "Quote details",
      titleBook: "Confirm & save quote",
      titleDone: "Quote saved",
      lede: "Describe the work in your own words, pick the customer (existing or new), then the site address for this job.",
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
      titleWorkType: "What is the work?",
      titleQuestions: "Job details",
      titleBook: "Confirm & save job",
      titleDone: "Job saved",
      lede: "Describe the work in your own words, pick the customer (existing or new), then the site address for this job.",
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
    titleWorkType: "What is the work?",
    titleQuestions: "Lead details",
    titleBook: "Book surveyor & save lead",
    titleDone: "Lead saved",
    lede: "Describe the work in your own words, then customer / site / phone / email. Survey detail comes after the visit.",
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
  // Server render and first client render must match, so start from mode-agnostic
  // defaults and apply the URL ?mode after mount (see effect below). Reading
  // window.location during initial render caused a React hydration mismatch.
  const [recordMode, setRecordMode] = useState<RecordMode | null>(null);
  const [phase, setPhase] = useState<Phase>("recordType");
  const [workType, setWorkType] = useState("");
  const [workDraft, setWorkDraft] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [addressMatches, setAddressMatches] = useState<AddressMatch[]>([]);
  const [addressMeta, setAddressMeta] = useState<{ postcode?: string; town?: string; source?: string } | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressHint, setAddressHint] = useState("");
  const [customerMatches, setCustomerMatches] = useState<ClientMatch[]>([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientMatch | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [fields, setFields] = useState<MandatoryField[]>(() => cloneIntakeFields());
  const [conversation, setConversation] = useState<Array<{ role: "customer" | "ai"; text: string }>>([
    { role: "ai", text: blakeOpener(null) },
  ]);
  const [source, setSource] = useState<LeadSource>("Phone call");
  const [surveyor, setSurveyor] = useState(surveyors[0] || "Brian Kerr");
  const [surveyDate, setSurveyDate] = useState("");
  const [surveyTime, setSurveyTime] = useState("09:30");
  const [bookSurvey, setBookSurvey] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [savedLead, setSavedLead] = useState<LeadApiResponse["lead"] | null>(null);
  const [savedRef, setSavedRef] = useState("");
  const [savedKind, setSavedKind] = useState<RecordMode>("lead");
  const lookupGen = useRef(0);
  const clientGen = useRef(0);

  // Apply URL ?mode and today-derived defaults only after mount to avoid a
  // server/client hydration mismatch (window and Date are client-only here).
  useEffect(() => {
    const mode = modeFromSearch();
    if (mode) {
      setRecordMode(mode);
      setPhase("workType");
      setSavedKind(mode);
      setConversation([{ role: "ai", text: blakeOpener(mode) }]);
    }
    setSurveyDate(tomorrowIso());
  }, []);

  const copy = stageCopy(recordMode);
  const missingCount = fields.filter((field) => field.status !== "answered").length;
  const answeredCount = fields.filter((field) => field.status === "answered").length;
  const progress = Math.round((answeredCount / Math.max(fields.length, 1)) * 100);
  const currentQuestion = firstOpenField(fields);
  const questionNumber = Math.min(answeredCount + 1, fields.length);
  const askingAddress = phase === "questions" && currentQuestion?.id === "site_address";
  const askingCustomer = phase === "questions" && currentQuestion?.id === "customer";

  const siteAddress = fieldValue(fields, "site_address") || "Address to confirm";
  const description = useMemo(() => {
    const captured = fields
      .filter((field) => field.status === "answered" && field.answer)
      .map((field) => `${field.label}: ${field.answer}`)
      .join(" · ");
    const work = workType.trim() || "General work";
    return `${work}${captured ? ` | ${captured}` : ""}`.slice(0, 1800);
  }, [fields, workType]);

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
      setAddressMeta(null);
      setAddressHint("");
      return;
    }
    const gen = ++lookupGen.current;
    setAddressBusy(true);
    setAddressHint("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/postcode-lookup?q=${encodeURIComponent(query)}`, {
            headers: requestHeaders,
          });
          const body = (await response.json().catch(() => null)) as {
            matches?: AddressMatch[];
            meta?: { postcode?: string; town?: string; source?: string } | null;
            incomplete?: boolean;
          } | null;
          if (gen !== lookupGen.current) return;
          const matches = Array.isArray(body?.matches) ? body!.matches! : [];
          setAddressMatches(matches);
          setAddressMeta(body?.meta || null);
          if (body?.incomplete) {
            setAddressHint("Keep typing the full postcode (e.g. AB15 4YE) and Blake will list the street.");
          } else if (matches.length === 0 && body?.meta?.postcode) {
            setAddressHint(
              `Postcode ${body.meta.postcode}${body.meta.town ? ` (${body.meta.town})` : ""} is valid — type the house number and street, or try again.`,
            );
          } else if (matches.length === 0) {
            setAddressHint("No addresses found yet — check the postcode or type the full address.");
          } else {
            setAddressHint(`Select an address (${matches.length} found).`);
          }
        } catch {
          if (gen === lookupGen.current) {
            setAddressMatches([]);
            setAddressHint("Lookup failed — type the full address manually.");
          }
        } finally {
          if (gen === lookupGen.current) setAddressBusy(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [askingAddress, postcodeQuery]);

  useEffect(() => {
    if (!askingCustomer) return;
    const query = answerDraft.trim();
    if (query.length < 2) {
      setCustomerMatches([]);
      return;
    }
    const gen = ++clientGen.current;
    setCustomerBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/clients?q=${encodeURIComponent(query)}`, {
            headers: requestHeaders,
          });
          const body = (await response.json().catch(() => [])) as ClientMatch[] | { error?: string };
          if (gen !== clientGen.current) return;
          setCustomerMatches(Array.isArray(body) ? body.slice(0, 8) : []);
        } catch {
          if (gen === clientGen.current) setCustomerMatches([]);
        } finally {
          if (gen === clientGen.current) setCustomerBusy(false);
        }
      })();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [askingCustomer, answerDraft]);

  function showToast(message: string) {
    setToast(message);
  }

  function reset() {
    const mode = modeFromSearch();
    setRecordMode(mode);
    setPhase(mode ? "workType" : "recordType");
    setWorkType("");
    setWorkDraft("");
    setAnswerDraft("");
    setPostcodeQuery("");
    setAddressMatches([]);
    setAddressMeta(null);
    setAddressHint("");
    setCustomerMatches([]);
    setSelectedClient(null);
    setCustomerName("");
    setFields(cloneIntakeFields());
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
    setPhase("workType");
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

  function submitWorkType(raw?: string) {
    const value = (raw ?? workDraft).trim();
    if (!value || phase !== "workType") return;
    setWorkType(value);
    setWorkDraft("");
    setPhase("thinking");
    setConversation((prev) => [
      ...prev,
      { role: "customer", text: value },
      {
        role: "ai",
        text: `Got it — “${value}”. Who is the customer or contractor? Search an existing client (e.g. Aberbuild) or type a new name.`,
      },
    ]);

    window.setTimeout(() => {
      const seeded = cloneIntakeFields();
      setFields(seeded);
      setSelectedClient(null);
      setCustomerName("");
      setPhase("questions");
      setConversation((prev) => [
        ...prev,
        { role: "ai", text: questionForField(seeded[0]!, "New customer") },
      ]);
      setAnswerDraft("");
    }, 450);
  }

  function continueAfterFields(
    updated: MandatoryField[],
    toastMessage: string,
    linkedClient: ClientMatch | null = selectedClient,
  ) {
    const next = firstOpenField(updated);
    if (!next) {
      setPhase("book");
      setConversation((prev) => [...prev, { role: "ai", text: stageCopy(recordMode).completeMessage }]);
      showToast(toastMessage);
      return;
    }
    const name = updated.find((field) => field.id === "customer")?.answer || customerName || "New customer";
    window.setTimeout(() => {
      if (next.id === "site_address" && linkedClient) {
        setConversation((prev) => [
          ...prev,
          {
            role: "ai",
            text: `Site address for this ${modeLabel(recordMode).toLowerCase()} — a new site for ${linkedClient.name}, not their office/billing address. Enter the postcode and I’ll list the street.`,
          },
        ]);
        return;
      }
      setConversation((prev) => [...prev, { role: "ai", text: questionForField(next, name) }]);
    }, 220);
  }

  function applyAnswer(updated: MandatoryField[], value: string, toastMessage = `${modeLabel(recordMode)} details complete`) {
    setFields(updated);
    setAnswerDraft("");
    setPostcodeQuery("");
    setAddressMatches([]);
    setAddressHint("");
    setCustomerMatches([]);
    setConversation((prev) => [...prev, { role: "customer", text: value }]);

    const customerField = updated.find((field) => field.id === "customer");
    if (customerField?.answer) setCustomerName(customerField.answer);

    continueAfterFields(updated, toastMessage);
  }

  function markField(updated: MandatoryField[], id: string, answer: string) {
    return updated.map((field) =>
      field.id === id ? { ...field, status: "answered" as const, answer } : field,
    );
  }

  function selectExistingClient(client: ClientMatch) {
    if (phase !== "questions" || currentQuestion?.id !== "customer") return;
    setSelectedClient(client);
    setCustomerName(client.name);

    let updated = fields.map((field) => {
      if (field.id === "customer") return { ...field, status: "answered" as const, answer: client.name };
      if (field.id === "site_address") return { ...field, status: "missing" as const, answer: undefined };
      return field;
    });

    if (client.phone?.trim() && client.phone !== "Pending") {
      updated = markField(updated, "phone", client.phone.trim());
    }
    if (client.email?.trim() && !client.email.includes("@example.com")) {
      updated = markField(updated, "email", client.email.trim());
    }

    setFields(updated);
    setAnswerDraft("");
    setCustomerMatches([]);
    setConversation((prev) => [
      ...prev,
      { role: "customer", text: client.name },
      {
        role: "ai",
        text: `Using existing client ${client.name}. I’ll keep their contact details where we have them, but we need a new site address for this work — not ${client.name}’s billing address.`,
      },
    ]);
    showToast(`Linked to ${client.name}`);
    continueAfterFields(updated, `${modeLabel(recordMode)} details complete`, client);
  }

  function submitAnswer(raw?: string) {
    const value = (raw ?? answerDraft).trim();
    const current = firstOpenField(fields);
    if (!current || !value || phase !== "questions") return;
    if (current.id === "site_address" && value.length < 5) return;

    if (current.id === "customer") {
      setSelectedClient(null);
    }

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
    const demo = playbookAnswers.heating[current.id] || "Confirmed";
    submitAnswer(demo);
  }

  function fillRemaining() {
    const answers = playbookAnswers.heating;
    const updated = fields.map((field) =>
      field.status === "answered"
        ? field
        : { ...field, status: "answered" as const, answer: answers[field.id] || "Confirmed" },
    );
    const name = updated.find((field) => field.id === "customer")?.answer || customerName;
    setCustomerName(name);
    setFields(updated);
    setPhase("book");
    setConversation((prev) => [...prev, { role: "ai", text: stageCopy(recordMode).fillMessage }]);
    showToast(`Remaining ${stageCopy(recordMode).detailsLabel} filled`);
  }

  async function resolveClientAndSite(name: string, address: string) {
    const phone = fieldValue(fields, "phone");
    const email = fieldValue(fields, "email");

    if (selectedClient?.id) {
      const siteResponse = await fetch("/api/client-sites", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient.id,
          address,
          name: address.split(",")[0]?.trim() || "New site",
          primaryContact: selectedClient.primaryContact || name.trim(),
          serviceLine: workType.trim() || "New work",
          actor: "Carol",
        }),
      });
      const siteResult = (await siteResponse.json().catch(() => ({}))) as SiteApiResponse;
      if (!siteResponse.ok || !siteResult.site) {
        throw new Error(siteResult.error || "Could not create the new site for this client.");
      }
      return { client: { id: selectedClient.id, name: selectedClient.name }, site: siteResult.site };
    }

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
        serviceLine: workType.trim() || "New work",
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
      clientId: selectedClient?.id,
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
        notes: selectedClient
          ? `Existing client ${selectedClient.name}; new site via Blake`
          : "Captured via Blake AI intake",
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
          jobType: workType.trim() || "General",
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
    const clientResult = await resolveClientAndSite(name, address);
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: clientResult.client?.name || name.trim(),
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
    const clientResult = await resolveClientAndSite(name, address);
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: clientResult.client?.name || name.trim(),
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
    if (!workType.trim()) {
      setError("Describe the work before saving.");
      return;
    }
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
      : phase === "workType" || phase === "thinking"
        ? copy.titleWorkType
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

            {(phase === "workType" || phase === "thinking") && (
              <>
                <div className="ai-question-box">
                  <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                    Free text · no fixed job-type list
                  </p>
                  <h3 style={{ marginTop: 0 }}>What is the work?</h3>
                  <p className="ai-summary">
                    Type it in your own words — Blake won’t force boiler / bathroom chips. There are too many variants for static options.
                  </p>
                  <div className="ai-prompt-shell" style={{ marginTop: 10 }}>
                    <textarea
                      value={workDraft}
                      onChange={(event) => setWorkDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          submitWorkType();
                        }
                      }}
                      placeholder="e.g. Aberbuild need a quote for a new bathroom first fix at a Portlethen site…"
                      style={{ minHeight: 96 }}
                      disabled={phase === "thinking"}
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
                      {recordMode ? (
                        <span className="ai-chip" style={{ fontWeight: 700 }}>
                          Creating: {modeLabel(recordMode)}
                        </span>
                      ) : null}
                      <button
                        className="ai-btn ai-btn-primary"
                        type="button"
                        disabled={phase === "thinking" || !workDraft.trim()}
                        onClick={() => submitWorkType()}
                      >
                        <Send size={16} /> Continue
                      </button>
                    </div>
                  </div>
                </div>
                {phase === "thinking" && (
                  <div className="ai-thinking">
                    <div className="ai-thinking-dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                    Blake is setting up the intake…
                  </div>
                )}
              </>
            )}

            {(phase === "questions" || phase === "book" || phase === "saving" || phase === "done") && (
              <div className="ai-draft-card">
                <div className="ai-draft-grid">
                  <div className="ai-stat">
                    <label>Customer</label>
                    <strong>
                      {fieldValue(fields, "customer") || customerName || "—"}
                      {selectedClient ? " · existing" : ""}
                    </strong>
                  </div>
                  <div className="ai-stat">
                    <label>Work</label>
                    <strong>{workType || "—"}</strong>
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

                    {askingCustomer ? (
                      <div className="ai-question-box">
                        <p className="ai-first-eyebrow" style={{ marginBottom: 6 }}>
                          Question {questionNumber} of {fields.length} · Customer / contractor
                        </p>
                        <h3 style={{ marginTop: 0 }}>
                          <Users size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
                          Who is the customer?
                        </h3>
                        <p className="ai-summary">
                          Search an existing client (e.g. Aberbuild) to link them, or type a new name. Site address stays separate.
                        </p>
                        <div className="ai-prompt-shell" style={{ marginTop: 10 }}>
                          <input
                            value={answerDraft}
                            onChange={(event) => setAnswerDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                submitAnswer();
                              }
                            }}
                            placeholder="Start typing a client name…"
                            aria-label="Customer search"
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
                          {customerBusy ? (
                            <p className="ai-summary" style={{ margin: "0 0 8px" }}>
                              Blake is searching clients…
                            </p>
                          ) : null}
                          {customerMatches.length > 0 ? (
                            <div className="ai-address-matches">
                              {customerMatches.map((client) => (
                                <button
                                  key={client.id}
                                  type="button"
                                  className="ai-address-match"
                                  onClick={() => selectExistingClient(client)}
                                >
                                  <strong>{client.name}</strong>
                                  <span style={{ display: "block", opacity: 0.75, fontSize: "0.9em" }}>
                                    {[client.primaryContact, client.phone, client.email].filter(Boolean).join(" · ") ||
                                      "Existing client · new site next"}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className="ai-prompt-actions" style={{ marginTop: 10 }}>
                            <button
                              className="ai-btn ai-btn-primary"
                              type="button"
                              disabled={!answerDraft.trim()}
                              onClick={() => submitAnswer()}
                            >
                              <Send size={16} /> Use as new customer
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {phase === "questions" && currentQuestion && !askingAddress && !askingCustomer ? (
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
                          {selectedClient ? ` · new site for ${selectedClient.name}` : ""}
                        </p>
                        <h3 style={{ marginTop: 0 }}>
                          <MapPin size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
                          Site address
                        </h3>
                        <p className="ai-summary">
                          Enter the postcode. Blake looks up UK addresses on the internet and offers matches to select
                          {selectedClient
                            ? ` — this becomes a new site on ${selectedClient.name}, not their billing address`
                            : ""}
                          .
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
                              Blake is searching addresses…
                            </p>
                          ) : null}
                          {!addressBusy && addressHint ? (
                            <p className="ai-summary" style={{ margin: "0 0 8px" }}>
                              {addressHint}
                              {addressMeta?.source ? ` · ${addressMeta.source}` : ""}
                            </p>
                          ) : null}
                          {addressMatches.length > 0 ? (
                            <div className="ai-address-matches">
                              {addressMatches.slice(0, 40).map((match) => (
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
                              {selectedClient ? (
                                <>
                                  Linked to existing client <strong>{selectedClient.name}</strong> with a{" "}
                                  <strong>new site</strong> at <strong>{siteAddress}</strong>.
                                </>
                              ) : (
                                <>
                                  Blake will create the customer/site if needed, then save the{" "}
                                  {modeLabel(recordMode).toLowerCase()} for{" "}
                                  <strong>{fieldValue(fields, "customer") || customerName}</strong> at{" "}
                                  <strong>{siteAddress}</strong>.
                                </>
                              )}
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
                      <li className={workType ? "answered" : "current"}>
                        <span className="mark">{workType ? "✓" : ""}</span>
                        <span>
                          Work
                          {workType ? <span className="answer">{workType}</span> : null}
                        </span>
                      </li>
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
                            {field.id === "customer" && selectedClient ? " (existing)" : ""}
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
                      Existing contractors keep their own record; each job gets its own site address. Survey detail stays
                      for the visit.
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
