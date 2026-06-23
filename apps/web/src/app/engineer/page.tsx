import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin, Phone, ShoppingCart, Wrench } from "lucide-react";
import { formatDuration, getEngineerSchedule, mapsUrl } from "@/lib/engineer-data";

export default function EngineerTodayPage() {
  const jobs = getEngineerSchedule();
  const totalHours = jobs.reduce((sum, job) => sum + job.durationHours, 0);
  const missingItems = jobs.reduce(
    (sum, job) => sum + job.requirements.filter((requirement) => requirement.status === "missing").length,
    0,
  );

  return (
    <main className="engineer-shell">
      <section className="engineer-hero">
        <p className="eyebrow">Engineer app</p>
        <h1>My Day</h1>
        <p>Today&apos;s schedule is ready. Open a job for notes, photos, PO requests and outcome actions.</p>
        <div className="engineer-summary-grid">
          <div><strong>{jobs.length}</strong><span>Jobs</span></div>
          <div><strong>{formatDuration(totalHours)}</strong><span>Booked</span></div>
          <div><strong>{missingItems}</strong><span>Required items</span></div>
        </div>
      </section>

      <section className="engineer-action-strip" aria-label="Daily actions">
        <Link href="/engineer/time-check" className="engineer-primary-action">Quick time check</Link>
        <a href="tel:+441224000000" className="engineer-secondary-action">Call office</a>
      </section>

      <section className="engineer-timeline" aria-label="Scheduled jobs">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>Tuesday 23 June</h2>
          </div>
          <CalendarDays size={22} />
        </div>

        {jobs.map((job) => {
          const missingRequirements = job.requirements.filter((requirement) => requirement.status === "missing").length;

          return (
            <article className="engineer-job-card" key={job.scheduleId}>
              <Link href={`/engineer/jobs/${job.scheduleId}`} className="engineer-job-main">
                <div className="engineer-time-block">
                  <strong>{job.start}</strong>
                  <span>{job.end}</span>
                </div>
                <div className="engineer-job-copy">
                  <div className="engineer-job-title-row">
                    <h3>{job.customer}</h3>
                    <span className={`engineer-status ${job.status.toLowerCase().replaceAll(" ", "-")}`}>{job.status}</span>
                  </div>
                  <p>{job.description}</p>
                  <span className="engineer-cost-centre"><Wrench size={14} /> {job.costCentre}</span>
                </div>
                <ChevronRight className="engineer-card-chevron" size={22} />
              </Link>

              <div className="engineer-job-actions">
                <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Maps</a>
                <a href={`tel:${job.phone}`}><Phone size={16} /> Call</a>
                <Link href={`/engineer/jobs/${job.scheduleId}#po-request`}><ShoppingCart size={16} /> PO</Link>
              </div>

              {missingRequirements > 0 ? (
                <div className="engineer-card-warning">{missingRequirements} required item{missingRequirements === 1 ? "" : "s"} before completion</div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
