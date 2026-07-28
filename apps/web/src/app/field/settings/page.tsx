"use client";

import { useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { resetMockDemo } from "@/lib/field/nexa/mock-data";
import { fieldPath } from "@/lib/field/routes";

export default function SettingsPage() {
  const [resetNotice, setResetNotice] = useState("");

  function resetDemo() {
    resetMockDemo();
    setResetNotice("Demo cleared. Open My Day or Blake to start again.");
  }

  return (
    <main className="field-screen">
      <header className="field-page-header">
        <p className="eyebrow">Demo</p>
        <h1>Connect later</h1>
        <p className="field-page-sub">Playing on mock jobs for now. NeXa wiring comes next.</p>
      </header>

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
    </main>
  );
}
