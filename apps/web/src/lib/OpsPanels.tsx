"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Package, Plus, RefreshCw, Repeat } from "lucide-react";

type RequestHeaders = HeadersInit;

type StockSnapshot = {
  locations: Array<{ id: string; name: string; kind: string; engineerName?: string }>;
  items: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    minLevel: number;
    unitCost: number;
    preferredSupplier?: string;
    catalogItemId?: string;
  }>;
  balances: Array<{ locationId: string; itemId: string; quantity: number }>;
  movements: Array<{ id: string; at: string; itemId: string; quantity: number; reason: string; jobRef?: string; poNumber?: string; note?: string }>;
  lowStock: Array<{
    item: {
      id: string;
      sku: string;
      name: string;
      unit?: string;
      minLevel: number;
      unitCost?: number;
      preferredSupplier?: string;
      catalogItemId?: string;
    };
    onHand: number;
  }>;
};

type SiteAsset = {
  id: string;
  siteId: string;
  type: string;
  name: string;
  make?: string;
  model?: string;
  serialNumber?: string;
  locationNote?: string;
  installDate?: string;
  lastServiceDate?: string;
  nextServiceDate?: string;
  warrantyUntil?: string;
  certificateNumber?: string;
  certificateIssuedAt?: string;
  certificateExpiresAt?: string;
  notes?: string;
};

type RecurringPlan = {
  id: string;
  kind: "Job" | "Invoice";
  name: string;
  customer: string;
  site?: string;
  description: string;
  frequency: string;
  nextDueDate: string;
  amount?: number;
  active: boolean;
  lastGeneratedRef?: string;
};

