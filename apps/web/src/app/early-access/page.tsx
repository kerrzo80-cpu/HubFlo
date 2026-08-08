import Image from "next/image";
import { ArrowRight, Check, Minus } from "lucide-react";

import { EARLY_ACCESS_PACK as pack } from "@/lib/early-access-pack";

import styles from "./early-access.module.css";

const acceptHref = `mailto:${pack.supportEmail}?subject=${encodeURIComponent(pack.mailtoSubject)}`;

function ProductPreview() {
  return (
    <div className={styles.productPreview} aria-hidden>
      <div className={styles.previewTop}>
        <Image src="/brand/nexa-command-mark.svg" width={22} height={22} alt="" />
        <span>Core</span>
        <em>Live</em>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewMetric}>
          <small>Revenue this month</small>
          <strong>£184,620</strong>
        </div>
        <div className={styles.previewMetric}>
          <small>Ready to invoice</small>
          <strong>6</strong>
        </div>
        <div className={styles.previewFlow}>
          {["Core", "Survey", "Takeoff", "Field"].map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>
        <div className={styles.previewBlake}>
          <Image src="/brand/blake-poses/blake-guide.png" width={44} height={44} alt="" />
          <p>Two approved quotes are ready to schedule.</p>
        </div>
      </div>
    </div>
  );
}

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
          <a className={styles.primary} href={acceptHref}>
            Accept early access <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <section className={styles.hero} aria-label="NeXa early access">
        <div className={styles.heroAtmosphere} aria-hidden />
        <div className={styles.heroVisual} aria-hidden>
          <ProductPreview />
        </div>
        <div className={styles.heroInner}>
          <Image
            className={styles.heroBrand}
            src="/brand/nexa-command-lockup-dark.svg"
            width={220}
            height={56}
            alt="NeXa"
            priority
          />
          <h1>One company package.</h1>
          <p className={styles.heroLede}>
            Core, Survey, Takeoff, Heat Design and Field for {pack.buyer} — live ops, Blake AI and backups. Not a pile of project apps.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primary} href={acceptHref}>
              Accept early access <ArrowRight size={16} />
            </a>
            <a className={styles.secondary} href="#terms">
              See commercial terms
            </a>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow}`}>
        <p className={styles.sectionLabel}>Included</p>
        <h2>Everything in the package.</h2>
        <p className={styles.sectionIntro}>
          One connected company package for quoting, surveying, heat design, takeoff, field and invoicing — not five separate tools.
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

      <section className={`${styles.section} ${styles.sectionNarrow}`} id="start">
        <p className={styles.sectionLabel}>How we start</p>
        <h2>Three steps after you accept.</h2>
        <p className={styles.sectionIntro}>
          No second sales stack. Accept the pack, prove readiness, then run live work.
        </p>
        <ol className={styles.steps}>
          {pack.startSteps.map((step, index) => (
            <li key={step.title}>
              <span className={styles.stepNum}>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.sectionNarrow}`} id="terms">
        <p className={styles.sectionLabel}>Commercial terms</p>
        <h2>Simple company pricing.</h2>
        <div className={styles.termsBlock}>
          <div>
            <div className={styles.priceLine}>
              <strong>{pack.pricingLabel}</strong>
              <span>company-wide</span>
            </div>
            <p className={styles.sectionIntro}>{pack.pricingNote}</p>
            <a className={styles.primary} href={acceptHref}>
              Accept early access <ArrowRight size={16} />
            </a>
          </div>
          <dl className={styles.termsMeta}>
            <dt>Buyer</dt>
            <dd>{pack.buyer}</dd>
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
            <a className={styles.primary} href={acceptHref}>
              Start early access <ArrowRight size={16} />
            </a>
            <a className={styles.secondary} href="/login?next=/setup">
              Open ops checklist
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
