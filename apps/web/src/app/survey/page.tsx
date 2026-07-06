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
import type { ClientSite } from "@/lib/people-data";
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

function quoteSite(quote: Quote, clientSites: ClientSite[]) {
  return quote.siteId ? clientSites.find((site) => site.id === quote.siteId) : undefined;
}

function quoteSearchLabel(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [quote.ref, quote.customer, site?.address, quote.description].filter(Boolean).join(" - ");
}

function quoteSearchText(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [
    quote.ref,
    quote.customer,
    site?.name,
    site?.address,
    quote.description,
    quote.owner,
    quote.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

function shouldReplaceProjectText(value: string) {
  const normalised = value.trim().toLowerCase();
  return [
    "",
    "new survey pricing chat",
    "customer to confirm",
    "site to confirm",
    "takeoff scope to review.",
    "survey conversation started from nexa survey.",
  ].includes(normalised);
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
  const [clientSites, setClientSites] = useState<ClientSite[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [isQuoteSearchOpen, setIsQuoteSearchOpen] = useState(false);
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
  const linkedQuote = useMemo(
    () => selectedProject
      ? quotes.find((quote) => quote.id === selectedProject.linkedQuoteId || quote.ref === selectedProject.linkedQuoteRef) ?? null
      : null,
    [quotes, selectedProject],
  );
  const quoteSearchMatches = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase();
    const source = query
      ? quotes.filter((quote) => quoteSearchText(quote, clientSites).includes(query))
      : quotes;
    return source.slice(0, 6);
  }, [clientSites, quoteSearch, quotes]);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setQuoteSearch(linkedQuote ? quoteSearchLabel(linkedQuote, clientSites) : "");
  }, [clientSites, linkedQuote]);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [projectResponse, quoteResponse, siteResponse] = await Promise.all([
        fetch("/api/takeoff-projects", { headers: requestHeaders }),
        fetch("/api/quotes", { headers: requestHeaders }),
        fetch("/api/client-sites", { headers: requestHeaders }),
      ]);
      if (!projectResponse.ok) throw new Error("Unable to load survey jobs");
      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = quoteResponse.ok ? ((await quoteResponse.json()) as Quote[]) : [];
      const nextClientSites = siteResponse.ok ? ((await siteResponse.json()) as ClientSite[]) : [];
      setProjects(nextProjects);
      setQuotes(nextQuotes);
      setClientSites(nextClientSites);
      setSelectedProjectId((current) => current || nextProjects[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load survey app");
    } finally {
      setIsLoading(false);
    }
  }

  async function linkQuoteToProject(quote: Quote) {
    if (!selectedProject) return;
    const site = quoteSite(quote, clientSites);
    setQuoteSearch(quoteSearchLabel(quote, clientSites));
    setIsQuoteSearchOpen(false);
    await patchProject(selectedProject.id, {
      linkedQuoteId: quote.id,
      customer: quote.customer,
      site: site?.address ?? selectedProject.site,
      name: shouldReplaceProjectText(selectedProject.name) ? `${quote.description} survey` : selectedProject.name,
      description: shouldReplaceProjectText(selectedProject.description) ? quote.description : selectedProject.description,
    }, `Linked to ${quote.ref}.`);
  }

  async function clearQuoteLinkIfEmpty(value: string) {
    if (!selectedProject || value.trim() || !selectedProject.linkedQuoteId) return;
    await patchProject(selectedProject.id, { linkedQuoteId: "" }, "Quote link cleared.");
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
    setNotice("Live LiDAR capture needs the native NeXa Field app installed. For now, use Import scan file here; once NeXa Field is installed this project link will open the camera scanner.");
  }

  async function copyRoomScanLink() {
    if (!selectedProject) return;
    try {
      await navigator.clipboard.writeText(roomScanDeepLink(selectedProject));
      setNotice("NeXa Field scanner link copied. Use it after the native iPad/iPhone app is installed.");
    } catch {
      setError("Could not copy the scanner link. Use Import scan file for now.");
    }
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
                  <div className="quote-search-control">
                    <input
                      type="search"
                      value={quoteSearch}
                      placeholder="Search quote, client or address..."
                      onChange={(event) => {
                        setQuoteSearch(event.target.value);
                        setIsQuoteSearchOpen(true);
                        void clearQuoteLinkIfEmpty(event.target.value);
                      }}
                      onFocus={() => setIsQuoteSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsQuoteSearchOpen(false), 140)}
                    />
                    {isQuoteSearchOpen ? (
                      <div className="quote-search-results">
                        {quoteSearchMatches.length ? quoteSearchMatches.map((quote) => {
                          const site = quoteSite(quote, clientSites);
                          return (
                            <button type="button" key={quote.id} onClick={() => void linkQuoteToProject(quote)}>
                              <strong>{quote.ref} - {quote.customer}</strong>
                              <small>{site?.address ?? quote.description}</small>
                            </button>
                          );
                        }) : (
                          <span>No matching quote, client or site address.</span>
                        )}
                      </div>
                    ) : null}
                  </div>
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
                    <strong>{linkedQuote?.ref ?? selectedProject.linkedQuoteRef ?? "Not linked"}</strong>
                  </article>
                  <div className="survey-next-steps">
                    <strong>How this should work live</strong>
                    <p>On iPad/iPhone, the installed NeXa Field app will open the LiDAR camera scanner directly. Until it is installed, import a scan export here.</p>
                  </div>
                </aside>
              </section>

              {showRoomScanBridge ? (
                <section className="survey-roomscan-bridge" aria-label="LiDAR room scan setup">
                  <div>
                    <ScanLine size={22} />
                    <span>
                      <strong>LiDAR camera scan</strong>
                      <small>The browser cannot open the LiDAR camera directly. Native NeXa Field will do that once installed; today this panel imports scan exports into the survey.</small>
                    </span>
                  </div>
                  <ol>
                    <li>For today, scan the room in a LiDAR app and export the RoomPlan/3D file.</li>
                    <li>Tap Import scan file below and attach the exported scan to this survey.</li>
                    <li>Once NeXa Field is installed on this iPad/iPhone, the copied app link will open the camera scanner directly.</li>
                  </ol>
                  <div className="survey-roomscan-actions">
                    <label className={isUploading ? "takeoff-upload-button disabled" : "takeoff-upload-button"}>
                      <Upload size={15} />
                      Import scan file
                      <input hidden type="file" accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply" onChange={(event) => void uploadEvidence("LiDAR scan", event)} />
                    </label>
                    <button className="takeoff-secondary-button" type="button" onClick={() => void copyRoomScanLink()}>
                      <Link2 size={15} />
                      Copy app link
                    </button>
                    <button className="takeoff-secondary-button" type="button" onClick={() => setShowRoomScanBridge(false)}>
                      Close
                    </button>
                  </div>
                  <p>
                    <Info size={14} />
                    Safari showed "address is invalid" because the native NeXa Field scanner is not installed on this device yet.
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
