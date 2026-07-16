"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LogIn } from "lucide-react";

function safeNextPath() {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error || "Unable to sign in.");
        return;
      }
      window.location.assign(safeNextPath());
    } catch {
      setError("NeXa could not reach the login service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="nexa-secure-login">
      <section>
        <div className="nexa-secure-login-brand">
          <img src="/ewg-logo.png" alt="Errol Watson Group" />
          <span>
            <strong>NeXa</strong>
            <small>Secure workspace</small>
          </span>
        </div>
        <div className="nexa-secure-login-heading">
          <span><KeyRound size={17} /></span>
          <div>
            <h1>Sign in</h1>
            <p>Use your individual NeXa account. Activity is recorded against your profile.</p>
          </div>
        </div>
        <form onSubmit={submit}>
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
          {error ? <p className="nexa-secure-login-error">{error}</p> : null}
          <button disabled={submitting} type="submit">
            <LogIn size={17} />
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
