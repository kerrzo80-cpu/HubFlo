"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Eye, EyeOff, Loader2, MousePointer2, Plus, Trash2 } from "lucide-react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import type { StudioAiReviewMeasuredQuantity, StudioAiReviewStatus } from "@/lib/takeoff-studio";
import type { TakeoffConfidence } from "@/lib/takeoff-skill";

type OverlayPin = NonNullable<StudioAiReviewMeasuredQuantity["tagMatches"]>[number] & {
  code: string;
  description: string;
  quantityId: string;
  confidence?: TakeoffConfidence;
};

type ToolMode = "select" | "add" | "delete";

function colourForCode(code: string) {
  if (code.startsWith("P-WC")) return "#14618c";
  if (code.startsWith("P-WHB")) return "#2e8c7d";
  if (code.startsWith("P-BATH")) return "#b36a16";
  if (code.startsWith("P-SHR")) return "#006eb8";
  if (code.startsWith("P-SINK")) return "#278459";
  if (code.startsWith("P-APPL")) return "#7a4f9a";
  if (code.startsWith("P-SVP")) return "#b43a3a";
  if (code.includes("PIPE-H") || code.includes("ELBOW-H") || code.includes("TEE-H") || code.includes("COUP-H")) return "#c45c26";
  if (code.includes("PIPE-C") || code.includes("ELBOW-C") || code.includes("TEE-C") || code.includes("COUP-C")) return "#1f7fb0";
  if (code.includes("WASTE") || code.includes("TRAP")) return "#5b6b7a";
  if (code.includes("ISO")) return "#8a5a00";
  return "#14618c";
}

