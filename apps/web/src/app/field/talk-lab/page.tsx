"use client";

import { AskBlakeTalkLab } from "@/components/field/AskBlakeTalkLab";

export default function TalkLabPage() {
  return (
    <main className="field-screen ask-blake-page is-talk talk-lab-page">
      <header className="ask-blake-hero">
        <div>
          <p className="eyebrow">Sandbox · not in the app yet</p>
          <h1>Talk lab</h1>
          <p className="field-page-sub">
            Flowing conversation test outside Ask Blake. Listen → Blake answers out loud → listens again. When this feels solid on iPhone, we’ll add it back into the app.
          </p>
        </div>
      </header>

      <div className="feedback">
        Direct link only — not on the Field tabs. Silent switch off. Allow mic when asked.
      </div>

      <AskBlakeTalkLab />
    </main>
  );
}
