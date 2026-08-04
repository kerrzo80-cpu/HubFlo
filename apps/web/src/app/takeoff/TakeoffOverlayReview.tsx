"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Eye, EyeOff, Loader2, MousePointer2, Plus, Trash2 } from "lucide-react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import type { TakeoffMeasuredQuantity } from "@/lib/takeoff-skill";

type OverlayPin = NonNullable<TakeoffMeasuredQuantity["tagMatches"]>[number] & {
  code: string;
  description: string;
  quantityId: string;
};

type ToolMode = "select" | "add" | "delete";

const CODE_COLOURS: Record<string, string> = {
  "P-WC": "#14618c",
  "P-WHB": "#2e8c7d",
  "P-BATH": "#b36a16",
  "P-SHR": "#006eb8",
  "P-SINK": "#278459",
  "P-APPL": "#7a4f9a",
  "P-SVP": "#b43a3a",
  "P-PIPE-H": "#c45c26",
  "P-PIPE-C": "#1f7fb0",
  "P-WASTE": "#5b6b7a",
};

function colourForCode(code: string) {
  if (CODE_COLOURS[code]) return CODE_COLOURS[code]!;
  if (code.includes("ISO")) return "#8a5a00";
  if (code.includes("TRAP") || code.includes("WASTE")) return "#5b6b7a";
  if (code.includes("ELBOW") || code.includes("TEE") || code.includes("COUP")) return "#3d6b8a";
  if (code.includes("CLIP")) return "#4a6a4a";
  if (code.startsWith("P-WC")) return "#14618c";
  if (code.startsWith("P-WHB")) return "#2e8c7d";
  if (code.startsWith("P-BATH")) return "#b36a16";
  if (code.startsWith("P-SHR")) return "#006eb8";
  if (code.startsWith("P-SINK")) return "#278459";
  return "#14618c";
}

