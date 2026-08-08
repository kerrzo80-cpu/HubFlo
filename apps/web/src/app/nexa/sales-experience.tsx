"use client";

import {
  ArrowRight,
  BarChart3,
  Bot,
  Flame,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  ClipboardCheck,
  Gauge,
  HardHat,
  Layers3,
  Mail,
  Map,
  Menu,
  Play,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import styles from "./sales.module.css";

type DemoKey = "blake" | "workflow" | "surveyor";

const demoFrames: Record<DemoKey, Array<{ label: string; title: string; copy: string }>> = {
  blake: [
    {
      label: "Ask naturally",
      title: "What are our sales this month?",
      copy: "Blake understands the question and checks the live quote, invoice and job records.",
    },
    {
      label: "Verify the data",
      title: "£184,620 secured",
      copy: "12.4% ahead of last month, with £46,800 still awaiting quote decisions.",
    },
    {
      label: "Take action",
      title: "Open the full sales report",
      copy: "The answer becomes a filterable report, not a dead-end chat response.",
    },
  ],
  workflow: [
    {
      label: "Lead",
      title: "New boiler enquiry received",
      copy: "Customer, site, contact and survey requirement are captured once.",
    },
    {
      label: "Quote",
      title: "Scope and cost centres built",
      copy: "Materials, labour, margin and customer options stay connected.",
    },
    {
      label: "Job",
      title: "Accepted and ready to schedule",
      copy: "The approved quote becomes a controlled delivery plan without re-keying.",
    },
    {
      label: "Invoice",
      title: "Reviewed, approved and issued",
      copy: "Costs, variations, evidence and progress claims remain attached to the job.",
    },
  ],
  surveyor: [
    {
      label: "Capture",
      title: "Survey on site",
      copy: "Capture the real job with photos, rooms and scope — not a fixed paper checklist.",
    },
    {
      label: "Measure",
      title: "Photos, LiDAR and heat loss",
      copy: "Room evidence and measurements move with the survey record.",
    },
    {
      label: "Build",
      title: "AI estimate pack prepared",
      copy: "Blake drafts scope, materials and labour for human review.",
    },
    {
      label: "Send",
      title: "Cost centres arrive in Core",
      copy: "Survey → Send to quote lands an editable Core quote, ready for approval.",
    },
  ],
};

const moduleRows = [
  {
    icon: Gauge,
    name: "Core",
    statement: "The operational truth",
    detail: "Leads, quotes, jobs, schedules, purchase orders, invoices and reporting.",
  },
  {
    icon: ScanLine,
    name: "Surveyor",
    statement: "Capture the job properly",
    detail: "Surveys, photos, measurements, LiDAR, heat loss and evidence gates.",
  },
  {
    icon: Layers3,
    name: "Takeoffs",
    statement: "Measure and count",
    detail: "Mark up drawings, build quantities by floor, flat, system and cost centre.",
  },
  {
    icon: Flame,
    name: "Heat Design",
    statement: "Size the heating system",
    detail: "Floor plans, emitters, pipe routes and kit that push into Takeoff and Core quotes.",
  },
  {
    icon: HardHat,
    name: "Field",
    statement: "Keep delivery connected",
    detail: "Job information, checklists, timesheets, photos, notes and PO requests.",
  },
];

const reportRows = [
  ["Revenue secured", "£184,620", "+12.4%"],
  ["Gross margin", "31.8%", "+2.1%"],
  ["Quotes awaiting action", "8", "£46,800"],
  ["Jobs at risk", "2", "Review"],
];

function ProductShell() {
  return (
    <div className={styles.productShell} aria-label="NeXa command centre preview">
      <div className={styles.productTopbar}>
        <Image src="/brand/nexa-command-mark.svg" width={30} height={30} alt="" />
        <span className={styles.productSearch}>Search customers, jobs, quotes, assets...</span>
        <span className={styles.productAvatar}>BK</span>
      </div>
      <div className={styles.productNav}>
        <span className={styles.productNavActive}>Dashboard</span>
        <span>Leads</span>
        <span>Quotes</span>
        <span>Jobs</span>
        <span>Schedules</span>
        <span>Invoices</span>
        <span>Reports</span>
      </div>
      <div className={styles.productBody}>
        <div className={styles.productRail}>
          <Gauge size={18} />
          <ClipboardCheck size={18} />
          <HardHat size={18} />
          <BarChart3 size={18} />
        </div>
        <div className={styles.productWorkspace}>
          <div className={styles.workspaceTitle}>
            <div>
              <small>Tuesday, 28 July</small>
              <strong>Operations overview</strong>
            </div>
            <span><Bot size={15} /> Ask Blake</span>
          </div>
          <div className={styles.metricRow}>
            <div><small>Revenue this month</small><strong>£184,620</strong><span>+12.4%</span></div>
            <div><small>Jobs in progress</small><strong>18</strong><span>4 due this week</span></div>
            <div><small>Quotes awaiting action</small><strong>8</strong><span>£46,800</span></div>
            <div><small>Ready to invoice</small><strong>6</strong><span>£29,340</span></div>
          </div>
          <div className={styles.schedulePreview}>
            <header><strong>Team schedule</strong><span>Week view</span></header>
            <div className={styles.scheduleGrid}>
              {["Mon 27", "Tue 28", "Wed 29", "Thu 30", "Fri 31"].map((day, index) => (
                <div key={day}>
                  <b>{day}</b>
                  {index !== 0 ? <span className={styles.scheduleJob}>J-{2051 + index}<small>{index % 2 ? "First fix" : "Boiler install"}</small></span> : null}
                  {index === 2 ? <span className={styles.scheduleJobAlt}>Q-2148<small>Site survey</small></span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.blakePeek}>
          <header><Bot size={17} /><strong>Blake</strong></header>
          <p>Two approved quotes are ready to schedule. Murray is available Thursday morning.</p>
          <span>Ask anything about the operation...</span>
        </div>
      </div>
    </div>
  );
}

function DemoPlayer({ activeDemo }: { activeDemo: DemoKey }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = demoFrames[activeDemo];

  useEffect(() => {
    setFrame(0);
    setPlaying(true);
  }, [activeDemo]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % frames.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [frames.length, playing]);

  const current = frames[frame]!;

  return (
    <div className={styles.demoStage}>
      <div className={styles.demoChrome}>
        <div><span /><span /><span /></div>
        <small>Interactive product demo</small>
        <button type="button" onClick={() => { setFrame(0); setPlaying(true); }} title="Restart demo">
          <RefreshCw size={15} />
        </button>
      </div>
      <div className={`${styles.demoCanvas} ${styles[`demoCanvas_${activeDemo}`]}`}>
        {activeDemo === "blake" ? (
          <div className={styles.blakeDemo}>
            <aside>
              <span><Bot size={19} /></span>
              <div><strong>Blake</strong><small>AI business assistant</small></div>
            </aside>
            <div className={styles.blakeConversation}>
              <p className={styles.userBubble}>What are our sales this month?</p>
              {frame >= 1 ? (
                <div className={styles.blakeAnswer}>
                  <small>LIVE NEXA DATA</small>
                  <strong>£184,620 secured this month</strong>
                  <p>That is 12.4% ahead of last month. Eight quotes worth £46,800 still need a decision.</p>
                </div>
              ) : <div className={styles.thinkingLine}><Sparkles size={16} /> Checking quotes, jobs and invoices...</div>}
              {frame >= 2 ? (
                <div className={styles.reportMini}>
                  {reportRows.map(([label, value, trend]) => (
                    <div key={label}><span>{label}</span><strong>{value}</strong><b>{trend}</b></div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeDemo === "workflow" ? (
          <div className={styles.workflowDemo}>
            <div className={styles.workflowTrack}>
              {frames.map((item, index) => (
                <div className={index <= frame ? styles.workflowStepActive : styles.workflowStep} key={item.label}>
                  <span>{index < frame ? <Check size={16} /> : index + 1}</span>
                  <strong>{item.label}</strong>
                  <small>{index <= frame ? "Connected" : "Waiting"}</small>
                </div>
              ))}
            </div>
            <div className={styles.workflowRecord}>
              <header><span>{current.label.toUpperCase()} RECORD</span><b>EWG-2148</b></header>
              <h3>{current.title}</h3>
              <p>{current.copy}</p>
              <div>
                <span>Client<strong>Northfield Property Services</strong></span>
                <span>Site<strong>Union Street, Aberdeen</strong></span>
                <span>Status<strong>{frame === frames.length - 1 ? "Ready to send" : "In progress"}</strong></span>
              </div>
            </div>
          </div>
        ) : null}

        {activeDemo === "surveyor" ? (
          <div className={styles.surveyDemo}>
            <aside>
              {frames.map((item, index) => (
                <span className={index <= frame ? styles.surveyStepActive : ""} key={item.label}>
                  {index < frame ? <Check size={14} /> : index + 1} {item.label}
                </span>
              ))}
            </aside>
            <div className={styles.surveyDevice}>
              <header><ScanLine size={18} /><strong>Bathroom refurbishment survey</strong><small>Autosaved</small></header>
              <div className={styles.surveyVisual}>
                {frame === 0 ? <><Map size={42} /><strong>What are we pricing today?</strong><p>Full bathroom refurbishment with altered shower position.</p></> : null}
                {frame === 1 ? <><ScanLine size={42} /><strong>Room captured</strong><p>2.48m × 2.16m · 2 photos · LiDAR model attached</p></> : null}
                {frame === 2 ? <><Sparkles size={42} /><strong>Estimate pack ready</strong><p>3 cost centres · 28 materials · 42 labour hours</p></> : null}
                {frame === 3 ? <><Check size={42} /><strong>Sent to NeXa Core</strong><p>Q-2148 is ready for office review and supplier pricing.</p></> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className={styles.demoCaption}>
        <button type="button" onClick={() => setPlaying((currentPlaying) => !currentPlaying)} title={playing ? "Pause demo" : "Play demo"}>
          {playing ? <CirclePause size={22} /> : <CirclePlay size={22} />}
        </button>
        <div>
          <small>{current.label}</small>
          <strong>{current.title}</strong>
          <p>{current.copy}</p>
        </div>
        <span>{frame + 1} / {frames.length}</span>
      </div>
      <div className={styles.demoProgress} aria-hidden="true">
        {frames.map((item, index) => (
          <button
            aria-label={`Show ${item.label}`}
            className={index === frame ? styles.demoProgressActive : ""}
            key={item.label}
            onClick={() => setFrame(index)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

export function NexaSalesExperience() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeDemo, setActiveDemo] = useState<DemoKey>("blake");

  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="NeXa home">
          <Image src="/brand/nexa-command-lockup-dark.svg" width={148} height={38} alt="NeXa" priority />
        </a>
        <nav className={menuOpen ? styles.navOpen : styles.nav} aria-label="Sales site">
          <a href="#product" onClick={() => setMenuOpen(false)}>Product</a>
          <a href="#blake" onClick={() => setMenuOpen(false)}>Blake AI</a>
          <a href="#modules" onClick={() => setMenuOpen(false)}>Modules</a>
          <a href="#demo" onClick={() => setMenuOpen(false)}>Demos</a>
          <a href="/early-access" onClick={() => setMenuOpen(false)}>Early access</a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.textAction} href="/login">Sign in</a>
          <a className={styles.primaryAction} href="/early-access">Company production <ArrowRight size={16} /></a>
        </div>
        <button className={styles.menuButton} type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Close menu" : "Open menu"}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroAtmosphere} aria-hidden />
        <div className={styles.heroProduct}><ProductShell /></div>
        <div className={styles.heroCopy}>
          <h1>NeXa</h1>
          <p>Quote, survey, schedule, deliver and invoice from one live command centre — with Blake across the operation.</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryAction} href="/early-access">
              Company production <ArrowRight size={16} />
            </a>
            <a className={styles.secondaryAction} href="#demo">
              <Play size={16} /> See it move
            </a>
          </div>
        </div>
      </section>

      <section className={styles.statementBand} id="product">
        <span>One live operational record</span>
        <h2>Every decision stays connected to the work.</h2>
        <p>NeXa binds the customer, site, scope, price, programme, people, evidence, costs and invoice into one controlled workflow.</p>
        <div className={styles.lifecycle}>
          {["Enquiry", "Survey", "Estimate", "Quote", "Schedule", "Deliver", "Invoice", "Learn"].map((item, index) => (
            <span key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}</span>
          ))}
        </div>
      </section>

      <section className={styles.blakeBand} id="blake">
        <div className={styles.blakeIntro}>
          <span className={styles.eyebrow}>Meet Blake</span>
          <h2>Ask the business. Get an operational answer.</h2>
          <p>Blake does more than chat. It reads the live NeXa records, produces reports, finds risks and prepares actions for you to approve.</p>
          <ul>
            <li><Check size={16} /> “What are our sales this month?”</li>
            <li><Check size={16} /> “Which jobs are losing money?”</li>
            <li><Check size={16} /> “Is Murray available next Thursday?”</li>
            <li><Check size={16} /> “Build me a report of overdue quotes.”</li>
          </ul>
        </div>
        <div className={styles.blakeReport}>
          <header><span><Bot size={18} /></span><div><strong>Blake</strong><small>Live business intelligence</small></div><b>Verified</b></header>
          <p className={styles.reportQuestion}>Which jobs need attention today?</p>
          <div className={styles.reportAnswer}>
            <strong>Three jobs need a decision.</strong>
            <span>J-2141 is forecast 6.8% over labour. J-2137 has an unapproved variation. J-2129 is complete but not invoiced.</span>
          </div>
          <div className={styles.reportActions}>
            <span><TrendingUp size={17} /> Open risk report</span>
            <span><CalendarDays size={17} /> Review programme</span>
            <span><Mail size={17} /> Draft follow-ups</span>
          </div>
        </div>
      </section>

      <section className={styles.modulesBand} id="modules">
        <header>
          <span className={styles.eyebrow}>One connected system</span>
          <h2>Use the right tool for each part of the job.</h2>
          <p>Each NeXa module has one clear purpose. The information moves between them without rebuilding the work.</p>
        </header>
        <div className={styles.moduleList}>
          {moduleRows.map(({ icon: Icon, name, statement, detail }, index) => (
            <article key={name}>
              <span className={styles.moduleNumber}>{String(index + 1).padStart(2, "0")}</span>
              <Icon size={23} />
              <div><strong>{name}</strong><small>{statement}</small></div>
              <p>{detail}</p>
              <ChevronRight size={18} />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.demoBand} id="demo">
        <header>
          <span className={styles.eyebrow}>Product demos</span>
          <h2>See NeXa move real work.</h2>
          <p>These interactive demo sequences use synthetic records. They are ready to become narrated website videos, sales clips and onboarding walkthroughs.</p>
        </header>
        <div className={styles.demoTabs} role="tablist" aria-label="Choose a NeXa demo">
          <button className={activeDemo === "blake" ? styles.demoTabActive : ""} onClick={() => setActiveDemo("blake")} type="button"><Bot size={17} /> Ask Blake</button>
          <button className={activeDemo === "workflow" ? styles.demoTabActive : ""} onClick={() => setActiveDemo("workflow")} type="button"><ClipboardCheck size={17} /> Enquiry to invoice</button>
          <button className={activeDemo === "surveyor" ? styles.demoTabActive : ""} onClick={() => setActiveDemo("surveyor")} type="button"><ScanLine size={17} /> Survey to quote</button>
        </div>
        <DemoPlayer activeDemo={activeDemo} />
      </section>

      <section className={styles.controlBand}>
        <div>
          <ShieldCheck size={30} />
          <span className={styles.eyebrow}>AI with operational control</span>
          <h2>Blake can recommend. Your team remains accountable.</h2>
        </div>
        <div className={styles.controlPoints}>
          <span><b>01</b><strong>Live data</strong><small>Answers come from the connected workspace.</small></span>
          <span><b>02</b><strong>Clear evidence</strong><small>Reports show what sits behind the answer.</small></span>
          <span><b>03</b><strong>Review before action</strong><small>Schedules and commercial changes require approval.</small></span>
          <span><b>04</b><strong>Audit trail</strong><small>NeXa records who asked, approved and changed what.</small></span>
        </div>
      </section>

      <section className={styles.earlyAccessBand} id="early-access">
        <div className={styles.earlyAccessInner}>
          <span className={styles.eyebrow}>Company production</span>
          <h2>Sell it as early access.</h2>
          <p>
            One named-company offer: live ops spine, Blake AI, backups and a clear ops checklist.
            simPRO stays optional until NeXa is the system of record.
          </p>
          <div className={styles.earlyAccessActions}>
            <a className={styles.primaryAction} href="/early-access">
              View early access pack <ArrowRight size={16} />
            </a>
            <a className={styles.secondaryAction} href="/login">
              Sign in to Core
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/brand/nexa-command-lockup-dark.svg" width={132} height={34} alt="NeXa" />
        <span>Bound into one command centre.</span>
        <div><a href="#product">Product</a><a href="#demo">Demos</a><a href="/early-access">Early access</a><a href="/login">Sign in</a></div>
        <small>© 2026 NeXa. Product demonstration data is synthetic.</small>
      </footer>
    </main>
  );
}
