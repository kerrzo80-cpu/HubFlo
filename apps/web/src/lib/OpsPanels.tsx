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
  nextServiceDate?: string;
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
    mode: "transfer" as "transfer" | "issue" | "stocktake",
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
      const item = (upsertBody.items as StockSnapshot["items"]).find((row) => row.sku.toLowerCase() === draft.sku.trim().toLowerCase());
      if (item && draft.locationId && Number(draft.qty) > 0) {
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
      }
      onNotice(`${draft.name} saved into stock.`);
      setDraft((current) => ({ ...current, sku: "", name: "", preferredSupplier: "", qty: "1" }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save stock");
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
    if (moveDraft.mode === "issue" && !moveDraft.jobRef.trim()) {
      onNotice("Enter the job ref before issuing stock.");
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
      onNotice(
        moveDraft.mode === "transfer"
          ? "Stock transferred."
          : moveDraft.mode === "issue"
            ? `Issued to ${moveDraft.jobRef.trim()}.`
            : "Stocktake count saved.",
      );
      setMoveDraft((current) => ({ ...current, qty: "1", countedQty: "", jobRef: current.mode === "issue" ? "" : current.jobRef }));
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
          <h3>Add / receive item</h3>
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
            <label>
              Location
              <select value={draft.locationId} onChange={(e) => setDraft((c) => ({ ...c, locationId: e.target.value }))}>
                {(snapshot?.locations || []).map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
            <label>Qty to receive<input value={draft.qty} onChange={(e) => setDraft((c) => ({ ...c, qty: e.target.value }))} /></label>
          </div>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void addItemAndReceipt()}>
            <Plus size={15} /> Save &amp; receive
          </button>
        </article>
        <article>
          <h3>Transfer / issue / stocktake</h3>
          <div className="ops-form-grid">
            <label>
              Action
              <select
                value={moveDraft.mode}
                onChange={(e) => setMoveDraft((c) => ({ ...c, mode: e.target.value as typeof c.mode }))}
              >
                <option value="transfer">Transfer warehouse ↔ van</option>
                <option value="issue">Issue to job</option>
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
            {moveDraft.mode !== "stocktake" ? (
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
                {moveDraft.mode === "stocktake" ? "Location" : "To"}
                <select value={moveDraft.toLocationId} onChange={(e) => setMoveDraft((c) => ({ ...c, toLocationId: e.target.value }))}>
                  {(snapshot?.locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {moveDraft.mode === "issue" ? (
              <label>Job ref<input value={moveDraft.jobRef} onChange={(e) => setMoveDraft((c) => ({ ...c, jobRef: e.target.value }))} placeholder="J-1004" /></label>
            ) : null}
            {moveDraft.mode === "stocktake" ? (
              <label>Counted qty<input value={moveDraft.countedQty} onChange={(e) => setMoveDraft((c) => ({ ...c, countedQty: e.target.value }))} /></label>
            ) : (
              <label>Qty<input value={moveDraft.qty} onChange={(e) => setMoveDraft((c) => ({ ...c, qty: e.target.value }))} /></label>
            )}
          </div>
          <button className="primary-button" type="button" disabled={busy || !(snapshot?.items || []).length} onClick={() => void runStockMove()}>
            {moveDraft.mode === "transfer" ? "Transfer stock" : moveDraft.mode === "issue" ? "Issue to job" : "Save stocktake"}
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
  const [assets, setAssets] = useState<SiteAsset[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>(["Gas appliance", "Oil Boiler", "Pipework", "Cylinder", "Controls", "Other"]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    type: "Gas appliance",
    name: "",
    make: "",
    model: "",
    serialNumber: "",
    nextServiceDate: "",
    notes: "",
  });

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
        const types = (setup.assetTypes || []).map((row: { name: string }) => row.name).filter(Boolean);
        if (types.length) {
          setAssetTypes(types);
          setDraft((current) => ({ ...current, type: types.includes(current.type) ? current.type : types[0] }));
        }
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
    try {
      const response = await fetch("/api/site-assets", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          siteId,
          clientId,
          ...draft,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save asset");
      setAssets(body.assets || []);
      setDraft((current) => ({ ...current, name: "", make: "", model: "", serialNumber: "", notes: "" }));
      onNotice("Asset saved to the site register.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save asset");
    }
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
          <p>{siteLabel || "Site register"} — service history and next due dates.</p>
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
        <label>Next service<input type="date" value={draft.nextServiceDate} onChange={(e) => setDraft((c) => ({ ...c, nextServiceDate: e.target.value }))} /></label>
      </div>
      <button className="primary-button" type="button" onClick={() => void saveAsset()}>
        <Plus size={15} /> Add asset
      </button>
      <div className="ops-table">
        <div className="ops-table-head"><span>Type</span><span>Asset</span><span>Make / model</span><span>Next service</span></div>
        {assets.map((asset) => (
          <div className="ops-table-row" key={asset.id}>
            <span>{asset.type}</span>
            <strong>{asset.name}</strong>
            <span>{[asset.make, asset.model].filter(Boolean).join(" ") || "—"}</span>
            <span>{asset.nextServiceDate || "—"}</span>
          </div>
        ))}
        {!assets.length ? <p className="muted">No assets on this site yet.</p> : null}
      </div>
    </section>
  );
}

export function RecurringOpsPanel({
  requestHeaders,
  onNotice,
  onGenerateJob,
  onGenerateInvoice,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  onGenerateJob: (plan: RecurringPlan) => Promise<string | null>;
  onGenerateInvoice: (plan: RecurringPlan) => Promise<string | null>;
}) {
  const [plans, setPlans] = useState<RecurringPlan[]>([]);
  const [due, setDue] = useState<RecurringPlan[]>([]);
  const [upcoming, setUpcoming] = useState<RecurringPlan[]>([]);
  const [error, setError] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [draft, setDraft] = useState({
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
          ...draft,
          amount: draft.amount ? Number(draft.amount) : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save plan");
      applyLists(body);
      onNotice("Recurring plan saved.");
      setDraft((current) => ({ ...current, name: "", description: "", amount: "" }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save plan");
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
    try {
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
    let created = 0;
    try {
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
      <button className="primary-button" type="button" onClick={() => void savePlan()}>
        <Plus size={15} /> Save plan
      </button>
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
        <div className="ops-table-head"><span>Plan</span><span>Frequency</span><span>Next due</span><span>Last</span><span>Active</span></div>
        {plans.map((plan) => (
          <div className="ops-table-row" key={plan.id}>
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
          </div>
        ))}
      </div>
    </section>
  );
}
