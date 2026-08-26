"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { TrialEndedScreen } from "@/components/TrialEndedScreen";
import { useBrand } from "@/components/BrandProvider";
import { platformLabel } from "@/lib/branding";

function safeNextPath() {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

type TrialStatus = {
  trial?: boolean;
  expired?: boolean;
  daysRemaining?: number | null;
};

type AuthUser = {
  id: string;
  name: string;
  username: string;
  mustChangePassword?: boolean;
};

function trialDaysLabel(days: number | null | undefined) {
  if (days == null) return "";
  if (days <= 0) return "Trial ended";
  if (days === 1) return "Trial: 1 day remaining";
  return `Trial: ${days} days remaining`;
}

export default function LoginPage() {
  const brand = useBrand();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const label = platformLabel(brand);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/trial-licence", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as TrialStatus;
        if (!cancelled) setTrial(body);
      } catch {
        // Live / pilot / offline: no trial banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("change") === "1") {
      setMustChange(true);
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (mustChange) {
        if (newPassword.length < 10) {
          setError("New password must be at least 10 characters.");
          return;
        }
        if (newPassword !== confirmPassword) {
          setError("New password and confirmation do not match.");
          return;
        }
        const response = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: password, newPassword }),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setError(result.error || "Unable to change password.");
          return;
        }
        window.location.assign(safeNextPath());
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        trialExpired?: boolean;
        user?: AuthUser;
      };
      if (!response.ok) {
        setError(result.error || "Unable to sign in.");
        if (result.trialExpired) setTrial({ trial: true, expired: true, daysRemaining: 0 });
        return;
      }
      if (result.user?.mustChangePassword) {
        setMustChange(true);
        setError("");
        return;
      }
      window.location.assign(safeNextPath());
    } catch {
      setError("Could not reach the login service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (trial?.trial && trial.expired) {
    return <TrialEndedScreen />;
  }

  return (
    <main className="nexa-secure-login">
      <section>
        <div className="nexa-secure-login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.companyName || "Company"} /> : null}
          <span>
            <strong>{label}</strong>
            <small>Secure workspace</small>
          </span>
        </div>
        <div className="nexa-secure-login-heading">
          <span>
            <KeyRound size={17} />
          </span>
          <div>
            <h1>{mustChange ? "Choose a new password" : "Sign in"}</h1>
            <p>
              {mustChange
                ? "This account must set a personal password before continuing (at least 10 characters)."
                : "Use your individual account. Activity is recorded against your profile."}
            </p>
          </div>
        </div>
        <form onSubmit={submit}>
          {!mustChange ? (
            <>
              <label>
                Username
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  autoComplete="current-password"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Current password
                <input
                  autoComplete="current-password"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  autoComplete="new-password"
                  required
                  minLength={10}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  autoComplete="new-password"
                  required
                  minLength={10}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </>
          )}
          {error ? <p className="nexa-secure-login-error">{error}</p> : null}
          <button disabled={submitting} type="submit">
            <LogIn size={17} />
            {submitting ? "Please wait…" : mustChange ? "Save password" : "Sign in"}
          </button>
        </form>
        {trial?.trial && trial.daysRemaining != null ? (
          <p className="nexa-secure-login-trial-note">{trialDaysLabel(trial.daysRemaining)}</p>
        ) : null}
      </section>
    </main>
  );
}
