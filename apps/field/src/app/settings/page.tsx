"use client";

import { useState } from "react";
import { Link2, ShieldCheck } from "lucide-react";
import { useNexaClient } from "@/lib/nexa";

export default function SettingsPage() {
  const client = useNexaClient();
  const connection = client.getConnection();
  const [baseUrl, setBaseUrl] = useState("https://nexa-pilot.onrender.com");
  const [engineerId, setEngineerId] = useState(connection.engineerId);

  return (
    <main className="field-content">
      <section className="hero">
        <p className="eyebrow">Connect later</p>
        <h1>NeXa link</h1>
        <p>
          The field app runs on its own mock schedule today. When you are ready, point it at NeXa and the same screens
          will pull live jobs, packs and charge hours back.
        </p>
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
          Blake time checks and charged hours are saved in this device for now. Connecting to NeXa will swap the mock
          client for the live engineer APIs without redesigning the screens.
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
        <p className="muted" style={{ marginTop: 12 }}>
          Wire-up target: field schedule + `/api/engineer/time-check` already started in the office app.
        </p>
      </section>
    </main>
  );
}
