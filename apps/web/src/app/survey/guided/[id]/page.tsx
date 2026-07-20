"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  ChevronUp,
  ClipboardCheck,
  Download,
  HardHat,
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Ruler,
  Save,
  ScanLine,
  Send,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import {
  buildDynamicSurveyPath,
  inferSurveyJobTypeFromText,
  inferSurveyorIntent,
  surveyQuestionSetForJobType,
  surveyJobTypes,
  surveyorItemGroupLabels,
  surveyorItemGroups,
  surveyorWorkTypeLabels,
  surveyorWorkTypes,
  type SurveyEvidenceConfidence,
  type SurveyAnswer,
  type SurveyCompletionReview,
  type SurveyEquipmentItem,
  type SurveyJobLink,
  type SurveyPhoto,
  type SurveyPhotoCategory,
  type SurveyPipeRun,
  type SurveyRecord,
  type SurveyRoom,
  type SurveyScopeItem,
  type SurveyorIntent,
  type SurveyValueStatus,
} from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

const publicPilotBaseUrl = "https://nexa-pilot.onrender.com";

const steps = [
  { key: "details", label: "Details", icon: Building2 },
  { key: "conditions", label: "Conditions", icon: ClipboardCheck },
  { key: "scope", label: "Scope", icon: Wrench },
  { key: "measurements", label: "Measurements", icon: Ruler },
  { key: "photos", label: "Photos", icon: Camera },
  { key: "review", label: "Review", icon: CheckCircle2 },
] as const;
type StepKey = (typeof steps)[number]["key"];
type SaveState = "Saved" | "Unsaved" | "Saving" | "Error";

type LinkOption = {
  type: SurveyJobLink["type"];
  id: string;
  reference: string;
  label: string;
  customerName?: string;
  siteAddress?: string;
};

const blankScope: Omit<SurveyScopeItem, "id"> = {
  taskType: "",
  trade: "Plumbing/Heating",
  roomOrArea: "",
  existingPosition: "",
  proposedPosition: "",
  quantity: 1,
  dimensions: "",
  status: "Confirmed",
  responsibility: "EWG",
  notes: "",
  photoIds: [],
};

const blankRoom: Omit<SurveyRoom, "id"> = {
  name: "",
  wallConstruction: "",
  floorConstruction: "",
  ceilingConstruction: "",
  accessNotes: "",
  photoIds: [],
};

const blankPipeRun: Omit<SurveyPipeRun, "id"> = {
  service: "Hot",
  fromLocation: "",
  toLocation: "",
  pipeSize: "",
  material: "Copper",
  route: "",
  insulationRequired: false,
  directionChanges: [],
  accessDifficulty: "Normal",
  fireStopping: false,
  coreDrilling: false,
  makingGood: false,
  measurementStatus: "Measured",
  notes: "",
  photoIds: [],
};

const blankEquipment: Omit<SurveyEquipmentItem, "id"> = {
  category: "",
  roomOrArea: "",
  description: "",
  make: "",
  model: "",
  supplierCode: "",
  quantity: 1,
  dimensions: "",
  outputOrCapacity: "",
  connectionRequirements: "",
  rfqRequired: false,
  status: "Confirmed",
  notes: "",
  photoIds: [],
};

const photoCategories: SurveyPhotoCategory[] = [
  "Room overview", "Existing condition", "Proposed position", "Pipe route", "Boiler data plate", "Gas meter",
  "Consumer unit", "Drainage", "Access issue", "Damage or making good", "Measurement evidence", "Other",
];

const surveyEvidenceConfidenceOptions: SurveyEvidenceConfidence[] = ["High", "Medium", "Low", "Needs more evidence"];

function nextId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}

function isLidarEvidence(photo: SurveyPhoto) {
  const haystack = `${photo.fileName} ${photo.mimeType} ${photo.caption} ${photo.surveySection}`.toLowerCase();
  return photo.category === "Measurement evidence"
    && /lidar|roomplan|room scan|\.json|\.usd|\.usdz|\.obj|\.glb|\.gltf|\.ply|model\//.test(haystack);
}

