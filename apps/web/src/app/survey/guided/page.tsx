"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, FileSearch, LayoutDashboard, Loader2, Plus } from "lucide-react";
import type { SurveyRecord } from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

export default function GuidedSurveyDirectory() {
  const [surveys, setSurveys] = useState<SurveyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/surveys", { headers: requestHeaders })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load guided surveys.");
        setSurveys(await response.json() as SurveyRecord[]);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load surveys."))
      .finally(() => setLoading(false));
  }, []);

  async function createSurvey() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/surveys", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error("Unable to create the guided survey.");
      const created = await response.json() as SurveyRecord;
      window.location.href = `/survey/guided/${encodeURIComponent(created.id)}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey.");
      setCreating(false);
    }
  }

  return (
    <main className="guided-survey-directory">
      <header className="guided-app-header">
        <div>
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa" />
          <span><strong>NeXa Surveyor</strong><small>Guided site capture</small></span>
        </div>
        <div className="guided-header-actions">
          <a href="/"><LayoutDashboard size={17} /> Core</a>
          <a href="/takeoff"><FileSearch size={17} /> Takeoffs</a>
        </div>
      </header>
      <section className="guided-directory-content">
        <div className="guided-directory-heading">
          <div>
            <span className="guided-eyebrow">Site surveys</span>
            <h1>Guided surveys</h1>
            <p>Structured site facts and evidence, kept separate from pricing.</p>
          </div>
          <button type="button" onClick={createSurvey} disabled={creating}>
            {creating ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
            New survey
          </button>
        </div>
        {error ? <p className="guided-error">{error}</p> : null}
        <div className="guided-survey-table">
          <div className="guided-survey-table-head">
            <span>Survey</span><span>Customer / site</span><span>Job type</span><span>Status</span><span>Updated</span>
          </div>
          {surveys.map((survey) => (
            <a href={`/survey/guided/${encodeURIComponent(survey.id)}`} className="guided-survey-row" key={survey.id}>
              <span><ClipboardCheck size={16} /><strong>{survey.reference}</strong></span>
              <span><strong>{survey.customerName || "Customer required"}</strong><small>{survey.siteAddress || "Site address required"}</small></span>
              <span>{survey.jobType}</span>
              <span><b data-status={survey.status}>{survey.status}</b></span>
              <span>{new Date(survey.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            </a>
          ))}
          {!surveys.length && !loading ? <p className="guided-empty">No guided surveys yet. Create the first one above.</p> : null}
          {loading ? <p className="guided-empty"><Loader2 className="spin" size={18} /> Loading surveys</p> : null}
        </div>
      </section>
    </main>
  );
}
