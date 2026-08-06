"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Loader2 } from "lucide-react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import {
  createDefaultStudioState,
  polygonArea,
  polylineLength,
  scaleForPage,
  studioId,
  type StudioGeometry,
  type StudioPoint,
  type StudioState,
  type StudioTool,
} from "@/lib/takeoff-studio";

type Props = {
  projectId: string;
  document: TakeoffDocument | null;
  studio: StudioState;
  onChange: (next: StudioState) => void;
};

function dist(a: StudioPoint, b: StudioPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function StudioCanvas({ projectId, document, studio, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [draftPoints, setDraftPoints] = useState<StudioPoint[]>([]);
  const [scaleDraft, setScaleDraft] = useState<StudioPoint[]>([]);
  const [scaleMetres, setScaleMetres] = useState("5");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  const activeClass = studio.classifications.find((c) => c.id === studio.activeClassificationId);
  const page = studio.activePage || 1;
  const pageScale = document ? scaleForPage(studio, document.id, page) : undefined;

  const clientToPage = useCallback(
    (clientX: number, clientY: number): StudioPoint | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      const x = (clientX - rect.left - view.panX) / view.scale;
      const y = (clientY - rect.top - view.panY) / view.scale;
      return { x, y };
    },
    [view],
  );

  // Load PDF page
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!document) {
        setStatus("idle");
        return;
      }
      setStatus("loading");
      setError("");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const src = `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(document.id)}/file`;
        const response = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to load drawing (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = pdfjs.getDocument({ data, isOffscreenCanvasSupported: false });
        const pdf = await task.promise;
        const pdfPage = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
        const viewport = pdfPage.getViewport({ scale: 1.35 });
        if (cancelled) return;
        setPageSize({ width: viewport.width, height: viewport.height });

        const pdfCanvas = pdfRef.current;
        if (!pdfCanvas) return;
        pdfCanvas.width = Math.floor(viewport.width);
        pdfCanvas.height = Math.floor(viewport.height);
        const ctx = pdfCanvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        await pdfPage.render({ canvas: pdfCanvas, canvasContext: ctx, viewport } as never).promise;
        if (cancelled) return;

        // Fit to stage
        const stage = stageRef.current;
        if (stage) {
          const pad = 24;
          const fit = Math.min(
            (stage.clientWidth - pad) / viewport.width,
            (stage.clientHeight - pad) / viewport.height,
            1.4,
          );
          setView({
            scale: Math.max(0.35, fit),
            panX: (stage.clientWidth - viewport.width * fit) / 2,
            panY: 16,
          });
        }
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Unable to open drawing");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [document?.id, page, projectId]);

  // Draw overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) return;
    canvas.width = Math.floor(pageSize.width);
    canvas.height = Math.floor(pageSize.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const geos = studio.geometries.filter(
      (g) => g.documentId === document.id && g.page === page,
    );

    for (const geo of geos) {
      const cls = studio.classifications.find((c) => c.id === geo.classificationId);
      const colour = cls?.colour || "#1998cf";
      const selected = geo.id === selectedId;
      ctx.lineWidth = selected ? 3.5 : 2.2;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;

      if (geo.kind === "count") {
        const r = selected ? 14 : 11;
        ctx.beginPath();
        ctx.arc(geo.point.x, geo.point.y, r, 0, Math.PI * 2);
        ctx.fillStyle = selected ? colour : `${colour}cc`;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (geo.kind === "linear" || geo.kind === "area") {
        const pts = geo.points;
        const first = pts[0];
        if (!first) continue;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i += 1) {
          const pt = pts[i];
          if (pt) ctx.lineTo(pt.x, pt.y);
        }
        if (geo.kind === "area" && geo.closed) {
          ctx.closePath();
          ctx.fillStyle = `${colour}33`;
          ctx.fill();
        }
        ctx.stroke();
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, selected ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // Draft
    const draftColour = activeClass?.colour || "#1998cf";
    const draftFirst = draftPoints[0];
    if (draftFirst) {
      ctx.strokeStyle = draftColour;
      ctx.fillStyle = `${draftColour}44`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(draftFirst.x, draftFirst.y);
      for (let i = 1; i < draftPoints.length; i += 1) {
        const pt = draftPoints[i];
        if (pt) ctx.lineTo(pt.x, pt.y);
      }
      if (studio.tool === "area" && draftPoints.length > 2) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of draftPoints) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = draftColour;
        ctx.fill();
      }
    }

    const scaleFirst = scaleDraft[0];
    if (scaleFirst) {
      ctx.strokeStyle = "#101828";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(scaleFirst.x, scaleFirst.y);
      if (scaleDraft[1]) ctx.lineTo(scaleDraft[1].x, scaleDraft[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of scaleDraft) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#101828";
        ctx.fill();
      }
    }
  }, [studio, document, page, pageSize, draftPoints, scaleDraft, selectedId, activeClass]);

  function patchStudio(partial: Partial<StudioState>) {
    onChange({
      ...studio,
      ...partial,
      updatedAt: new Date().toISOString(),
    });
  }

  function setTool(tool: StudioTool) {
    setDraftPoints([]);
    setScaleDraft([]);
    patchStudio({ tool });
  }

  function hitTest(point: StudioPoint): StudioGeometry | null {
    if (!document) return null;
    const geos = studio.geometries.filter((g) => g.documentId === document.id && g.page === page);
    for (let i = geos.length - 1; i >= 0; i -= 1) {
      const geo = geos[i];
      if (!geo) continue;
      if (geo.kind === "count" && dist(geo.point, point) <= 18 / view.scale) return geo;
      if (geo.kind === "linear" || geo.kind === "area") {
        for (const p of geo.points) {
          if (dist(p, point) <= 16 / view.scale) return geo;
        }
      }
    }
    return null;
  }

  function commitScale(from: StudioPoint, to: StudioPoint, metres: number) {
    if (!document || metres <= 0) return;
    const units = dist(from, to);
    if (units < 1) return;
    const metresPerUnit = metres / units;
    const nextScales = [
      ...studio.scales.filter((s) => !(s.documentId === document.id && s.page === page)),
      {
        documentId: document.id,
        page,
        metresPerUnit,
        calibrateFrom: from,
        calibrateTo: to,
        knownMetres: metres,
        label: `${metres} m`,
      },
    ];
    setScaleDraft([]);
    patchStudio({ scales: nextScales, tool: "pan" });
  }

  function onPointerDown(event: ReactPointerEvent) {
    const stage = stageRef.current;
    if (!stage || !document) return;
    stage.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
      };
      panRef.current = null;
      return;
    }

    const tool = studio.tool;
    const wantsPan =
      tool === "pan" ||
      event.button === 1 ||
      event.shiftKey ||
      (event.pointerType === "touch" && tool === "select");

    if (wantsPan && pointers.current.size === 1) {
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: view.panX,
        panY: view.panY,
      };
      return;
    }

    const point = clientToPage(event.clientX, event.clientY);
    if (!point) return;

    if (tool === "select") {
      const hit = hitTest(point);
      setSelectedId(hit?.id || null);
      return;
    }

    if (tool === "scale") {
      const next = [...scaleDraft, point].slice(0, 2);
      setScaleDraft(next);
      return;
    }

    if (tool === "count") {
      if (!activeClass || activeClass.kind !== "count") return;
      const geo: StudioGeometry = {
        id: studioId("geo"),
        classificationId: activeClass.id,
        kind: "count",
        documentId: document.id,
        page,
        point,
      };
      patchStudio({ geometries: [...studio.geometries, geo] });
      setSelectedId(geo.id);
      return;
    }

    if (tool === "linear" || tool === "area") {
      if (!activeClass || activeClass.kind !== tool) return;
      // Double-tap / second tap near first closes area
      const firstDraft = draftPoints[0];
      if (tool === "area" && firstDraft && draftPoints.length >= 3 && dist(firstDraft, point) < 18 / view.scale) {
        const geo: StudioGeometry = {
          id: studioId("geo"),
          classificationId: activeClass.id,
          kind: "area",
          documentId: document.id,
          page,
          points: draftPoints,
          closed: true,
        };
        setDraftPoints([]);
        patchStudio({ geometries: [...studio.geometries, geo] });
        setSelectedId(geo.id);
        return;
      }
      setDraftPoints((current) => [...current, point]);
    }
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchRef.current) {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const nextScale = Math.min(4, Math.max(0.25, pinchRef.current.scale * (d / Math.max(1, pinchRef.current.dist))));
      setView((v) => ({ ...v, scale: nextScale }));
      return;
    }

    if (panRef.current) {
      setView({
        scale: view.scale,
        panX: panRef.current.panX + (event.clientX - panRef.current.x),
        panY: panRef.current.panY + (event.clientY - panRef.current.y),
      });
    }
  }

  function onPointerUp(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) panRef.current = null;
  }

  function onWheel(event: ReactWheelEvent) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, scale: Math.min(4, Math.max(0.25, v.scale * factor)) }));
  }

  function finishLinear() {
    if (!document || !activeClass || studio.tool !== "linear" || draftPoints.length < 2) return;
    const geo: StudioGeometry = {
      id: studioId("geo"),
      classificationId: activeClass.id,
      kind: "linear",
      documentId: document.id,
      page,
      points: draftPoints,
    };
    setDraftPoints([]);
    patchStudio({ geometries: [...studio.geometries, geo] });
    setSelectedId(geo.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    patchStudio({ geometries: studio.geometries.filter((g) => g.id !== selectedId) });
    setSelectedId(null);
  }

  const draftHint = (() => {
    if (studio.tool === "scale" && scaleDraft.length === 2) {
      return "Enter the known length below, then Save scale.";
    }
    if (studio.tool === "linear" && draftPoints.length >= 2) {
      const units = polylineLength(draftPoints);
      const metres = pageScale ? units * pageScale.metresPerUnit : null;
      return metres != null
        ? `Draft run ≈ ${metres.toFixed(2)} m — tap Done to save.`
        : "Set scale first for metres. Tap Done to save the run.";
    }
    if (studio.tool === "area" && draftPoints.length >= 3) {
      const closePt = draftPoints[0];
      const area = closePt ? polygonArea([...draftPoints, closePt]) : 0;
      const m2 = pageScale ? area * pageScale.metresPerUnit ** 2 : null;
      return m2 != null
        ? `Draft area ≈ ${m2.toFixed(2)} m² — tap first point (or Close) to finish.`
        : "Tap near the first point to close the area.";
    }
    return null;
  })();

  return (
    <div className="nexa-studio-canvas-wrap">
      <div className="nexa-studio-toolbar" role="toolbar" aria-label="Drawing tools">
        {(
          [
            ["pan", "Pan"],
            ["select", "Select"],
            ["count", "Count"],
            ["linear", "Linear"],
            ["area", "Area"],
            ["scale", "Scale"],
          ] as Array<[StudioTool, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={studio.tool === id ? "on" : undefined}
            onClick={() => setTool(id)}
          >
            {label}
          </button>
        ))}
        <span className="nexa-studio-toolbar-gap" />
        {studio.tool === "linear" ? (
          <button type="button" className="accent" onClick={finishLinear} disabled={draftPoints.length < 2}>
            Done run
          </button>
        ) : null}
        {studio.tool === "area" && draftPoints.length >= 3 ? (
          <button
            type="button"
            className="accent"
            onClick={() => {
              if (!document || !activeClass) return;
              const geo: StudioGeometry = {
                id: studioId("geo"),
                classificationId: activeClass.id,
                kind: "area",
                documentId: document.id,
                page,
                points: draftPoints,
                closed: true,
              };
              setDraftPoints([]);
              patchStudio({ geometries: [...studio.geometries, geo] });
              setSelectedId(geo.id);
            }}
          >
            Close area
          </button>
        ) : null}
        <button type="button" onClick={deleteSelected} disabled={!selectedId}>
          Delete
        </button>
      </div>

      <div
        ref={stageRef}
        className="nexa-studio-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {!document ? (
          <div className="nexa-studio-empty">Upload a PDF drawing to start the takeoff.</div>
        ) : null}
        {status === "loading" ? (
          <div className="nexa-studio-empty">
            <Loader2 className="spin" size={22} />
            Opening drawing…
          </div>
        ) : null}
        {status === "error" ? <div className="nexa-studio-empty error">{error}</div> : null}

        <div
          className="nexa-studio-page"
          style={{
            width: pageSize.width,
            height: pageSize.height,
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`,
          }}
        >
          <canvas ref={pdfRef} className="nexa-studio-pdf" />
          <canvas ref={canvasRef} className="nexa-studio-overlay" />
        </div>
      </div>

      <div className="nexa-studio-statusbar">
        <span>
          Scale:{" "}
          {pageScale
            ? `${pageScale.label || "set"} · ${(1 / pageScale.metresPerUnit).toFixed(1)} units/m`
            : "Not set — tap Scale, two points, enter metres"}
        </span>
        {draftHint ? <strong>{draftHint}</strong> : <span>Pinch zoom · drag to pan · large tap targets for iPad</span>}
        {studio.tool === "scale" && scaleDraft.length === 2 ? (
          <form
            className="nexa-studio-scale-form"
            onSubmit={(event) => {
              event.preventDefault();
              const from = scaleDraft[0];
              const to = scaleDraft[1];
              if (from && to) commitScale(from, to, Number(scaleMetres));
            }}
          >
            <label>
              Known length (m)
              <input
                inputMode="decimal"
                value={scaleMetres}
                onChange={(e) => setScaleMetres(e.target.value)}
              />
            </label>
            <button type="submit" className="accent">
              Save scale
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export { createDefaultStudioState };
