import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRight, Check } from "lucide-react";

import { EARLY_ACCESS_PACK as pack } from "@/lib/early-access-pack";

import styles from "./early-access.module.css";

export const metadata: Metadata = {
  title: "NeXa · Company Production Early Access",
  description:
    "NeXa as production for your company — early access scope, what’s included, and pilot terms.",
};

export default function EarlyAccessPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/nexa" aria-label="NeXa">
          <Image
            className={styles.brandMark}
            src="/brand/nexa-command-mark.svg"
            width={36}
            height={36}
            alt=""
          />
          <span className={styles.brandCopy}>
            <strong>NeXa</strong>
            <span>{pack.offerName}</span>
          </span>
        </a>
        <div className={styles.headerActions}>
          <a className={styles.secondary} href="/nexa">
            Product
          </a>
          <a className={styles.primary} href="/login?next=/setup">
            Sign in to Core <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Early access · single company</p>
        <h1>
          Production for <em>your</em> company
        </h1>
        <p className={styles.lede}>
          NeXa is ready to sell as paid early access for {pack.buyer}: the live ops spine, Blake AI,
          and company backups — not a generic multi-tenant SaaS launch.
        </p>
        <div className={styles.metaRow}>
          <span className={styles.chip}>{pack.posture}</span>
          <span className={styles.chip}>{pack.pricingLabel}</span>
          <span className={styles.chip}>simPRO optional bridge</span>
        </div>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href={`mailto:${pack.supportEmail}?subject=NeXa%20Early%20Access`}>
            Accept early access <ArrowRight size={16} />
          </a>
          <a className={styles.secondary} href="/login?next=/setup">
            Open ops checklist
          </a>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Included</h2>
          <p>What you get in this early-access company production offer.</p>
          <ul>
            {pack.included.map((item) => (
              <li key={item}>
                <Check size={14} style={{ display: "inline", marginRight: 6, color: "var(--verdigris)" }} />
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.panel}>
          <h2>Not included</h2>
          <p>Clear boundaries so the sale stays honest.</p>
          <ul>
            {pack.excluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className={styles.panel}>
          <h2>Commercial terms</h2>
          <div className={styles.price}>
            <strong>{pack.pricingLabel}</strong>
            <span>company-wide</span>
          </div>
          <p>{pack.pricingNote}</p>
          <ul>
            <li>
              Support: {pack.supportOwner} · {pack.supportWindow}
            </li>
            <li>Contact: {pack.supportEmail}</li>
            <li>{pack.exitTerms}</li>
            <li>{pack.simproStance}</li>
          </ul>
        </article>

        <article className={styles.panel}>
          <h2>Acceptance proof</h2>
          <p>Evidence already on the live company instance.</p>
          <ul>
            {pack.acceptanceProof.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className={styles.ctaRow}>
            <a className={styles.secondary} href="/login?next=/setup">
              Verify in Setup → Ops checklist
            </a>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.span2}`}>
          <h2>How we run it</h2>
          <p>
            Sales for plumbing/heating work stay in NeXa Core (leads, quotes, jobs, invoices). Service
            health stays in Setup — NeXa, OpenAI, backups, restore fire-drill, plus optional bridges
            (simPRO, Xero, SumUp). No second CRM or monitoring product required for early access.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.primary} href={`mailto:${pack.supportEmail}?subject=NeXa%20Early%20Access%20-%20start`}>
              Start early access <ArrowRight size={16} />
            </a>
            <a className={styles.secondary} href="/nexa">
              Back to product overview
            </a>
          </div>
        </article>
      </section>

      <p className={styles.footnote}>
        This page is the commercial pack for {pack.offerName}. Multi-tenant SaaS for other companies
        is a later product track — not required for EWG go-live.
      </p>
    </main>
  );
}
