import type { FaultIssue } from "@/lib/faults-types";
import { buildDevelopmentTaskMarkdown } from "@/lib/faults-data";

/**
 * Optional GitHub sync for Faults & Improvements.
 * Configure GITHUB_TOKEN + GITHUB_FAULTS_REPO (owner/repo).
 * NeXa remains source of truth — GitHub is a downstream mirror.
 */
export function githubFaultsConfigured() {
  return Boolean(process.env.GITHUB_TOKEN?.trim() && process.env.GITHUB_FAULTS_REPO?.trim());
}

export async function syncFaultIssueToGithub(issue: FaultIssue) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_FAULTS_REPO?.trim();
  if (!token || !repo) {
    return {
      ok: false as const,
      error: "GitHub sync not configured (set GITHUB_TOKEN and GITHUB_FAULTS_REPO)",
    };
  }

  const body = buildDevelopmentTaskMarkdown(issue);
  const labels = ["nexa", `module:${String(issue.module).toLowerCase().replace(/\s+/g, "-")}`, issue.type, issue.priority];

  try {
    if (issue.github?.issueNumber) {
      const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issue.github.issueNumber}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: `${issue.reference} — ${issue.title}`,
          body,
          state: issue.status === "complete" || issue.status === "rejected" ? "closed" : "open",
          labels,
        }),
      });
      const data = (await response.json()) as { html_url?: string; number?: number; message?: string };
      if (!response.ok) {
        return { ok: false as const, error: data.message || `GitHub update failed (${response.status})` };
      }
      return {
        ok: true as const,
        issueNumber: data.number || issue.github.issueNumber,
        issueUrl: data.html_url || issue.github.issueUrl,
      };
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: `${issue.reference} — ${issue.title}`,
        body,
        labels,
      }),
    });
    const data = (await response.json()) as { html_url?: string; number?: number; message?: string };
    if (!response.ok) {
      return { ok: false as const, error: data.message || `GitHub create failed (${response.status})` };
    }
    return {
      ok: true as const,
      issueNumber: data.number,
      issueUrl: data.html_url,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "GitHub sync failed",
    };
  }
}
