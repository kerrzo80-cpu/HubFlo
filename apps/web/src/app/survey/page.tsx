"use client";

import { useEffect, useState } from "react";
import { ClipboardList, FileSearch, LayoutDashboard, Loader2, Plus, Sparkles } from "lucide-react";
import type { SurveyRecord } from "@hubflo/domain";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

export default function SurveyDirectoryPage() {
  const [surveys, setSurveys] = useState<SurveyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/surveys", { headers: requestHeaders })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load surveys.");
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
      if (!response.ok) throw new Error("Unable to create the survey.");
      const created = await response.json() as SurveyRecord;
      window.location.href = `/survey/${encodeURIComponent(created.id)}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create survey.");
      setCreating(false);
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
            <p>Upload drawings or site evidence, describe the works, and let Buddy draft cost centres with materials for supplier RFQ and suggested labour.</p>
          </div>
          <button type="button" onClick={() => void createSurvey()} disabled={creating}>
            {creating ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
            New survey
          </button>
        </div>

        {error ? <p className="survey-simple-error">{error}</p> : null}

        <div className="survey-simple-list">
          {surveys.map((survey) => (
            <a className="survey-simple-row" href={`/survey/${encodeURIComponent(survey.id)}`} key={survey.id}>
              <span>
                <ClipboardList size={16} />
                <strong>{survey.reference}</strong>
              </span>
              <span>
                <strong>{survey.customerName || "Customer to confirm"}</strong>
                <small>{survey.siteAddress || "Site to confirm"}</small>
              </span>
              <span>{survey.jobType}</span>
              <span><b data-status={survey.status}>{survey.status}</b></span>
              <span>{new Date(survey.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            </a>
          ))}
          {!surveys.length && !loading ? <p className="survey-simple-empty">No surveys yet. Start with a new survey above.</p> : null}
          {loading ? <p className="survey-simple-empty"><Loader2 className="spin" size={18} /> Loading surveys</p> : null}
        </div>
      </section>
    </main>
  );
}
