import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Phone } from "lucide-react";
import { formatDuration, getEngineerSchedule, getEngineerScheduleItem, mapsUrl } from "@/lib/engineer-data";
import EngineerJobWorkspace from "./EngineerJobWorkspace";

export default async function EngineerJobDetailPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) notFound();
  const jobs = getEngineerSchedule(job.engineerId);

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

      <EngineerJobWorkspace job={job} jobs={jobs} />
    </main>
  );
}
