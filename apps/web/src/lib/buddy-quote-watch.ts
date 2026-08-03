import type { BuddyMemory } from "@/lib/buddy-memory";

export type BuddyWatchSeverity = "block" | "warn" | "tip";

export type BuddyWatchFinding = {
  id: string;
  severity: BuddyWatchSeverity;
  title: string;
  detail: string;
  actionHint?: string;
};

type WatchLine = {
  description?: string;
  quantity?: number;
  unitCost?: number;
  unitSell?: number;
  catalogItemId?: string;
};

type WatchCentre = {
  id?: string;
  name?: string;
  lines?: WatchLine[];
};

function isPlaceholder(value?: string) {
  const text = (value || "").trim().toLowerCase();
  if (!text) return true;
  return /^(site to confirm|address to confirm|to confirm|to be confirmed|tbc|n\/?a|unknown|not set)$/i.test(text);
}

function lineLooksLikeLabour(line: WatchLine) {
  const catalogId = (line.catalogItemId || "").toLowerCase();
  if (catalogId.startsWith("labour-") || catalogId.startsWith("labor-")) return true;
  return /\b(labour|labor|engineer hours?|plumber hours?|fitter hours?)\b/i.test(line.description || "");
}

/**
 * Blake watches a quote before it goes out (email / Simpro / accept).
 * Findings are ordered blockers first, then warnings, then tips.
 */
export function watchQuoteReadiness(input: {
  quote: {
    id: string;
    ref: string;
    customer: string;
    clientId?: string;
    siteId?: string;
    description: string;
    value: number;
    status: string;
  };
  clientName?: string;
  siteName?: string;
  siteAddress?: string;
  costCentres: WatchCentre[];
  memory?: BuddyMemory;
}): BuddyWatchFinding[] {
  const memory = input.memory;
  const muted = new Set(memory?.mutedFindingIds ?? []);
  const dismissed = new Set(memory?.dismissedByQuote?.[input.quote.id] ?? []);
  const findings: BuddyWatchFinding[] = [];

  const push = (finding: BuddyWatchFinding) => {
    const key = finding.id.split(":")[0] || finding.id;
    if (muted.has(key) || dismissed.has(finding.id)) return;
    const misses = memory?.missCounts?.[key] || 0;
    if (misses >= 2 && finding.severity === "warn") {
      findings.push({
        ...finding,
        detail: `${finding.detail} Blake has seen this crop up ${misses} times on your sends.`,
      });
      return;
    }
    findings.push(finding);
  };

  if (!input.quote.clientId || isPlaceholder(input.clientName || input.quote.customer)) {
    push({
      id: "client-missing",
      severity: "block",
      title: "Client still needs confirming",
      detail: "Blake can’t see a proper linked client on this quote yet.",
      actionHint: "Open quote details and pick the customer before sending.",
    });
  }

  if (!input.quote.siteId || isPlaceholder(input.siteName) || isPlaceholder(input.siteAddress)) {
    push({
      id: "site-missing",
      severity: "block",
      title: "Site still says to confirm",
      detail: "Simpro and the customer pack need a real site address, not a placeholder.",
      actionHint: "Link or create the site on this quote.",
    });
  }

  if (isPlaceholder(input.quote.description)) {
    push({
      id: "description-missing",
      severity: "warn",
      title: "Works description is thin",
      detail: "A clear description helps Blake, Simpro, and the customer understand the job.",
      actionHint: "Add a short plain-English description of the works.",
    });
  }

  const centres = Array.isArray(input.costCentres) ? input.costCentres : [];
  const lines = centres.flatMap((centre) => (Array.isArray(centre.lines) ? centre.lines : []));

  if (!centres.length) {
    push({
      id: "no-cost-centres",
      severity: "block",
      title: "No cost centres built yet",
      detail: "Sending now would push an empty commercial shell.",
      actionHint: "Use Build quote costs first.",
    });
  } else if (!lines.length) {
    push({
      id: "empty-cost-centres",
      severity: "block",
      title: "Cost centres have no lines",
      detail: "The centres exist, but Blake can’t see labour or materials inside them.",
      actionHint: "Open the cost build and add materials and labour.",
    });
  } else {
    const hasLabour = lines.some(lineLooksLikeLabour);
    const hasMaterial = lines.some((line) => !lineLooksLikeLabour(line));
    if (!hasLabour) {
      push({
        id: "no-labour",
        severity: "warn",
        title: "No labour hours on the build",
        detail: "Blake only sees materials so far — labour is usually needed before this goes out.",
        actionHint: "Add engineer/plumber hours to the cost centre.",
      });
    }
    if (!hasMaterial) {
      push({
        id: "no-materials",
        severity: "warn",
        title: "No materials / kit on the build",
        detail: "Blake only sees labour — boiler kit, radiators or fittings may be missing.",
        actionHint: "Add the plant and materials lines before sending.",
      });
    }

    const emptyCentres = centres.filter((centre) => !(centre.lines && centre.lines.length));
    for (const centre of emptyCentres.slice(0, 3)) {
      push({
        id: `empty-centre:${centre.id || centre.name || "unknown"}`,
        severity: "warn",
        title: `"${centre.name || "Cost centre"}" is empty`,
        detail: "This centre will look blank in Simpro if you send it as-is.",
        actionHint: "Add lines or remove the empty centre.",
      });
    }
  }

  const sell = Number(input.quote.value) || lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitSell) || 0), 0);
  if (sell <= 0 && lines.length > 0) {
    push({
      id: "zero-sell",
      severity: "block",
      title: "Sell total is still £0",
      detail: "Blake won’t let a zero-value quote go out as if it’s ready.",
      actionHint: "Check unit sell prices on the cost lines.",
    });
  }

  if (input.quote.status === "Draft" && lines.length > 0 && sell > 0) {
    push({
      id: "still-draft",
      severity: "tip",
      title: "Still in Draft",
      detail: "That’s fine for Simpro handoff — just remember the customer hasn’t been issued this pack yet.",
    });
  }

  const rank = { block: 0, warn: 1, tip: 2 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function buddyWatchSummary(findings: BuddyWatchFinding[]) {
  const blocks = findings.filter((item) => item.severity === "block").length;
  const warns = findings.filter((item) => item.severity === "warn").length;
  if (blocks > 0) {
    return {
      mood: "alert" as const,
      headline: blocks === 1 ? "Blake spotted 1 thing to fix before send" : `Blake spotted ${blocks} things to fix before send`,
    };
  }
  if (warns > 0) {
    return {
      mood: "guide" as const,
      headline: warns === 1 ? "Blake has 1 check for you" : `Blake has ${warns} checks for you`,
    };
  }
  return {
    mood: "good" as const,
    headline: "Looks good to Blake — nothing blocking send",
  };
}
