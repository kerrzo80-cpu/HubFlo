"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Loader2,
  Ruler,
  Save,
  ScanLine,
  Sparkles,
  Upload,
} from "lucide-react";
import type { SurveyPhoto, SurveyPhotoCategory, SurveyRecord } from "@hubflo/domain";
import type { QuickCostCentre } from "@/lib/survey-quick-pack";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

type SaveState = "Saved" | "Unsaved" | "Saving" | "Error";

function isLidarOrModel(photo: SurveyPhoto) {
  const haystack = `${photo.fileName} ${photo.mimeType} ${photo.caption}`.toLowerCase();
  return photo.category === "Measurement evidence"
    || /lidar|roomplan|room scan|\.json|\.usd|\.usdz|\.obj|\.glb|\.gltf|\.ply|model\//.test(haystack);
}

function categoryForFile(file: File): SurveyPhotoCategory {
  const name = file.name.toLowerCase();
  if (/\.(pdf|dwg|dxf)$/.test(name) || file.type === "application/pdf") return "Other";
  if (/\.(json|usd|usdz|obj|glb|gltf|ply)$/.test(name) || file.type.startsWith("model/")) return "Measurement evidence";
  if (file.type.startsWith("image/")) return "Existing condition";
  return "Other";
}

export default function SimpleSurveyWorkspacePage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;
  const [survey, setSurvey] = useState<SurveyRecord | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("Saved");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [costCentres, setCostCentres] = useState<QuickCostCentre[]>([]);
  const surveyRef = useRef<SurveyRecord | null>(null);
  const pendingPatchRef = useRef<Partial<SurveyRecord>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const evidenceSummary = useMemo(() => {
    if (!survey) return { drawings: 0, photos: 0, scans: 0 };
    let drawings = 0;
    let photos = 0;
    let scans = 0;
    survey.photos.forEach((photo) => {
      if (isLidarOrModel(photo)) scans += 1;
      else if (/\.pdf$/i.test(photo.fileName) || /drawing|plan/i.test(photo.caption)) drawings += 1;
      else photos += 1;
    });
    return { drawings, photos, scans };
  }, [survey]);

  useEffect(() => {
    async function load() {
      setError("");
      try {
        const response = await fetch(`/api/surveys/${encodeURIComponent(surveyId)}`, { headers: requestHeaders });
        if (!response.ok) throw new Error("Unable to open this survey.");
        const loaded = await response.json() as SurveyRecord;
        setSurvey(loaded);
        surveyRef.current = loaded;
        if (loaded.estimateId) {
          const estimateResponse = await fetch(`/api/estimates/${encodeURIComponent(loaded.estimateId)}`, { headers: requestHeaders });
          if (estimateResponse.ok) {
            const estimate = await estimateResponse.json() as {
              scopeOfWorks?: string[];
              materialLines?: Array<{ costCentre: string; description: string; quantity: number; unit: string; trade?: string }>;
              labourLines?: Array<{ costCentre: string; description: string; hours: number; trade: string }>;
            };
            const centres = new Map<string, QuickCostCentre>();
            (estimate.scopeOfWorks || []).forEach((line) => {
              const [name, ...rest] = line.split(":");
              const centreName = (name || "Works").trim();
              centres.set(centreName, {
                name: centreName,
                jobDescription: rest.join(":").trim() || centreName,
                trade: "Plumbing/Heating",
                materials: [],
                labour: [],
              });
            });
            (estimate.materialLines || []).forEach((line) => {
              const current = centres.get(line.costCentre) || {
                name: line.costCentre,
                jobDescription: line.costCentre,
                trade: (line.trade as QuickCostCentre["trade"]) || "Plumbing/Heating",
                materials: [],
                labour: [],
              };
              current.materials.push({
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
              });
              centres.set(line.costCentre, current);
            });
            (estimate.labourLines || []).forEach((line) => {
              const current = centres.get(line.costCentre) || {
                name: line.costCentre,
                jobDescription: line.costCentre,
                trade: "Plumbing/Heating",
                materials: [],
                labour: [],
              };
              current.labour.push({
                description: line.description,
                hours: line.hours,
                trade: line.trade,
              });
              centres.set(line.costCentre, current);
            });
            setCostCentres(Array.from(centres.values()));
          }
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load survey.");
      }
    }
    void load();
  }, [surveyId]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  async function flushAutosave(): Promise<SurveyRecord | null> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const current = surveyRef.current;
    const patch = pendingPatchRef.current;
    if (!current || !Object.keys(patch).length) return current;
    pendingPatchRef.current = {};
    setSaveState("Saving");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.version, patch }),
      });
      const body = await response.json() as SurveyRecord & { error?: string; current?: SurveyRecord };
      if (!response.ok) {
        if (response.status === 409 && body.current) {
          surveyRef.current = body.current;
          setSurvey(body.current);
        }
        throw new Error(body.error || "Autosave failed.");
      }
      surveyRef.current = body;
      setSurvey(body);
      setSaveState("Saved");
      return body;
    } catch (saveError) {
      pendingPatchRef.current = { ...patch, ...pendingPatchRef.current };
      setSaveState("Error");
      setError(saveError instanceof Error ? saveError.message : "Autosave failed.");
      return null;
    }
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

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    const current = await flushAutosave();
    if (!current || !files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("category", categoryForFile(file));
        formData.append("caption", file.name);
        formData.append("surveySection", "Evidence");
        formData.append("expectedVersion", String(surveyRef.current?.version || current.version));
        const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/photos`, {
          method: "POST",
          headers: requestHeaders,
          body: formData,
        });
        const body = await response.json() as { survey?: SurveyRecord; error?: string };
        if (!response.ok || !body.survey) throw new Error(body.error || `Unable to upload ${file.name}.`);
        surveyRef.current = body.survey;
        setSurvey(body.survey);
      }
      setNotice(`${files.length} file${files.length === 1 ? "" : "s"} added to the survey evidence.`);
      setSaveState("Saved");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload evidence.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function generateCostCentres() {
    const current = await flushAutosave();
    if (!current) return;
    if (!current.customerRequirements.trim()) {
      setError("Add a description of the works first.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/quick-pack`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.version }),
      });
      const body = await response.json() as {
        ok?: boolean;
        survey?: SurveyRecord;
        costCentres?: QuickCostCentre[];
        summary?: string;
        error?: string;
        aiUsed?: boolean;
        estimateId?: string;
        takeoffProjectId?: string;
      };
      if (body.survey) {
        setSurvey(body.survey);
        surveyRef.current = body.survey;
      }
      if (!response.ok || !body.costCentres?.length) {
        throw new Error(body.error || "Unable to generate cost centres.");
      }
      setCostCentres(body.costCentres);
      setNotice(body.summary || "Cost centres ready for review.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate cost centres.");
    } finally {
      setGenerating(false);
    }
  }

  if (!survey) {
    return (
      <main className="survey-simple-loading">
        <Loader2 className="spin" size={22} />
        <strong>{error || "Opening survey"}</strong>
        <a href="/survey">Back to surveys</a>
      </main>
    );
  }

  const takeoffHref = survey.legacyTakeoffProjectId
    ? `/takeoff?project=${encodeURIComponent(survey.legacyTakeoffProjectId)}&tab=markup`
    : "/takeoff";
  const boqHref = survey.legacyTakeoffProjectId
    ? `/takeoff?project=${encodeURIComponent(survey.legacyTakeoffProjectId)}&tab=boq`
    : "/takeoff?tab=boq";

  return (
    <main className="survey-simple-app">
      <header className="survey-simple-topbar">
        <div className="survey-simple-brand">
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa" />
          <span>
            <strong>NeXa Surveyor</strong>
            <small>{survey.reference}</small>
          </span>
        </div>
        <div className="survey-simple-top-actions">
          <span className={`survey-simple-save ${saveState.toLowerCase()}`}>
            {saveState === "Saving" ? <Loader2 className="spin" size={14} /> : saveState === "Saved" ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saveState}
          </span>
          <a href="/survey"><ArrowLeft size={16} /> Surveys</a>
        </div>
      </header>

      <section className="survey-simple-stage">
        <div className="survey-simple-hero">
          <h1>Build the job from evidence</h1>
          <p>Upload drawings, photos, LiDAR or AR scans. Describe the works. Buddy drafts cost centres, materials for supplier RFQ, and suggested labour.</p>
        </div>

        {notice ? <p className="survey-simple-notice">{notice}</p> : null}
        {error ? <p className="survey-simple-error">{error}</p> : null}

        <div className="survey-simple-grid">
          <label>
            Customer
            <input value={survey.customerName} onChange={(event) => queuePatch({ customerName: event.target.value })} placeholder="Customer name" />
          </label>
          <label>
            Site
            <input value={survey.siteAddress} onChange={(event) => queuePatch({ siteAddress: event.target.value })} placeholder="Site address" />
          </label>
        </div>

        <div className="survey-simple-upload">
          <div>
            <strong>Drawings, photos, LiDAR / AR</strong>
            <p>{evidenceSummary.drawings} drawings · {evidenceSummary.photos} photos · {evidenceSummary.scans} scans</p>
          </div>
          <label className="survey-simple-upload-button">
            {uploading ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
            Upload evidence
            <input
              hidden
              type="file"
              multiple
              accept="image/*,.pdf,.dwg,.dxf,.json,.usd,.usdz,.obj,.glb,.gltf,.ply,application/pdf,model/*"
              onChange={(event) => void uploadEvidence(event)}
            />
          </label>
        </div>

        {survey.photos.length ? (
          <ul className="survey-simple-evidence">
            {survey.photos.map((photo) => (
              <li key={photo.id}>
                {isLidarOrModel(photo) ? <ScanLine size={15} /> : /\.pdf$/i.test(photo.fileName) ? <FileSearch size={15} /> : <Camera size={15} />}
                <span>
                  <strong>{photo.fileName}</strong>
                  <small>{photo.category}{photo.caption ? ` · ${photo.caption}` : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="survey-simple-works">
          Description of works
          <textarea
            value={survey.customerRequirements}
            onChange={(event) => queuePatch({ customerRequirements: event.target.value })}
            placeholder="Example: Relocate the existing boiler to the utility cupboard, alter flow and return, renew the flue route, and move two radiators in the living room."
            rows={5}
          />
        </label>

        <div className="survey-simple-cta-row">
          <button type="button" className="survey-simple-primary" disabled={generating || !survey.customerRequirements.trim()} onClick={() => void generateCostCentres()}>
            {generating ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            {generating ? "Building cost centres..." : costCentres.length ? "Rebuild cost centres" : "Generate cost centres"}
          </button>
          <button type="button" onClick={() => void flushAutosave()}><Save size={16} /> Save</button>
        </div>

        {costCentres.length ? (
          <section className="survey-simple-centres">
            <header>
              <h2>Cost centres</h2>
              <p>Materials have no prices yet — send them on the supplier quote request. Labour hours are suggestions to review.</p>
            </header>
            {costCentres.map((centre) => (
              <article key={centre.name}>
                <header>
                  <div>
                    <strong>{centre.name}</strong>
                    <small>{centre.trade}</small>
                  </div>
                  <b>{centre.labour.reduce((sum, item) => sum + item.hours, 0).toFixed(1)} hrs</b>
                </header>
                <p>{centre.jobDescription}</p>
                <div className="survey-simple-centre-columns">
                  <div>
                    <h3>Materials for supplier RFQ</h3>
                    {centre.materials.length ? (
                      <ul>
                        {centre.materials.map((material, index) => (
                          <li key={`${centre.name}-mat-${index}`}>
                            <span>{material.description}</span>
                            <b>{material.quantity} {material.unit}</b>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="survey-simple-muted">No materials listed.</p>}
                  </div>
                  <div>
                    <h3>Suggested labour</h3>
                    {centre.labour.length ? (
                      <ul>
                        {centre.labour.map((labour, index) => (
                          <li key={`${centre.name}-lab-${index}`}>
                            <span>{labour.description}<small>{labour.trade}</small></span>
                            <b>{labour.hours} hrs</b>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="survey-simple-muted">No labour listed.</p>}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <footer className="survey-simple-footer">
          <a href={takeoffHref}><Ruler size={16} /> Mark up drawings</a>
          <a href={boqHref}><ClipboardList size={16} /> Bill of quantities</a>
          {survey.estimateId ? <a href={`/estimator?estimate=${encodeURIComponent(survey.estimateId)}`}><Sparkles size={16} /> Open estimate / RFQ</a> : null}
          <a href={`/survey/guided/${encodeURIComponent(survey.id)}`}>Advanced capture</a>
        </footer>
      </section>
    </main>
  );
}