function surveyRoomScanDeepLink(survey: SurveyRecord) {
  if (!survey.legacyTakeoffProjectId) return "";
  const baseUrl = typeof window !== "undefined"
    && !["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? window.location.origin
    : publicPilotBaseUrl;
  const params = new URLSearchParams({
    baseUrl,
    projectId: survey.legacyTakeoffProjectId,
    reference: survey.reference,
    projectName: survey.customerRequirements || survey.reference,
    returnUrl: `${baseUrl}/survey/guided/${survey.id}`,
  });
  return `nexa-field://room-scan?${params.toString()}`;
}

export default function GuidedSurveyPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;
  const [survey, setSurvey] = useState<SurveyRecord | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("details");
  const [saveState, setSaveState] = useState<SaveState>("Saved");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<SurveyCompletionReview | null>(null);
  const [linkOptions, setLinkOptions] = useState<LinkOption[]>([]);
  const [scopeDraft, setScopeDraft] = useState(blankScope);
  const [roomDraft, setRoomDraft] = useState(blankRoom);
  const [pipeDraft, setPipeDraft] = useState(blankPipeRun);
  const [equipmentDraft, setEquipmentDraft] = useState(blankEquipment);
  const [photoCategory, setPhotoCategory] = useState<SurveyPhotoCategory>("Existing condition");
  const [photoCaption, setPhotoCaption] = useState("");
  const [lidarCaption, setLidarCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantSending, setAssistantSending] = useState(false);
  const [assistantWarning, setAssistantWarning] = useState("");
  const surveyRef = useRef<SurveyRecord | null>(null);
  const assistantListRef = useRef<HTMLDivElement | null>(null);
  const pendingPatchRef = useRef<Partial<SurveyRecord>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingPromiseRef = useRef<Promise<SurveyRecord | null> | null>(null);
  const lidarEvidence = useMemo(() => survey?.photos.filter(isLidarEvidence) ?? [], [survey]);

  useEffect(() => {
    async function load() {
      setError("");
      try {
        const [surveyResponse, quoteResponse, jobResponse, leadResponse] = await Promise.all([
          fetch(`/api/surveys/${encodeURIComponent(surveyId)}`, { headers: requestHeaders }),
          fetch("/api/quotes", { headers: requestHeaders }),
          fetch("/api/jobs", { headers: requestHeaders }),
          fetch("/api/leads", { headers: requestHeaders }),
        ]);
        if (!surveyResponse.ok) throw new Error("Unable to open this guided survey.");
        const loaded = await surveyResponse.json() as SurveyRecord;
        setSurvey(loaded);
        surveyRef.current = loaded;
        const records: LinkOption[] = [];
        if (quoteResponse.ok) {
          const quotes = await quoteResponse.json() as Array<Record<string, unknown>>;
          quotes.forEach((item) => records.push({ type: "Quote", id: String(item.id || ""), reference: String(item.ref || item.reference || ""), label: `${item.ref || item.reference} - ${item.customer || item.description || "Quote"}`, customerName: String(item.customer || "") }));
        }
        if (jobResponse.ok) {
          const jobs = await jobResponse.json() as Array<Record<string, unknown>>;
          jobs.forEach((item) => records.push({ type: "Job", id: String(item.id || ""), reference: String(item.ref || item.reference || ""), label: `${item.ref || item.reference} - ${item.customer || item.description || "Job"}`, customerName: String(item.customer || ""), siteAddress: String(item.siteAddress || item.address || "") }));
        }
        if (leadResponse.ok) {
          const leads = await leadResponse.json() as Array<Record<string, unknown>>;
          leads.forEach((item) => records.push({ type: "Lead", id: String(item.id || ""), reference: String(item.ref || item.reference || ""), label: `${item.ref || item.reference} - ${item.customerName || item.description || "Lead"}`, customerName: String(item.customerName || ""), siteAddress: String(item.siteAddress || item.address || "") }));
        }
        setLinkOptions(records.filter((item) => item.id && item.reference));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load survey.");
      }
    }
    void load();
  }, [surveyId]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!assistantOpen || !assistantListRef.current) return;
    assistantListRef.current.scrollTop = assistantListRef.current.scrollHeight;
  }, [assistantOpen, survey?.assistantMessages?.length]);

  async function flushAutosave(): Promise<SurveyRecord | null> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savingPromiseRef.current) await savingPromiseRef.current;
    const current = surveyRef.current;
    const patch = pendingPatchRef.current;
    if (!current || !Object.keys(patch).length) return current;
    pendingPatchRef.current = {};
    setSaveState("Saving");
    const request = fetch(`/api/surveys/${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: current.version, patch }),
    }).then(async (response) => {
      const body = await response.json() as SurveyRecord & { error?: string; current?: SurveyRecord };
      if (!response.ok) {
        if (response.status === 409 && body.current) {
          surveyRef.current = body.current;
          setSurvey(body.current);
        }
        throw new Error(body.error || "Autosave failed.");
      }
      const pending = pendingPatchRef.current;
      const optimistic = { ...body, ...pending } as SurveyRecord;
      surveyRef.current = optimistic;
      setSurvey(optimistic);
      setSaveState(Object.keys(pending).length ? "Unsaved" : "Saved");
      if (Object.keys(pending).length) {
        saveTimerRef.current = setTimeout(() => void flushAutosave(), 500);
      }
      return body;
    }).catch((saveError) => {
      pendingPatchRef.current = { ...patch, ...pendingPatchRef.current };
      setSaveState("Error");
      setError(saveError instanceof Error ? saveError.message : "Autosave failed.");
      return null;
    }).finally(() => {
      savingPromiseRef.current = null;
    });
    savingPromiseRef.current = request;
    return request;
  }

  function queuePatch(patch: Partial<SurveyRecord>) {
    const current = surveyRef.current;
    if (!current) return;
    const optimistic = { ...current, ...patch };
    surveyRef.current = optimistic;
    setSurvey(optimistic);
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    setSaveState("Unsaved");
    setNotice("");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushAutosave(), 700);
  }

  function updateAnswer(key: string, patch: Partial<SurveyAnswer>) {
    const current = surveyRef.current;
    if (!current) return;
    const definition = surveyQuestionSetForJobType(current.jobType).questions.find((question) => question.key === key);
    if (!definition) return;
    const existing = current.answers.find((answer) => answer.key === key);
    const answer: SurveyAnswer = {
      id: existing?.id || nextId("survey-answer"),
      key,
      section: definition.section,
      question: definition.question,
      value: existing?.value ?? "",
      status: existing?.status || "Confirmed",
      notes: existing?.notes || "",
      photoIds: existing?.photoIds || [],
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    queuePatch({ answers: [...current.answers.filter((item) => item.key !== key), answer] });
  }

  async function saveRepeatable(path: string, item: SurveyScopeItem | SurveyRoom | SurveyPipeRun | SurveyEquipmentItem) {
    const current = await flushAutosave();
    if (!current) return false;
    setSaveState("Saving");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/${path}`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.version, item }),
      });
      const body = await response.json() as SurveyRecord & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to add survey item.");
      setSurvey(body);
      surveyRef.current = body;
      setSaveState("Saved");
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add survey item.");
      setSaveState("Error");
      return false;
    }
  }

  async function goToStep(step: StepKey) {
    await flushAutosave();
    setActiveStep(step);
    setError("");
    if (step === "review") await loadReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadReview() {
    const current = await flushAutosave();
    if (!current) return;
    const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/completion-review`, { headers: requestHeaders });
    if (response.ok) setReview(await response.json() as SurveyCompletionReview);
  }

  async function completeCurrentSurvey() {
    const current = await flushAutosave();
    if (!current) return;
    const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/complete`, {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: current.version }),
    });
    const body = await response.json() as { survey?: SurveyRecord; review?: SurveyCompletionReview; error?: string };
    if (!response.ok || !body.survey) {
      setReview(body.review || null);
      setError(body.error || "The completion review still has blocking items.");
      return;
    }
    setSurvey(body.survey);
    surveyRef.current = body.survey;
    setReview(body.review || null);
    setNotice(body.review?.canSendToEstimator ? "Survey completed and ready for Estimator." : "Survey captured. Resolve the pricing-readiness items before sending it to Estimator.");
  }

  async function sendToEstimator() {
    const current = await flushAutosave();
    if (!current) return;
    const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/send-to-estimator`, {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: current.version }),
    });
    const body = await response.json() as { survey?: SurveyRecord; estimate?: { id: string }; error?: string };
    if (!response.ok || !body.survey || !body.estimate) {
      setError(body.error || "Unable to send survey to Estimator.");
      return;
    }
    setSurvey(body.survey);
    surveyRef.current = body.survey;
    window.location.href = `/estimator?estimate=${encodeURIComponent(body.estimate.id)}`;
  }

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    const current = await flushAutosave();
    if (!current || !files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("category", photoCategory);
    formData.append("caption", photoCaption);
    formData.append("surveySection", activeStep);
    formData.append("expectedVersion", String(current.version));
    setUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/photos`, { method: "POST", headers: requestHeaders, body: formData });
      const body = await response.json() as { survey?: SurveyRecord; error?: string };
      if (!response.ok || !body.survey) throw new Error(body.error || "Unable to upload photographs.");
      setSurvey(body.survey);
      surveyRef.current = body.survey;
      setPhotoCaption("");
      setNotice(`${files.length} photograph${files.length === 1 ? "" : "s"} saved as ${photoCategory}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload photographs.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function uploadLidarEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    const current = await flushAutosave();
    if (!current || !files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("category", "Measurement evidence");
    formData.append("caption", lidarCaption.trim() || "LiDAR / RoomPlan scan evidence");
    formData.append("surveySection", "LiDAR / room scan");
    formData.append("expectedVersion", String(current.version));
    setUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/photos`, { method: "POST", headers: requestHeaders, body: formData });
      const body = await response.json() as { survey?: SurveyRecord; error?: string };
      if (!response.ok || !body.survey) throw new Error(body.error || "Unable to upload LiDAR evidence.");
      setSurvey(body.survey);
      surveyRef.current = body.survey;
      setLidarCaption("");
      setNotice(`${files.length} LiDAR / RoomPlan export${files.length === 1 ? "" : "s"} saved as measurement evidence.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload LiDAR evidence.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function askNexa(event?: FormEvent<HTMLFormElement>, promptOverride?: string) {
    event?.preventDefault();
    const message = (promptOverride || assistantDraft).trim();
    if (!message || assistantSending) return;
    const current = await flushAutosave();
    if (!current) return;
    setAssistantOpen(true);
    setAssistantSending(true);
    setAssistantWarning("");
    setError("");
    if (!promptOverride) setAssistantDraft("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/ask-nexa`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message, activeStep, expectedVersion: current.version }),
      });
      const body = await response.json() as { survey?: SurveyRecord; warning?: string; error?: string; current?: SurveyRecord };
      if (!response.ok || !body.survey) {
        if (body.current) {
          setSurvey(body.current);
          surveyRef.current = body.current;
        }
        throw new Error(body.error || "NeXa could not answer that question.");
      }
      setSurvey(body.survey);
      surveyRef.current = body.survey;
      setAssistantWarning(body.warning || "");
    } catch (assistantError) {
      setError(assistantError instanceof Error ? assistantError.message : "NeXa could not answer that question.");
      if (!promptOverride) setAssistantDraft(message);
    } finally {
      setAssistantSending(false);
    }
  }

  const questionSet = useMemo(() => survey ? surveyQuestionSetForJobType(survey.jobType) : null, [survey]);
  const questions = questionSet?.questions ?? [];
  const suggestedJobType = useMemo(() => survey ? inferSurveyJobTypeFromText(survey.customerRequirements) : undefined, [survey?.customerRequirements]);
  const surveyorIntent = useMemo(() => survey ? inferSurveyorIntent({
    text: [
      survey.customerRequirements,
      survey.scopeItems.map((item) => `${item.taskType} ${item.notes}`).join(" "),
      scopeDraft.taskType,
      scopeDraft.notes,
    ].join(" "),
    jobType: survey.jobType,
    currentIntent: survey.surveyIntent,
    evidenceCount: survey.photos.length,
  }) : null, [survey, scopeDraft.taskType, scopeDraft.notes]);
  const surveyorPath = useMemo(() => surveyorIntent ? buildDynamicSurveyPath(surveyorIntent) : null, [surveyorIntent]);
  const currentStepIndex = steps.findIndex((step) => step.key === activeStep);
  const takeoffRoomsHref = survey
    ? `/takeoff?tab=rooms&survey=${encodeURIComponent(survey.id)}${survey.legacyTakeoffProjectId ? `&project=${encodeURIComponent(survey.legacyTakeoffProjectId)}` : ""}`
    : "/takeoff?tab=rooms";

  function updateCustomerRequirement(value: string) {
    if (!survey) return;
    const suggestion = inferSurveyJobTypeFromText(value);
    const shouldAutoSet = suggestion
      && suggestion !== survey.jobType
      && !survey.answers.length
      && (survey.jobType === "General plumbing" || survey.jobType === "Custom survey");
    const patch: Partial<SurveyRecord> = shouldAutoSet ? { customerRequirements: value, jobType: suggestion } : { customerRequirements: value };
    if (!survey.surveyIntent) {
      patch.surveyIntent = {
        ...inferSurveyorIntent({ text: value, jobType: suggestion || survey.jobType, evidenceCount: survey.photos.length }),
        updatedAt: new Date().toISOString(),
      };
    }
    queuePatch(patch);
  }

  function updateSurveyIntent(patch: Partial<SurveyorIntent>) {
    if (!surveyorIntent) return;
    queuePatch({ surveyIntent: { ...surveyorIntent, ...patch, updatedAt: new Date().toISOString() } });
  }

  if (!survey) {
    return <main className="guided-loading"><Loader2 className="spin" size={22} /><strong>{error || "Opening guided survey"}</strong><a href="/survey/guided">Back to surveys</a></main>;
  }

  return (
    <main className="guided-survey-app">
      <header className="guided-app-header">
        <div>
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa" />
          <span><strong>NeXa Surveyor</strong><small>{survey.reference}</small></span>
        </div>
        <div className="guided-header-actions">
          <span className={`guided-save-state ${saveState.toLowerCase()}`}>{saveState === "Saving" ? <Loader2 className="spin" size={14} /> : saveState === "Saved" ? <Check size={14} /> : <Save size={14} />}{saveState}</span>
          <a href="/survey/guided"><ArrowLeft size={17} /> Surveys</a>
        </div>
      </header>

      <div className="guided-survey-shell">
        <nav className="guided-step-nav" aria-label="Survey progress">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return <button className={step.key === activeStep ? "active" : index < currentStepIndex ? "done" : ""} type="button" key={step.key} onClick={() => void goToStep(step.key)}><span>{index < currentStepIndex ? <Check size={15} /> : <Icon size={16} />}</span><b>{step.label}</b></button>;
          })}
        </nav>

        <section className="guided-workspace">
          <header className="guided-workspace-heading">
            <div><span className="guided-eyebrow">{survey.jobType}</span><h1>{steps[currentStepIndex]?.label}</h1><p>{survey.customerName || "Customer not selected"} · {survey.siteAddress || "Site address required"}</p></div>
            <div className="guided-workspace-actions">
              <button className="guided-ask-toggle" type="button" aria-expanded={assistantOpen} onClick={() => setAssistantOpen((open) => !open)}><Bot size={16} /> Ask NeXa</button>
              <b data-status={survey.status}>{survey.status}</b>
            </div>
          </header>
          {notice ? <p className="guided-notice">{notice}</p> : null}
          {error ? <p className="guided-error">{error}</p> : null}

          {assistantOpen ? (
            <aside className="guided-assistant-panel" aria-label="Ask NeXa survey assistant">
              <header>
                <div><span className="guided-assistant-icon"><Bot size={17} /></span><span><strong>Ask NeXa</strong><small>Using this survey and the {steps[currentStepIndex]?.label.toLowerCase()} stage</small></span></div>
                <button type="button" title="Close Ask NeXa" aria-label="Close Ask NeXa" onClick={() => setAssistantOpen(false)}><ChevronUp size={18} /></button>
              </header>
              <div className="guided-assistant-messages" ref={assistantListRef}>
                {survey.assistantMessages?.length ? survey.assistantMessages.map((message) => (
                  <article className={message.role} key={message.id}><span>{message.role === "assistant" ? "NeXa" : "You"}</span><p>{message.text}</p><small>{message.step}</small></article>
                )) : <p className="guided-assistant-empty">Ask NeXa to check what is missing, explain what to capture, or challenge the survey before it reaches Estimator.</p>}
                {assistantSending ? <article className="assistant thinking"><span>NeXa</span><p><Loader2 className="spin" size={16} /> Reviewing the live survey...</p></article> : null}
              </div>
              <div className="guided-assistant-prompts">
                <button type="button" disabled={assistantSending} onClick={() => void askNexa(undefined, "What is missing from this stage?")}>What is missing?</button>
                <button type="button" disabled={assistantSending} onClick={() => void askNexa(undefined, "Check the evidence I have recorded and tell me the next three useful checks.")}>Check evidence</button>
                <button type="button" disabled={assistantSending} onClick={() => void askNexa(undefined, "What should I capture next before this survey can be priced reliably?")}>What next?</button>
              </div>
              <form className="guided-assistant-compose" onSubmit={(event) => void askNexa(event)}>
                <textarea aria-label="Ask NeXa" value={assistantDraft} onChange={(event) => setAssistantDraft(event.target.value)} placeholder="Ask about this job, the evidence or anything that may have been missed..." />
                <button type="submit" title="Send to NeXa" aria-label="Send to NeXa" disabled={assistantSending || !assistantDraft.trim()}>{assistantSending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}</button>
              </form>
              {assistantWarning ? <p className="guided-assistant-warning">{assistantWarning}</p> : null}
            </aside>
          ) : null}

          {activeStep === "details" ? (
            <section className="guided-form-section">
              <div className="guided-section-title"><MapPin size={18} /><span><h2>Job and site</h2><p>Link the survey before site capture begins.</p></span></div>
              <div className="guided-form-grid">
                <label className="wide">Linked lead, quote or job<select value={survey.jobLink ? `${survey.jobLink.type}|${survey.jobLink.id}` : ""} onChange={(event) => {
                  const option = linkOptions.find((item) => `${item.type}|${item.id}` === event.target.value);
                  if (!option) return queuePatch({ jobLink: undefined });
                  queuePatch({ jobLink: { type: option.type, id: option.id, reference: option.reference }, customerName: survey.customerName || option.customerName || "", siteAddress: survey.siteAddress || option.siteAddress || "" });
                }}><option value="">Select a live record...</option>{linkOptions.map((option) => <option value={`${option.type}|${option.id}`} key={`${option.type}-${option.id}`}>{option.type}: {option.label}</option>)}</select></label>
                <label>Customer<input value={survey.customerName} onChange={(event) => queuePatch({ customerName: event.target.value })} /></label>
                <label>Site address<textarea value={survey.siteAddress} onChange={(event) => queuePatch({ siteAddress: event.target.value })} /></label>
                <label>Primary contact<input value={survey.primaryContact.name} onChange={(event) => queuePatch({ primaryContact: { ...survey.primaryContact, name: event.target.value } })} /></label>
                <label>Telephone<input inputMode="tel" value={survey.primaryContact.phone} onChange={(event) => queuePatch({ primaryContact: { ...survey.primaryContact, phone: event.target.value } })} /></label>
                <label>Email<input inputMode="email" value={survey.primaryContact.email} onChange={(event) => queuePatch({ primaryContact: { ...survey.primaryContact, email: event.target.value } })} /></label>
                <div className="guided-additional-contacts wide">
                  <div><strong>Additional contacts</strong><button type="button" onClick={() => queuePatch({ additionalContacts: [...survey.additionalContacts, { name: "", email: "", phone: "" }] })}><Plus size={14} /> Add contact</button></div>
                  {survey.additionalContacts.map((contact, index) => <div className="guided-contact-row" key={`contact-${index}`}><input aria-label={`Additional contact ${index + 1} name`} placeholder="Name" value={contact.name} onChange={(event) => queuePatch({ additionalContacts: survey.additionalContacts.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><input aria-label={`Additional contact ${index + 1} telephone`} placeholder="Telephone" value={contact.phone} onChange={(event) => queuePatch({ additionalContacts: survey.additionalContacts.map((item, itemIndex) => itemIndex === index ? { ...item, phone: event.target.value } : item) })} /><input aria-label={`Additional contact ${index + 1} email`} placeholder="Email" value={contact.email} onChange={(event) => queuePatch({ additionalContacts: survey.additionalContacts.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item) })} /><button title="Remove contact" aria-label="Remove contact" type="button" onClick={() => queuePatch({ additionalContacts: survey.additionalContacts.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></button></div>)}
                </div>
                <label>Surveyor<input value={survey.surveyorName} onChange={(event) => queuePatch({ surveyorName: event.target.value })} /></label>
                <label>Survey date<input type="date" value={survey.surveyDate} onChange={(event) => queuePatch({ surveyDate: event.target.value })} /></label>
                <label>Required by<input type="date" value={survey.requiredByDate || ""} onChange={(event) => queuePatch({ requiredByDate: event.target.value })} /></label>
                <label>Job type<select value={survey.jobType} onChange={(event) => {
                  const jobType = event.target.value as SurveyRecord["jobType"];
                  queuePatch({
                    jobType,
                    surveyIntent: {
                      ...inferSurveyorIntent({ text: survey.customerRequirements, jobType, evidenceCount: survey.photos.length }),
                      updatedAt: new Date().toISOString(),
                    },
                  });
                }}>{surveyJobTypes.map((type) => <option key={type}>{type}</option>)}</select><small>The selected job type controls the next questions.</small></label>
                <label>Property<select value={survey.occupancy} onChange={(event) => queuePatch({ occupancy: event.target.value as SurveyRecord["occupancy"] })}><option>Occupied</option><option>Vacant</option><option>Unknown</option></select></label>
                <label>Pricing market<select value={survey.market} onChange={(event) => queuePatch({ market: event.target.value as SurveyRecord["market"] })}><option>Domestic</option><option>Commercial</option></select></label>
                <label className="wide">What are we doing? (required for pricing)<textarea value={survey.customerRequirements} onChange={(event) => updateCustomerRequirement(event.target.value)} placeholder="Example: move two existing radiators to new positions and alter the pipework..." /></label>
                {surveyorPath ? (
                  <div className="guided-intent-card wide">
                    <header>
                      <span>
                        <strong>Dynamic survey path</strong>
                        <small>NeXa changes the questions from the item and type of work.</small>
                      </span>
                      <b>{surveyorPath.intent.confidence}</b>
                    </header>
                    <div className="guided-intent-controls">
                      <label>Item / asset<select value={surveyorPath.intent.itemGroup} onChange={(event) => updateSurveyIntent({ itemGroup: event.target.value as SurveyorIntent["itemGroup"] })}>{surveyorItemGroups.map((item) => <option key={item} value={item}>{surveyorItemGroupLabels[item]}</option>)}</select></label>
                      <label>Type of work<select value={surveyorPath.intent.workType} onChange={(event) => updateSurveyIntent({ workType: event.target.value as SurveyorIntent["workType"] })}>{surveyorWorkTypes.map((item) => <option key={item} value={item}>{surveyorWorkTypeLabels[item]}</option>)}</select></label>
                      <label>Evidence confidence<select value={surveyorPath.intent.confidence} onChange={(event) => updateSurveyIntent({ confidence: event.target.value as SurveyEvidenceConfidence })}>{surveyEvidenceConfidenceOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
                    </div>
                    <p>{surveyorPath.summary}</p>
                  </div>
                ) : null}
                {suggestedJobType && suggestedJobType !== survey.jobType ? (
                  <div className="guided-job-type-suggestion wide">
                    <span><strong>Suggested question set: {suggestedJobType}</strong><small>NeXa will ask different questions for a radiator move than a boiler change or bathroom refurb.</small></span>
                    <button type="button" onClick={() => queuePatch({ jobType: suggestedJobType })}>Use this</button>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeStep === "conditions" ? (
            <>
              <section className="guided-form-section guided-question-set-card">
                <div className="guided-section-title"><ClipboardCheck size={18} /><span><h2>{survey.jobType} question set</h2><p>{questionSet?.intro}</p></span></div>
                <div className="guided-question-set-meta">
                  <span>{questions.length} focused checks</span>
                  <span>{questions.filter((item) => item.required).length} required</span>
                  <button type="button" onClick={() => void goToStep("details")}>Change job type</button>
                </div>
              </section>
              <section className="guided-question-list">
                {questions.map((question, index) => {
                  const answer = survey.answers.find((item) => item.key === question.key);
                  return <article key={question.key}>
                    <div className="guided-question-number">{index + 1}</div>
                    <div className="guided-question-body">
                      <span><b>{question.section}</b>{question.required ? <em>{question.safetyCritical ? "Safety required" : "Required"}</em> : null}</span>
                      <h2>{question.question}</h2>
                      <div className="guided-answer-status">
                        {(["Confirmed", "TBC", "Not applicable"] as SurveyValueStatus[]).map((status) => <button className={answer?.status === status ? "active" : ""} type="button" key={status} onClick={() => updateAnswer(question.key, { status, value: status === "Not applicable" ? "Not applicable" : answer?.value ?? "" })}>{status}</button>)}
                      </div>
                      <textarea value={answer?.value?.toString() || ""} onChange={(event) => updateAnswer(question.key, { value: event.target.value })} placeholder="Record the site facts. Do not guess." disabled={answer?.status === "Not applicable"} />
                      {answer?.status === "TBC" ? <label className="guided-tbc-reason">Why is this TBC?<input value={answer.tbcReason || ""} onChange={(event) => updateAnswer(question.key, { tbcReason: event.target.value })} placeholder="Supplier confirmation, inaccessible route, design check..." /></label> : null}
                    </div>
                  </article>;
                })}
              </section>
            </>
          ) : null}

          {activeStep === "scope" ? (
            <section className="guided-form-section">
              <div className="guided-section-title"><Wrench size={18} /><span><h2>Proposed scope</h2><p>Add at least one task. Estimator builds materials and labour from these items.</p></span></div>
              {surveyorPath ? (
                <section className="guided-dynamic-surveyor-card">
                  <header>
                    <span><Bot size={17} /><strong>{surveyorPath.title}</strong></span>
                    <small>{surveyorPath.intent.itemGroup} · {surveyorPath.intent.workType}</small>
                  </header>
                  <p>{surveyorPath.summary}</p>
                  <div className="guided-dynamic-grid">
                    <article>
                      <h3>Next questions</h3>
                      <ol>
                        {surveyorPath.nextQuestions.map((item) => (
                          <li key={item.id}><strong>{item.question}</strong><span>{item.why}</span></li>
                        ))}
                      </ol>
                    </article>
                    <article>
                      <h3>Evidence confidence</h3>
                      <ul>{surveyorPath.evidencePrompts.map((item) => <li key={item}>{item}</li>)}</ul>
                    </article>
                    <article>
                      <h3>Materials to build</h3>
                      <ul>{surveyorPath.materialBuild.map((item) => <li key={item}>{item}</li>)}</ul>
                    </article>
                    <article>
                      <h3>Labour and handoff</h3>
                      <ul>{[...surveyorPath.labourBuild, ...surveyorPath.takeoffHandoff].map((item) => <li key={item}>{item}</li>)}</ul>
                    </article>
                  </div>
                  {surveyorPath.estimatorWarnings.length ? <div className="guided-estimator-warnings">{surveyorPath.estimatorWarnings.map((item) => <span key={item}>{item}</span>)}</div> : null}
                  <div className="guided-dynamic-actions">
                    <button type="button" onClick={() => setScopeDraft({
                      ...scopeDraft,
                      taskType: surveyorPath.scopeDraft.taskType,
                      trade: "Plumbing/Heating",
                      dimensions: surveyorPath.scopeDraft.dimensions,
                      status: surveyorPath.intent.confidence === "High" ? "Confirmed" : "Provisional",
                      notes: surveyorPath.scopeDraft.notes,
                    })}><Wrench size={16} /> Use this for scope draft</button>
                    <button type="button" onClick={() => void askNexa(undefined, `Challenge this ${surveyorPath.intent.itemGroup} ${surveyorPath.intent.workType} survey path. What are the missing checks before it can become a quote?`)}><Bot size={16} /> Ask NeXa to challenge it</button>
                    <a href={takeoffRoomsHref}><ScanLine size={16} /> LiDAR / Takeoffs handoff</a>
                  </div>
                </section>
              ) : null}
              <div className="guided-record-list">{survey.scopeItems.map((item) => <article key={item.id}><span><strong>{item.taskType}</strong><small>{item.trade} · {item.roomOrArea || "Area TBC"} · Qty {item.quantity}</small></span><b>{item.status}</b><button title="Remove scope item" aria-label="Remove scope item" type="button" onClick={() => queuePatch({ scopeItems: survey.scopeItems.filter((row) => row.id !== item.id) })}><Trash2 size={15} /></button></article>)}</div>
              <div className="guided-scope-notes">
                <label>Work by others<textarea value={survey.workByOthers.join("\n")} onChange={(event) => queuePatch({ workByOthers: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} placeholder="One item per line" /></label>
                <label>Survey assumptions<textarea value={survey.assumptions.join("\n")} onChange={(event) => queuePatch({ assumptions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} placeholder="One item per line" /></label>
              </div>
              <div className="guided-add-form">
                <label className="wide">Task type<input value={scopeDraft.taskType} onChange={(event) => setScopeDraft({ ...scopeDraft, taskType: event.target.value })} placeholder="Relocate boiler, install radiator, strip out..." /></label>
                <label>Trade<select value={scopeDraft.trade} onChange={(event) => setScopeDraft({ ...scopeDraft, trade: event.target.value })}><option>Plumbing/Heating</option><option>Joinery</option><option>Electrical</option><option>Tiling/Flooring</option><option>Painting</option><option>Other</option></select></label>
                <label>Room / area<input value={scopeDraft.roomOrArea} onChange={(event) => setScopeDraft({ ...scopeDraft, roomOrArea: event.target.value })} /></label>
                <label>Existing position<input value={scopeDraft.existingPosition} onChange={(event) => setScopeDraft({ ...scopeDraft, existingPosition: event.target.value })} /></label>
                <label>Proposed position<input value={scopeDraft.proposedPosition} onChange={(event) => setScopeDraft({ ...scopeDraft, proposedPosition: event.target.value })} /></label>
                <label>Quantity<input type="number" min="0" step="0.01" value={scopeDraft.quantity} onChange={(event) => setScopeDraft({ ...scopeDraft, quantity: Number(event.target.value) })} /></label>
                <label>Status<select value={scopeDraft.status} onChange={(event) => setScopeDraft({ ...scopeDraft, status: event.target.value as SurveyScopeItem["status"] })}><option>Confirmed</option><option>Assumed</option><option>Provisional</option><option>TBC</option></select></label>
                <label>Responsibility<select value={scopeDraft.responsibility} onChange={(event) => setScopeDraft({ ...scopeDraft, responsibility: event.target.value as SurveyScopeItem["responsibility"] })}><option>EWG</option><option>Client</option><option>Main contractor</option><option>Other trade</option></select></label>
                <label>Dimensions<input value={scopeDraft.dimensions} onChange={(event) => setScopeDraft({ ...scopeDraft, dimensions: event.target.value })} /></label>
                <label className="wide">Notes<textarea value={scopeDraft.notes} onChange={(event) => setScopeDraft({ ...scopeDraft, notes: event.target.value })} /></label>
                {scopeDraft.status === "TBC" ? <label className="wide">TBC reason<input value={scopeDraft.tbcReason || ""} onChange={(event) => setScopeDraft({ ...scopeDraft, tbcReason: event.target.value })} /></label> : null}
                <button className="guided-primary-action" type="button" disabled={!scopeDraft.taskType.trim()} onClick={async () => { if (await saveRepeatable("scope-items", { ...scopeDraft, id: nextId("survey-scope") })) setScopeDraft(blankScope); }}><Plus size={16} /> Add scope item</button>
              </div>
            </section>
          ) : null}

          {activeStep === "measurements" ? (
            <section className="guided-measurement-sections">
              <section className="guided-form-section guided-lidar-section">
                <div className="guided-section-title"><ScanLine size={18} /><span><h2>LiDAR / room scans</h2><p>Use this as dimensional evidence, then confirm the rooms and pipe runs below.</p></span></div>
                <div className="guided-lidar-layout">
                  <div className="guided-lidar-summary">
                    <strong>{lidarEvidence.length}</strong>
                    <span>scan export{lidarEvidence.length === 1 ? "" : "s"} saved</span>
                    <small>RoomPlan files are kept with the survey evidence. Takeoffs uses the same scan as room context, dimensions and markup evidence.</small>
                  </div>
                  <div className="guided-lidar-actions">
                    <label className="wide">Scan note<input value={lidarCaption} onChange={(event) => setLidarCaption(event.target.value)} placeholder="Bathroom RoomPlan scan, hallway dimensions, existing cupboard..." /></label>
                    {surveyRoomScanDeepLink(survey) ? (
                      <a className="guided-secondary-action" href={surveyRoomScanDeepLink(survey)}><ScanLine size={16} /> Open room scanner</a>
                    ) : null}
                    <label className="guided-camera-button">
                      {uploading ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
                      Import LiDAR export
                      <input hidden type="file" accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply,application/json,model/*" multiple onChange={(event) => void uploadLidarEvidence(event)} />
                    </label>
                    <a className="guided-secondary-action" href={takeoffRoomsHref}><Ruler size={16} /> Use in Takeoffs</a>
                  </div>
                </div>
                {lidarEvidence.length ? (
                  <div className="guided-record-list guided-lidar-list">
                    {lidarEvidence.map((photo) => (
                      <article key={photo.id}>
                        <span>
                          <strong>{photo.fileName}</strong>
                          <small>{photo.caption || "LiDAR / RoomPlan scan evidence"} · {new Date(photo.capturedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small>
                        </span>
                        <b>{Math.max(1, Math.round(photo.size / 1024))} KB</b>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="guided-form-section">
                <div className="guided-section-title"><Building2 size={18} /><span><h2>Rooms and areas</h2><p>Dimensions remain survey evidence, not priced quantities.</p></span></div>
                <div className="guided-record-list">{survey.rooms.map((room) => <article key={room.id}><span><strong>{room.name}</strong><small>{[room.lengthM, room.widthM, room.heightM].filter(Boolean).join("m × ")}{room.heightM ? "m" : ""}</small></span><button title="Remove room" type="button" onClick={() => queuePatch({ rooms: survey.rooms.filter((row) => row.id !== room.id) })}><Trash2 size={15} /></button></article>)}</div>
                <div className="guided-add-form compact"><label>Room / area<input value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} /></label><label>Length (m)<input inputMode="decimal" onChange={(event) => setRoomDraft({ ...roomDraft, lengthM: numberOrUndefined(event.target.value) })} /></label><label>Width (m)<input inputMode="decimal" onChange={(event) => setRoomDraft({ ...roomDraft, widthM: numberOrUndefined(event.target.value) })} /></label><label>Height (m)<input inputMode="decimal" onChange={(event) => setRoomDraft({ ...roomDraft, heightM: numberOrUndefined(event.target.value) })} /></label><label>Wall construction<input value={roomDraft.wallConstruction} onChange={(event) => setRoomDraft({ ...roomDraft, wallConstruction: event.target.value })} /></label><label>Floor construction<input value={roomDraft.floorConstruction} onChange={(event) => setRoomDraft({ ...roomDraft, floorConstruction: event.target.value })} /></label><label>Ceiling construction<input value={roomDraft.ceilingConstruction} onChange={(event) => setRoomDraft({ ...roomDraft, ceilingConstruction: event.target.value })} /></label><label className="wide">Access notes<textarea value={roomDraft.accessNotes} onChange={(event) => setRoomDraft({ ...roomDraft, accessNotes: event.target.value })} /></label><button className="guided-primary-action" type="button" disabled={!roomDraft.name.trim()} onClick={async () => { if (await saveRepeatable("rooms", { ...roomDraft, id: nextId("survey-room") })) setRoomDraft(blankRoom); }}><Plus size={16} /> Add room</button></div>
              </section>

              <section className="guided-form-section">
                <div className="guided-section-title"><Ruler size={18} /><span><h2>Pipe runs</h2><p>Record every service independently, with a measurement status.</p></span></div>
                <div className="guided-record-list">{survey.pipeRuns.map((run) => <article key={run.id}><span><strong>{run.service}: {run.fromLocation} to {run.toLocation}</strong><small>{run.measuredLengthM ?? "TBC"}m · {run.pipeSize || "Size TBC"} · {run.measurementStatus}</small></span><button title="Remove pipe run" type="button" onClick={() => queuePatch({ pipeRuns: survey.pipeRuns.filter((row) => row.id !== run.id) })}><Trash2 size={15} /></button></article>)}</div>
                <div className="guided-add-form"><label>Service<select value={pipeDraft.service} onChange={(event) => setPipeDraft({ ...pipeDraft, service: event.target.value as SurveyPipeRun["service"] })}>{["Hot", "Cold", "Heating flow", "Heating return", "Gas", "Waste", "Soil", "Condensate", "Other"].map((item) => <option key={item}>{item}</option>)}</select></label><label>From<input value={pipeDraft.fromLocation} onChange={(event) => setPipeDraft({ ...pipeDraft, fromLocation: event.target.value })} /></label><label>To<input value={pipeDraft.toLocation} onChange={(event) => setPipeDraft({ ...pipeDraft, toLocation: event.target.value })} /></label><label>Measured length (m)<input inputMode="decimal" onChange={(event) => setPipeDraft({ ...pipeDraft, measuredLengthM: numberOrUndefined(event.target.value) })} /></label><label>Pipe size<input value={pipeDraft.pipeSize} onChange={(event) => setPipeDraft({ ...pipeDraft, pipeSize: event.target.value })} placeholder="22mm" /></label><label>Material<input value={pipeDraft.material} onChange={(event) => setPipeDraft({ ...pipeDraft, material: event.target.value })} /></label><label>Direction fitting type<input list="guided-pipe-fitting-types" value={pipeDraft.directionChanges[0]?.type || ""} onChange={(event) => setPipeDraft({ ...pipeDraft, directionChanges: [{ type: event.target.value, quantity: pipeDraft.directionChanges[0]?.quantity || 0 }] })} placeholder="Elbow, bend, offset..." /><datalist id="guided-pipe-fitting-types">{["Elbow", "Bend", "Offset", "Tee", "Coupling", "Reducer", "Valve", "Adaptor"].map((item) => <option value={item} key={item} />)}</datalist></label><label>Number of those fittings<input type="number" min="0" value={pipeDraft.directionChanges[0]?.quantity || 0} onChange={(event) => setPipeDraft({ ...pipeDraft, directionChanges: [{ type: pipeDraft.directionChanges[0]?.type || "Direction change", quantity: Number(event.target.value) }] })} /></label><label>Measurement status<select value={pipeDraft.measurementStatus} onChange={(event) => setPipeDraft({ ...pipeDraft, measurementStatus: event.target.value as SurveyPipeRun["measurementStatus"] })}><option>Measured</option><option>Drawing-derived</option><option>Allowance</option><option>TBC</option></select></label><label>Access<select value={pipeDraft.accessDifficulty} onChange={(event) => setPipeDraft({ ...pipeDraft, accessDifficulty: event.target.value as SurveyPipeRun["accessDifficulty"] })}><option>Normal</option><option>Restricted</option><option>Difficult</option><option>TBC</option></select></label><label className="wide">Route<textarea value={pipeDraft.route} onChange={(event) => setPipeDraft({ ...pipeDraft, route: event.target.value })} /></label><div className="guided-checkboxes"><label><input type="checkbox" checked={pipeDraft.insulationRequired} onChange={(event) => setPipeDraft({ ...pipeDraft, insulationRequired: event.target.checked })} /> Insulation</label><label><input type="checkbox" checked={pipeDraft.coreDrilling} onChange={(event) => setPipeDraft({ ...pipeDraft, coreDrilling: event.target.checked })} /> Core drilling</label><label><input type="checkbox" checked={pipeDraft.fireStopping} onChange={(event) => setPipeDraft({ ...pipeDraft, fireStopping: event.target.checked })} /> Fire stopping</label><label><input type="checkbox" checked={pipeDraft.makingGood} onChange={(event) => setPipeDraft({ ...pipeDraft, makingGood: event.target.checked })} /> Making good</label></div>{pipeDraft.measurementStatus === "TBC" ? <label className="wide">TBC reason<input value={pipeDraft.tbcReason || ""} onChange={(event) => setPipeDraft({ ...pipeDraft, tbcReason: event.target.value })} /></label> : null}<button className="guided-primary-action" type="button" disabled={!pipeDraft.fromLocation.trim() || !pipeDraft.toLocation.trim()} onClick={async () => { if (await saveRepeatable("pipe-runs", { ...pipeDraft, id: nextId("survey-pipe") })) setPipeDraft(blankPipeRun); }}><Plus size={16} /> Add pipe run</button></div>
              </section>

              <section className="guided-form-section">
                <div className="guided-section-title"><HardHat size={18} /><span><h2>Fixtures and equipment</h2><p>Use RFQ when the make, model or live price must be confirmed.</p></span></div>
                <div className="guided-record-list">{survey.equipmentItems.map((item) => <article key={item.id}><span><strong>{item.description || item.category}</strong><small>{item.make} {item.model} · Qty {item.quantity}{item.rfqRequired ? " · Supplier RFQ" : ""}</small></span><b>{item.status}</b><button title="Remove equipment" type="button" onClick={() => queuePatch({ equipmentItems: survey.equipmentItems.filter((row) => row.id !== item.id) })}><Trash2 size={15} /></button></article>)}</div>
                <div className="guided-add-form"><label>Category<input value={equipmentDraft.category} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, category: event.target.value })} placeholder="Boiler, flue, radiator..." /></label><label>Room / area<input value={equipmentDraft.roomOrArea} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, roomOrArea: event.target.value })} /></label><label className="wide">Description<input value={equipmentDraft.description} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, description: event.target.value })} /></label><label>Make<input value={equipmentDraft.make} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, make: event.target.value })} /></label><label>Model<input value={equipmentDraft.model} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, model: event.target.value })} /></label><label>Supplier code<input value={equipmentDraft.supplierCode} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, supplierCode: event.target.value })} /></label><label>Quantity<input type="number" min="0" step="0.01" value={equipmentDraft.quantity} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, quantity: Number(event.target.value) })} /></label><label>Confirmed supplier price<input inputMode="decimal" value={equipmentDraft.confirmedSupplierPrice ?? ""} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, confirmedSupplierPrice: numberOrUndefined(event.target.value) })} placeholder="Leave blank if RFQ" /></label><label>Dimensions<input value={equipmentDraft.dimensions} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, dimensions: event.target.value })} /></label><label>Output / capacity<input value={equipmentDraft.outputOrCapacity} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, outputOrCapacity: event.target.value })} /></label><label className="wide">Connection requirements<textarea value={equipmentDraft.connectionRequirements} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, connectionRequirements: event.target.value })} /></label><label>Status<select value={equipmentDraft.status} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, status: event.target.value as SurveyValueStatus })}><option>Confirmed</option><option>Assumed</option><option>Provisional</option><option>TBC</option></select></label><label className="guided-checkbox-field"><input type="checkbox" checked={equipmentDraft.rfqRequired} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, rfqRequired: event.target.checked })} /> Supplier RFQ required</label>{equipmentDraft.status === "TBC" ? <label className="wide">TBC reason<input value={equipmentDraft.tbcReason || ""} onChange={(event) => setEquipmentDraft({ ...equipmentDraft, tbcReason: event.target.value })} /></label> : null}<button className="guided-primary-action" type="button" disabled={!equipmentDraft.category.trim() && !equipmentDraft.description.trim()} onClick={async () => { if (await saveRepeatable("equipment", { ...equipmentDraft, id: nextId("survey-equipment") })) setEquipmentDraft(blankEquipment); }}><Plus size={16} /> Add equipment</button></div>
              </section>
            </section>
          ) : null}

          {activeStep === "photos" ? (
            <section className="guided-form-section">
              <div className="guided-section-title"><ImagePlus size={18} /><span><h2>Categorised photographs</h2><p>Every photograph must explain what it proves.</p></span></div>
              <div className="guided-photo-upload"><label>Category<select value={photoCategory} onChange={(event) => setPhotoCategory(event.target.value as SurveyPhotoCategory)}>{photoCategories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="wide">Caption<input value={photoCaption} onChange={(event) => setPhotoCaption(event.target.value)} placeholder="What does this photograph prove?" /></label><label className="guided-camera-button">{uploading ? <Loader2 className="spin" size={18} /> : <Camera size={18} />} Take or choose photographs<input hidden type="file" accept="image/*" capture="environment" multiple onChange={(event) => void uploadPhotos(event)} /></label></div>
              <div className="guided-photo-list">{survey.photos.map((photo) => <article key={photo.id}><ImagePlus size={18} /><span><strong>{photo.category}</strong><small>{photo.fileName}</small><p>{photo.caption || "No caption added"}</p></span><time>{new Date(photo.capturedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time></article>)}</div>
            </section>
          ) : null}

          {activeStep === "review" ? (
            <section className="guided-review">
              <div className="guided-review-banner" data-ready={review?.canSendToEstimator ? "true" : "false"}>{review?.canSendToEstimator ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}<span><h2>{review?.canSendToEstimator ? "Ready for Estimator" : review?.canComplete ? "Survey captured; pricing information is still needed" : "Completion checks need attention"}</h2><p>Complete captures the site record. Estimator handoff also requires a clear customer outcome, structured scope and usable evidence.</p></span></div>
              <div className="guided-review-groups">
                <ReviewGroup title="Blocking items" tone="danger" items={review?.blockers.map((item) => item.message) || []} />
                <ReviewGroup title="Pricing readiness" tone="danger" items={review?.pricingReadinessIssues.map((item) => item.message) || []} />
                <ReviewGroup title="Missing information" items={review?.missingInformation.map((item) => item.message) || []} />
                <ReviewGroup title="TBC items" items={review?.tbcItems.map((item) => item.message) || []} />
                <ReviewGroup title="Design dependencies" items={review?.designDependencies.map((item) => item.message) || []} />
                <ReviewGroup title="Supplier RFQs" items={review?.supplierRfqs.map((item) => item.message) || []} />
              </div>
              <div className="guided-review-actions"><button type="button" onClick={() => void loadReview()}><ClipboardCheck size={16} /> Refresh review</button><a href={`/api/surveys/${encodeURIComponent(survey.id)}/pdf`} target="_blank" rel="noreferrer"><Download size={16} /> Survey PDF</a>{survey.estimateId ? <a href={`/estimator?estimate=${encodeURIComponent(survey.estimateId)}`}><Calculator size={16} /> Open current estimate</a> : null}{survey.status === "Complete" || survey.status === "Sent to estimator" ? <button className="guided-primary-action" type="button" disabled={!review?.canSendToEstimator} onClick={() => void sendToEstimator()}><Send size={16} /> {survey.status === "Sent to estimator" ? "Update Estimator" : "Send to Estimator"}</button> : <button className="guided-primary-action" type="button" disabled={!review?.canComplete} onClick={() => void completeCurrentSurvey()}><CheckCircle2 size={16} /> Complete survey</button>}</div>
            </section>
          ) : null}

          <footer className="guided-workspace-footer">
            <button type="button" disabled={currentStepIndex === 0} onClick={() => void goToStep(steps[currentStepIndex - 1]!.key)}><ArrowLeft size={16} /> Back</button>
            <button type="button" onClick={() => void flushAutosave()}><Save size={16} /> Save now</button>
            {currentStepIndex < steps.length - 1 ? <button className="guided-primary-action" type="button" onClick={() => void goToStep(steps[currentStepIndex + 1]!.key)}>Save and continue <ArrowRight size={16} /></button> : null}
          </footer>
        </section>
      </div>
    </main>
  );
}

function ReviewGroup({ title, items, tone = "normal" }: { title: string; items: string[]; tone?: "normal" | "danger" }) {
  return <section className={`guided-review-group ${tone}`}><header><strong>{title}</strong><b>{items.length}</b></header>{items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <p>None</p>}</section>;
}
