"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronLeft, ChevronRight, Loader2, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import {
  polygonArea,
  polylineLength,
  detectScaleRatioHints,
  metresPerUnitFromRatio,
  parseScaleRatioLabel,
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
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

function dist(a: StudioPoint, b: StudioPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const RENDER_SCALE = 1.35;

export default function StudioCanvas({
  projectId,
  document,
  studio,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [pageCount, setPageCount] = useState(1);
  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [draftPoints, setDraftPoints] = useState<StudioPoint[]>([]);
  const [scaleDraft, setScaleDraft] = useState<StudioPoint[]>([]);
  const [scaleMetres, setScaleMetres] = useState("5");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [rectStart, setRectStart] = useState<StudioPoint | null>(null);
  const [rectCurrent, setRectCurrent] = useState<StudioPoint | null>(null);
  const [scaleHints, setScaleHints] = useState<string[]>([]);

  const [dragPreview, setDragPreview] = useState<{ id: string; point: StudioPoint } | null>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number; panX: number; panY: number; midX: number; midY: number } | null>(null);
  const dragGeoRef = useRef<{ id: string; origin: StudioPoint; start: StudioPoint } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const viewRef = useRef(view);
  viewRef.current = view;

  const activeClass = studio.classifications.find((c) => c.id === studio.activeClassificationId);
  const page = studio.activePage || 1;
  const pageScale = document ? scaleForPage(studio, document.id, page) : undefined;

  const clientToPage = useCallback((clientX: number, clientY: number): StudioPoint | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.panX) / v.scale,
      y: (clientY - rect.top - v.panY) / v.scale,
    };
  }, []);

  const fitView = useCallback((width: number, height: number) => {
    const stage = stageRef.current;
    if (!stage || width < 2 || height < 2) return;
    const pad = 28;
    const fit = Math.min((stage.clientWidth - pad) / width, (stage.clientHeight - pad) / height, 1.6);
    setView({
      scale: Math.max(0.3, fit),
      panX: (stage.clientWidth - width * fit) / 2,
      panY: 12,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!document) {
        setStatus("idle");
        setPageCount(1);
        return;
      }
      setStatus("loading");
      setError("");
      setDraftPoints([]);
      setScaleDraft([]);
      setSelectedId(null);
      setScaleHints([]);
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
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const safePage = Math.min(Math.max(1, page), pdf.numPages);
        if (safePage !== page) {
          onChange({ ...studio, activePage: safePage, updatedAt: new Date().toISOString() });
          return;
        }
        const pdfPage = await pdf.getPage(safePage);
        const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
        if (cancelled) return;
        setPageSize({ width: viewport.width, height: viewport.height });

        try {
          const textContent = await pdfPage.getTextContent();
          const pageText = textContent.items
            .map((item) => (item && typeof item === "object" && "str" in item ? String((item as { str?: string }).str || "") : ""))
            .join(" ");
          if (!cancelled) setScaleHints(detectScaleRatioHints(pageText));
        } catch {
          if (!cancelled) setScaleHints([]);
        }

        const pdfCanvas = pdfRef.current;
        if (!pdfCanvas) return;
        pdfCanvas.width = Math.floor(viewport.width);
        pdfCanvas.height = Math.floor(viewport.height);
        const ctx = pdfCanvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        await pdfPage.render({ canvas: pdfCanvas, canvasContext: ctx, viewport } as never).promise;
        if (cancelled) return;
        fitView(viewport.width, viewport.height);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on doc/page/project only
  }, [document?.id, page, projectId, fitView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) return;
    canvas.width = Math.floor(pageSize.width);
    canvas.height = Math.floor(pageSize.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const geos = studio.geometries.filter((g) => g.documentId === document.id && g.page === page);
    for (const geo of geos) {
      const cls = studio.classifications.find((c) => c.id === geo.classificationId);
      const colour = cls?.colour || "#1998cf";
      const selected = geo.id === selectedId;
      const dimmed = Boolean(studio.activeClassificationId && geo.classificationId !== studio.activeClassificationId && !selected);
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.22 : 1;
      ctx.lineWidth = selected ? 3.5 : 2.2;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;

      if (geo.kind === "count") {
        const point = dragPreview?.id === geo.id ? dragPreview.point : geo.point;
        const r = selected ? 15 : 12;
        ctx.beginPath();
        ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
        ctx.fillStyle = selected ? colour : `${colour}cc`;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        const pts = geo.points;
        const first = pts[0];
        if (!first) {
          ctx.restore();
          continue;
        }
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
          ctx.arc(p.x, p.y, selected ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

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

    if (rectStart && rectCurrent) {
      const colour = activeClass?.colour || "#1998cf";
      const x = Math.min(rectStart.x, rectCurrent.x);
      const y = Math.min(rectStart.y, rectCurrent.y);
      const w = Math.abs(rectCurrent.x - rectStart.x);
      const h = Math.abs(rectCurrent.y - rectStart.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = colour;
      ctx.fillStyle = `${colour}33`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [studio, document, page, pageSize, draftPoints, scaleDraft, selectedId, activeClass, dragPreview, rectStart, rectCurrent]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
      if ((event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      }
      if ((event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        event.preventDefault();
        onRedo?.();
      }
      if ((event.key === "y" || event.key === "Y") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onRedo?.();
      }
      if (event.key === "Escape") {
        setDraftPoints([]);
        setScaleDraft([]);
        setRectStart(null);
        setRectCurrent(null);
        setSelectedId(null);
        if (studio.tool === "measure") patchStudio({ tool: "pan" });
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
        event.preventDefault();
        patchStudio({ geometries: studio.geometries.filter((g) => g.id !== selectedId) });
        setSelectedId(null);
      }
      if (event.key === "1") setTool("pan");
      if (event.key === "2") setTool("select");
      if (event.key === "3") setTool("count");
      if (event.key === "4") setTool("linear");
      if (event.key === "5") setTool("area");
      if (event.key === "6") setTool("rect");
      if (event.key === "7") setTool("measure");
      if (event.key === "8") setTool("scale");
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceDown(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

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
    setRectStart(null);
    setRectCurrent(null);
    dragGeoRef.current = null;
    patchStudio({ tool });
  }

  function setPage(next: number) {
    const safe = Math.min(Math.max(1, next), pageCount);
    setDraftPoints([]);
    setScaleDraft([]);
    patchStudio({ activePage: safe });
  }

  function hitTest(point: StudioPoint): StudioGeometry | null {
    if (!document) return null;
    const geos = studio.geometries.filter((g) => g.documentId === document.id && g.page === page);
    for (let i = geos.length - 1; i >= 0; i -= 1) {
      const geo = geos[i];
      if (!geo) continue;
      if (geo.kind === "count" && dist(geo.point, point) <= 20 / view.scale) return geo;
      if (geo.kind === "linear" || geo.kind === "area") {
        for (const p of geo.points) {
          if (dist(p, point) <= 18 / view.scale) return geo;
        }
      }
    }
    return null;
  }

  function commitScale(from: StudioPoint, to: StudioPoint, metres: number) {
    if (!document || !(metres > 0)) return;
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
    patchStudio({ scales: nextScales, tool: activeClass?.kind || "count" });
  }

  function applyRatioHint(label: string) {
    if (!document) return;
    const denom = parseScaleRatioLabel(label);
    const metresPerUnit = denom != null ? metresPerUnitFromRatio(denom, RENDER_SCALE) : null;
    if (metresPerUnit == null) return;
    const nextScales = [
      ...studio.scales.filter((s) => !(s.documentId === document.id && s.page === page)),
      {
        documentId: document.id,
        page,
        metresPerUnit,
        label,
      },
    ];
    setScaleDraft([]);
    patchStudio({ scales: nextScales, tool: activeClass?.kind || "count" });
  }

  function onPointerDown(event: ReactPointerEvent) {
    const stage = stageRef.current;
    if (!stage || !document || status !== "ready") return;
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
        panX: view.panX,
        panY: view.panY,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      panRef.current = null;
      dragGeoRef.current = null;
      return;
    }

    const point = clientToPage(event.clientX, event.clientY);
    if (!point) return;
    const tool = studio.tool;
    const hit = hitTest(point);

    // Pan: dedicated tool, middle mouse, shift, space, or two-finger (handled above).
    // Single-finger on blank space in select also pans — but tap on a pin selects/drags.
    const forcePan = tool === "pan" || event.button === 1 || event.shiftKey || spaceDown;
    if (forcePan) {
      panRef.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      return;
    }

    if (tool === "select") {
      if (hit) {
        setSelectedId(hit.id);
        if (hit.kind === "count") {
          dragGeoRef.current = { id: hit.id, origin: { ...hit.point }, start: point };
        }
      } else {
        setSelectedId(null);
        panRef.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      }
      return;
    }

    if (tool === "scale" || tool === "measure") {
      setScaleDraft((current) => [...current, point].slice(0, 2));
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

    if (tool === "rect") {
      if (!activeClass || activeClass.kind !== "area") return;
      setRectStart(point);
      setRectCurrent(point);
      return;
    }

    if (tool === "linear" || tool === "area") {
      if (!activeClass || activeClass.kind !== tool) return;
      const firstDraft = draftPoints[0];
      if (tool === "area" && firstDraft && draftPoints.length >= 3 && dist(firstDraft, point) < 22 / view.scale) {
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
      // Double-tap near last point finishes linear
      const last = draftPoints[draftPoints.length - 1];
      if (tool === "linear" && last && draftPoints.length >= 2 && dist(last, point) < 14 / view.scale) {
        finishLinear([...draftPoints]);
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
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const nextScale = Math.min(5, Math.max(0.2, pinchRef.current.scale * (d / Math.max(1, pinchRef.current.dist))));
      setView({
        scale: nextScale,
        panX: pinchRef.current.panX + (midX - pinchRef.current.midX),
        panY: pinchRef.current.panY + (midY - pinchRef.current.midY),
      });
      return;
    }

    if (rectStart) {
      const point = clientToPage(event.clientX, event.clientY);
      if (point) setRectCurrent(point);
      return;
    }

    if (dragGeoRef.current) {
      const point = clientToPage(event.clientX, event.clientY);
      if (!point) return;
      const dx = point.x - dragGeoRef.current.start.x;
      const dy = point.y - dragGeoRef.current.start.y;
      const origin = dragGeoRef.current.origin;
      setDragPreview({ id: dragGeoRef.current.id, point: { x: origin.x + dx, y: origin.y + dy } });
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
    if (pointers.current.size === 0) {
      if (rectStart && rectCurrent && document && activeClass?.kind === "area") {
        const x1 = Math.min(rectStart.x, rectCurrent.x);
        const y1 = Math.min(rectStart.y, rectCurrent.y);
        const x2 = Math.max(rectStart.x, rectCurrent.x);
        const y2 = Math.max(rectStart.y, rectCurrent.y);
        if (Math.hypot(x2 - x1, y2 - y1) > 8 / view.scale) {
          const geo: StudioGeometry = {
            id: studioId("geo"),
            classificationId: activeClass.id,
            kind: "area",
            documentId: document.id,
            page,
            points: [
              { x: x1, y: y1 },
              { x: x2, y: y1 },
              { x: x2, y: y2 },
              { x: x1, y: y2 },
            ],
            closed: true,
          };
          patchStudio({ geometries: [...studio.geometries, geo] });
          setSelectedId(geo.id);
        }
      }
      if (dragGeoRef.current && dragPreview) {
        const id = dragGeoRef.current.id;
        const point = dragPreview.point;
        patchStudio({
          geometries: studio.geometries.map((geo) => (
            geo.id === id && geo.kind === "count" ? { ...geo, point } : geo
          )),
        });
      }
      panRef.current = null;
      dragGeoRef.current = null;
      setDragPreview(null);
      setRectStart(null);
      setRectCurrent(null);
    }
  }

  function onWheel(event: ReactWheelEvent) {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(5, Math.max(0.2, view.scale * factor));
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const pageX = (mx - view.panX) / view.scale;
    const pageY = (my - view.panY) / view.scale;
    setView({
      scale: nextScale,
      panX: mx - pageX * nextScale,
      panY: my - pageY * nextScale,
    });
  }

  function finishLinear(points = draftPoints) {
    if (!document || !activeClass || points.length < 2) return;
    const geo: StudioGeometry = {
      id: studioId("geo"),
      classificationId: activeClass.id,
      kind: "linear",
      documentId: document.id,
      page,
      points,
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

  function handleUndo() {
    if (draftPoints.length) {
      setDraftPoints((points) => points.slice(0, -1));
      return;
    }
    if (scaleDraft.length) {
      setScaleDraft((points) => points.slice(0, -1));
      return;
    }
    if (rectStart) {
      setRectStart(null);
      setRectCurrent(null);
      return;
    }
    onUndo?.();
  }

  const canLocalUndo = draftPoints.length > 0 || scaleDraft.length > 0 || Boolean(rectStart);

  const toolHelp: Record<StudioTool, { label: string; title: string; hint: string }> = {
    pan: {
      label: "Move",
      title: "Move the drawing around (drag). Pinch to zoom.",
      hint: "Drag to move the sheet. Pinch or use + / − to zoom.",
    },
    select: {
      label: "Edit",
      title: "Select and move pins. Drag empty space to pan.",
      hint: "Tap a pin to select it. Drag the pin to move it. Delete removes it.",
    },
    count: {
      label: "Count",
      title: "Tap once for each fixture (WC, basin, socket, etc.).",
      hint: "Tap each fixture once to count it. Use Ask Blake first if tags are on the PDF.",
    },
    linear: {
      label: "Length",
      title: "Tap along a pipe or wall run to measure metres.",
      hint: "Tap along the run point-by-point, then Done run. Set scale first for metres.",
    },
    area: {
      label: "Area",
      title: "Tap around a room or zone to measure m².",
      hint: "Tap the corners of the space, then Close area (or tap near the first point).",
    },
    rect: {
      label: "Box",
      title: "Drag a rectangle for a quick area takeoff.",
      hint: "Press and drag a box over the area. Set scale first for m².",
    },
    measure: {
      label: "Check m",
      title: "Check a distance between two points (does not set scale).",
      hint: "Tap two points to see the distance. This only checks — it does not set scale.",
    },
    scale: {
      label: "Set scale",
      title: "Calibrate the drawing so lengths show in metres.",
      hint: "Tap two ends of a known dimension, enter how many metres it is, Save scale.",
    },
  };

  const draftHint = (() => {
    if ((studio.tool === "scale" || studio.tool === "measure") && scaleDraft.length === 2) {
      const from = scaleDraft[0];
      const to = scaleDraft[1];
      if (from && to) {
        const units = dist(from, to);
        const metres = pageScale ? units * pageScale.metresPerUnit : null;
        if (studio.tool === "measure") {
          return metres != null
            ? `Checked distance ≈ ${metres.toFixed(2)} m`
            : `Checked ${units.toFixed(0)} drawing units — Set scale to see metres.`;
        }
        return "Type the real length in metres, then Save scale.";
      }
    }
    if (studio.tool === "linear" && draftPoints.length >= 2) {
      const units = polylineLength(draftPoints);
      const metres = pageScale ? units * pageScale.metresPerUnit : null;
      return metres != null
        ? `Length so far ≈ ${metres.toFixed(2)} m — tap Done run when finished.`
        : "Length draft started — Set scale for metres, then Done run.";
    }
    if (studio.tool === "area" && draftPoints.length >= 3) {
      const closePt = draftPoints[0];
      const area = closePt ? polygonArea([...draftPoints, closePt]) : 0;
      const m2 = pageScale ? area * pageScale.metresPerUnit ** 2 : null;
      return m2 != null
        ? `Area so far ≈ ${m2.toFixed(2)} m² — Close area when finished.`
        : "Area draft started — tap near the first corner or Close area.";
    }
    return toolHelp[studio.tool]?.hint || "Choose a tool above, then mark the drawing.";
  })();

  const toolGroups: Array<Array<StudioTool>> = [
    ["pan", "select"],
    ["count", "linear", "area", "rect"],
    ["measure", "scale"],
  ];

  return (
    <div className="nexa-studio-canvas-wrap">
      <div className="nexa-studio-toolbar" role="toolbar" aria-label="Drawing tools">
        {toolGroups.map((group, groupIndex) => (
          <div className="nexa-studio-tool-group" key={group.join("-")} role="group">
            {groupIndex === 0 ? <span className="nexa-studio-tool-group-label">View</span> : null}
            {groupIndex === 1 ? <span className="nexa-studio-tool-group-label">Mark up</span> : null}
            {groupIndex === 2 ? <span className="nexa-studio-tool-group-label">Calibrate</span> : null}
            {group.map((id) => (
              <button
                key={id}
                type="button"
                className={studio.tool === id ? "on" : undefined}
                title={toolHelp[id].title}
                aria-label={toolHelp[id].title}
                onClick={() => setTool(id)}
              >
                {toolHelp[id].label}
              </button>
            ))}
          </div>
        ))}
        <span className="nexa-studio-toolbar-gap" />
        <button type="button" onClick={handleUndo} disabled={!canUndo && !canLocalUndo} aria-label="Undo last mark" title="Undo last mark">
          <Undo2 size={15} />
        </button>
        <button type="button" onClick={() => onRedo?.()} disabled={!canRedo} aria-label="Redo" title="Redo">
          <Redo2 size={15} />
        </button>
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(5, v.scale * 1.15) }))} aria-label="Zoom in" title="Zoom in">
          <ZoomIn size={15} />
        </button>
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.2, v.scale * 0.87) }))} aria-label="Zoom out" title="Zoom out">
          <ZoomOut size={15} />
        </button>
        <button type="button" onClick={() => fitView(pageSize.width, pageSize.height)} title="Fit drawing on screen">Fit</button>
        <div className="nexa-studio-page-nav">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span>Page {page}/{pageCount}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
        {studio.tool === "linear" ? (
          <button type="button" className="accent" onClick={() => finishLinear()} disabled={draftPoints.length < 2}>
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
        <button type="button" onClick={deleteSelected} disabled={!selectedId} title="Delete selected mark">Delete</button>
      </div>

      <p className="nexa-studio-tool-banner">{draftHint}</p>

      <div
        ref={stageRef}
        className={`nexa-studio-stage tool-${studio.tool}${spaceDown ? " space-pan" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {!document ? <div className="nexa-studio-empty">Upload a PDF drawing to start the takeoff.</div> : null}
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
          Drawing scale:{" "}
          {pageScale
            ? `${pageScale.label || "set"}`
            : "not set yet — use Set scale"}
        </span>
        {scaleHints.length && !pageScale ? (
          <div className="nexa-studio-scale-hints" role="group" aria-label="Scale found on drawing">
            <span>Found on sheet:</span>
            {scaleHints.map((hint) => (
              <button key={hint} type="button" className="accent" onClick={() => applyRatioHint(hint)}>
                Use {hint}
              </button>
            ))}
          </div>
        ) : null}
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
              <input inputMode="decimal" value={scaleMetres} onChange={(e) => setScaleMetres(e.target.value)} />
            </label>
            <button type="submit" className="accent">Save scale</button>
          </form>
        ) : null}
        {studio.tool === "measure" && scaleDraft.length === 2 ? (
          <button type="button" onClick={() => setScaleDraft([])}>Clear check</button>
        ) : null}
      </div>
    </div>
  );
}
