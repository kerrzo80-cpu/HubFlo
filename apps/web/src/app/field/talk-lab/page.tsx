"use client";

import { AskBlakeTalkLab } from "@/components/field/AskBlakeTalkLab";

export default function TalkLabPage() {
  return (
    <main className="field-screen ask-blake-page is-talk talk-lab-page">
      <header className="ask-blake-hero">
        <div>
          <p className="eyebrow">Dev sandbox</p>
          <h1>Talk lab</h1>
          <p className="field-page-sub">
            Same hands-free engine as Ask Blake → Talk. Extra lab log for debugging.
          </p>
        </div>
      </header>

      <div className="feedback">
        Prefer <strong>Ask Blake → Talk</strong> in the app. This page keeps the detailed lab log.
      </div>

      <AskBlakeTalkLab variant="lab" />
    </main>
  );
}
