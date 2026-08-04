"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RotateCcw, Smartphone, Sparkles } from "lucide-react";
import { useNexaClient } from "@/lib/field/nexa";
import { resetMockDemo } from "@/lib/field/nexa/mock-data";
import { fieldPath } from "@/lib/field/routes";

export default function SettingsPage() {
  const client = useNexaClient();
  const connection = useMemo(() => client.getConnection(), [client]);
  const [resetNotice, setResetNotice] = useState("");
  const isCore = connection.mode === "nexa";

  function resetDemo() {
    resetMockDemo();
    setResetNotice("Local demo data cleared. Pull to refresh My Day if needed.");
  }

  return (
    <main className="field-screen">
      <header className="field-page-header">
        <p className="eyebrow">{isCore ? "NeXa Core" : "Demo"}</p>
        <h1>{isCore ? "Connected" : "Connect later"}</h1>
        <p className="field-page-sub">
          {isCore
            ? "Schedule and Blake hours come from NeXa Core on this same account."
            : "Playing on mock jobs for now. NeXa wiring comes next."}
        </p>
      </header>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Link</p>
            <h2>{connection.label}</h2>
          </div>
          <Sparkles size={20} />
        </div>
        <p>
          {isCore
            ? "Office schedules in Core. Those jobs appear here as My Day. Hours Blake confirms charge back against the jobs."
            : "This build is still on the standalone mock diary."}
        </p>
        <Link href="/" className="primary-btn">
          <ExternalLink size={16} /> Open Core
        </Link>
      </section>

      <section className="settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Phone</p>
            <h2>Install on iPhone &amp; Android</h2>
          </div>
          <Smartphone size={20} />
        </div>
        <p>
          EWG Field is a web app you can install like a real app today. Store-listed native shells (Capacitor) come next —
          same Field screens, wrapped for the App Store and Play Store.
        </p>
        <ol className="settings-install-steps">
          <li>
            <strong>iPhone:</strong> open{" "}
            <a href={fieldPath("/")}>/field</a> in Safari → Share → <em>Add to Home Screen</em>.
          </li>
          <li>
            <strong>Android:</strong> open{" "}
            <a href={fieldPath("/")}>/field</a> in Chrome → menu → <em>Install app</em> / <em>Add to Home screen</em>.
          </li>
          <li>
            Use the home-screen icon for My Day, Ask Blake, and Hours — it opens full-screen without browser chrome.
          </li>
        </ol>
        <p className="settings-note">
          The separate NeXa Field LiDAR app is only for Survey room scans on LiDAR iPads/iPhones — not this plumber schedule app.
        </p>
      </section>

      {!isCore ? (
        <section className="settings-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Try this</p>
              <h2>Play tips</h2>
            </div>
            <Sparkles size={20} />
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open the next job from My Day.</li>
            <li>Tick a couple of checklist items.</li>
            <li>
              Finish with <a href={fieldPath("/time-check")}>Blake</a> — amend one job longer.
            </li>
          </ul>
          <button className="primary-btn" type="button" onClick={resetDemo}>
            <RotateCcw size={16} /> Reset demo
          </button>
          {resetNotice ? <p>{resetNotice}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