export function StockOpsPanel({
  requestHeaders,
  onNotice,
  jobs = [],
  actorName = "NeXa",
  defaultSupplier = "Plumbase",
  onPurchaseRequestCreated,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  jobs?: Array<{ id: string; ref: string; customer: string; status: string }>;
  actorName?: string;
  defaultSupplier?: string;
  onPurchaseRequestCreated?: (request: {
    id: string;
    jobId: string;
    jobRef: string;
    supplier: string;
    item: string;
    estimatedCost: number;
    status: string;
    poNumber: string;
  }) => void;
}) {
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reorderBusyId, setReorderBusyId] = useState<string | null>(null);
  const [supplierEditById, setSupplierEditById] = useState<Record<string, string>>({});
  const [reorderDraft, setReorderDraft] = useState({
    jobId: "",
    supplier: "",
  });
  const [draft, setDraft] = useState({
    id: "",
    sku: "",
    name: "",
    unit: "each",
    minLevel: "0",
    unitCost: "0",
    preferredSupplier: "",
    locationId: "",
    qty: "1",
  });
  const [moveDraft, setMoveDraft] = useState({
    itemId: "",
    fromLocationId: "",
    toLocationId: "",
    qty: "1",
    jobRef: "",
    countedQty: "",
    mode: "transfer" as "transfer" | "issue" | "return" | "stocktake",
  });

  const openJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          !["Completed", "Cancelled", "Invoiced"].includes(job.status),
      ),
    [jobs],
  );

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/stock", { headers: requestHeaders });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load stock");
      setSnapshot(body as StockSnapshot);
      if (!draft.locationId && body.locations?.[0]?.id) {
        setDraft((current) => ({ ...current, locationId: body.locations[0].id }));
      }
      setMoveDraft((current) => ({
        ...current,
        itemId: current.itemId || body.items?.[0]?.id || "",
        fromLocationId: current.fromLocationId || body.locations?.[0]?.id || "",
        toLocationId: current.toLocationId || body.locations?.[1]?.id || body.locations?.[0]?.id || "",
      }));
      setReorderDraft((current) => ({
        ...current,
        jobId: current.jobId || openJobs[0]?.id || jobs[0]?.id || "",
      }));
      setSupplierEditById((current) => {
        const next: Record<string, string> = { ...current };
        for (const item of (body.items || []) as StockSnapshot["items"]) {
          if (next[item.id] === undefined) next[item.id] = item.preferredSupplier || "";
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load stock");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!reorderDraft.jobId && (openJobs[0]?.id || jobs[0]?.id)) {
      setReorderDraft((current) => ({ ...current, jobId: openJobs[0]?.id || jobs[0]?.id || "" }));
    }
  }, [jobs, openJobs, reorderDraft.jobId]);

  const onHandByItem = useMemo(() => {
    const map = new Map<string, number>();
    snapshot?.balances.forEach((row) => {
      map.set(row.itemId, (map.get(row.itemId) || 0) + row.quantity);
    });
    return map;
  }, [snapshot]);

  const stocktakeExpectedQty = useMemo(() => {
    if (moveDraft.mode !== "stocktake" || !moveDraft.itemId || !moveDraft.toLocationId) return null;
    const row = snapshot?.balances.find(
      (balance) => balance.itemId === moveDraft.itemId && balance.locationId === moveDraft.toLocationId,
    );
    return row?.quantity ?? 0;
  }, [moveDraft.itemId, moveDraft.mode, moveDraft.toLocationId, snapshot]);

  const stocktakeVariance = useMemo(() => {
    if (stocktakeExpectedQty == null || moveDraft.countedQty.trim() === "") return null;
    const counted = Number(moveDraft.countedQty);
    if (!Number.isFinite(counted)) return null;
    return counted - stocktakeExpectedQty;
  }, [moveDraft.countedQty, stocktakeExpectedQty]);

  async function addItemAndReceipt() {
    if (!draft.sku.trim() || !draft.name.trim()) {
      onNotice("Enter SKU and name first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const upsert = await fetch("/api/stock", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert-item",
          item: {
            id: draft.id || undefined,
            sku: draft.sku,
            name: draft.name,
            unit: draft.unit,
            minLevel: Number(draft.minLevel) || 0,
            unitCost: Number(draft.unitCost) || 0,
            preferredSupplier: draft.preferredSupplier.trim() || undefined,
          },
        }),
      });
      const upsertBody = await upsert.json();
      if (!upsert.ok) throw new Error(upsertBody.error || "Unable to save item");
      const item = (upsertBody.items as StockSnapshot["items"]).find(
        (row) =>
          (draft.id && row.id === draft.id) || row.sku.toLowerCase() === draft.sku.trim().toLowerCase(),
      );
      const isEdit = Boolean(draft.id);
      if (!isEdit && item && draft.locationId && Number(draft.qty) > 0) {
        const move = await fetch("/api/stock", {
          method: "POST",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            movement: {
              itemId: item.id,
              quantity: Number(draft.qty) || 1,
              reason: "Receipt",
              toLocationId: draft.locationId,
            },
          }),
        });
        const moveBody = await move.json();
        if (!move.ok) throw new Error(moveBody.error || "Unable to receive stock");
        setSnapshot(moveBody as StockSnapshot);
        if (item.id) {
          setSupplierEditById((current) => ({ ...current, [item.id]: draft.preferredSupplier.trim() }));
        }
      } else {
        setSnapshot(upsertBody as StockSnapshot);
        if (item?.id) {
          setSupplierEditById((current) => ({ ...current, [item.id]: draft.preferredSupplier.trim() }));
        }
      }
      onNotice(isEdit ? `${draft.name} updated.` : `${draft.name} saved into stock.`);
      setDraft((current) => ({
        ...current,
        id: "",
        sku: "",
        name: "",
        preferredSupplier: "",
        qty: "1",
        minLevel: "0",
        unitCost: "0",
        unit: "each",
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save stock");
    } finally {
      setBusy(false);
    }
  }

  function editStockItem(item: StockSnapshot["items"][number]) {
    setDraft((current) => ({
      ...current,
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit || "each",
      minLevel: String(item.minLevel ?? 0),
      unitCost: String(item.unitCost ?? 0),
      preferredSupplier: item.preferredSupplier || "",
      qty: "0",
    }));
    onNotice(`Editing ${item.sku} — update the form then save.`);
  }

  async function removeStockItem(item: StockSnapshot["items"][number]) {
    if (!window.confirm(`Remove ${item.sku} · ${item.name} from stock?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stock", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive-item", itemId: item.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to remove stock item");
      setSnapshot(body as StockSnapshot);
      if (draft.id === item.id) {
        setDraft((current) => ({
          ...current,
          id: "",
          sku: "",
          name: "",
          preferredSupplier: "",
          qty: "1",
        }));
      }
      onNotice(`${item.name} removed from stock.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove stock item");
    } finally {
      setBusy(false);
    }
  }

  async function runStockMove() {
    if (!moveDraft.itemId) {
      onNotice("Pick a stock item first.");
      return;
    }
    const qty = moveDraft.mode === "stocktake" ? Number(moveDraft.countedQty) : Number(moveDraft.qty);
    if (!Number.isFinite(qty) || qty < 0 || (moveDraft.mode !== "stocktake" && qty <= 0)) {
      onNotice(moveDraft.mode === "stocktake" ? "Enter the counted quantity." : "Enter a quantity greater than zero.");
      return;
    }
    if ((moveDraft.mode === "issue" || moveDraft.mode === "return") && !moveDraft.jobRef.trim()) {
      onNotice(moveDraft.mode === "return" ? "Enter the job ref before returning stock." : "Enter the job ref before issuing stock.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const movement =
        moveDraft.mode === "transfer"
          ? {
              itemId: moveDraft.itemId,
              quantity: qty,
              reason: "Transfer",
              fromLocationId: moveDraft.fromLocationId,
              toLocationId: moveDraft.toLocationId,
            }
          : moveDraft.mode === "issue"
            ? {
                itemId: moveDraft.itemId,
                quantity: qty,
                reason: "Issue to job",
                fromLocationId: moveDraft.fromLocationId,
                jobRef: moveDraft.jobRef.trim(),
              }
            : moveDraft.mode === "return"
              ? {
                  itemId: moveDraft.itemId,
                  quantity: qty,
                  reason: "Return from job",
                  toLocationId: moveDraft.toLocationId || moveDraft.fromLocationId,
                  jobRef: moveDraft.jobRef.trim(),
                  note: "Unused materials returned from job",
                }
              : {
                  itemId: moveDraft.itemId,
                  quantity: qty,
                  reason: "Stocktake",
                  toLocationId: moveDraft.toLocationId || moveDraft.fromLocationId,
                  note: "Stocktake count",
                };
      const response = await fetch("/api/stock", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", movement }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update stock");
      setSnapshot(body as StockSnapshot);
      const expectedBefore =
        moveDraft.mode === "stocktake"
          ? snapshot?.balances.find(
              (balance) => balance.itemId === moveDraft.itemId && balance.locationId === (moveDraft.toLocationId || moveDraft.fromLocationId),
            )?.quantity ?? 0
          : null;
      const variance =
        expectedBefore == null || moveDraft.mode !== "stocktake" ? null : qty - expectedBefore;
      onNotice(
        moveDraft.mode === "transfer"
          ? "Stock transferred."
          : moveDraft.mode === "issue"
            ? `Issued to ${moveDraft.jobRef.trim()}.`
            : moveDraft.mode === "return"
              ? `Returned from ${moveDraft.jobRef.trim()} to stock.`
              : variance == null
                ? "Stocktake count saved."
                : `Stocktake saved · expected ${expectedBefore}, counted ${qty}, variance ${variance > 0 ? "+" : ""}${variance}.`,
      );
      setMoveDraft((current) => ({
        ...current,
        qty: "1",
        countedQty: "",
        jobRef: current.mode === "issue" || current.mode === "return" ? "" : current.jobRef,
      }));
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Unable to update stock");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferredSupplier(item: StockSnapshot["items"][number], preferredSupplier: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stock", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert-item",
          item: {
            id: item.id,
            sku: item.sku,
            name: item.name,
            unit: item.unit,
            minLevel: item.minLevel,
            unitCost: item.unitCost,
            preferredSupplier,
            catalogItemId: item.catalogItemId,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save preferred supplier");
      setSnapshot(body as StockSnapshot);
      setSupplierEditById((current) => ({ ...current, [item.id]: preferredSupplier.trim() }));
      onNotice(
        preferredSupplier.trim()
          ? `${item.sku} preferred supplier set to ${preferredSupplier.trim()}.`
          : `${item.sku} preferred supplier cleared.`,
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save preferred supplier");
    } finally {
      setBusy(false);
    }
  }

  function resolveReorderSupplier(itemPreferred?: string) {
    return (reorderDraft.supplier.trim() || itemPreferred?.trim() || defaultSupplier).trim();
  }

  async function createLowStockReorder(row: StockSnapshot["lowStock"][number]) {
    const job = jobs.find((item) => item.id === reorderDraft.jobId) || openJobs[0] || jobs[0];
    if (!job) {
      onNotice("Create or open a job first so the reorder PO has somewhere to charge.");
      return;
    }
    const supplier = resolveReorderSupplier(row.item.preferredSupplier);
    if (!supplier) {
      onNotice("Enter a supplier override or set a preferred supplier on the stock item.");
      return;
    }
    const shortfall = Math.max(row.item.minLevel - row.onHand, 0);
    const orderQty = Math.max(shortfall || row.item.minLevel || 1, 1);
    const unitCost = Number(row.item.unitCost) || 0;
    const estimatedCost = Number((unitCost * orderQty).toFixed(2));

    setReorderBusyId(row.item.id);
    setError("");
    try {
      const response = await fetch("/api/purchase-requests", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          jobRef: job.ref,
          requestedBy: actorName,
          supplier,
          item: `${row.item.name} (${row.item.sku})`,
          estimatedCost,
          reason: `Low stock reorder · on hand ${row.onHand} · min ${row.item.minLevel} · supplier ${supplier}`,
          lines: [
            {
              id: `reorder-${row.item.id}`,
              description: row.item.name,
              quantity: orderQty,
              estimatedCost,
              receivedPercent: 0,
              sku: row.item.sku,
              catalogItemId: row.item.catalogItemId,
            },
          ],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Unable to create reorder PO");
      onPurchaseRequestCreated?.(body);
      onNotice(
        `Reorder PO ${body.poNumber || "created"} for ${row.item.sku} × ${orderQty} via ${supplier} against ${job.ref}.`,
      );
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "Unable to create reorder PO");
    } finally {
      setReorderBusyId(null);
    }
  }

  return (
    <section className="ops-module-panel">
      <header className="ops-module-header">
        <div>
          <span className="permission-heading">Materials</span>
          <h2><Package size={18} /> Stock &amp; van stock</h2>
          <p>Warehouse plus vans. Receive, transfer, issue to job, stocktake and low-stock alerts.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}
      <div className="ops-module-grid">
        <article>
          <h3>{draft.id ? "Edit stock item" : "Add / receive item"}</h3>
          <div className="ops-form-grid">
            <label>SKU<input value={draft.sku} onChange={(e) => setDraft((c) => ({ ...c, sku: e.target.value }))} /></label>
            <label>Name<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
            <label>Unit<input value={draft.unit} onChange={(e) => setDraft((c) => ({ ...c, unit: e.target.value }))} /></label>
            <label>Min level<input value={draft.minLevel} onChange={(e) => setDraft((c) => ({ ...c, minLevel: e.target.value }))} /></label>
            <label>Unit cost<input value={draft.unitCost} onChange={(e) => setDraft((c) => ({ ...c, unitCost: e.target.value }))} /></label>
            <label>
              Preferred supplier
              <input
                value={draft.preferredSupplier}
                onChange={(e) => setDraft((c) => ({ ...c, preferredSupplier: e.target.value }))}
                placeholder="e.g. Plumbase"
              />
            </label>
            {!draft.id ? (
              <>
                <label>
                  Location
                  <select value={draft.locationId} onChange={(e) => setDraft((c) => ({ ...c, locationId: e.target.value }))}>
                    {(snapshot?.locations || []).map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </label>
                <label>Qty to receive<input value={draft.qty} onChange={(e) => setDraft((c) => ({ ...c, qty: e.target.value }))} /></label>
              </>
            ) : null}
          </div>
          <div className="setup-template-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void addItemAndReceipt()}>
              <Plus size={15} /> {draft.id ? "Save item" : "Save & receive"}
            </button>
            {draft.id ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    id: "",
                    sku: "",
                    name: "",
                    preferredSupplier: "",
                    qty: "1",
                    minLevel: "0",
                    unitCost: "0",
                    unit: "each",
                  }))
                }
              >
                Cancel edit
              </button>
            ) : null}
          </div>
        </article>
        <article>
          <h3>Transfer / issue / return / stocktake</h3>
          <div className="ops-form-grid">
            <label>
              Action
              <select
                value={moveDraft.mode}
                onChange={(e) => setMoveDraft((c) => ({ ...c, mode: e.target.value as typeof c.mode }))}
              >
                <option value="transfer">Transfer warehouse ↔ van</option>
                <option value="issue">Issue to job</option>
                <option value="return">Return from job</option>
                <option value="stocktake">Stocktake count</option>
              </select>
            </label>
            <label>
              Item
              <select value={moveDraft.itemId} onChange={(e) => setMoveDraft((c) => ({ ...c, itemId: e.target.value }))}>
                {(snapshot?.items || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>
                ))}
              </select>
            </label>
            {moveDraft.mode !== "stocktake" && moveDraft.mode !== "return" ? (
              <label>
                From
                <select value={moveDraft.fromLocationId} onChange={(e) => setMoveDraft((c) => ({ ...c, fromLocationId: e.target.value }))}>
                  {(snapshot?.locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {moveDraft.mode !== "issue" ? (
              <label>
                {moveDraft.mode === "stocktake" ? "Location" : moveDraft.mode === "return" ? "Return to" : "To"}
                <select value={moveDraft.toLocationId} onChange={(e) => setMoveDraft((c) => ({ ...c, toLocationId: e.target.value }))}>
                  {(snapshot?.locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {moveDraft.mode === "issue" || moveDraft.mode === "return" ? (
              <label>
                Job
                <select value={moveDraft.jobRef} onChange={(e) => setMoveDraft((c) => ({ ...c, jobRef: e.target.value }))}>
                  <option value="">Select job…</option>
                  {openJobs.map((job) => (
                    <option key={job.id} value={job.ref}>
                      {job.ref} · {job.customer}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {moveDraft.mode === "stocktake" ? (
              <>
                <label>
                  Expected on hand
                  <input
                    value={stocktakeExpectedQty == null ? "" : String(stocktakeExpectedQty)}
                    readOnly
                    aria-label="Expected quantity on hand at this location"
                  />
                </label>
                <label>
                  Counted qty
                  <input
                    value={moveDraft.countedQty}
                    onChange={(e) => setMoveDraft((c) => ({ ...c, countedQty: e.target.value }))}
                  />
                </label>
                {stocktakeVariance != null ? (
                  <p className={stocktakeVariance === 0 ? "muted" : "ops-module-error"}>
                    Variance: {stocktakeVariance > 0 ? "+" : ""}
                    {stocktakeVariance}
                    {stocktakeVariance === 0
                      ? " (matches expected)"
                      : stocktakeVariance > 0
                        ? " (over expected)"
                        : " (under expected)"}
                  </p>
                ) : null}
              </>
            ) : (
              <label>Qty<input value={moveDraft.qty} onChange={(e) => setMoveDraft((c) => ({ ...c, qty: e.target.value }))} /></label>
            )}
          </div>
          <button className="primary-button" type="button" disabled={busy || !(snapshot?.items || []).length} onClick={() => void runStockMove()}>
            {moveDraft.mode === "transfer"
              ? "Transfer stock"
              : moveDraft.mode === "issue"
                ? "Issue to job"
                : moveDraft.mode === "return"
                  ? "Return from job"
                  : "Save stocktake"}
          </button>
        </article>
        <article>
          <h3>Locations</h3>
          <ul className="ops-simple-list">
            {(snapshot?.locations || []).map((location) => (
              <li key={location.id}>
                <strong>{location.name}</strong>
                <span>{location.kind}{location.engineerName ? ` · ${location.engineerName}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="muted">Edit or remove vans/warehouse under Setup → Stock locations.</p>
          <h3>Low stock</h3>
          {(snapshot?.lowStock || []).length ? (
            <>
              <div className="ops-form-grid" style={{ marginBottom: "0.75rem" }}>
                <label>
                  Charge reorder to job
                  <select
                    value={reorderDraft.jobId}
                    onChange={(e) => setReorderDraft((c) => ({ ...c, jobId: e.target.value }))}
                  >
                    {(openJobs.length ? openJobs : jobs).map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.ref} · {job.customer}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Supplier override
                  <input
                    value={reorderDraft.supplier}
                    onChange={(e) => setReorderDraft((c) => ({ ...c, supplier: e.target.value }))}
                    placeholder="Blank = each item’s preferred supplier"
                  />
                </label>
              </div>
              <ul className="ops-simple-list warn">
                {snapshot?.lowStock.map((row) => {
                  const shortfall = Math.max(row.item.minLevel - row.onHand, 0);
                  const orderQty = Math.max(shortfall || row.item.minLevel || 1, 1);
                  const supplier = resolveReorderSupplier(row.item.preferredSupplier);
                  return (
                    <li key={row.item.id}>
                      <AlertTriangle size={14} />
                      <strong>{row.item.name}</strong>
                      <span>
                        {row.onHand} on hand · min {row.item.minLevel} · order {orderQty} {row.item.unit || ""}
                        {" · "}
                        {supplier || "no supplier"}
                        {!reorderDraft.supplier.trim() && row.item.preferredSupplier ? " (preferred)" : ""}
                      </span>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(reorderBusyId) || (!openJobs.length && !jobs.length)}
                        onClick={() => void createLowStockReorder(row)}
                      >
                        {reorderBusyId === row.item.id ? "Creating…" : "Create reorder PO"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="muted">No items below minimum.</p>
          )}
          <h3>Recent movements</h3>
          <ul className="ops-simple-list">
            {(snapshot?.movements || []).slice(0, 6).map((movement) => {
              const item = snapshot?.items.find((row) => row.id === movement.itemId);
              return (
                <li key={movement.id}>
                  <strong>{movement.reason}</strong>
                  <span>
                    {item?.sku || "item"} · {movement.quantity}
                    {movement.jobRef ? ` · ${movement.jobRef}` : ""}
                    {movement.poNumber ? ` · ${movement.poNumber}` : ""}
                  </span>
                </li>
              );
            })}
            {!(snapshot?.movements || []).length ? <li><span className="muted">No movements yet.</span></li> : null}
          </ul>
        </article>
      </div>
      <div className="ops-table">
        <div className="ops-table-head ops-table-row-stock">
          <span>SKU</span>
          <span>Item</span>
          <span>On hand</span>
          <span>Min</span>
          <span>Cost</span>
          <span>Preferred supplier</span>
          <span>Actions</span>
        </div>
        {(snapshot?.items || []).map((item) => (
          <div className="ops-table-row ops-table-row-stock" key={item.id}>
            <span>{item.sku}</span>
            <strong>{item.name}</strong>
            <span>{onHandByItem.get(item.id) || 0} {item.unit}</span>
            <span>{item.minLevel}</span>
            <span>£{item.unitCost.toFixed(2)}</span>
            <label className="ops-inline-edit">
              <input
                value={supplierEditById[item.id] ?? item.preferredSupplier ?? ""}
                onChange={(e) => setSupplierEditById((current) => ({ ...current, [item.id]: e.target.value }))}
                onBlur={() => {
                  const next = (supplierEditById[item.id] ?? item.preferredSupplier ?? "").trim();
                  const previous = (item.preferredSupplier || "").trim();
                  if (next === previous) return;
                  void savePreferredSupplier(item, next);
                }}
                placeholder="Set supplier"
                aria-label={`Preferred supplier for ${item.sku}`}
              />
            </label>
            <div className="ops-row-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => editStockItem(item)}>
                Edit
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void removeStockItem(item)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        {!snapshot?.items.length ? <p className="muted">No stock items yet — receive a PO or add one above.</p> : null}
      </div>
    </section>
  );
}

export function SiteAssetsPanel({
  requestHeaders,
  siteId,
  clientId,
  siteLabel,
  onNotice,
}: {
  requestHeaders: RequestHeaders;
  siteId?: string;
  clientId?: string;
  siteLabel?: string;
  onNotice: (message: string) => void;
}) {
  const blankDraft = {
    id: "",
    type: "Gas appliance",
    name: "",
    make: "",
    model: "",
    serialNumber: "",
    locationNote: "",
    installDate: "",
    lastServiceDate: "",
    nextServiceDate: "",
    warrantyUntil: "",
    certificateNumber: "",
    certificateIssuedAt: "",
    certificateExpiresAt: "",
    notes: "",
  };
  const [assets, setAssets] = useState<SiteAsset[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>(["Gas appliance", "Oil Boiler", "Pipework", "Cylinder", "Controls", "Other"]);
  const [certRequiredByType, setCertRequiredByType] = useState<Record<string, boolean>>({
    "Gas appliance": true,
    "Oil Boiler": true,
  });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "overdue" | "cert">("all");
  const [draft, setDraft] = useState(blankDraft);
  const today = new Date().toISOString().slice(0, 10);

  const visibleAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (filter === "all") return true;
      if (filter === "cert") {
        return Boolean(asset.certificateExpiresAt && asset.certificateExpiresAt < today);
      }
      if (!asset.nextServiceDate) return false;
      if (filter === "overdue") return asset.nextServiceDate < today;
      const horizon = new Date(`${today}T12:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + 30);
      return asset.nextServiceDate >= today && asset.nextServiceDate <= horizon.toISOString().slice(0, 10);
    });
  }, [assets, filter, today]);

  const overdueCount = assets.filter((asset) => asset.nextServiceDate && asset.nextServiceDate < today).length;
  const dueSoonCount = assets.filter((asset) => {
    if (!asset.nextServiceDate || asset.nextServiceDate < today) return false;
    const horizon = new Date(`${today}T12:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 30);
    return asset.nextServiceDate <= horizon.toISOString().slice(0, 10);
  }).length;
  const certOverdueCount = assets.filter(
    (asset) => asset.certificateExpiresAt && asset.certificateExpiresAt < today,
  ).length;

  async function load() {
    if (!siteId) {
      setAssets([]);
      return;
    }
    setError("");
    try {
      const [assetsResponse, setupResponse] = await Promise.all([
        fetch(`/api/site-assets?siteId=${encodeURIComponent(siteId)}`, { headers: requestHeaders }),
        fetch("/api/setup-config", { headers: requestHeaders }),
      ]);
      const body = await assetsResponse.json();
      if (!assetsResponse.ok) throw new Error(body.error || "Unable to load assets");
      setAssets(body.assets || []);
      if (setupResponse.ok) {
        const setup = await setupResponse.json();
        const typeRows = (setup.assetTypes || []) as Array<{ name: string; certificateRequired?: boolean }>;
        const types = typeRows.map((row) => row.name).filter(Boolean);
        if (types.length) {
          setAssetTypes(types);
          setDraft((current) => ({
            ...current,
            type: types.includes(current.type) ? current.type : (types[0] || current.type),
          }));
        }
        const certMap: Record<string, boolean> = {};
        for (const row of typeRows) {
          if (row.name) certMap[row.name] = Boolean(row.certificateRequired);
        }
        if (Object.keys(certMap).length) setCertRequiredByType(certMap);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assets");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function saveAsset() {
    if (!siteId) {
      onNotice("Open a job/quote with a site before adding assets.");
      return;
    }
    if (!draft.name.trim()) {
      onNotice("Enter an asset name.");
      return;
    }
    if (certRequiredByType[draft.type] && !draft.certificateNumber.trim()) {
      onNotice(`${draft.type} usually needs a certificate number — add it or clear the type requirement in Setup.`);
    }
    try {
      const response = await fetch("/api/site-assets", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id: draft.id || undefined,
          siteId,
          clientId,
          type: draft.type,
          name: draft.name,
          make: draft.make || undefined,
          model: draft.model || undefined,
          serialNumber: draft.serialNumber || undefined,
          locationNote: draft.locationNote || undefined,
          installDate: draft.installDate || undefined,
          lastServiceDate: draft.lastServiceDate || undefined,
          nextServiceDate: draft.nextServiceDate || undefined,
          warrantyUntil: draft.warrantyUntil || undefined,
          certificateNumber: draft.certificateNumber || undefined,
          certificateIssuedAt: draft.certificateIssuedAt || undefined,
          certificateExpiresAt: draft.certificateExpiresAt || undefined,
          notes: draft.notes || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save asset");
      setAssets(body.assets || []);
      setDraft({ ...blankDraft, type: draft.type });
      onNotice(draft.id ? "Asset updated." : "Asset saved to the site register.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save asset");
    }
  }

  async function archiveAsset(asset: SiteAsset) {
    try {
      const response = await fetch("/api/site-assets", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", id: asset.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to archive asset");
      await load();
      onNotice(`${asset.name} archived.`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive asset");
    }
  }

  function editAsset(asset: SiteAsset) {
    setDraft({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      make: asset.make || "",
      model: asset.model || "",
      serialNumber: asset.serialNumber || "",
      locationNote: asset.locationNote || "",
      installDate: asset.installDate || "",
      lastServiceDate: asset.lastServiceDate || "",
      nextServiceDate: asset.nextServiceDate || "",
      warrantyUntil: asset.warrantyUntil || "",
      certificateNumber: asset.certificateNumber || "",
      certificateIssuedAt: asset.certificateIssuedAt || "",
      certificateExpiresAt: asset.certificateExpiresAt || "",
      notes: asset.notes || "",
    });
  }

  if (!siteId) {
    return (
      <section className="simpro-empty-workspace">
        <h2>Customer Assets</h2>
        <p>Link a site on this record first, then add Gas appliance / Oil Boiler / Pipework assets here.</p>
      </section>
    );
  }

  return (
    <section className="ops-module-panel compact">
      <header className="ops-module-header">
        <div>
          <h2>Customer Assets</h2>
          <p>
            {siteLabel || "Site register"} — {overdueCount} overdue · {dueSoonCount} due in 30 days
            {certOverdueCount ? ` · ${certOverdueCount} cert expired` : ""}.
          </p>
        </div>
        <div className="setup-template-actions">
          <button className={filter === "all" ? "secondary-button active" : "secondary-button"} type="button" onClick={() => setFilter("all")}>
            All ({assets.length})
          </button>
          <button className={filter === "overdue" ? "secondary-button active" : "secondary-button"} type="button" onClick={() => setFilter("overdue")}>
            Overdue ({overdueCount})
          </button>
          <button className={filter === "due" ? "secondary-button active" : "secondary-button"} type="button" onClick={() => setFilter("due")}>
            Due soon ({dueSoonCount})
          </button>
          <button className={filter === "cert" ? "secondary-button active" : "secondary-button"} type="button" onClick={() => setFilter("cert")}>
            Cert expired ({certOverdueCount})
          </button>
        </div>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}
      <div className="ops-form-grid">
        <label>
          Type
          <select value={draft.type} onChange={(e) => setDraft((c) => ({ ...c, type: e.target.value }))}>
            {assetTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>Name<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Kitchen boiler" /></label>
        <label>Make<input value={draft.make} onChange={(e) => setDraft((c) => ({ ...c, make: e.target.value }))} /></label>
        <label>Model<input value={draft.model} onChange={(e) => setDraft((c) => ({ ...c, model: e.target.value }))} /></label>
        <label>Serial<input value={draft.serialNumber} onChange={(e) => setDraft((c) => ({ ...c, serialNumber: e.target.value }))} /></label>
        <label>Location<input value={draft.locationNote} onChange={(e) => setDraft((c) => ({ ...c, locationNote: e.target.value }))} placeholder="Plant room / loft" /></label>
        <label>Installed<input type="date" value={draft.installDate} onChange={(e) => setDraft((c) => ({ ...c, installDate: e.target.value }))} /></label>
        <label>Last service<input type="date" value={draft.lastServiceDate} onChange={(e) => setDraft((c) => ({ ...c, lastServiceDate: e.target.value }))} /></label>
        <label>Next service<input type="date" value={draft.nextServiceDate} onChange={(e) => setDraft((c) => ({ ...c, nextServiceDate: e.target.value }))} /></label>
        <label>Warranty until<input type="date" value={draft.warrantyUntil} onChange={(e) => setDraft((c) => ({ ...c, warrantyUntil: e.target.value }))} /></label>
        <label>
          Cert number
          <input
            value={draft.certificateNumber}
            onChange={(e) => setDraft((c) => ({ ...c, certificateNumber: e.target.value }))}
            placeholder={certRequiredByType[draft.type] ? "Required for this type" : "Optional"}
          />
        </label>
        <label>Cert issued<input type="date" value={draft.certificateIssuedAt} onChange={(e) => setDraft((c) => ({ ...c, certificateIssuedAt: e.target.value }))} /></label>
        <label>Cert expires<input type="date" value={draft.certificateExpiresAt} onChange={(e) => setDraft((c) => ({ ...c, certificateExpiresAt: e.target.value }))} /></label>
        <label className="full">Notes<input value={draft.notes} onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))} /></label>
      </div>
      <div className="setup-template-actions">
        <button className="primary-button" type="button" onClick={() => void saveAsset()}>
          <Plus size={15} /> {draft.id ? "Update asset" : "Add asset"}
        </button>
        {draft.id ? (
          <button className="secondary-button" type="button" onClick={() => setDraft({ ...blankDraft, type: draft.type })}>
            Cancel edit
          </button>
        ) : null}
      </div>
      <div className="ops-table">
        <div className="ops-table-head"><span>Type</span><span>Asset</span><span>Service</span><span>Certificate</span><span /></div>
        {visibleAssets.map((asset) => {
          const overdue = Boolean(asset.nextServiceDate && asset.nextServiceDate < today);
          const certOverdue = Boolean(asset.certificateExpiresAt && asset.certificateExpiresAt < today);
          return (
            <div className="ops-table-row" key={asset.id}>
              <span>{asset.type}</span>
              <strong>
                {asset.name}
                <small style={{ display: "block", fontWeight: 400 }}>
                  {[asset.make, asset.model, asset.serialNumber].filter(Boolean).join(" · ") || asset.locationNote || "—"}
                </small>
              </strong>
              <span className={overdue ? "ops-module-error" : undefined}>
                {asset.nextServiceDate ? `${overdue ? "Overdue " : ""}${asset.nextServiceDate}` : "—"}
                {asset.lastServiceDate ? <small style={{ display: "block" }}>Last {asset.lastServiceDate}</small> : null}
              </span>
              <span className={certOverdue ? "ops-module-error" : undefined}>
                {asset.certificateNumber || "—"}
                {asset.certificateExpiresAt ? (
                  <small style={{ display: "block" }}>
                    {certOverdue ? "Expired " : "Expires "}
                    {asset.certificateExpiresAt}
                  </small>
                ) : null}
              </span>
              <span className="setup-template-actions">
                <button className="secondary-button" type="button" onClick={() => editAsset(asset)}>Edit</button>
                <button className="secondary-button" type="button" onClick={() => void archiveAsset(asset)}>Archive</button>
              </span>
            </div>
          );
        })}
        {!visibleAssets.length ? <p className="muted">{filter === "all" ? "No assets on this site yet." : "No assets in this filter."}</p> : null}
      </div>
    </section>
  );
}

export function RecurringOpsPanel({
  requestHeaders,
  onNotice,
  onGenerateJob,
  onGenerateInvoice,
  actor,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  onGenerateJob: (plan: RecurringPlan) => Promise<string | null>;
  onGenerateInvoice: (plan: RecurringPlan) => Promise<string | null>;
  actor?: string;
}) {
  const [plans, setPlans] = useState<RecurringPlan[]>([]);
  const [due, setDue] = useState<RecurringPlan[]>([]);
  const [upcoming, setUpcoming] = useState<RecurringPlan[]>([]);
  const [error, setError] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [draft, setDraft] = useState({
    id: "",
    kind: "Job" as "Job" | "Invoice",
    name: "",
    customer: "",
    site: "",
    description: "",
    frequency: "Monthly",
    nextDueDate: new Date().toISOString().slice(0, 10),
    amount: "",
  });

  const blankDraft = () => ({
    id: "",
    kind: "Job" as "Job" | "Invoice",
    name: "",
    customer: "",
    site: "",
    description: "",
    frequency: "Monthly",
    nextDueDate: new Date().toISOString().slice(0, 10),
    amount: "",
  });

  function applyLists(body: { plans?: RecurringPlan[]; due?: RecurringPlan[]; upcoming?: RecurringPlan[] }) {
    setPlans(body.plans || []);
    setDue(body.due || []);
    setUpcoming(body.upcoming || []);
  }

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/recurring?all=1&upcomingDays=14", { headers: requestHeaders });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load recurring plans");
      applyLists(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load recurring");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePlan() {
    try {
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id: draft.id || undefined,
          kind: draft.kind,
          name: draft.name,
          customer: draft.customer,
          site: draft.site,
          description: draft.description,
          frequency: draft.frequency,
          nextDueDate: draft.nextDueDate,
          amount: draft.amount ? Number(draft.amount) : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save plan");
      applyLists(body);
      onNotice(draft.id ? "Recurring plan updated." : "Recurring plan saved.");
      setDraft(blankDraft());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save plan");
    }
  }

  function editPlan(plan: RecurringPlan) {
    setDraft({
      id: plan.id,
      kind: plan.kind,
      name: plan.name,
      customer: plan.customer,
      site: plan.site || "",
      description: plan.description,
      frequency: plan.frequency,
      nextDueDate: plan.nextDueDate,
      amount: plan.amount != null ? String(plan.amount) : "",
    });
    onNotice(`Editing ${plan.name} — update the form then save.`);
  }

  async function removePlan(plan: RecurringPlan) {
    if (!window.confirm(`Remove recurring plan “${plan.name}”?`)) return;
    try {
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: plan.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to remove plan");
      applyLists(body);
      if (draft.id === plan.id) setDraft(blankDraft());
      onNotice(`${plan.name} removed.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove plan");
    }
  }

  async function setActive(plan: RecurringPlan, active: boolean) {
    try {
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: active ? "activate" : "deactivate", id: plan.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update plan");
      applyLists(body);
      onNotice(`${plan.name} ${active ? "activated" : "paused"}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update plan");
    }
  }

  async function generate(plan: RecurringPlan) {
    setGeneratingId(plan.id);
    setError("");
    try {
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", id: plan.id, actor }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to generate plan on the server");
      applyLists(body);
      const ref = body.result?.ref || body.generated?.[0]?.ref;
      if (!ref) throw new Error("Recurring plan generated but no reference was returned.");
      setError("");
      onNotice(`${plan.kind} ${ref} generated from ${plan.name}. Next due ${body.plan?.nextDueDate || "advanced"}.`);
    } catch (serverError) {
      setError(serverError instanceof Error ? serverError.message : "Unable to generate recurring plan");
      const ref = plan.kind === "Job" ? await onGenerateJob(plan) : await onGenerateInvoice(plan);
      if (!ref) return;
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-generated", id: plan.id, generatedRef: ref }),
      });
      const body = await response.json();
      if (!response.ok) {
        onNotice(body.error || "Generated but could not advance next due date.");
        return;
      }
      applyLists(body);
      setError("");
      onNotice(`${plan.kind} ${ref} generated from ${plan.name}. Next due ${body.plan?.nextDueDate || "advanced"}.`);
    } finally {
      setGeneratingId(null);
    }
  }

  async function generateAllDue() {
    if (!due.length) {
      onNotice("Nothing due to generate.");
      return;
    }
    setGeneratingAll(true);
    setError("");
    try {
      const response = await fetch("/api/recurring", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-due", actor }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to generate due plans on the server");
      applyLists(body);
      const created = Array.isArray(body.generated) ? body.generated.length : 0;
      const errors = Array.isArray(body.errors) ? body.errors.length : 0;
      setError("");
      onNotice(
        created
          ? `Generated ${created} recurring record(s)${errors ? `; ${errors} failed` : ""}.`
          : errors
            ? `No recurring records were generated; ${errors} failed.`
            : "No recurring records were generated.",
      );
      await load();
    } catch {
      let created = 0;
      for (const plan of [...due]) {
        const ref = plan.kind === "Job" ? await onGenerateJob(plan) : await onGenerateInvoice(plan);
        if (!ref) continue;
        const response = await fetch("/api/recurring", {
          method: "POST",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark-generated", id: plan.id, generatedRef: ref }),
        });
        const body = await response.json();
        if (!response.ok) continue;
        applyLists(body);
        created += 1;
      }
      setError("");
      onNotice(created ? `Generated ${created} recurring record(s).` : "No recurring records were generated.");
      await load();
    } finally {
      setGeneratingAll(false);
    }
  }

  return (
    <section className="ops-module-panel">
      <header className="ops-module-header">
        <div>
          <span className="permission-heading">Contracts</span>
          <h2><Repeat size={18} /> Recurring jobs &amp; invoices</h2>
          <p>Service plans that create the next job or invoice when due, then advance the next visit.</p>
        </div>
        <div className="setup-template-actions">
          <button className="secondary-button" type="button" onClick={() => void load()}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={generatingAll || !due.length}
            onClick={() => void generateAllDue()}
          >
            {generatingAll ? "Generating…" : `Generate all due (${due.length})`}
          </button>
        </div>
      </header>
      {error ? <p className="ops-module-error">{error}</p> : null}
      <div className="ops-form-grid">
        <label>
          Kind
          <select value={draft.kind} onChange={(e) => setDraft((c) => ({ ...c, kind: e.target.value as "Job" | "Invoice" }))}>
            <option value="Job">Recurring job</option>
            <option value="Invoice">Recurring invoice</option>
          </select>
        </label>
        <label>Plan name<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label>
        <label>Customer<input value={draft.customer} onChange={(e) => setDraft((c) => ({ ...c, customer: e.target.value }))} /></label>
        <label>Site<input value={draft.site} onChange={(e) => setDraft((c) => ({ ...c, site: e.target.value }))} /></label>
        <label>Frequency
          <select value={draft.frequency} onChange={(e) => setDraft((c) => ({ ...c, frequency: e.target.value }))}>
            {["Weekly", "Monthly", "Quarterly", "Yearly"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Next due<input type="date" value={draft.nextDueDate} onChange={(e) => setDraft((c) => ({ ...c, nextDueDate: e.target.value }))} /></label>
        <label className="full">Description<input value={draft.description} onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))} /></label>
        <label>Amount (invoices)<input value={draft.amount} onChange={(e) => setDraft((c) => ({ ...c, amount: e.target.value }))} /></label>
      </div>
      <div className="setup-template-actions">
        <button className="primary-button" type="button" onClick={() => void savePlan()}>
          <Plus size={15} /> {draft.id ? "Update plan" : "Save plan"}
        </button>
        {draft.id ? (
          <button className="secondary-button" type="button" onClick={() => setDraft(blankDraft())}>
            Cancel edit
          </button>
        ) : null}
      </div>
      <h3>Due / overdue ({due.length})</h3>
      <div className="ops-table">
        <div className="ops-table-head"><span>Plan</span><span>Customer</span><span>Due</span><span>Kind</span><span /></div>
        {due.map((plan) => (
          <div className="ops-table-row" key={plan.id}>
            <strong>{plan.name}</strong>
            <span>{plan.customer}</span>
            <span>{plan.nextDueDate}</span>
            <span>{plan.kind}</span>
            <button
              className="primary-button"
              type="button"
              disabled={generatingId === plan.id || generatingAll}
              onClick={() => void generate(plan)}
            >
              {generatingId === plan.id ? "Generating…" : "Generate"}
            </button>
          </div>
        ))}
        {!due.length ? <p className="muted">Nothing due or overdue.</p> : null}
      </div>
      <h3>Coming up (14 days) ({upcoming.length})</h3>
      <div className="ops-table">
        <div className="ops-table-head"><span>Plan</span><span>Customer</span><span>Due</span><span>Kind</span><span /></div>
        {upcoming.map((plan) => (
          <div className="ops-table-row" key={plan.id}>
            <strong>{plan.name}</strong>
            <span>{plan.customer}</span>
            <span>{plan.nextDueDate}</span>
            <span>{plan.kind}</span>
            <button
              className="secondary-button"
              type="button"
              disabled={generatingId === plan.id || generatingAll}
              onClick={() => void generate(plan)}
            >
              Generate early
            </button>
          </div>
        ))}
        {!upcoming.length ? <p className="muted">No visits due in the next two weeks.</p> : null}
      </div>
      <h3>All plans</h3>
      <div className="ops-table">
        <div className="ops-table-head ops-table-row-recurring">
          <span>Plan</span>
          <span>Frequency</span>
          <span>Next due</span>
          <span>Last</span>
          <span>Active</span>
          <span>Actions</span>
        </div>
        {plans.map((plan) => (
          <div className="ops-table-row ops-table-row-recurring" key={plan.id}>
            <strong>{plan.name}</strong>
            <span>{plan.frequency}</span>
            <span>{plan.nextDueDate}</span>
            <span>{plan.lastGeneratedRef || "—"}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void setActive(plan, !plan.active)}
            >
              {plan.active ? "Pause" : "Activate"}
            </button>
            <div className="ops-row-actions">
              <button className="secondary-button" type="button" onClick={() => editPlan(plan)}>
                Edit
              </button>
              <button className="secondary-button" type="button" onClick={() => void removePlan(plan)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        {!plans.length ? <p className="muted">No recurring plans yet.</p> : null}
      </div>
    </section>
  );
}
