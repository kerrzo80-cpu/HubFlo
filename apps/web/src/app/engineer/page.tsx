import Link from "next/link";
import {
  CalendarDays,
  Camera,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  MapPin,
  Phone,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { formatDuration, getEngineerSchedule, mapsUrl } from "@/lib/engineer-data";

export default function EngineerTodayPage() {
  const jobs = getEngineerSchedule();
  const totalHours = jobs.reduce((sum, job) => sum + job.durationHours, 0);
  const missingItems = jobs.reduce(
    (sum, job) => sum + job.requirements.filter((requirement) => requirement.status === "missing").length,
    0,
  );
  const firstJob = jobs[0];
  const evidenceCount = jobs.reduce((sum, job) => sum + job.photos.length + job.attachments.length, 0);

  return (
    <main className="engineer-shell">
      <section className="engineer-hero">
        <p className="eyebrow">Engineer app</p>
        <h1>Field workflow</h1>
        <p>Open each job to see the job pack, complete stop / go checks, upload photos and notes, request POs, enter time or scan the carbon-book sheet for office review.</p>
        <div className="engineer-summary-grid">
          <div><strong>{jobs.length}</strong><span>Jobs</span></div>
          <div><strong>{formatDuration(totalHours)}</strong><span>Booked</span></div>
          <div><strong>{missingItems}</strong><span>Required items</span></div>
          <div><strong>{evidenceCount}</strong><span>Files / photos</span></div>
        </div>
      </section>

      <section className="engineer-action-strip" aria-label="Daily actions">
        <Link href={firstJob ? `/engineer/jobs/${firstJob.scheduleId}` : "/engineer/time-check"} className="engineer-primary-action">
          <ClipboardCheck size={17} /> Open next job
        </Link>
        <Link href="/engineer/time-check" className="engineer-secondary-action"><Clock3 size={17} /> Quick time check</Link>
        <Link href="/office/alerts" className="engineer-secondary-action"><FileText size={17} /> Office alerts</Link>
        <a href="tel:+441224000000" className="engineer-secondary-action">Call office</a>
      </section>

      <section className="engineer-flow-panel" aria-label="Engineer workflow tools">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Live workflow</p>
            <h2>What happens inside each job</h2>
          </div>
          <ClipboardCheck size={22} />
        </div>
        <div className="engineer-flow-card-grid">
          <Link href={firstJob ? `/engineer/jobs/${firstJob.scheduleId}` : "/engineer"} className="engineer-flow-card">
            <FileText size={19} />
            <strong>Job pack</strong>
            <span>Works, access, office notes and documents.</span>
          </Link>
          <Link href={firstJob ? `/engineer/jobs/${firstJob.scheduleId}#site-evidence` : "/engineer"} className="engineer-flow-card">
            <Camera size={19} />
            <strong>Photos / reports</strong>
            <span>Send notes, photos and reports to office review.</span>
          </Link>
          <Link href={firstJob ? `/engineer/jobs/${firstJob.scheduleId}#time-entry` : "/engineer/time-check"} className="engineer-flow-card">
            <Clock3 size={19} />
            <strong>Timesheets</strong>
            <span>Confirm actual hours against the schedule.</span>
          </Link>
          <Link href={firstJob ? `/engineer/jobs/${firstJob.scheduleId}#paper-sheet` : "/engineer"} className="engineer-flow-card">
            <ClipboardCheck size={19} />
            <strong>Carbon sheet scan</strong>
            <span>Photo the paper sheet so NeXa pulls time and ticks.</span>
          </Link>
        </div>
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
                  <div className="engineer-card-workflow-chips" aria-label="Job workflow status">
                    <span>{missingRequirements ? `${missingRequirements} stop / go missing` : "Stop / go ready"}</span>
                    <span>{job.photos.length} photo{job.photos.length === 1 ? "" : "s"}</span>
                    <span>{job.attachments.length} doc{job.attachments.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <ChevronRight className="engineer-card-chevron" size={22} />
              </Link>

              <div className="engineer-job-actions">
                <Link href={`/engineer/jobs/${job.scheduleId}`}><ClipboardCheck size={16} /> Workflow</Link>
                <Link href={`/engineer/jobs/${job.scheduleId}#site-evidence`}><Camera size={16} /> Photos</Link>
                <Link href={`/engineer/jobs/${job.scheduleId}#time-entry`}><Clock3 size={16} /> Time</Link>
                <Link href={`/engineer/jobs/${job.scheduleId}#paper-sheet`}><FileText size={16} /> Sheet</Link>
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
