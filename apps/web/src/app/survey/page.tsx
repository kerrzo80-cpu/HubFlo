"use client";

import { useEffect, useState } from "react";
import { Archive, ClipboardList, FileSearch, LayoutDashboard, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import type { SurveyRecord } from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

export default function SurveyDirectoryPage() {
  const [surveys, setSurveys] = useState<SurveyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSurveys(includeArchived = showArchived) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/surveys${includeArchived ? "?includeArchived=1" : ""}`, { headers: requestHeaders });
      if (!response.ok) throw new Error("Unable to load surveys.");
      setSurveys(await response.json() as SurveyRecord[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load surveys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSurveys(showArchived);
  }, [showArchived]);

  async function createSurvey() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/surveys", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error("Unable to create the survey.");
      const created = await response.json() as SurveyRecord;
      window.location.href = `/survey/${encodeURIComponent(created.id)}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey.");
      setCreating(false);
    }
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
      const body = await response.json() as SurveyRecord & { error?: string };
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
      const body = await response.json() as { error?: string };
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
          <a href="/"><LayoutDashboard size={16} /> Core</a>
          <a href="/takeoff"><FileSearch size={16} /> Takeoffs</a>
          <a href="/estimator"><Sparkles size={16} /> Estimator</a>
          <a href="/survey/guided">Advanced capture</a>
        </nav>
      </header>

      <section className="survey-simple-directory">
        <div className="survey-simple-directory-head">
          <div>
            <h1>Surveys</h1>
            <p>Upload evidence, describe the works, generate cost centres, then mark up drawings in Takeoffs.</p>
          </div>
          <div className="survey-simple-directory-actions">
            <label className="survey-simple-toggle">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              Show archived
            </label>
            <button type="button" onClick={() => void createSurvey()} disabled={creating}>
              {creating ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              New survey
            </button>
          </div>
        </div>

        {notice ? <p className="survey-simple-notice">{notice}</p> : null}
        {error ? <p className="survey-simple-error">{error}</p> : null}

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
              <span>{survey.jobType}</span>
              <span><b data-status={survey.status}>{survey.status}</b></span>
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
          {loading ? <p className="survey-simple-empty"><Loader2 className="spin" size={18} /> Loading surveys</p> : null}
        </div>
      </section>
    </main>
  );
}