function newPinId() {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Props = {
  projectId: string;
  documents: TakeoffDocument[];
  measured: TakeoffMeasuredQuantity[];
  busy?: boolean;
  onApply: (measured: TakeoffMeasuredQuantity[]) => Promise<void>;
};

export default function TakeoffOverlayReview({ projectId, documents, measured, busy, onApply }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [tool, setTool] = useState<ToolMode>("select");
  const [placeCode, setPlaceCode] = useState("");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const dragRef = useRef<{ pinId: string; moved: boolean } | null>(null);

  const placeableRows = useMemo(
    () => measured.filter((row) => row.unit === "nr"),
    [measured],
  );

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
        });
      }
    }
    setPins(next);
    if (!placeCode && placeableRows[0]) setPlaceCode(placeableRows[0].code);
  }, [measured]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawingDocs = useMemo(() => {
    const fromProject = documents.filter(
      (doc) =>
        (doc.kind === "Drawing" || doc.kind === "Marked-up drawing")
        && (doc.mimeType?.includes("pdf") || doc.fileName.toLowerCase().endsWith(".pdf")),
    );
    if (fromProject.length) return fromProject;
    const ids = [...new Set(pins.map((pin) => pin.documentId))];
    return ids.map((id) => ({
      id,
      fileName: pins.find((pin) => pin.documentId === id)?.fileName || id,
    })) as TakeoffDocument[];
  }, [documents, pins]);

  const codes = useMemo(() => [...new Set(pins.map((pin) => pin.code))].sort(), [pins]);
  const [visibleCodes, setVisibleCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVisibleCodes(new Set(codes.length ? codes : placeableRows.map((row) => row.code)));
  }, [codes, placeableRows]);

  const [docId, setDocId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);

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
  const hiddenOnPage = pins.filter(
    (pin) =>
      pin.excluded
      && pin.documentId === (activeDoc?.id || docId)
      && pin.pageNumber === pageNumber
      && visibleCodes.has(pin.code),
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
        const maxWidth = Math.min(1200, window.innerWidth - 64);
        const scale = Math.min(1.4, maxWidth / base.width);
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

  function hitTest(cx: number, cy: number, includeExcluded = false) {
    const pool = includeExcluded
      ? pins.filter(
        (pin) =>
          pin.documentId === (activeDoc?.id || docId)
          && pin.pageNumber === pageNumber
          && visibleCodes.has(pin.code),
      )
      : pagePins;
    let best: OverlayPin | null = null;
    let bestDist = 16;
    for (const pin of pool) {
      const { cx: px, cy: py } = toCanvas(pin.x, pin.y);
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = pin;
      }
    }
    return best;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (status !== "ready") return;
    const point = clientToCanvas(event.clientX, event.clientY);
    if (!point) return;
    const hit = hitTest(point.cx, point.cy, tool === "select");

    if (tool === "delete") {
      if (!hit) return;
      setPins((prev) => prev.map((pin) => (pin.id === hit.id ? { ...pin, excluded: true } : pin)));
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

    // select / drag
    if (hit) {
      if (hit.excluded) {
        setPins((prev) => prev.map((pin) => (pin.id === hit.id ? { ...pin, excluded: false } : pin)));
      }
      setSelectedPinId(hit.id);
      dragRef.current = { pinId: hit.id, moved: false };
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
    dragRef.current.moved = true;
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
    const next = measured.map((row) => {
      const rowPins = byQuantity.get(row.id);
      if (!rowPins) return row;
      const tagMatches = rowPins.map(({ code: _c, description: _d, quantityId: _q, ...match }) => match);
      const active = tagMatches.filter((match) => !match.excluded).length;
      return {
        ...row,
        tagMatches,
        quantity: row.unit === "nr" ? active : row.quantity,
      };
    });
    await onApply(next);
  }

  const activeCount = pins.filter((pin) => !pin.excluded).length;
  const removedCount = pins.filter((pin) => pin.excluded).length;

  if (!drawingDocs.length) {
    return (
      <div className="takeoff-overlay-empty">
        <p>Upload PDF drawings first, then measure — the marked overlay opens here for add / move / remove.</p>
      </div>
    );
  }

  return (
    <div className="takeoff-overlay">
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
          <button type="button" className={tool === "select" ? "tool on" : "tool"} onClick={() => setTool("select")}>
            <MousePointer2 size={14} /> Move
          </button>
          <button type="button" className={tool === "add" ? "tool on" : "tool"} onClick={() => setTool("add")}>
            <Plus size={14} /> Add
          </button>
          <button type="button" className={tool === "delete" ? "tool on" : "tool"} onClick={() => setTool("delete")}>
            <Trash2 size={14} /> Remove
          </button>
        </div>

        {tool === "add" ? (
          <label>
            Place item
            <select value={placeCode} onChange={(event) => setPlaceCode(event.target.value)}>
              {placeableRows.map((row) => (
                <option key={row.id} value={row.code}>
                  {row.code} · {row.description}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <p className="takeoff-overlay-count">
          {activeCount} pins · {removedCount} removed · drag to move · Add/Remove tools for manual edits
        </p>
        <button className="takeoff-skill-primary" type="button" disabled={Boolean(busy)} onClick={() => void applyEdits()}>
          {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
          Save overlay & recount
        </button>
      </div>

      <div className="takeoff-overlay-legend">
        {(codes.length ? codes : placeableRows.map((row) => row.code)).map((code) => {
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
        {status === "loading" ? <div className="takeoff-overlay-status">Rendering marked drawing…</div> : null}
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
              const colour = colourForCode(pin.code);
              return (
                <g key={pin.id} transform={`translate(${cx} ${cy})`} style={{ cursor: tool === "select" ? "grab" : "pointer" }}>
                  <circle
                    r={selected ? 13 : pin.manual ? 11 : 10}
                    fill={`${colour}dd`}
                    stroke={selected ? "#101828" : "#ffffff"}
                    strokeWidth={selected ? 3 : 2}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize="8"
                    fontWeight="700"
                    style={{ pointerEvents: "none" }}
                  >
                    {pin.code.replace(/^P-/, "").slice(0, 6)}
                  </text>
                  {pin.manual ? (
                    <circle r={3} cx={8} cy={-8} fill="#fff" stroke={colour} strokeWidth={1} />
                  ) : null}
                </g>
              );
            })}
            {hiddenOnPage.map((pin) => {
              const { cx, cy } = toCanvas(pin.x, pin.y);
              return (
                <g key={`ex-${pin.id}`} transform={`translate(${cx} ${cy})`} opacity={0.45}>
                  <circle r={8} fill="rgba(180,58,58,0.2)" stroke="#b43a3a" strokeWidth={2} />
                  <line x1={-5} y1={-5} x2={5} y2={5} stroke="#b43a3a" strokeWidth={2} />
                  <line x1={5} y1={-5} x2={-5} y2={5} stroke="#b43a3a" strokeWidth={2} />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="takeoff-overlay-list">
        <h3>Pins on this page ({pagePins.length})</h3>
        <ul>
          {pagePins.map((pin) => (
            <li key={pin.id} className={selectedPinId === pin.id ? "selected" : ""}>
              <button
                type="button"
                onClick={() => setSelectedPinId(pin.id)}
              >
                <span className="swatch" style={{ background: colourForCode(pin.code) }} />
                <strong>{pin.code}</strong>
                <span>{pin.description}{pin.manual ? " · manual" : pin.derived ? " · derived" : ""}</span>
                <em
                  onClick={(event) => {
                    event.stopPropagation();
                    setPins((prev) => prev.map((row) => (row.id === pin.id ? { ...row, excluded: true } : row)));
                  }}
                >
                  remove
                </em>
              </button>
            </li>
          ))}
          {!pagePins.length ? (
            <li className="empty">
              No pins on this page yet. Use <strong>Add</strong> and click the drawing, or re-run measure after rebuilding the plan.
            </li>
          ) : null}
        </ul>
        {selectedPinId ? (
          <div className="takeoff-overlay-selected">
            <button
              type="button"
              className="takeoff-skill-secondary"
              onClick={() => {
                setPins((prev) => prev.map((pin) => (pin.id === selectedPinId ? { ...pin, excluded: true } : pin)));
                setSelectedPinId(null);
              }}
            >
              <Trash2 size={14} /> Remove selected pin
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
