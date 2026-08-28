type PortalInvoiceLike = {
  id: string;
  ref: string;
  portalToken?: string | null;
};

/** Stable portal slug: inv-simpro-4063-{first8OfId} */
export function makeInvoicePortalToken(invoice: Pick<PortalInvoiceLike, "id" | "ref">) {
  const refSlug = String(invoice.ref || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const idSuffix = String(invoice.id || "").slice(0, 8);
  return `${refSlug || "invoice"}-${idSuffix}`;
}

export function resolveInvoicePortalToken(invoice: PortalInvoiceLike) {
  const stored = String(invoice.portalToken || "").trim();
  return stored || makeInvoicePortalToken(invoice);
}

export function invoicePortalUrl(
  invoice: PortalInvoiceLike,
  origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000",
) {
  const token = resolveInvoicePortalToken(invoice);
  return `${origin}/client/invoices/${encodeURIComponent(token)}`;
}

export function findInvoiceByPortalToken<T extends PortalInvoiceLike>(
  invoices: T[],
  token: string,
): T | null {
  const cleaned = token.trim().toLowerCase();
  if (!cleaned) return null;

  for (const invoice of invoices) {
    if (!invoice || typeof invoice !== "object") continue;
    const portal = String(invoice.portalToken || "").trim().toLowerCase();
    if (portal && portal === cleaned) return invoice;

    const derived = makeInvoicePortalToken(invoice).toLowerCase();
    if (derived === cleaned) return invoice;

    const ref = String(invoice.ref || "").trim().toLowerCase();
    if (ref && ref === cleaned) return invoice;
  }

  return null;
}

export function withPersistedInvoicePortalToken<T extends PortalInvoiceLike>(invoice: T): T & { portalToken: string } {
  const portalToken = resolveInvoicePortalToken(invoice);
  return { ...invoice, portalToken };
}
