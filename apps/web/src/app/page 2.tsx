import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  LayoutDashboard,
  ListTodo,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";
import {
  checkInvoiceReadiness,
  type InvoiceReadinessInput,
} from "@hubflo/domain";

const invoiceInput: InvoiceReadinessInput = {
  requiredTasks: { complete: 7, total: 8 },
  openBlockers: 1,
  unresolvedVariations: 1,
  completionNoteSubmitted: true,
  requiredPhotos: { complete: 4, total: 4 },
  requiredDocuments: { complete: 1, total: 1 },
  timesheetsSubmitted: true,
  materialCostsConfirmed: false,
  finalJobValueConfirmed: true,
};

const invoiceReadiness = checkInvoiceReadiness(invoiceInput);

const queues = [
  {
    label: "Blocked jobs",
    count: 4,
    detail: "2 need action today",
    tone: "red",
    icon: ShieldAlert,
  },
  {
    label: "Variations",
    count: 7,
    detail: "£8,420 pending",
    tone: "amber",
    icon: CircleDollarSign,
  },
  {
    label: "Ready to invoice",
    count: 9,
    detail: "£31,680 value",
    tone: "green",
    icon: FileCheck2,
  },
  {
    label: "Overdue tasks",
    count: 6,
    detail: "Oldest is 3 days",
    tone: "blue",
    icon: Clock3,
  },
];

const jobs = [
  {
    ref: "J-1048",
    customer: "Northfield Properties",
    site: "10 Hopetoun Court",
    work: "Boiler service and remedial works",
    status: "Waiting on parts",
    health: "red",
    value: "£2,840",
    next: "Order pump valves",
    due: "Today",
  },
  {
    ref: "J-1052",
    customer: "Morrison & Co.",
    site: "42 Queen's Road",
    work: "Office heating upgrade",
    status: "In progress",
    health: "green",
    value: "£18,900",
    next: "Engineer visit",
    due: "Tomorrow",
  },
  {
    ref: "J-1056",
    customer: "A. Davidson",
    site: "7 Cairn View",
    work: "Bathroom installation",
    status: "Waiting on approval",
    health: "amber",
    value: "£9,450",
    next: "Approve variation V-003",
    due: "Today",
  },
  {
    ref: "J-1041",
    customer: "Granite Developments",
    site: "Plot 18, Kings Park",
    work: "First and second fix plumbing",
    status: "Ready to invoice",
    health: "green",
    value: "£24,760",
    next: "Raise final invoice",
    due: "Today",
  },
];

const navigation = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Jobs", icon: Wrench },
  { label: "Schedule", icon: CalendarDays },
  { label: "Tasks", icon: ListTodo, badge: 6 },
  { label: "Customers", icon: Users },
];

function HealthDot({ tone }: { tone: string }) {
  return <span className={`health-dot ${tone}`} aria-label={`${tone} health`} />;
}

export default function Dashboard() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">HF</span>
          <span>HubFlo</span>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <a
                href="#"
                className={item.active ? "nav-link active" : "nav-link"}
                key={item.label}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </a>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <a href="#" className="nav-link">
            <Settings size={18} strokeWidth={1.8} />
            <span>Settings</span>
          </a>
          <div className="company-switcher">
            <span className="company-avatar">EW</span>
            <span className="company-copy">
              <strong>Errol Watson Group</strong>
              <small>Owner account</small>
            </span>
            <ChevronRight size={16} />
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Search HubFlo"
              placeholder="Search jobs, customers, sites or assets"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
            <button className="new-job" aria-label="New job">
              <Plus size={16} />
              <span>New job</span>
            </button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Monday, 22 June</p>
              <h1>Good morning, Errol</h1>
              <p className="subheading">
                Here is what needs attention across your operation.
              </p>
            </div>
            <div className="system-status">
              <span className="status-pulse" />
              All systems operational
            </div>
          </section>

          <section className="queue-grid" aria-label="Work queues">
            {queues.map((queue) => {
              const Icon = queue.icon;
              return (
                <article className="queue-item" key={queue.label}>
                  <div className={`queue-icon ${queue.tone}`}>
                    <Icon size={19} />
                  </div>
                  <div className="queue-copy">
                    <p>{queue.label}</p>
                    <strong>{queue.count}</strong>
                    <small>{queue.detail}</small>
                  </div>
                  <ChevronRight className="queue-arrow" size={18} />
                </article>
              );
            })}
          </section>

          <section className="workspace-grid">
            <div className="jobs-panel">
              <div className="section-heading">
                <div>
                  <h2>Priority jobs</h2>
                  <p>Jobs with action due or operational risk</p>
                </div>
                <button className="text-button">
                  View all jobs <ChevronRight size={16} />
                </button>
              </div>

              <div className="jobs-table" role="table" aria-label="Priority jobs">
                <div className="jobs-row jobs-header" role="row">
                  <span>Job</span>
                  <span>Status</span>
                  <span>Value</span>
                  <span>Next action</span>
                  <span />
                </div>
                {jobs.map((job) => (
                  <div className="jobs-row" role="row" key={job.ref}>
                    <div className="job-main">
                      <div className="job-ref">
                        <HealthDot tone={job.health} />
                        <strong>{job.ref}</strong>
                        <span>{job.customer}</span>
                      </div>
                      <p>{job.work}</p>
                      <small>{job.site}</small>
                    </div>
                    <div>
                      <span className={`status-tag ${job.health}`}>{job.status}</span>
                    </div>
                    <strong className="job-value">{job.value}</strong>
                    <div className="next-action">
                      <span>{job.next}</span>
                      <small>{job.due}</small>
                    </div>
                    <button className="row-action" aria-label={`Open ${job.ref}`}>
                      <ChevronRight size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <aside className="attention-panel">
              <div className="section-heading compact">
                <div>
                  <h2>Invoice gate</h2>
                  <p>J-1048 · 10 Hopetoun Court</p>
                </div>
                <span className="blocked-label">Blocked</span>
              </div>

              <div className="gate-summary">
                <div className="gate-score">
                  <span>{invoiceReadiness.completedChecks}</span>
                  <small>of {invoiceReadiness.totalChecks} checks passed</small>
                </div>
                <div
                  className="progress-track"
                  aria-label={`${invoiceReadiness.completedChecks} of ${invoiceReadiness.totalChecks} checks passed`}
                >
                  <span
                    style={{
                      width: `${
                        (invoiceReadiness.completedChecks /
                          invoiceReadiness.totalChecks) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>

              <div className="gate-list">
                {invoiceReadiness.reasons.map((reason) => (
                  <div className="gate-item" key={reason.code}>
                    <AlertTriangle size={17} />
                    <div>
                      <strong>{reason.title}</strong>
                      <p>{reason.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button className="gate-button">
                Review job controls
                <ChevronRight size={17} />
              </button>

              <div className="activity">
                <div className="section-heading compact">
                  <div>
                    <h2>Latest activity</h2>
                    <p>Across all active jobs</p>
                  </div>
                </div>
                <div className="activity-item">
                  <span className="activity-icon success">
                    <CheckCircle2 size={16} />
                  </span>
                  <p>
                    <strong>Timesheet submitted</strong>
                    <small>J-1052 · Scott M. · 14 min ago</small>
                  </p>
                </div>
                <div className="activity-item">
                  <span className="activity-icon warning">
                    <AlertTriangle size={16} />
                  </span>
                  <p>
                    <strong>Variation detected</strong>
                    <small>J-1056 · Engineer app · 32 min ago</small>
                  </p>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}