function newPinId() {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Props = {
  projectId: string;
  documents: TakeoffDocument[];
  measured: StudioAiReviewMeasuredQuantity[];
  busy?: boolean;
  reviewStatus?: StudioAiReviewStatus;
  onApply: (measured: StudioAiReviewMeasuredQuantity[]) => Promise<void>;
  onFindTags?: () => Promise<void>;
  onReject?: () => Promise<void>;
  onRejectClass?: (code: string, description: string) => void;
  onClose?: () => void;
};

/**
 * Drawing-first takeoff board (PlanSwift / ZZ Takeoff style):
 * pick an item → click each instance on the PDF → qty = pin count.
 */
export default function TakeoffOverlayReview({
  projectId,
  documents,
  measured,
  busy,
  reviewStatus,
  onApply,
  onFindTags,
  onReject,
  onRejectClass,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [tool, setTool] = useState<ToolMode>("add");
  const [placeCode, setPlaceCode] = useState("");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [manualQty, setManualQty] = useState<Record<string, number>>({});
  const dragRef = useRef<{ pinId: string } | null>(null);

  const primaries = useMemo(() => measured.filter((row) => row.kind === "primary"), [measured]);
  const secondaries = useMemo(() => measured.filter((row) => row.kind === "secondary"), [measured]);
  const placeableRows = useMemo(() => measured.filter((row) => row.unit === "nr"), [measured]);

  const [pins, setPins] = useState<OverlayPin[]>([]);

  useEffect(() => {
    const next: OverlayPin[] = [];
    for (const row of measured) {
      for (const match of row.tagMatches || []) {
        next.push({
          ...match,
          id: match.id || newPinId(),
          code: row.code,
          description: row.description,
          quantityId: row.id,
          confidence: row.confidence,
        });
      }
    }
    setPins(next);
    const qtySeed: Record<string, number> = {};
    for (const row of measured) {
      if (row.unit !== "nr") qtySeed[row.id] = row.quantity ?? 0;
    }
    setManualQty(qtySeed);
    const firstPrimary = primaries.find((row) => row.unit === "nr") || placeableRows[0];
    if (firstPrimary) setPlaceCode(firstPrimary.code);
    const hasPins = next.some((pin) => !pin.excluded);
    setTool(hasPins ? "select" : "add");
  }, [measured]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawingDocs = useMemo(() => {
    const fromProject = documents.filter(
      (doc) =>
        (doc.kind === "Drawing" || doc.kind === "Marked-up drawing")
        && (doc.mimeType?.includes("pdf") || doc.fileName.toLowerCase().endsWith(".pdf") || Boolean(doc.storageKey)),
    );
    if (fromProject.length) return fromProject;
    const ids = [...new Set(pins.map((pin) => pin.documentId).filter(Boolean))];
    return ids.map((id) => ({
      id,
      fileName: pins.find((pin) => pin.documentId === id)?.fileName || id,
      kind: "Drawing" as const,
      mimeType: "application/pdf",
    })) as TakeoffDocument[];
  }, [documents, pins]);

  const codes = useMemo(() => [...new Set(pins.map((pin) => pin.code))].sort(), [pins]);
  const [visibleCodes, setVisibleCodes] = useState<Set<string>>(new Set());
  const [docId, setDocId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    setVisibleCodes(new Set(codes.length ? codes : placeableRows.map((row) => row.code)));
  }, [codes, placeableRows]);

  useEffect(() => {
    if (!drawingDocs.length) return;
    if (!docId || !drawingDocs.some((doc) => doc.id === docId)) {
      setDocId(drawingDocs[0]!.id);
      setPageNumber(1);
    }
  }, [drawingDocs, docId]);

  const activeDoc = drawingDocs.find((doc) => doc.id === docId) || drawingDocs[0];
  const pagePins = pins.filter(
    (pin) =>
      !pin.excluded
      && pin.documentId === (activeDoc?.id || docId)
      && pin.pageNumber === pageNumber
      && visibleCodes.has(pin.code),
  );

  const liveQty = useCallback(
    (row: StudioAiReviewMeasuredQuantity) => {
      if (row.unit !== "nr") return manualQty[row.id] ?? row.quantity ?? 0;
      return pins.filter((pin) => pin.quantityId === row.id && !pin.excluded).length;
    },
    [manualQty, pins],
  );

  const toCanvas = useCallback(
    (x: number, y: number) => ({
      cx: (x / pageSize.width) * viewportSize.width,
      cy: viewportSize.height - (y / pageSize.height) * viewportSize.height,
    }),
    [pageSize, viewportSize],
  );

  const toPdf = useCallback(
    (cx: number, cy: number) => ({
      x: (cx / viewportSize.width) * pageSize.width,
      y: ((viewportSize.height - cy) / viewportSize.height) * pageSize.height,
    }),
    [pageSize, viewportSize],
  );

  useEffect(() => {
    if (!activeDoc) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function renderPage() {
      setStatus("loading");
      setErrorMessage("");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const src = `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(activeDoc!.id)}/file`;
        const response = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to load drawing (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = pdfjs.getDocument({ data, isOffscreenCanvasSupported: false });
        loadingTask = task;
        const pdf = await task.promise;
        setPdfPageCount(pdf.numPages);
        const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
        if (safePage !== pageNumber) {
          setPageNumber(safePage);
          return;
        }
        const page = await pdf.getPage(safePage);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setPageSize({ width: base.width, height: base.height });
        const maxWidth = Math.min(980, Math.max(480, window.innerWidth - 420));
        const scale = Math.min(1.5, maxWidth / base.width);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        setViewportSize({ width: canvas.width, height: canvas.height });
        const taskRender = page.render({ canvas, viewport, background: "#ffffff" });
        renderTask = taskRender;
        await taskRender.promise;
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(error instanceof Error ? error.message : "Unable to render drawing");
        }
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [activeDoc, pageNumber, projectId]);

  function clientToCanvas(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      cx: ((clientX - rect.left) / rect.width) * viewportSize.width,
      cy: ((clientY - rect.top) / rect.height) * viewportSize.height,
    };
  }

  function hitTest(cx: number, cy: number) {
    let best: OverlayPin | null = null;
    let bestDist = 16;
    for (const pin of pagePins) {
      const { cx: px, cy: py } = toCanvas(pin.x, pin.y);
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = pin;
      }
    }
    return best;
  }

  function selectItemToPlace(code: string) {
    setPlaceCode(code);
    setTool("add");
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (status !== "ready") return;
    const point = clientToCanvas(event.clientX, event.clientY);
    if (!point) return;
    const hit = hitTest(point.cx, point.cy);

    if (tool === "delete") {
      if (!hit) return;
      setPins((prev) => prev.map((pin) => (pin.id === hit.id ? { ...pin, excluded: true } : pin)));
      onRejectClass?.(hit.code, hit.description);
      setSelectedPinId(null);
      return;
    }

    if (tool === "add") {
      const row = placeableRows.find((item) => item.code === placeCode) || placeableRows[0];
      if (!row || !activeDoc) return;
      const pdf = toPdf(point.cx, point.cy);
      const pin: OverlayPin = {
        id: newPinId(),
        documentId: activeDoc.id,
        fileName: activeDoc.fileName,
        pageNumber,
        text: row.code.replace(/^P-/, ""),
        x: pdf.x,
        y: pdf.y,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        manual: true,
        code: row.code,
        description: row.description,
        quantityId: row.id,
      };
      setPins((prev) => [...prev, pin]);
      setSelectedPinId(pin.id);
      return;
    }

    if (hit) {
      setSelectedPinId(hit.id);
      dragRef.current = { pinId: hit.id };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      setSelectedPinId(null);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || tool !== "select") return;
    const point = clientToCanvas(event.clientX, event.clientY);
    if (!point) return;
    const pdf = toPdf(point.cx, point.cy);
    const pinId = dragRef.current.pinId;
    setPins((prev) => prev.map((pin) => (pin.id === pinId ? { ...pin, x: pdf.x, y: pdf.y } : pin)));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function applyEdits() {
    const byQuantity = new Map<string, OverlayPin[]>();
    for (const pin of pins) {
      const list = byQuantity.get(pin.quantityId) || [];
      list.push(pin);
      byQuantity.set(pin.quantityId, list);
    }
    const next: StudioAiReviewMeasuredQuantity[] = measured.map((row) => {
      const rowPins = byQuantity.get(row.id);
      if (row.unit !== "nr") {
        const quantity = manualQty[row.id] ?? row.quantity ?? 0;
        const confidence: TakeoffConfidence = quantity > 0 ? "Medium" : row.confidence ?? "Low";
        return {
          ...row,
          quantity,
          confidence,
          notes: "Manual length / area from takeoff board",
        };
      }
      if (!rowPins) {
        return { ...row, quantity: 0, tagMatches: [] };
      }
      const tagMatches = rowPins.map(({ code: _c, description: _d, quantityId: _q, confidence: _confidence, ...match }) => match);
      const active = tagMatches.filter((match) => !match.excluded).length;
      const confidence: TakeoffConfidence = active > 0 ? (row.confidence === "High" ? "High" : "Medium") : "Low";
      return {
        ...row,
        tagMatches,
        quantity: active,
        confidence,
        notes: `${active} pin(s) on marked drawings`,
      };
    });
    await onApply(next);
  }

  const activeCount = pins.filter((pin) => !pin.excluded).length;
  const lowConfidenceCount = pins.filter((pin) => !pin.excluded && pin.confidence === "Low").length;
  const isAiReview = Boolean(reviewStatus);

  if (!drawingDocs.length) {
    return (
      <div className="takeoff-overlay-empty">
        <p>Upload PDF drawings first. Then open the takeoff board and click each fixture on the plan to count.</p>
      </div>
    );
  }

  return (
    <div className="takeoff-board">
      <aside className="takeoff-board-sidebar">
        <header>
          <strong>{isAiReview ? "Review AI counts" : "Count on drawing"}</strong>
          <span>
            {isAiReview
              ? "Confirm Blake's suggested pins, or remove/exclude anything that should not reach Core."
              : "Select an item, then click every instance on the plan"}
          </span>
        </header>
        <div className="takeoff-board-items">
          <h4>Primaries</h4>
          {primaries.map((row) => {
            const qty = liveQty(row);
            const active = placeCode === row.code && tool === "add";
            const lowConfidence = row.confidence === "Low";
            return (
              <button
                key={row.id}
                type="button"
                className={`${active ? "item on" : "item"}${lowConfidence ? " low-confidence" : ""}`}
                onClick={() => {
                  if (row.unit === "nr") selectItemToPlace(row.code);
                }}
              >
                <span className="swatch" style={{ background: colourForCode(row.code) }} />
                <span className="meta">
                  <strong>{row.code}</strong>
                  <small>{row.description}{lowConfidence ? " · Low confidence" : ""}</small>
                </span>
                {row.unit === "nr" ? (
                  <em>{qty}</em>
                ) : (
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={manualQty[row.id] ?? row.quantity}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setManualQty((prev) => ({ ...prev, [row.id]: Number.isFinite(value) ? value : 0 }));
                    }}
                  />
                )}
              </button>
            );
          })}
          {secondaries.length ? (
            <>
              <h4>Derived fittings</h4>
              {secondaries.map((row) => (
                <div key={row.id} className="item derived">
                  <span className="swatch" style={{ background: colourForCode(row.code) }} />
                  <span className="meta">
                    <strong>{row.code}</strong>
                    <small>{row.description}</small>
                  </span>
                  <em title="Updates when you save & derive">{row.quantity}</em>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </aside>

      <div className="takeoff-board-main">
        <div className="takeoff-overlay-toolbar">
          <label>
            Drawing
            <select
              value={activeDoc?.id || ""}
              onChange={(event) => {
                setDocId(event.target.value);
                setPageNumber(1);
              }}
            >
              {drawingDocs.map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.fileName}</option>
              ))}
            </select>
          </label>
          <label>
            Page
            <select value={pageNumber} onChange={(event) => setPageNumber(Number(event.target.value))}>
              {Array.from({ length: pdfPageCount }, (_, index) => index + 1).map((page) => (
                <option key={page} value={page}>{page}</option>
              ))}
            </select>
          </label>
          <div className="takeoff-overlay-tools">
            <button type="button" className={tool === "add" ? "tool on" : "tool"} onClick={() => setTool("add")}>
              <Plus size={14} /> Count
            </button>
            <button type="button" className={tool === "select" ? "tool on" : "tool"} onClick={() => setTool("select")}>
              <MousePointer2 size={14} /> Move
            </button>
            <button type="button" className={tool === "delete" ? "tool on" : "tool"} onClick={() => setTool("delete")}>
              <Trash2 size={14} /> Remove
            </button>
          </div>
          {onFindTags ? (
            <button className="takeoff-skill-secondary" type="button" disabled={Boolean(busy)} onClick={() => void onFindTags()}>
              {busy === true ? <Loader2 className="spin" size={14} /> : null}
              Auto-find PDF tags
            </button>
          ) : null}
          <p className="takeoff-overlay-count">
            {isAiReview
              ? `Review ${activeCount} active AI pin(s)${lowConfidenceCount ? ` · ${lowConfidenceCount} low confidence` : ""}`
              : tool === "add"
                ? `Counting ${placeCode || "…"} — click the drawing`
                : `${activeCount} pins on sheets`}
          </p>
          {onClose ? (
            <button className="takeoff-skill-secondary" type="button" disabled={Boolean(busy)} onClick={onClose}>
              Back to Studio
            </button>
          ) : null}
          {onReject ? (
            <button className="takeoff-skill-secondary danger" type="button" disabled={Boolean(busy)} onClick={() => void onReject()}>
              Reject these pins
            </button>
          ) : null}
          <button className="takeoff-skill-primary" type="button" disabled={Boolean(busy)} onClick={() => void applyEdits()}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            {isAiReview ? "Confirm pins (guide counts, not a firm price)" : "Save & derive fittings"}
          </button>
        </div>

        <div className="takeoff-overlay-legend">
          {(codes.length ? codes : placeableRows.map((row) => row.code)).slice(0, 24).map((code) => {
            const on = visibleCodes.has(code);
            return (
              <button
                key={code}
                type="button"
                className={on ? "legend on" : "legend"}
                style={{ ["--swatch" as string]: colourForCode(code) }}
                onClick={() => {
                  setVisibleCodes((prev) => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code);
                    else next.add(code);
                    return next;
                  });
                }}
              >
                {on ? <Eye size={12} /> : <EyeOff size={12} />}
                <span className="swatch" />
                {code}
              </button>
            );
          })}
        </div>

        <div className="takeoff-overlay-stage">
          {status === "loading" ? <div className="takeoff-overlay-status">Rendering drawing…</div> : null}
          {status === "error" ? <div className="takeoff-overlay-status error">{errorMessage}</div> : null}
          <div
            ref={stageRef}
            className={`takeoff-overlay-canvas-wrap tool-${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas ref={canvasRef} className="takeoff-overlay-pdf" />
            <svg
              className="takeoff-overlay-hits"
              width={viewportSize.width}
              height={viewportSize.height}
              viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
            >
              {pagePins.map((pin) => {
                const { cx, cy } = toCanvas(pin.x, pin.y);
                const selected = selectedPinId === pin.id;
                const lowConfidence = pin.confidence === "Low";
                const colour = colourForCode(pin.code);
                return (
                  <g key={pin.id} transform={`translate(${cx} ${cy})`}>
                    {lowConfidence ? (
                      <circle
                        r={selected ? 17 : 15}
                        fill="none"
                        stroke="#f79009"
                        strokeWidth={3}
                        strokeDasharray="4 3"
                      />
                    ) : null}
                    <circle
                      r={selected ? 13 : 10}
                      fill={`${colour}dd`}
                      stroke={selected ? "#101828" : lowConfidence ? "#f79009" : "#ffffff"}
                      strokeWidth={selected ? 3 : lowConfidence ? 3 : 2}
                    />
                    <text textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize="8" fontWeight="700">
                      {pin.code.replace(/^P-/, "").slice(0, 6)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
