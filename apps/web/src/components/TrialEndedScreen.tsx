"use client";

import { TimerOff } from "lucide-react";
import { useBrand } from "@/components/BrandProvider";
import { platformLabel } from "@/lib/branding";

export function TrialEndedScreen() {
  const brand = useBrand();
  const label = platformLabel(brand);

  return (
    <main className="nexa-secure-login">
      <section>
        <div className="nexa-secure-login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.companyName || "Company"} /> : null}
          <span>
            <strong>{label}</strong>
            <small>Trial workspace</small>
          </span>
        </div>
        <div className="nexa-secure-login-heading">
          <span>
            <TimerOff size={17} />
          </span>
          <div>
            <h1>This trial has ended</h1>
            <p>
              The 30-day trial is over, so sign-in and the apps are paused. Your company data is still here if you
              decide to continue.
            </p>
          </div>
        </div>
        <p className="nexa-secure-login-trial-note">
          To carry on using this workspace, ask the person who set up the trial for a paid copy.
        </p>
      </section>
    </main>
  );
}
