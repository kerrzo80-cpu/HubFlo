import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, FileText, MapPin, Phone, RotateCcw, ShoppingCart, Wrench } from "lucide-react";
import { formatDuration, getEngineerScheduleItem, mapsUrl } from "@/lib/engineer-data";

export default async function EngineerJobDetailPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) notFound();

  const missingRequirements = job.requirements.filter((requirement) => requirement.status === "missing");

  return (
    <main className="engineer-shell job-detail-shell">
      <Link href="/engineer" className="engineer-back-link"><ArrowLeft size={17} /> Back to My Day</Link>

      <section className="engineer-job-detail-hero">
        <p className="eyebrow">{job.jobRef} · {job.costCentre}</p>
        <h1>{job.customer}</h1>
        <p>{job.description}</p>
        <div className="engineer-detail-meta">
          <span>{job.start}-{job.end}</span>
          <span>{formatDuration(job.durationHours)} booked</span>
          <span>{job.status}</span>
        </div>
      </section>

      <section className="engineer-contact-card">
        <div>
          <p className="eyebrow">Site</p>
          <h2>{job.address}</h2>
          <p>Contact: {job.contactName}</p>
        </div>
        <div className="engineer-contact-actions">
          <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer"><MapPin size={17} /> Open maps</a>
          <a href={`tel:${job.phone}`}><Phone size={17} /> Call customer</a>
        </div>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Notes</p>
            <h2>Information for site</h2>
          </div>
          <FileText size={21} />
        </div>
        <div className="engineer-note-block"><strong>Access</strong><p>{job.accessNotes}</p></div>
        {job.officeNotes.map((note) => <div className="engineer-note-block" key={note}><strong>Office</strong><p>{note}</p></div>)}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Stop/go</p>
            <h2>Completion requirements</h2>
          </div>
          <CheckCircle2 size={21} />
        </div>
        <div className="engineer-requirement-list">
          {job.requirements.map((requirement) => (
            <div className={`engineer-requirement ${requirement.status}`} key={requirement.id}>
              <span>{requirement.label}</span>
              <strong>{requirement.status === "done" ? "Done" : requirement.status === "missing" ? "Missing" : "Optional"}</strong>
            </div>
          ))}
        </div>
        {missingRequirements.length ? (
          <div className="engineer-stop-message">Cannot mark complete yet. Missing: {missingRequirements.map((item) => item.label).join(", ")}.</div>
        ) : null}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Files</p>
            <h2>Attachments and photos</h2>
          </div>
          <Camera size={21} />
        </div>
        <div className="engineer-file-grid">
          {[...job.attachments, ...job.photos].map((attachment) => (
            <button className="engineer-file-tile" type="button" key={attachment.id}>
              <span>{attachment.type}</span>
              <strong>{attachment.name}</strong>
              <small>{attachment.uploadedBy} · {attachment.uploadedAt}</small>
            </button>
          ))}
          <button className="engineer-file-tile upload" type="button">
            <span>Upload</span>
            <strong>Add photo</strong>
            <small>Camera or gallery</small>
          </button>
        </div>
      </section>

      <section className="engineer-panel" id="po-request">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Purchase order</p>
            <h2>Request a PO</h2>
          </div>
          <ShoppingCart size={21} />
        </div>
        <form className="engineer-po-form">
          <label>
            Supplier
            <input placeholder="Supplier name" name="supplier" />
          </label>
          <label>
            Note optional
            <textarea placeholder="Short note for office, for example: pump valves needed" name="note" rows={3} />
          </label>
          <button type="button">Send PO request to office</button>
        </form>
      </section>

      <section className="engineer-outcome-bar" aria-label="Job outcome actions">
        <button type="button" disabled={missingRequirements.length > 0}><CheckCircle2 size={17} /> Complete</button>
        <button type="button"><Wrench size={17} /> Needs parts</button>
        <button type="button"><RotateCcw size={17} /> Rebook</button>
      </section>
    </main>
  );
}
