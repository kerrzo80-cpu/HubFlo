/**
 * Retention ledger — held vs released from progress claims / release invoices.
 * Optional £ cap stops further retention once the held total reaches the cap.
 */

export type RetentionClaimLike = {
  id?: string;
  ref?: string;
  applicationRef?: string;
  status?: string;
  sourceType?: string;
  sourceId?: string;
  claimType?: string;
  chargeTotal?: number;
  retentionPercent?: number;
  /** Actual £ retained on this claim (preferred when set — supports caps). */
  retentionHeldAmount?: number;
  valuationLines?: Array<{ agreedThisPeriod?: number; requestedThisPeriod?: number }>;
  customer?: string;
  clientId?: string;
  siteId?: string;
  sourceRef?: string;
  sourceName?: string;
};

export type JobLike = {
  id: string;
  ref: string;
  customer: string;
  clientId?: string;
  siteId?: string;
  status?: string;
};

export type JobRetentionBalance = {
  jobId: string;
  retained: number;
  released: number;
  available: number;
  claimCount: number;
  releaseCount: number;
  claimRefs: string[];
};

export type RetentionPortfolioRow = {
  jobId: string;
  jobRef: string;
  customer: string;
  clientId?: string;
  siteId?: string;
  retentionPercent: number;
  retentionCapAmount: number;
  retained: number;
  released: number;
  outstanding: number;
  roomUnderCap: number | null;
  claimCount: number;
  releaseCount: number;
  capped: boolean;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseMoneyAmount(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseFloat(String(value).replace(/[£,\s]/g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function applyRetentionWithCap(options: {
  grossClaim: number;
  retentionPercent: number;
  alreadyRetained: number;
  /** 0 or blank = no cap */
  retentionCapAmount?: number;
}): {
  retentionAmount: number;
  netClaim: number;
  effectivePercent: number;
  uncappedRetention: number;
  capped: boolean;
  roomUnderCap: number;
} {
  const gross = Math.max(0, options.grossClaim);
  const pct = Math.max(0, Math.min(99.9, options.retentionPercent));
  const uncappedRetention = roundMoney(gross * (pct / 100));
  const cap = Math.max(0, options.retentionCapAmount ?? 0);
  const already = Math.max(0, options.alreadyRetained);
  const roomUnderCap = cap > 0 ? Math.max(0, roundMoney(cap - already)) : uncappedRetention;
  const retentionAmount = cap > 0 ? Math.min(uncappedRetention, roomUnderCap) : uncappedRetention;
  const netClaim = Math.max(0, roundMoney(gross - retentionAmount));
  const effectivePercent = gross > 0 ? roundMoney((retentionAmount / gross) * 100) : 0;
  return {
    retentionAmount,
    netClaim,
    effectivePercent,
    uncappedRetention,
    capped: cap > 0 && retentionAmount + 0.001 < uncappedRetention,
    roomUnderCap: cap > 0 ? roomUnderCap : Number.POSITIVE_INFINITY,
  };
}

export function progressClaimGrossAmount(invoice: RetentionClaimLike) {
  if (invoice.valuationLines?.length) {
    return invoice.valuationLines.reduce(
      (sum, line) => sum + Math.max(0, Number(line.agreedThisPeriod) || Number(line.requestedThisPeriod) || 0),
      0,
    );
  }
  const rate = Math.max(0, Math.min(99.9, invoice.retentionPercent ?? 0)) / 100;
  if (rate > 0 && rate < 1) return (Number(invoice.chargeTotal) || 0) / (1 - rate);
  return Number(invoice.chargeTotal) || 0;
}

export function progressClaimRetainedAmount(invoice: RetentionClaimLike) {
  if (typeof invoice.retentionHeldAmount === "number" && Number.isFinite(invoice.retentionHeldAmount)) {
    return Math.max(0, invoice.retentionHeldAmount);
  }
  const rate = Math.max(0, invoice.retentionPercent ?? 0) / 100;
  if (rate <= 0) return 0;
  return roundMoney(progressClaimGrossAmount(invoice) * rate);
}

export function jobRetentionBalances(jobId: string, invoiceList: RetentionClaimLike[]): JobRetentionBalance {
  const claims = invoiceList.filter(
    (invoice) =>
      invoice.sourceType === "job" &&
      invoice.sourceId === jobId &&
      invoice.status !== "Cancelled" &&
      invoice.claimType === "progress-claim",
  );
  const releases = invoiceList.filter(
    (invoice) =>
      invoice.sourceType === "job" &&
      invoice.sourceId === jobId &&
      invoice.status !== "Cancelled" &&
      invoice.claimType === "retention-release",
  );
  const retained = roundMoney(claims.reduce((sum, invoice) => sum + progressClaimRetainedAmount(invoice), 0));
  const released = roundMoney(releases.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.chargeTotal) || 0), 0));
  return {
    jobId,
    retained,
    released,
    available: Math.max(0, roundMoney(retained - released)),
    claimCount: claims.length,
    releaseCount: releases.length,
    claimRefs: claims.map((invoice) => invoice.applicationRef || invoice.ref || "").filter(Boolean),
  };
}

export function buildRetentionPortfolio(options: {
  jobs: JobLike[];
  invoices: RetentionClaimLike[];
  /** Resolved retention % / cap per job */
  termsForJob: (job: JobLike) => { retentionPercent: number; retentionCapAmount: number };
  customerFilter?: string;
}): RetentionPortfolioRow[] {
  const filter = options.customerFilter?.trim().toLowerCase();
  const rows: RetentionPortfolioRow[] = [];

  for (const job of options.jobs) {
    if (filter && filter !== "all customers" && job.customer.trim().toLowerCase() !== filter) {
      continue;
    }
    const balance = jobRetentionBalances(job.id, options.invoices);
    if (balance.retained <= 0 && balance.released <= 0) continue;
    const terms = options.termsForJob(job);
    const cap = Math.max(0, terms.retentionCapAmount);
    const roomUnderCap = cap > 0 ? Math.max(0, roundMoney(cap - balance.retained)) : null;
    // Prefer % from latest progress claim if present
    const latestClaim = options.invoices.find(
      (invoice) =>
        invoice.sourceType === "job" &&
        invoice.sourceId === job.id &&
        invoice.claimType === "progress-claim" &&
        invoice.status !== "Cancelled",
    );
    rows.push({
      jobId: job.id,
      jobRef: job.ref,
      customer: job.customer,
      clientId: job.clientId,
      siteId: job.siteId,
      retentionPercent: latestClaim?.retentionPercent ?? terms.retentionPercent,
      retentionCapAmount: cap,
      retained: balance.retained,
      released: balance.released,
      outstanding: balance.available,
      roomUnderCap,
      claimCount: balance.claimCount,
      releaseCount: balance.releaseCount,
      capped: cap > 0 && balance.retained + 0.009 >= cap,
    });
  }

  return rows.sort((a, b) => b.outstanding - a.outstanding || a.jobRef.localeCompare(b.jobRef));
}

export function retentionPortfolioTotals(rows: RetentionPortfolioRow[]) {
  return rows.reduce(
    (acc, row) => ({
      retained: roundMoney(acc.retained + row.retained),
      released: roundMoney(acc.released + row.released),
      outstanding: roundMoney(acc.outstanding + row.outstanding),
      jobs: acc.jobs + 1,
    }),
    { retained: 0, released: 0, outstanding: 0, jobs: 0 },
  );
}
