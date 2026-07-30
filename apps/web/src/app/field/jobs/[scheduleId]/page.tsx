import { Suspense } from "react";
import JobDetailPage from "./JobDetailClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="field-content"><p className="muted">Loading job pack…</p></main>}>
      <JobDetailPage />
    </Suspense>
  );
}
