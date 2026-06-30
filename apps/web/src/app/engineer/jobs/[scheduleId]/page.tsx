import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, ClipboardPlus, FileText, MapPin, MessageCircle, Phone, RotateCcw, ShoppingCart, Wrench } from "lucide-react";
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

      <section className="engineer-panel engineer-chat-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Job chat</p>
            <h2>NeXa timeline</h2>
          </div>
          <MessageCircle size={21} />
        </div>
        <div className="engineer-chat-audience">
          <button type="button">Internal</button>
          <button type="button">Office only</button>
          <button type="button">Engineer private</button>
          <button type="button">Client</button>
          <button type="button">Supplier</button>
        </div>
        <div className="engineer-chat-thread">
          <div className="engineer-chat-message office">
            <span>Internal · Office</span>
            <p>Any issues on site, send them here. NeXa will link it back to {job.jobRef}.</p>
          </div>
          <div className="engineer-chat-message system">
            <span>Engineer private · NeXa</span>
            <p>Choose what you need and I&apos;ll ask one thing at a time.</p>
          </div>
          <div className="engineer-chat-message engineer">
            <span>Internal · Engineer</span>
            <p>Customer has asked about moving the radiator. Looks like a variation before we proceed.</p>
          </div>
          <div className="engineer-chat-message warning">
            <span>Client safety check</span>
            <p>Client-visible messages are separate. Costs, hours and internal notes stay hidden unless the office sends an approved update.</p>
          </div>
          <div className="engineer-chat-quick-actions">
            <a href="#variation-check">Variation</a>
            <a href="#po-request">PO request</a>
            <button type="button">Needs parts</button>
            <button type="button">Rebook</button>
            <button type="button">Could not access</button>
          </div>
        </div>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">WhatsApp doorway</p>
            <h2>Messages NeXa would send</h2>
          </div>
          <MessageCircle size={21} />
        </div>
        <div className="whatsapp-doorway-grid">
          <article>
            <span>Engineer private</span>
            <strong>Time check</strong>
            <p>Scott, confirm your time for {job.jobRef}: {job.start}-{job.end}. Reply confirmed or send changes.</p>
          </article>
          <article>
            <span>Internal team</span>
            <strong>Site issue</strong>
            <p>Variation raised on {job.jobRef}. Office review needed before customer-facing approval.</p>
          </article>
          <article>
            <span>Client visible</span>
            <strong>Approval link</strong>
            <p>Variation V-004 is ready to review. Open secure NeXa link to approve before works proceed.</p>
          </article>
          <article>
            <span>Supplier + office</span>
            <strong>Material request</strong>
            <p>Please price the listed materials for {job.jobRef}. Supplier replies are linked privately to the job.</p>
          </article>
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

      <section className="engineer-panel" id="variation-check">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Completion check</p>
            <h2>Any variation or extra work?</h2>
          </div>
          <ClipboardPlus size={21} />
        </div>

        <div className="engineer-variation-prompt">
          <button type="button">No variation</button>
          <button type="button">Yes, capture variation</button>
        </div>

        <div className="engineer-chat-thread variation-chat">
          <div className="engineer-chat-message system">
            <span>NeXa</span>
            <p>Tell me what changed. I&apos;ll turn it into a draft variation quote for the office.</p>
          </div>
          <div className="engineer-chat-message engineer">
            <span>Engineer</span>
            <p>Extra pipe route needed because existing route cannot be reused.</p>
          </div>
          <div className="engineer-chat-message system">
            <span>NeXa</span>
            <p>I&apos;ll ask for reason, hours, materials, photos and whether approval is needed before you proceed.</p>
          </div>
        </div>

        <form className="engineer-variation-form">
          <label className="full">
            Description of extra works
            <textarea placeholder="What changed or what extra works did you carry out?" rows={3} />
          </label>
          <label>
            Reason
            <select defaultValue="client-request">
              <option value="client-request">Client request</option>
              <option value="hidden-issue">Hidden issue found</option>
              <option value="extra-materials">Extra materials required</option>
              <option value="access-issue">Access issue</option>
              <option value="emergency-decision">Emergency decision</option>
            </select>
          </label>
          <label>
            Labour hours used
            <input inputMode="decimal" placeholder="0.0" />
          </label>
          <label className="full">
            Materials used
            <textarea placeholder="List materials used or upload a photo of parts/receipt." rows={3} />
          </label>
          <label className="engineer-checkbox-line">
            <input type="checkbox" />
            <span>Client was told on site</span>
          </label>
          <label className="engineer-checkbox-line">
            <input type="checkbox" defaultChecked />
            <span>Likely chargeable</span>
          </label>
          <div className="engineer-variation-note full">
            <strong>Office review required</strong>
            <span>If approval is needed before work continues, the office will send a variation quote to the client and alert you when it is approved to proceed.</span>
          </div>
          <button className="full" type="button">Send variation to office</button>
        </form>
      </section>

      <section className="engineer-outcome-bar" aria-label="Job outcome actions">
        <a href="#variation-check"><CheckCircle2 size={17} /> Complete</a>
        <button type="button"><Wrench size={17} /> Needs parts</button>
        <button type="button"><RotateCcw size={17} /> Rebook</button>
      </section>
    </main>
  );
}
