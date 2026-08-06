import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, TriangleAlert } from "lucide-react";
import { formatDuration, getEngineerSchedule } from "@/lib/engineer-data";

export default function EngineerTimeCheckPage() {
  const jobs = getEngineerSchedule();
  const totalHours = jobs.reduce((sum, job) => sum + job.durationHours, 0);
  const knownGapHours = 0.5;

  return (
    <main className="engineer-shell job-detail-shell">
      <Link href="/engineer" className="engineer-back-link"><ArrowLeft size={17} /> Back to My Day</Link>

      <section className="engineer-job-detail-hero">
        <p className="eyebrow">Daily time check</p>
        <h1>Confirm today</h1>
        <p>
          Hours confirmation lives in Field — Blake walks you through booked time, gaps, and amendments on your phone.
        </p>
        <div className="engineer-detail-meta">
          <span>{jobs.length} jobs</span>
          <span>{formatDuration(totalHours)} scheduled</span>
          <span>{formatDuration(knownGapHours)} gap to assign</span>
        </div>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Field Hours</p>
            <h2>Open Blake time check</h2>
          </div>
          <Clock3 size={21} />
        </div>
        <p className="engineer-muted-copy">
          Use Field Hours to confirm today&apos;s schedule, assign gaps, and sync amendments back to Core. This
          engineer preview shows your booked jobs — the live flow is on Field.
        </p>
        <Link href="/field/time-check" className="engineer-primary-action" style={{ display: "inline-flex", marginTop: 12 }}>
          <ExternalLink size={17} /> Open Field Hours
        </Link>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Booked time</p>
            <h2>Jobs from your schedule</h2>
          </div>
          <Clock3 size={21} />
        </div>
        <div className="engineer-requirement-list">
          {jobs.map((job) => (
            <div className="engineer-requirement done" key={job.scheduleId}>
              <span>{job.start}-{job.end} · {job.customer}</span>
              <strong>{formatDuration(job.durationHours)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Gap detected</p>
            <h2>Assign unbooked time</h2>
          </div>
          <TriangleAlert size={21} />
        </div>
        <p className="engineer-muted-copy">
          A gap between scheduled jobs needs assigning in Field Hours — link it to an existing job and cost centre, or
          create a reactive job if work came in before the office could schedule it.
        </p>
        <Link href="/field/time-check" className="engineer-secondary-action" style={{ display: "inline-flex", marginTop: 8 }}>
          <Clock3 size={16} /> Assign gaps in Field Hours
        </Link>
      </section>

      <section className="engineer-outcome-bar" aria-label="Time check actions">
        <Link href="/field/time-check" className="engineer-primary-action" style={{ textDecoration: "none" }}>
          <CheckCircle2 size={17} /> Confirm in Field Hours
        </Link>
      </section>
    </main>
  );
}
