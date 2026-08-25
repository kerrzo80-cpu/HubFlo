"use client";

import {
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  Menu,
  PoundSterling,
  Sparkles,
  Zap,
  X,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import {
  ASSISTANT_ASK,
  ASSISTANT_NAME,
  ASSISTANT_TAGLINE,
  PLATFORM_NAME,
  PLATFORM_POSITIONING,
  PLATFORM_TAGLINE,
  PLATFORM_WORDMARK,
} from "@/lib/product-brand";

import styles from "./sales.module.css";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How It Works" },
  { href: "#trades", label: "For Trades" },
  { href: "#pricing", label: "Pricing" },
];

const featureStrip = [
  { icon: Zap, label: "Quote faster" },
  { icon: CalendarDays, label: "Stay on schedule" },
  { icon: ClipboardCheck, label: "Control every job" },
  { icon: PoundSterling, label: "Protect your profit" },
];

const demoMailto =
  "mailto:brian.kerr@errolwatsongroup.com?subject=blake.%20product%20demo";

function ProductShell() {
  return (
    <div className={styles.productShell} aria-label={`${PLATFORM_NAME} operations overview`}>
      <div className={styles.productTopbar}>
        <div className={styles.productBrand}>
          <Image src="/brand/blake-mark.svg" width={28} height={28} alt="" />
          <strong>{PLATFORM_WORDMARK}</strong>
        </div>
        <nav className={styles.productTabs} aria-label="Workspace modules">
          <span>Dashboard</span>
          <span className={styles.productTabActive}>{ASSISTANT_ASK}</span>
          <span>Leads</span>
          <span>Quotes</span>
          <span>Jobs</span>
          <span>Schedules</span>
          <span>Invoices</span>
        </nav>
      </div>
      <div className={styles.productBody}>
        <aside className={styles.productRail}>
          <p>DASHBOARD</p>
          <span className={styles.railActive}>Overview</span>
          <span>My work</span>
          <span>Reports</span>
          <p>ADDONS</p>
          <span className={styles.railAyla}>{ASSISTANT_ASK}</span>
          <span>Surveyor</span>
          <span>Takeoff</span>
          <span>Heat Design</span>
          <span>Field</span>
        </aside>
        <div className={styles.productWorkspace}>
          <header>
            <div>
              <small>Operations overview</small>
              <strong>Job health across the business</strong>
            </div>
            <em>{ASSISTANT_ASK}</em>
          </header>
          <div className={styles.metricRow}>
            <div>
              <small>Job health</small>
              <strong>42</strong>
              <span>live jobs</span>
            </div>
            <div>
              <small>Pipeline</small>
              <strong>£184k</strong>
              <span>open quotes</span>
            </div>
            <div>
              <small>Invoices</small>
              <strong>£29k</strong>
              <span>ready to send</span>
            </div>
            <div>
              <small>Live value</small>
              <strong>£312k</strong>
              <span>secured</span>
            </div>
          </div>
          <div className={styles.schedulePreview}>
            <header>
              <strong>Quotes by status</strong>
              <span>This month</span>
            </header>
            <div className={styles.barStack}>
              <div>
                <span>Draft</span>
                <b style={{ width: "42%" }} />
              </div>
              <div>
                <span>Sent</span>
                <b style={{ width: "68%" }} />
              </div>
              <div>
                <span>Accepted</span>
                <b style={{ width: "54%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AylaPeek() {
  return (
    <aside className={styles.aylaPeek} aria-label={ASSISTANT_ASK}>
      <Image
        src="/brand/buddy-avatar.png"
        width={88}
        height={88}
        alt={ASSISTANT_NAME}
        className={styles.aylaAvatar}
      />
      <div>
        <strong>{ASSISTANT_ASK}.</strong>
        <p>{ASSISTANT_TAGLINE}</p>
      </div>
    </aside>
  );
}

export function NexaSalesExperience() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label={`${PLATFORM_WORDMARK} home`}>
          <Image src="/brand/blake-lockup-dark.svg" width={168} height={48} alt={PLATFORM_WORDMARK} priority />
        </a>
        <nav className={menuOpen ? styles.navOpen : styles.nav} aria-label="Sales site">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.primaryAction} href={demoMailto}>
            Book a Demo
          </a>
        </div>
        <button
          className={styles.menuButton}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{PLATFORM_POSITIONING.toUpperCase()}</span>
          <h1>
            <span className={styles.heroWordmark}>{PLATFORM_WORDMARK}</span>
            <span className={styles.heroTagline}>{PLATFORM_TAGLINE}</span>
          </h1>
          <p>
            {PLATFORM_NAME} brings your entire office together — enquiries, quotes, jobs, schedules, variations and
            invoices.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryAction} href={demoMailto}>
              Book a Demo
            </a>
            <a className={styles.secondaryAction} href="#how">
              See {PLATFORM_NAME} in Action
            </a>
          </div>
        </div>
        <div className={styles.heroProduct}>
          <ProductShell />
          <AylaPeek />
        </div>
      </section>

      <section className={styles.featureStrip} id="features" aria-label="Product highlights">
        {featureStrip.map(({ icon: Icon, label }) => (
          <div key={label}>
            <span>
              <Icon size={20} />
            </span>
            <strong>{label}</strong>
          </div>
        ))}
      </section>

      <section className={styles.statementBand} id="how">
        <span className={styles.eyebrow}>How it works</span>
        <h2>One live office for the full job lifecycle.</h2>
        <p>
          Capture the enquiry, build the quote, schedule the team, control delivery and invoice from the same
          connected record — with {ASSISTANT_ASK} ready when you need help.
        </p>
        <div className={styles.lifecycle}>
          {["Enquiry", "Quote", "Schedule", "Deliver", "Invoice"].map((item, index) => (
            <span key={item}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.blakeBand} id="trades">
        <div className={styles.blakeIntro}>
          <span className={styles.eyebrow}>Meet {ASSISTANT_NAME}</span>
          <h2>Ask the business. Get an operational answer.</h2>
          <p>
            {ASSISTANT_NAME} reads live {PLATFORM_NAME} records, surfaces risks and prepares actions for your team to
            approve — never guessing outside the work.
          </p>
          <ul>
            <li>
              <Check size={16} /> “What are our sales this month?”
            </li>
            <li>
              <Check size={16} /> “Which jobs are losing money?”
            </li>
            <li>
              <Check size={16} /> “Who is free Thursday morning?”
            </li>
            <li>
              <Check size={16} /> “Draft follow-ups on overdue quotes.”
            </li>
          </ul>
        </div>
        <div className={styles.blakeReport}>
          <header>
            <span>
              <Sparkles size={18} />
            </span>
            <div>
              <strong>{ASSISTANT_ASK}</strong>
              <small>Live business intelligence</small>
            </div>
            <b>Verified</b>
          </header>
          <p className={styles.reportQuestion}>Which jobs need attention today?</p>
          <div className={styles.reportAnswer}>
            <strong>Three jobs need a decision.</strong>
            <span>
              J-2141 is forecast over labour. J-2137 has an unapproved variation. J-2129 is complete but not invoiced.
            </span>
          </div>
        </div>
      </section>

      <section className={styles.ctaBand} id="pricing">
        <Image src="/brand/blake-mark.svg" width={58} height={58} alt="" />
        <h2>Ready for a calmer office?</h2>
        <p>
          See how {PLATFORM_WORDMARK} fits your customers, teams and day-to-day trade workflows.
        </p>
        <div>
          <a className={styles.primaryAction} href={demoMailto}>
            Book a Demo <ArrowRight size={16} />
          </a>
          <a className={styles.secondaryAction} href="/login">
            Open {PLATFORM_NAME} workspace
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/brand/blake-lockup-dark.svg" width={148} height={42} alt={PLATFORM_WORDMARK} />
        <span>{PLATFORM_TAGLINE}</span>
        <div>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="/login">Sign in</a>
        </div>
        <small>© 2026 {PLATFORM_NAME}. Product demonstration data is synthetic.</small>
      </footer>
    </main>
  );
}
