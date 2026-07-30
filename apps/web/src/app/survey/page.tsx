"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ClipboardList, FileSearch, LayoutDashboard, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { SurveyJobLink, SurveyLinkType, SurveyRecord } from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

type CoreQuote = {
  id: string;
  ref: string;
  customer: string;
  description: string;
  clientId?: string;
  siteId?: string;
  status: string;
};

type CoreLead = {
  id: string;
  ref: string;
  customerName: string;
  address: string;
  description: string;
  clientId?: string;
  siteId?: string;
  status: string;
};

type CoreJob = {
  id: string;
  ref: string;
  customer: string;
  site: string;
  description: string;
  clientId?: string;
  siteId?: string;
  status: string;
};

type CoreSite = {
  id: string;
  clientId: string;
  address: string;
  name: string;
};

type LinkChoice = {
  type: SurveyLinkType;
  id: string;
  reference: string;
  customerName: string;
  siteAddress: string;
  description: string;
  clientId?: string;
  siteId?: string;
};

function linkFromSearch(): { type: SurveyLinkType; id: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  for (const type of ["quote", "lead", "job"] as const) {
    const id = params.get(type)?.trim();
    if (id) {
      return {
        type: type === "quote" ? "Quote" : type === "lead" ? "Lead" : "Job",
        id,
      };
    }
  }
  return null;
}

