import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, TriangleAlert } from "lucide-react";
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
        <p>Your scheduled time is ready. Confirm it, or fix anything that changed.</p>
        <div className="engineer-detail-meta">
          <span>{jobs.length} jobs</span>
          <span>{formatDuration(totalHours)} scheduled</span>
          <span>{formatDuration(knownGapHours)} gap to assign</span>
        </div>
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
        <p className="engineer-muted-copy">NeXa found a 30 minute gap between scheduled jobs. Assign it to an existing job/cost centre, or create a reactive job if work came in before the office could schedule it.</p>
        <div className="engineer-gap-options">
          <button type="button">Assign to job and cost centre</button>
          <button type="button">Create reactive job</button>
        </div>
      </section>

      <section className="engineer-outcome-bar" aria-label="Time check actions">
        <button type="button"><CheckCircle2 size={17} /> Confirm all</button>
        <button type="button"><Clock3 size={17} /> Adjust</button>
        <button type="button"><TriangleAlert size={17} /> Save draft</button>
      </section>
    </main>
  );
}
