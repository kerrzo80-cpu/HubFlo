"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  Bot,
  Camera,
  CheckCircle2,
  FileText,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  Ruler,
  ScanLine,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import type { Quote } from "@/lib/workflow-data";
import type { TakeoffDocumentKind, TakeoffProject, TakeoffSurveyChatMessage } from "@/lib/takeoff-data";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultOpening(project: TakeoffProject): TakeoffSurveyChatMessage[] {
  return [
    {
      id: makeId("survey-chat"),
      role: "assistant",
      text: `What are we pricing today for ${project.customer}? Start with the customer outcome, then I will ask for the photos, room scan, measurements and exclusions we need.`,
      createdAt: nowIso(),
    },
  ];
}

function nextAssistantReply(answer: string, project: TakeoffProject) {
  const lower = answer.toLowerCase();
  if (/photo|picture|image|camera|video/.test(lower)) {
    return "Good. Add photos of the boiler or appliance, access routes, existing pipework, each affected room, windows, floors and anything the office needs to see before pricing.";
  }
  if (/lidar|roomplan|scan|measure|dimension|room/.test(lower)) {
    return "Use the iPad/iPhone room scan on site, then import the RoomPlan export here. I will use it to populate rooms, dimensions and quantity checks for the Takeoff pack.";
  }
  if (/radiator|heat loss|heating|boiler|cylinder|flue/.test(lower)) {
    return "For heating work, I need heat source location, flue/condensate route, controls, room dimensions, window type/area and radiator position constraints. Which of those still needs captured?";
  }
  if (/quote|boq|bill|materials|supplier|cost/.test(lower)) {
    return "I can build the quote pack from this conversation, the photos and any scan/BOQ files. Before sending to NeXa, what items need supplier prices and what should be treated as an allowance?";
  }
  if (/variation|extra|additional|change/.test(lower)) {
    return "Is this extra work approved to proceed, or does the office need to send a variation quote first? Capture description, hours, materials and any photos that prove the change.";
  }
  return `Got it. What would someone pricing ${project.name} regret not knowing later: access, exclusions, materials, labour time, client preference, or supplier quote items?`;
}

function quoteLabel(quote: Quote) {
  return `${quote.ref} - ${quote.description}`;
}

function roomScanDeepLink(project: TakeoffProject) {
  const params = new URLSearchParams({
    projectId: project.id,
    reference: project.reference,
    projectName: project.name,
  });
  if (typeof window !== "undefined") {
    params.set("returnUrl", `${window.location.origin}/survey`);
  }
  return `nexa-field://room-scan?${params.toString()}`;
}

