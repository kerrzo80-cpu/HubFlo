import Link from "next/link";
import { ArrowLeft, CheckCircle2, PackageCheck, XCircle } from "lucide-react";
import { getOfficePoRequests } from "@/lib/engineer-data";

export default function OfficePoRequestsPage() {
  const requests = getOfficePoRequests();

  return (
    <main className="office-shell">
      <Link href="/office/alerts" className="engineer-back-link"><ArrowLeft size={17} /> Back to alerts</Link>

      <section className="office-hero">
        <p className="eyebrow">Purchase orders</p>
        <h1>Engineer PO requests</h1>
        <p>Engineers only send supplier, note and photo context. The office approves, rejects, marks ordered and adds full PO details later.</p>
        <div className="office-summary-grid">
          <div><strong>{requests.length}</strong><span>Requests</span></div>
          <div><strong>{requests.filter((item) => item.status === "New").length}</strong><span>New</span></div>
          <div><strong>{requests.filter((item) => item.status === "Approved").length}</strong><span>Approved</span></div>
          <div><strong>{requests.filter((item) => item.status === "Ordered").length}</strong><span>Ordered</span></div>
        </div>
      </section>

      <section className="office-panel">
        <div className="engineer-section-heading">
          <div>
            <p className="eyebrow">Approval queue</p>
            <h2>Parts and supplier requests</h2>
          </div>
          <PackageCheck size={22} />
        </div>

        <div className="office-po-list">
          {requests.map((request) => (
            <article className="office-po-card" key={request.id}>
              <div>
                <span className="office-alert-type">{request.jobRef} · {request.engineerName}</span>
                <h3>{request.supplier}</h3>
                <p>{request.note}</p>
                <small>{request.customer} · {request.address}</small>
              </div>
              <div className="office-alert-meta">
                <strong>{request.status}</strong>
                <span>{request.requestedAt}</span>
              </div>
              <div className="office-alert-actions">
                <button type="button"><CheckCircle2 size={15} /> Approve</button>
                <button type="button"><PackageCheck size={15} /> Ordered</button>
                <button type="button"><XCircle size={15} /> Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
