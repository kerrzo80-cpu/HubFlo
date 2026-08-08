import Image from "next/image";
import { ArrowRight, Check, Minus } from "lucide-react";

import { EARLY_ACCESS_PACK as pack } from "@/lib/early-access-pack";

import styles from "./early-access.module.css";

export default function EarlyAccessPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/nexa" aria-label="NeXa home">
          <Image src="/brand/nexa-command-lockup-dark.svg" width={148} height={38} alt="NeXa" priority />
        </a>
        <div className={styles.headerActions}>
          <a className={styles.textLink} href="/nexa">
            Product
          </a>
          <a className={styles.secondary} href="/login">
            Sign in
          </a>
          <a className={styles.primary} href={`mailto:${pack.supportEmail}?subject=NeXa%20Early%20Access`}>
            Accept early access <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <section className={styles.hero} aria-label="NeXa early access">
        <div className={styles.heroAtmosphere} aria-hidden />
        <div className={styles.heroInner}>
          <Image
            className={styles.heroBrand}
            src="/brand/nexa-command-lockup-dark.svg"
            width={220}
            height={56}
            alt="NeXa"
            priority
          />
          <h1>Production for your company.</h1>
          <p className={styles.heroLede}>
            Paid early access for {pack.buyer} — live ops, Blake AI, and company backups. Not a generic SaaS launch.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primary} href={`mailto:${pack.supportEmail}?subject=NeXa%20Early%20Access`}>
              Accept early access <ArrowRight size={16} />
            </a>
            <a className={styles.secondary} href="/login?next=/setup">
              Open ops checklist
            </a>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow}`}>
        <p className={styles.sectionLabel}>Included</p>
        <h2>What you get in early access.</h2>
        <p className={styles.sectionIntro}>
          One connected company system for quoting, surveying, heat design, takeoff, field and invoicing.
        </p>
        <ul className={styles.list}>
          {pack.included.map((item) => (
            <li key={item}>
              <Check size={18} aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow} ${styles.exclude}`}>
        <p className={styles.sectionLabel}>Not included</p>
        <h2>Honest boundaries.</h2>
        <p className={styles.sectionIntro}>
          So the sale stays clear — this is company production, not a multi-tenant product launch.
        </p>
        <ul className={styles.list}>
          {pack.excluded.map((item) => (
            <li key={item}>
              <Minus size={18} aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow}`}>
        <p className={styles.sectionLabel}>Commercial terms</p>
        <h2>Simple company pricing.</h2>
        <div className={styles.termsBlock}>
          <div>
            <div className={styles.priceLine}>
              <strong>{pack.pricingLabel}</strong>
              <span>company-wide</span>
            </div>
            <p className={styles.sectionIntro}>{pack.pricingNote}</p>
          </div>
          <dl className={styles.termsMeta}>
            <dt>Support</dt>
            <dd>
              {pack.supportOwner} · {pack.supportWindow}
            </dd>
            <dt>Contact</dt>
            <dd>
              <a href={`mailto:${pack.supportEmail}`}>{pack.supportEmail}</a>
            </dd>
            <dt>simPRO</dt>
            <dd>{pack.simproStance}</dd>
            <dt>Exit</dt>
            <dd>{pack.exitTerms}</dd>
          </dl>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow}`}>
        <p className={styles.sectionLabel}>Proof</p>
        <h2>Already running on live.</h2>
        <p className={styles.sectionIntro}>
          Evidence from the company instance — not a slide deck promise.
        </p>
        <div className={styles.proofStrip}>
          {pack.acceptanceProof.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </section>

      <section className={styles.close}>
        <div className={styles.closeInner}>
          <p className={styles.sectionLabel}>Next step</p>
          <h2>Start early access.</h2>
          <p className={styles.sectionIntro}>
            Accept the pack, then verify readiness in Setup. Plumbing sales stay in Core — service health stays in the ops checklist.
          </p>
          <div className={styles.closeActions}>
            <a className={styles.primary} href={`mailto:${pack.supportEmail}?subject=NeXa%20Early%20Access%20-%20start`}>
              Start early access <ArrowRight size={16} />
            </a>
            <a className={styles.secondary} href="/nexa">
              Product overview
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/brand/nexa-command-lockup-dark.svg" width={120} height={31} alt="NeXa" />
        <span>{pack.offerName}</span>
        <nav aria-label="Footer">
          <a href="/nexa">Product</a>
          <a href="/login">Sign in</a>
          <a href={`mailto:${pack.supportEmail}`}>Contact</a>
        </nav>
      </footer>
    </main>
  );
}
