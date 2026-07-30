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
            ChatGPT-style hands-free call: talk back and forth with both hands free. Optional live camera so Blake can see the job while you speak.
          </p>
        </div>
      </header>

      <div className="feedback">
        Direct link only — not on Field tabs. Allow mic (and camera if you want video). Silent switch off.
      </div>

      <AskBlakeTalkLab />
    </main>
  );
}
