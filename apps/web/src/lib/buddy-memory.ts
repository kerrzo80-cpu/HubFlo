/**
 * Buddy memory — light pattern learning that evolves with how the team works.
 * Stores preferences and repeated miss patterns locally per browser for now.
 * Safe for client use (no server imports).
 */

export type BuddyMood = "idle" | "alert" | "thinking" | "good" | "guide";

export type BuddyWorkHabits = {
  quotesWatched: number;
  quotesSent: number;
  totalLines: number;
  totalLabourHours: number;
  avgLinesPerQuote: number;
  avgLabourHours: number;
};

export type BuddyMemory = {
  version: 1;
  /** Finding ids the user asked Buddy to stop nagging about (global). */
  mutedFindingIds: string[];
  /** How often a finding type blocked or warned before send. */
  missCounts: Record<string, number>;
  /** Quote-scoped dismissals until refresh. */
  dismissedByQuote: Record<string, string[]>;
  /** Completed tutor flows, e.g. "quote-basics". */
  completedWalkthroughs: string[];
  /** Free-text habits Buddy has noticed. */
  habits: string[];
  /** Rolling commercial work pattern stats. */
  workHabits: BuddyWorkHabits;
  updatedAt: string;
};

const STORAGE_KEY = "hubflo:buddy-memory:v1";

export const buddyAvatarSrc = "/brand/buddy-mascot.png";
export const buddyPhotoAvatarSrc = "/brand/buddy-avatar.png";

export function defaultBuddyMemory(): BuddyMemory {
  return {
    version: 1,
    mutedFindingIds: [],
    missCounts: {},
    dismissedByQuote: {},
    completedWalkthroughs: [],
    habits: [],
    workHabits: {
      quotesWatched: 0,
      quotesSent: 0,
      totalLines: 0,
      totalLabourHours: 0,
      avgLinesPerQuote: 0,
      avgLabourHours: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function loadBuddyMemory(): BuddyMemory {
  if (typeof window === "undefined") return defaultBuddyMemory();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBuddyMemory();
    const parsed = JSON.parse(raw) as Partial<BuddyMemory>;
    const base = defaultBuddyMemory();
    return {
      ...base,
      ...parsed,
      version: 1,
      mutedFindingIds: Array.isArray(parsed.mutedFindingIds) ? parsed.mutedFindingIds : [],
      missCounts: parsed.missCounts && typeof parsed.missCounts === "object" ? parsed.missCounts : {},
      dismissedByQuote:
        parsed.dismissedByQuote && typeof parsed.dismissedByQuote === "object" ? parsed.dismissedByQuote : {},
      completedWalkthroughs: Array.isArray(parsed.completedWalkthroughs) ? parsed.completedWalkthroughs : [],
      habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      workHabits: {
        ...base.workHabits,
        ...(parsed.workHabits && typeof parsed.workHabits === "object" ? parsed.workHabits : {}),
      },
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return defaultBuddyMemory();
  }
}

export function saveBuddyMemory(memory: BuddyMemory) {
  if (typeof window === "undefined") return;
  const next = { ...memory, version: 1 as const, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function recordBuddyMiss(memory: BuddyMemory, findingIds: string[]) {
  const missCounts = { ...memory.missCounts };
  for (const id of findingIds) {
    const key = id.split(":")[0] || id;
    missCounts[key] = (missCounts[key] || 0) + 1;
  }
  const habits = [...memory.habits];
  for (const [key, count] of Object.entries(missCounts)) {
    if (count >= 3) {
      const habit = habitForFindingKey(key);
      if (habit && !habits.includes(habit)) habits.push(habit);
    }
  }
  return saveBuddyMemory({ ...memory, missCounts, habits: habits.slice(-20) }) ?? memory;
}

export function dismissBuddyFinding(memory: BuddyMemory, quoteId: string, findingId: string) {
  const current = memory.dismissedByQuote[quoteId] ?? [];
  if (current.includes(findingId)) return memory;
  return (
    saveBuddyMemory({
      ...memory,
      dismissedByQuote: {
        ...memory.dismissedByQuote,
        [quoteId]: [...current, findingId],
      },
    }) ?? memory
  );
}

export function muteBuddyFinding(memory: BuddyMemory, findingId: string) {
  const key = findingId.split(":")[0] || findingId;
  if (memory.mutedFindingIds.includes(key)) return memory;
  return (
    saveBuddyMemory({
      ...memory,
      mutedFindingIds: [...memory.mutedFindingIds, key],
    }) ?? memory
  );
}

export function markWalkthroughComplete(memory: BuddyMemory, walkthroughId: string) {
  if (memory.completedWalkthroughs.includes(walkthroughId)) return memory;
  return (
    saveBuddyMemory({
      ...memory,
      completedWalkthroughs: [...memory.completedWalkthroughs, walkthroughId],
    }) ?? memory
  );
}

/** Record a successful / attempted commercial send so Buddy learns typical quote shape. */
export function recordBuddyQuotePattern(
  memory: BuddyMemory,
  input: { lineCount: number; labourHours: number; sent: boolean },
) {
  const quotesWatched = memory.workHabits.quotesWatched + 1;
  const quotesSent = memory.workHabits.quotesSent + (input.sent ? 1 : 0);
  const totalLines = memory.workHabits.totalLines + Math.max(0, input.lineCount);
  const totalLabourHours = memory.workHabits.totalLabourHours + Math.max(0, input.labourHours);
  const avgLinesPerQuote = quotesWatched ? Math.round((totalLines / quotesWatched) * 10) / 10 : 0;
  const avgLabourHours = quotesWatched ? Math.round((totalLabourHours / quotesWatched) * 10) / 10 : 0;
  const habits = [...memory.habits];
  const shapeHabit =
    avgLabourHours >= 4
      ? "Quotes usually carry a healthy labour allowance."
      : avgLabourHours > 0 && avgLabourHours < 2
        ? "Labour hours on quotes tend to run light."
        : "";
  if (shapeHabit && !habits.includes(shapeHabit) && quotesWatched >= 3) {
    habits.push(shapeHabit);
  }
  return (
    saveBuddyMemory({
      ...memory,
      habits: habits.slice(-20),
      workHabits: {
        quotesWatched,
        quotesSent,
        totalLines,
        totalLabourHours,
        avgLinesPerQuote,
        avgLabourHours,
      },
    }) ?? memory
  );
}

/** Compact summary for Buddy chat / system context. */
export function buddyMemoryPrompt(memory: BuddyMemory) {
  const topMisses = Object.entries(memory.missCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${key}×${count}`);
  return {
    habits: memory.habits.slice(-8),
    completedWalkthroughs: memory.completedWalkthroughs,
    mutedFindingIds: memory.mutedFindingIds,
    topMisses,
    workHabits: memory.workHabits,
  };
}

function habitForFindingKey(key: string) {
  switch (key) {
    case "site-missing":
      return "Often sends quotes before the site is confirmed.";
    case "client-missing":
      return "Often needs a proper client link before Simpro.";
    case "no-cost-centres":
      return "Sometimes tries to send before building cost centres.";
    case "no-labour":
      return "Materials-only builds show up — labour is easy to miss.";
    case "no-materials":
      return "Labour-only builds show up — materials/kit are easy to miss.";
    case "zero-sell":
      return "Quotes sometimes go out with £0 sell.";
    default:
      return "";
  }
}

export function buddyMoodFromFindings(hasBlock: boolean, hasWarn: boolean, busy: boolean): BuddyMood {
  if (busy) return "thinking";
  if (hasBlock) return "alert";
  if (hasWarn) return "guide";
  return "good";
}