export default function SurveyDirectoryPage() {
  const [surveys, setSurveys] = useState<SurveyRecord[]>([]);
  const [quotes, setQuotes] = useState<CoreQuote[]>([]);
  const [leads, setLeads] = useState<CoreLead[]>([]);
  const [jobs, setJobs] = useState<CoreJob[]>([]);
  const [sites, setSites] = useState<CoreSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkType, setLinkType] = useState<SurveyLinkType | "">("Quote");
  const [linkId, setLinkId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [coreReady, setCoreReady] = useState(false);

  const siteAddressById = useMemo(() => {
    const map = new Map<string, string>();
    sites.forEach((site) => map.set(site.id, site.address || site.name));
    return map;
  }, [sites]);

  const linkChoices = useMemo((): LinkChoice[] => {
    if (linkType === "Quote") {
      return quotes.map((quote) => ({
        type: "Quote" as const,
        id: quote.id,
        reference: quote.ref,
        customerName: quote.customer,
        siteAddress: (quote.siteId && siteAddressById.get(quote.siteId)) || "",
        description: quote.description,
        clientId: quote.clientId,
        siteId: quote.siteId,
      }));
    }
    if (linkType === "Lead") {
      return leads.map((lead) => ({
        type: "Lead" as const,
        id: lead.id,
        reference: lead.ref,
        customerName: lead.customerName,
        siteAddress: lead.address,
        description: lead.description,
        clientId: lead.clientId,
        siteId: lead.siteId,
      }));
    }
    if (linkType === "Job") {
      return jobs.map((job) => ({
        type: "Job" as const,
        id: job.id,
        reference: job.ref,
        customerName: job.customer,
        siteAddress: job.site,
        description: job.description,
        clientId: job.clientId,
        siteId: job.siteId,
      }));
    }
    return [];
  }, [jobs, leads, linkType, quotes, siteAddressById]);

  const filteredChoices = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    if (!q) return linkChoices.slice(0, 12);
    return linkChoices
      .filter((choice) =>
        [choice.reference, choice.customerName, choice.siteAddress, choice.description]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 12);
  }, [linkChoices, linkQuery]);

  const selectedChoice = linkChoices.find((choice) => choice.id === linkId) || null;

  async function loadSurveys(includeArchived = showArchived) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/surveys${includeArchived ? "?includeArchived=1" : ""}`, { headers: requestHeaders });
      if (!response.ok) throw new Error("Unable to load surveys.");
      setSurveys((await response.json()) as SurveyRecord[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load surveys.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCoreRecords() {
    try {
      const [quotesRes, leadsRes, jobsRes, sitesRes] = await Promise.all([
        fetch("/api/quotes", { headers: requestHeaders }),
        fetch("/api/leads", { headers: requestHeaders }),
        fetch("/api/jobs", { headers: requestHeaders }),
        fetch("/api/client-sites", { headers: requestHeaders }),
      ]);
      if (quotesRes.ok) setQuotes((await quotesRes.json()) as CoreQuote[]);
      if (leadsRes.ok) setLeads((await leadsRes.json()) as CoreLead[]);
      if (jobsRes.ok) setJobs((await jobsRes.json()) as CoreJob[]);
      if (sitesRes.ok) setSites((await sitesRes.json()) as CoreSite[]);
    } catch {
      // Create panel can still make an unlinked survey.
    } finally {
      setCoreReady(true);
    }
  }

  useEffect(() => {
    void loadSurveys(showArchived);
  }, [showArchived]);

  useEffect(() => {
    void loadCoreRecords();
  }, []);

  async function createSurvey(choice?: LinkChoice | null) {
    setCreating(true);
    setError("");
    try {
      const jobLink: SurveyJobLink | undefined = choice
        ? { type: choice.type, id: choice.id, reference: choice.reference }
        : undefined;
      const response = await fetch("/api/surveys", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMutationId: crypto.randomUUID(),
          customerName: choice?.customerName || "",
          siteAddress: choice?.siteAddress || "",
          customerId: choice?.clientId,
          siteId: choice?.siteId,
          customerRequirements: choice?.description || "",
          jobLink,
        }),
      });
      if (!response.ok) throw new Error("Unable to create the survey.");
      const created = (await response.json()) as SurveyRecord;
      window.location.href = `/survey/${encodeURIComponent(created.id)}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey.");
      setCreating(false);
    }
  }

  useEffect(() => {
    if (deepLinkHandled || loading || creating || !coreReady) return;
    const wanted = linkFromSearch();
    if (!wanted) {
      setDeepLinkHandled(true);
      return;
    }

    setDeepLinkHandled(true);
    const existing = surveys.find(
      (survey) => survey.jobLink?.type === wanted.type && survey.jobLink.id === wanted.id && survey.status !== "Archived",
    );
    if (existing) {
      window.location.href = `/survey/${encodeURIComponent(existing.id)}`;
      return;
    }

    let choice: LinkChoice | null = null;
    if (wanted.type === "Quote") {
      const quote = quotes.find((item) => item.id === wanted.id || item.ref === wanted.id);
      if (quote) {
        choice = {
          type: "Quote",
          id: quote.id,
          reference: quote.ref,
          customerName: quote.customer,
          siteAddress: (quote.siteId && siteAddressById.get(quote.siteId)) || "",
          description: quote.description,
          clientId: quote.clientId,
          siteId: quote.siteId,
        };
      }
    } else if (wanted.type === "Lead") {
      const lead = leads.find((item) => item.id === wanted.id || item.ref === wanted.id);
      if (lead) {
        choice = {
          type: "Lead",
          id: lead.id,
          reference: lead.ref,
          customerName: lead.customerName,
          siteAddress: lead.address,
          description: lead.description,
          clientId: lead.clientId,
          siteId: lead.siteId,
        };
      }
    } else {
      const job = jobs.find((item) => item.id === wanted.id || item.ref === wanted.id);
      if (job) {
        choice = {
          type: "Job",
          id: job.id,
          reference: job.ref,
          customerName: job.customer,
          siteAddress: job.site,
          description: job.description,
          clientId: job.clientId,
          siteId: job.siteId,
        };
      }
    }

    if (!choice) {
      setError(`Could not find Core ${wanted.type.toLowerCase()} ${wanted.id} to link.`);
      setShowCreate(true);
      setLinkType(wanted.type);
      return;
    }

    void createSurvey(choice);
  }, [coreReady, creating, deepLinkHandled, jobs, leads, loading, quotes, siteAddressById, surveys]);

  function openCreatePanel() {
    setShowCreate(true);
    setLinkType("Quote");
    setLinkId("");
    setLinkQuery("");
    setError("");
    void loadCoreRecords();
  }

  async function archiveSurvey(survey: SurveyRecord) {
    setBusyId(survey.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(survey.id)}?mode=archive&expectedVersion=${survey.version}`, {
        method: "DELETE",
        headers: requestHeaders,
      });
      const body = (await response.json()) as SurveyRecord & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to archive survey.");
      setNotice(`${survey.reference} archived.`);
      await loadSurveys(showArchived);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive survey.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteSurvey(survey: SurveyRecord) {
    if (!window.confirm(`Delete ${survey.reference}? This removes it from the survey list.`)) return;
    setBusyId(survey.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(survey.id)}?mode=delete`, {
        method: "DELETE",
        headers: requestHeaders,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to delete survey.");
      setNotice(`${survey.reference} deleted.`);
      await loadSurveys(showArchived);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete survey.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="survey-simple-app">
      <header className="survey-simple-topbar">
        <div className="survey-simple-brand">
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa" />
          <span>
            <strong>NeXa Surveyor</strong>
            <small>Upload · describe · cost centres</small>
          </span>
        </div>
        <nav className="survey-simple-links">
          <a href="/">
            <LayoutDashboard size={16} /> Core
          </a>
          <a href="/takeoff">
            <FileSearch size={16} /> Takeoffs
          </a>
          <a href="/estimator">
            <Sparkles size={16} /> Estimator
          </a>
        </nav>
      </header>

      <section className="survey-simple-directory">
        <div className="survey-simple-directory-head">
          <div>
            <h1>Surveys</h1>
            <p>Link a Core quote, lead or job, then upload evidence and generate cost centres.</p>
          </div>
          <div className="survey-simple-directory-actions">
            <label className="survey-simple-toggle">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              Show archived
            </label>
            <button type="button" onClick={openCreatePanel} disabled={creating}>
              {creating ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              New survey
            </button>
          </div>
        </div>

        {notice ? <p className="survey-simple-notice">{notice}</p> : null}
        {error ? <p className="survey-simple-error">{error}</p> : null}

        {showCreate ? (
          <div className="survey-simple-create-panel">
            <div className="survey-simple-create-head">
              <div>
                <h2>New survey</h2>
                <p>Connect this survey to a Core quote (or lead/job) so customer, site and push-back stay linked.</p>
              </div>
              <button type="button" className="survey-simple-icon-button" onClick={() => setShowCreate(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="survey-simple-link-type-row" role="tablist" aria-label="Core link type">
              {(["Quote", "Lead", "Job"] as SurveyLinkType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={linkType === type}
                  className={linkType === type ? "on" : undefined}
                  onClick={() => {
                    setLinkType(type);
                    setLinkId("");
                    setLinkQuery("");
                  }}
                >
                  {type}
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={linkType === ""}
                className={linkType === "" ? "on" : undefined}
                onClick={() => {
                  setLinkType("");
                  setLinkId("");
                  setLinkQuery("");
                }}
              >
                No link
              </button>
            </div>

            {linkType ? (
              <>
                <label className="survey-simple-search-label">
                  Search Core {linkType.toLowerCase()}s
                  <input
                    value={linkQuery}
                    onChange={(event) => setLinkQuery(event.target.value)}
                    placeholder={`e.g. ${linkType === "Quote" ? "Q-" : linkType === "Lead" ? "L-" : "J-"} or customer name`}
                  />
                </label>
                <div className="survey-simple-link-matches">
                  {filteredChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={linkId === choice.id ? "on" : undefined}
                      onClick={() => setLinkId(choice.id)}
                    >
                      <strong>
                        {choice.reference} · {choice.customerName}
                      </strong>
                      <span>{choice.siteAddress || "Site to confirm"}</span>
                      <small>{choice.description || "No description"}</small>
                    </button>
                  ))}
                  {!filteredChoices.length ? (
                    <p className="survey-simple-empty">No matching {linkType.toLowerCase()}s in Core.</p>
                  ) : null}
                </div>
                {selectedChoice ? (
                  <p className="survey-simple-notice">
                    Will link to <strong>{selectedChoice.reference}</strong> — {selectedChoice.customerName}
                    {selectedChoice.siteAddress ? ` · ${selectedChoice.siteAddress}` : " · site to confirm"}
                  </p>
                ) : (
                  <p className="survey-simple-muted">Select a Core {linkType.toLowerCase()} above, or choose “No link”.</p>
                )}
              </>
            ) : (
              <p className="survey-simple-muted">Blank survey — you’ll type customer and site yourself. You can still link later on the survey page.</p>
            )}

            <div className="survey-simple-cta-row">
              <button
                type="button"
                className="survey-simple-primary"
                disabled={creating || (Boolean(linkType) && !selectedChoice)}
                onClick={() => void createSurvey(selectedChoice)}
              >
                {creating ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                {creating
                  ? "Creating…"
                  : selectedChoice
                    ? `Create survey for ${selectedChoice.reference}`
                    : "Create blank survey"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="survey-simple-list">
          {surveys.map((survey) => (
            <div className="survey-simple-row" key={survey.id}>
              <a href={`/survey/${encodeURIComponent(survey.id)}`}>
                <ClipboardList size={16} />
                <strong>{survey.reference}</strong>
              </a>
              <a href={`/survey/${encodeURIComponent(survey.id)}`}>
                <strong>{survey.customerName || "Customer to confirm"}</strong>
                <small>{survey.siteAddress || "Site to confirm"}</small>
              </a>
              <span>
                {survey.jobLink ? (
                  <>
                    {survey.jobLink.type} {survey.jobLink.reference}
                  </>
                ) : (
                  survey.jobType
                )}
              </span>
              <span>
                <b data-status={survey.status}>{survey.status}</b>
              </span>
              <span>{new Date(survey.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              <div className="survey-simple-row-actions">
                {survey.status !== "Archived" ? (
                  <button type="button" title="Archive survey" disabled={busyId === survey.id} onClick={() => void archiveSurvey(survey)}>
                    {busyId === survey.id ? <Loader2 className="spin" size={15} /> : <Archive size={15} />}
                    Archive
                  </button>
                ) : null}
                <button type="button" title="Delete survey" disabled={busyId === survey.id} onClick={() => void deleteSurvey(survey)}>
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!surveys.length && !loading ? <p className="survey-simple-empty">No surveys yet. Start with a new survey above.</p> : null}
          {loading ? (
            <p className="survey-simple-empty">
              <Loader2 className="spin" size={18} /> Loading surveys
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
