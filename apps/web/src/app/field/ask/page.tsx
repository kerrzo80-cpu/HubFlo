import { Suspense } from "react";
import AskBlakePage from "./AskBlakeClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="field-screen"><p className="muted">Loading Ask Blake…</p></main>}>
      <AskBlakePage />
    </Suspense>
  );
}
