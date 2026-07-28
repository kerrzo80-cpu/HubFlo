"use client";

import { useState } from "react";
import { Link2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useNexaClient } from "@/lib/nexa";
import { resetMockDemo } from "@/lib/nexa/mock-data";


export default function SettingsPage() {
  const client = useNexaClient();
  const connection = client.getConnection();
  const [baseUrl, setBaseUrl] = useState("https://nexa-pilot.onrender.com");
  const [engineerId, setEngineerId] = useState(connection.engineerId);
  const [resetNotice, setResetNotice] = useState("");

  function resetDemo() {
    resetMockDemo();
    setResetNotice("Demo reset. Reload My Day / Blake to start fresh.");
  }

  return (
    <main className="field-content">
      <section className="hero">
        <p className="eyebrow">Connect later</p>
        <h1>NeXa link</h1>
        <p>
          Play on mock data today. When you are ready, point this app at NeXa and the same screens pull live jobs and
          charge hours back.
        </p>
      </section>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Play tips</p>
            <h2>What to try</h2>
          </div>
          <Sparkles size={22} />
        </div>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
          <li>Open <strong>J-1048</strong> pack — drawings, tenant photo, stop/go.</li>
          <li>Tap checklist items on any job to mark evidence supplied.</li>
          <li>
            In <a href={"/time-check"}>Blake time check</a>, amend the cylinder job longer and the callback
            shorter.
          </li>
          <li>Submit hours and see variance charged against the day.</li>
        </ul>
        <button className="primary-btn" type="button" style={{ marginTop: 14, width: "100%" }} onClick={resetDemo}>
          <RotateCcw size={17} /> Reset demo data
        </button>
        {resetNotice ? <p className="muted" style={{ marginTop: 10 }}>{resetNotice}</p> : null}
      </section>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current mode</p>
            <h2>Standalone demo</h2>
          </div>
          <ShieldCheck size={22} />
        </div>
        <p>{connection.label}</p>
        <p className="muted">
          Blake time checks, checklist ticks and charged hours stay on this device until NeXa is connected.
        </p>
      </section>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Coming next</p>
            <h2>NeXa connection</h2>
          </div>
          <Link2 size={22} />
        </div>
        <label>
          NeXa base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…" />
        </label>
        <label>
          Engineer ID
          <input value={engineerId} onChange={(event) => setEngineerId(event.target.value)} />
        </label>
        <button className="primary-btn" type="button" style={{ marginTop: 14, width: "100%" }} disabled>
          Connect to NeXa (next step)
        </button>
      </section>
    </main>
  );
}
