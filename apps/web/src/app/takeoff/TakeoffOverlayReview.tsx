"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";

import type { TakeoffMeasuredQuantity } from "@/lib/takeoff-skill";

type TagMatch = NonNullable<TakeoffMeasuredQuantity["tagMatches"]>[number] & {
  code: string;
  description: string;
  matchKey: string;
};

const CODE_COLOURS: Record<string, string> = {
  "P-WC": "#14618c",
  "P-WHB": "#2e8c7d",
  "P-BATH": "#b36a16",
  "P-SHR": "#006eb8",
  "P-SINK": "#278459",
  "P-APPL": "#7a4f9a",
  "P-SVP": "#b43a3a",
};

function colourForCode(code: string) {
  return CODE_COLOURS[code] || "#14618c";
}

function matchKey(code: string, match: { documentId: string; pageNumber: number; x: number; y: number; text: string }) {
  return `${code}|${match.documentId}|${match.pageNumber}|${match.x.toFixed(1)}|${match.y.toFixed(1)}|${match.text}`;
}

type Props = {
  projectId: string;
  measured: TakeoffMeasuredQuantity[];
  busy?: boolean;
  onApply: (measured: TakeoffMeasuredQuantity[]) => Promise<void>;
};

export default function TakeoffOverlayReview({ projectId, measured, busy, onApply }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  const primariesWithTags = useMemo(
    () => measured.filter((row) => row.kind === "primary" && (row.tagMatches?.length || 0) > 0),
    [measured],
  );

  const allMatches = useMemo(() => {
    const rows: TagMatch[] = [];
    for (const primary of primariesWithTags) {
      for (const match of primary.tagMatches || []) {
        rows.push({
          ...match,
          code: primary.code,
          description: primary.description,
          matchKey: matchKey(primary.code, match),
        });
      }
    }
    return rows;
  }, [primariesWithTags]);

  const documents = useMemo(() => {
    const map = new Map<string, { documentId: string; fileName: string; pages: number[] }>();
    for (const match of allMatches) {
      const existing = map.get(match.documentId);
      if (!existing) {
        map.set(match.documentId, {
          documentId: match.documentId,
          fileName: match.fileName,
          pages: [match.pageNumber],
        });
      } else if (!existing.pages.includes(match.pageNumber)) {
        existing.pages.push(match.pageNumber);
        existing.pages.sort((a, b) => a - b);
      }
    }
    return [...map.values()];
  }, [allMatches]);

  const codes = useMemo(() => [...new Set(allMatches.map((row) => row.code))], [allMatches]);

  const [docId, setDocId] = useState<string>("");
  const [pageNumber, setPageNumber] = useState(1);
  const [visibleCodes, setVisibleCodes] = useState<Set<string>>(new Set());
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!documents.length) return;
    if (!docId || !documents.some((row) => row.documentId === docId)) {
      setDocId(documents[0]!.documentId);
      setPageNumber(documents[0]!.pages[0] || 1);
    }
  }, [documents, docId]);

  useEffect(() => {
    setVisibleCodes(new Set(codes));
  }, [codes]);

  useEffect(() => {
    const excluded = new Set<string>();
    for (const match of allMatches) {
      if (match.excluded) excluded.add(match.matchKey);
    }
    setExcludedKeys(excluded);
  }, [allMatches]);

  const activeDoc = documents.find((row) => row.documentId === docId) || documents[0];
  const pageMatches = allMatches.filter(
    (match) =>
      match.documentId === (activeDoc?.documentId || docId) &&
      match.pageNumber === pageNumber &&
      visibleCodes.has(match.code),
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
        const src = `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(activeDoc!.documentId)}/file`;
        const response = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to load drawing (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = pdfjs.getDocument({ data, isOffscreenCanvasSupported: false });
        loadingTask = task;
        const pdf = await task.promise;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setPageSize({ width: base.width, height: base.height });
        const maxWidth = Math.min(1100, window.innerWidth - 80);
        const scale = Math.min(1.35, maxWidth / base.width);
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

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || status !== "ready") return;
    overlay.width = viewportSize.width;
    overlay.height = viewportSize.height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const scaleX = viewportSize.width / pageSize.width;
    const scaleY = viewportSize.height / pageSize.height;

    for (const match of pageMatches) {
      const excluded = excludedKeys.has(match.matchKey);
      const colour = colourForCode(match.code);
      const cx = match.x * scaleX;
      // PDF text y is from bottom-left; canvas y is from top-left
      const cy = viewportSize.height - match.y * scaleY;
      ctx.beginPath();
      ctx.arc(cx, cy, excluded ? 7 : 10, 0, Math.PI * 2);
      ctx.fillStyle = excluded ? "rgba(180, 58, 58, 0.25)" : `${colour}cc`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = excluded ? "#b43a3a" : "#ffffff";
      ctx.stroke();
      if (excluded) {
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 5);
        ctx.lineTo(cx + 5, cy + 5);
        ctx.moveTo(cx + 5, cy - 5);
        ctx.lineTo(cx - 5, cy + 5);
        ctx.strokeStyle = "#b43a3a";
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px IBM Plex Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(match.code.replace(/^P-/, ""), cx, cy);
      }
    }
  }, [excludedKeys, pageMatches, pageSize, status, viewportSize]);

  function toggleMatchAt(clientX: number, clientY: number) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * overlay.width;
    const y = ((clientY - rect.top) / rect.height) * overlay.height;
    const scaleX = viewportSize.width / pageSize.width;
    const scaleY = viewportSize.height / pageSize.height;

    let best: TagMatch | null = null;
    let bestDist = 18;
    for (const match of pageMatches) {
      const cx = match.x * scaleX;
      const cy = viewportSize.height - match.y * scaleY;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = match;
      }
    }
    if (!best) return;
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(best!.matchKey)) next.delete(best!.matchKey);
      else next.add(best!.matchKey);
      return next;
    });
  }

  async function applyApproved() {
    const next = measured.map((row) => {
      if (row.kind !== "primary" || !row.tagMatches?.length) return row;
      const tagMatches = row.tagMatches.map((match) => ({
        ...match,
        excluded: excludedKeys.has(matchKey(row.code, match)),
      }));
      const active = tagMatches.filter((match) => !match.excluded).length;
      return {
        ...row,
        tagMatches,
        quantity: row.unit === "nr" ? active : row.quantity,
      };
    });
    await onApply(next);
  }

  const activeCount = allMatches.filter((match) => !excludedKeys.has(match.matchKey)).length;
  const excludedCount = excludedKeys.size;

  if (!allMatches.length) {
    return (
      <div className="takeoff-overlay-empty">
        <p>
          No text-tag positions were captured for this run. Re-run measurement on selectable-text PDFs
          to pin items on the drawing for approval.
        </p>
      </div>
    );
  }

  return (
    <div className="takeoff-overlay">
      <div className="takeoff-overlay-toolbar">
        <label>
          Drawing
          <select
            value={activeDoc?.documentId || ""}
            onChange={(event) => {
              const next = documents.find((row) => row.documentId === event.target.value);
              setDocId(event.target.value);
              setPageNumber(next?.pages[0] || 1);
            }}
          >
            {documents.map((doc) => (
              <option key={doc.documentId} value={doc.documentId}>
                {doc.fileName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page
          <select
            value={pageNumber}
            onChange={(event) => setPageNumber(Number(event.target.value))}
          >
            {(activeDoc?.pages || [1]).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
        </label>
        <div className="takeoff-overlay-legend">
          {codes.map((code) => {
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
        <p className="takeoff-overlay-count">
          {activeCount} allowed · {excludedCount} excluded — click a marker to toggle
        </p>
        <button
          className="takeoff-skill-primary"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void applyApproved()}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
          Apply approved counts
        </button>
      </div>

      <div className="takeoff-overlay-stage">
        {status === "loading" ? <div className="takeoff-overlay-status">Rendering drawing…</div> : null}
        {status === "error" ? <div className="takeoff-overlay-status error">{errorMessage}</div> : null}
        <div className="takeoff-overlay-canvas-wrap">
          <canvas ref={canvasRef} className="takeoff-overlay-pdf" />
          <canvas
            ref={overlayRef}
            className="takeoff-overlay-hits"
            onClick={(event) => toggleMatchAt(event.clientX, event.clientY)}
          />
        </div>
      </div>

      <div className="takeoff-overlay-list">
        <h3>Hits on this page</h3>
        <ul>
          {pageMatches.map((match) => {
            const excluded = excludedKeys.has(match.matchKey);
            return (
              <li key={match.matchKey} className={excluded ? "excluded" : ""}>
                <button
                  type="button"
                  onClick={() => {
                    setExcludedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(match.matchKey)) next.delete(match.matchKey);
                      else next.add(match.matchKey);
                      return next;
                    });
                  }}
                >
                  <span className="swatch" style={{ background: colourForCode(match.code) }} />
                  <strong>{match.code}</strong>
                  <span>“{match.text}”</span>
                  <em>{excluded ? "excluded" : "allowed"}</em>
                </button>
              </li>
            );
          })}
          {!pageMatches.length ? <li className="empty">No visible hits on this page for the selected codes.</li> : null}
        </ul>
      </div>
    </div>
  );
}