export default function SurveyPage() {
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [showRoomScanBridge, setShowRoomScanBridge] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const messages = selectedProject?.surveyChat?.length ? selectedProject.surveyChat : selectedProject ? defaultOpening(selectedProject) : [];
  const projectDocuments = selectedProject?.documents ?? [];
  const photoCount = projectDocuments.filter((document) => document.kind === "Survey photo").length;
  const scanCount = projectDocuments.filter((document) => document.kind === "LiDAR scan").length;

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [projectResponse, quoteResponse] = await Promise.all([
        fetch("/api/takeoff-projects", { headers: requestHeaders }),
        fetch("/api/quotes", { headers: requestHeaders }),
      ]);
      if (!projectResponse.ok) throw new Error("Unable to load survey jobs");
      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = quoteResponse.ok ? ((await quoteResponse.json()) as Quote[]) : [];
      setProjects(nextProjects);
      setQuotes(nextQuotes);
      setSelectedProjectId((current) => current || nextProjects[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load survey app");
    } finally {
      setIsLoading(false);
    }
  }

  function replaceProject(project: TakeoffProject) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
    setSelectedProjectId(project.id);
  }

  async function patchProject(projectId: string, patch: Partial<TakeoffProject>, successMessage?: string) {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Unable to save survey");
      const updated = (await response.json()) as TakeoffProject;
      replaceProject(updated);
      if (successMessage) setNotice(successMessage);
      return updated;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save survey");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function createSurveyChat() {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "New survey pricing chat",
          customer: "Customer to confirm",
          site: "Site to confirm",
          description: "Survey conversation started from NeXa Survey.",
          surveyChat: [
            {
              id: makeId("survey-chat"),
              role: "assistant",
              text: "What are we pricing today?",
              createdAt: nowIso(),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error("Unable to create survey chat");
      const created = (await response.json()) as TakeoffProject;
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.id);
      setNotice("Survey chat created.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey chat");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSurveyChat(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const shouldDelete = window.confirm(`Delete survey chat ${project.reference}? This removes the test chat and its captured evidence from this pilot.`);
    if (!shouldDelete) return;

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        headers: requestHeaders,
      });
      if (!response.ok) throw new Error("Unable to delete survey chat");
      setProjects((current) => {
        const nextProjects = current.filter((item) => item.id !== projectId);
        setSelectedProjectId((currentSelected) => currentSelected === projectId ? nextProjects[0]?.id ?? "" : currentSelected);
        return nextProjects;
      });
      setNotice("Survey chat deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete survey chat");
    } finally {
      setIsSaving(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !draft.trim()) return;
    const userMessage: TakeoffSurveyChatMessage = {
      id: makeId("survey-chat"),
      role: "user",
      text: draft.trim(),
      createdAt: nowIso(),
    };
    const assistantMessage: TakeoffSurveyChatMessage = {
      id: makeId("survey-chat"),
      role: "assistant",
      text: nextAssistantReply(draft, selectedProject),
      createdAt: nowIso(),
    };
    setDraft("");
    const nextMessages = [...messages, userMessage, assistantMessage];
    await patchProject(selectedProject.id, {
      surveyChat: nextMessages,
      description: selectedProject.description === "Takeoff scope to review." ? userMessage.text : selectedProject.description,
    }, "Survey conversation saved.");
  }

  async function uploadEvidence(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    if (!selectedProject || !event.target.files?.length) return;
    const files = Array.from(event.target.files);
    const formData = new FormData();
    formData.append("kind", kind);
    files.forEach((file) => formData.append("files", file));
    setIsUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/documents`, {
        method: "POST",
        headers: requestHeaders,
        body: formData,
      });
      if (!response.ok) throw new Error("Unable to import evidence");
      const result = (await response.json()) as { project: TakeoffProject };
      const attachmentNames = files.map((file) => file.name);
      const assistantMessage: TakeoffSurveyChatMessage = {
        id: makeId("survey-chat"),
        role: "assistant",
        text: kind === "LiDAR scan"
          ? "Room scan imported. I will use this as dimensional evidence for rooms, heat loss and quantities when the quote pack is built."
          : "Photos imported. Tell me what each photo proves or what the office should check when pricing.",
        createdAt: nowIso(),
        attachments: attachmentNames,
      };
      replaceProject({
        ...result.project,
        surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage],
      });
      await patchProject(result.project.id, { surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage] }, `${kind} imported.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to import evidence");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  async function prepareQuotePack() {
    if (!selectedProject) return;
    setIsBuilding(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/survey-plan`, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ actor: "NeXa Survey" }),
      });
      if (!response.ok) throw new Error("Unable to build survey pack");
      const result = (await response.json()) as { project: TakeoffProject; provider: string; generated: { questions: number; stopGo: number } };
      const assistantMessage: TakeoffSurveyChatMessage = {
        id: makeId("survey-chat"),
        role: "assistant",
        text: `${result.provider} quote pack prepared with ${result.generated.questions} pricing question(s) and ${result.generated.stopGo} safety gate(s). Open Takeoff to review the BOQ and supplier request before pushing to the quote.`,
        createdAt: nowIso(),
      };
      const nextProject = {
        ...result.project,
        surveyChat: [...(result.project.surveyChat ?? messages), assistantMessage],
      };
      replaceProject(nextProject);
      await patchProject(nextProject.id, { surveyChat: nextProject.surveyChat }, "Survey pack prepared for Takeoff.");
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Unable to build survey pack");
    } finally {
      setIsBuilding(false);
    }
  }

  function openRoomScanBridge() {
    if (!selectedProject) return;
    setShowRoomScanBridge(true);
    setNotice("LiDAR room scan bridge ready. The finished iPad/iPhone app will open the camera scanner; this web pilot can import the RoomPlan export.");
  }

  return (
    <main className="survey-app">
      <header className="takeoff-header">
        <div className="takeoff-brand">
          <img src="/brand/nexa-command-lockup-light.svg" alt="NeXa" />
          <span>Survey assistant</span>
        </div>
        <div className="takeoff-header-actions">
          <a className="takeoff-ghost-button" href="/">
            <ArrowLeft size={16} />
            Core
          </a>
          <a className="takeoff-ghost-button" href="/takeoff">
            <FileText size={16} />
            Takeoff
          </a>
        </div>
      </header>

      <div className="survey-shell">
        <aside className="survey-sidebar">
          <div className="takeoff-sidebar-title">
            <span>Survey chats</span>
            <button className="takeoff-create-project-button" type="button" onClick={createSurveyChat} disabled={isSaving}>
              <Plus size={16} />
              New
            </button>
          </div>
          <div className="takeoff-project-list">
            {projects.map((project) => (
              <article className="takeoff-project-card" key={project.id}>
                <button
                  className={project.id === selectedProject?.id ? "takeoff-project-button active" : "takeoff-project-button"}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <span>
                    <strong>{project.reference}</strong>
                    <small>{project.status}</small>
                  </span>
                  <b>{project.name}</b>
                  <em>{project.customer}</em>
                </button>
                <button
                  className="takeoff-delete-project-button"
                  type="button"
                  aria-label={`Delete ${project.reference}`}
                  onClick={() => void deleteSurveyChat(project.id)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
            {!projects.length && !isLoading ? <p className="takeoff-empty">No survey chats yet.</p> : null}
          </div>
        </aside>

        <section className="survey-main">
          {selectedProject ? (
            <>
              <section className="survey-hero">
                <div>
                  <span className="takeoff-kicker"><b>{selectedProject.reference}</b></span>
                  <h1>{selectedProject.name}</h1>
                  <p>{selectedProject.customer} - {selectedProject.site}</p>
                </div>
                <div className="takeoff-quote-link">
                  <Link2 size={16} />
                  <select
                    value={selectedProject.linkedQuoteId ?? ""}
                    onChange={(event) => void patchProject(selectedProject.id, { linkedQuoteId: event.target.value }, "Quote link updated.")}
                  >
                    <option value="">Link to lead / quote later</option>
                    {quotes.map((quote) => (
                      <option value={quote.id} key={quote.id}>{quoteLabel(quote)}</option>
                    ))}
                  </select>
                </div>
              </section>

              {notice ? <p className="takeoff-notice">{notice}</p> : null}
              {error ? <p className="takeoff-error">{error}</p> : null}

              <section className="survey-workspace">
                <article className="survey-chat-panel">
                  <div className="survey-action-strip">
                    <label className={isUploading ? "takeoff-upload-button disabled" : "takeoff-upload-button"}>
                      <Camera size={15} />
                      Camera / photos
                      <input hidden type="file" accept="image/*,video/*" multiple onChange={(event) => void uploadEvidence("Survey photo", event)} />
                    </label>
                    <button className="takeoff-secondary-button" type="button" onClick={openRoomScanBridge}>
                      <ScanLine size={15} />
                      Start LiDAR scan
                    </button>
                    <button className="takeoff-secondary-button" type="button" onClick={prepareQuotePack} disabled={isBuilding}>
                      {isBuilding ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                      Build quote pack
                    </button>
                    <a className="takeoff-primary-button" href="/takeoff">
                      <Send size={15} />
                      Send to Takeoff
                    </a>
                  </div>

                  <div className="survey-chat-log">
                    {messages.map((message) => (
                      <div className={`survey-message ${message.role}`} key={message.id}>
                        <b>{message.role === "assistant" ? <Bot size={15} /> : "You"}</b>
                        <span>
                          {message.text}
                          {message.attachments?.length ? (
                            <small>{message.attachments.join(", ")}</small>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>

                  <form className="survey-composer" onSubmit={sendMessage}>
                    <textarea
                      placeholder="Reply to the survey assistant..."
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <button className="takeoff-primary-button" type="submit" disabled={!draft.trim() || isSaving}>
                      {isSaving ? <Loader2 className="spin" size={15} /> : <MessageCircle size={15} />}
                      Send
                    </button>
                  </form>
                </article>

                <aside className="survey-capture-panel">
                  <article>
                    <ImagePlus size={18} />
                    <span>Photos</span>
                    <strong>{photoCount}</strong>
                  </article>
                  <article>
                    <Ruler size={18} />
                    <span>Room scans</span>
                    <strong>{scanCount}</strong>
                  </article>
                  <article>
                    <CheckCircle2 size={18} />
                    <span>Linked quote</span>
                    <strong>{selectedProject.linkedQuoteRef ?? "Not linked"}</strong>
                  </article>
                  <div className="survey-next-steps">
                    <strong>How this should work live</strong>
                    <p>On iPad/iPhone, NeXa Field opens the LiDAR camera scanner directly. This web pilot imports RoomPlan files until the native wrapper is built.</p>
                  </div>
                </aside>
              </section>

              {showRoomScanBridge ? (
                <section className="survey-roomscan-bridge" aria-label="LiDAR room scan setup">
                  <div>
                    <ScanLine size={22} />
                    <span>
                      <strong>LiDAR camera scan</strong>
                      <small>Use the iPad/iPhone NeXa Field scanner for live RoomPlan capture. The scan should then flow back into this survey and into Takeoff.</small>
                    </span>
                  </div>
                  <ol>
                    <li>Open NeXa Field on a LiDAR-capable iPad/iPhone.</li>
                    <li>Scan the room with the camera and save the RoomPlan result.</li>
                    <li>Attach the returned RoomPlan export here while the native app bridge is being built.</li>
                  </ol>
                  <div className="survey-roomscan-actions">
                    <a className="takeoff-primary-button" href={roomScanDeepLink(selectedProject)}>
                      <ScanLine size={15} />
                      Open NeXa Field scanner
                    </a>
                    <label className={isUploading ? "takeoff-upload-button disabled" : "takeoff-upload-button"}>
                      <Upload size={15} />
                      Import scan file
                      <input hidden type="file" accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply" onChange={(event) => void uploadEvidence("LiDAR scan", event)} />
                    </label>
                    <button className="takeoff-secondary-button" type="button" onClick={() => setShowRoomScanBridge(false)}>
                      Close
                    </button>
                  </div>
                  <p>
                    <Info size={14} />
                    Safari cannot run Apple RoomPlan directly from this web page. The native NeXa Field app will handle the live LiDAR capture.
                  </p>
                </section>
              ) : null}
            </>
          ) : (
            <section className="takeoff-panel takeoff-empty-state">
              <Upload size={18} />
              <strong>{isLoading ? "Loading survey app" : "Create a survey chat to begin"}</strong>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
