"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import {
  buildIsoPreviewScene,
  type IsoOrbit,
} from "@/lib/takeoff-studio-isometric";
import { scaleForPage, type StudioState } from "@/lib/takeoff-studio";

type Props = {
  studio: StudioState;
  document: TakeoffDocument;
  page: number;
  onClose: () => void;
};

type IsoCamera = {
  orbit: IsoOrbit;
  panX: number;
  panY: number;
  zoom: number;
};

const DEFAULT_CAMERA: IsoCamera = {
  orbit: { yawDeg: 0, pitchDeg: 0 },
  panX: 0,
  panY: 0,
  zoom: 1,
};

const PITCH_MIN = -55;
const PITCH_MAX = 55;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 4;

type DragMode =
  | { kind: "orbit"; x: number; y: number; yaw: number; pitch: number }
  | { kind: "pan"; x: number; y: number; panX: number; panY: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function IsoPreviewPanel({ studio, document, page, onClose }: Props) {
  const [camera, setCamera] = useState<IsoCamera>(DEFAULT_CAMERA);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const dragRef = useRef<DragMode | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
    midX: number;
    midY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pageScale = scaleForPage(studio, document.id, page);
  const isoScene = buildIsoPreviewScene(studio, {
    documentId: document.id,
    page,
    metresPerUnit: pageScale?.metresPerUnit || 0,
    orbit: camera.orbit,
  });

  const resetCamera = useCallback(() => setCamera(DEFAULT_CAMERA), []);

  // Fresh camera each time the panel mounts (toggle open).
  useEffect(() => {
    setCamera(DEFAULT_CAMERA);
  }, []);

  // Non-passive wheel so scroll zooms the iso view instead of the page.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = node.getBoundingClientRect();
      const mx = event.clientX - rect.left - rect.width / 2;
      const my = event.clientY - rect.top - rect.height / 2;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setCamera((prev) => {
        const nextZoom = clamp(prev.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        const ratio = nextZoom / prev.zoom;
        return {
          ...prev,
          zoom: nextZoom,
          panX: mx - (mx - prev.panX) * ratio,
          panY: my - (my - prev.panY) * ratio,
        };
      });
    };
    node.addEventListener("wheel", onWheelNative, { passive: false });
    return () => node.removeEventListener("wheel", onWheelNative);
  }, [Boolean(isoScene)]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchRef.current = {
        dist: Math.max(1, dist),
        zoom: cameraRef.current.zoom,
        panX: cameraRef.current.panX,
        panY: cameraRef.current.panY,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      dragRef.current = null;
      return;
    }

    const panMode = event.button === 1 || event.button === 2 || event.shiftKey || event.altKey;
    if (panMode) {
      dragRef.current = {
        kind: "pan",
        x: event.clientX,
        y: event.clientY,
        panX: cameraRef.current.panX,
        panY: cameraRef.current.panY,
      };
    } else {
      dragRef.current = {
        kind: "orbit",
        x: event.clientX,
        y: event.clientY,
        yaw: cameraRef.current.orbit.yawDeg,
        pitch: cameraRef.current.orbit.pitchDeg,
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const nextZoom = clamp(
        pinchRef.current.zoom * (dist / pinchRef.current.dist),
        ZOOM_MIN,
        ZOOM_MAX,
      );
      setCamera((prev) => ({
        ...prev,
        zoom: nextZoom,
        panX: pinchRef.current!.panX + (midX - pinchRef.current!.midX),
        panY: pinchRef.current!.panY + (midY - pinchRef.current!.midY),
      }));
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "orbit") {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      setCamera((prev) => ({
        ...prev,
        orbit: {
          yawDeg: drag.yaw + dx * 0.45,
          pitchDeg: clamp(drag.pitch - dy * 0.35, PITCH_MIN, PITCH_MAX),
        },
      }));
      return;
    }

    setCamera((prev) => ({
      ...prev,
      panX: drag.panX + (event.clientX - drag.x),
      panY: drag.panY + (event.clientY - drag.y),
    }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore if already released
    }
  };

  return (
    <aside className="nexa-studio-iso-panel" aria-label="Isometric route preview">
      <header>
        <strong>Isometric preview</strong>
        <div className="nexa-studio-iso-header-actions">
          <button type="button" onClick={resetCamera} aria-label="Reset isometric view" title="Reset view">
            Reset
          </button>
          <button type="button" onClick={onClose} aria-label="Close isometric preview">
            Close
          </button>
        </div>
      </header>
      {!isoScene ? (
        <p className="nexa-studio-iso-empty">
          No Length runs on this page yet. Use Mark up → Length, tap the run, Done run — then drops show here too.
        </p>
      ) : (
        <>
          <div
            ref={viewportRef}
            className="nexa-studio-iso-viewport"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
            role="application"
            aria-label="Interactive isometric preview"
            title="Drag to rotate · Shift-drag or right-drag to pan · Scroll to zoom"
          >
            <div
              className="nexa-studio-iso-camera"
              style={{
                transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})`,
              }}
            >
              <svg
                className="nexa-studio-iso-svg"
                viewBox={isoScene.viewBox}
                role="img"
                aria-label="Isometric view of completed pipe runs"
              >
                {isoScene.routes.map((route) => (
                  <g key={route.id}>
                    <path
                      d={route.planPath}
                      fill="none"
                      stroke={route.colour}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {route.dropPaths.map((dropPath, index) => (
                      <path
                        key={`${route.id}-drop-${index}`}
                        d={dropPath}
                        fill="none"
                        stroke={route.colour}
                        strokeWidth={2}
                        strokeLinecap="round"
                        opacity={0.85}
                        strokeDasharray="4 3"
                      />
                    ))}
                  </g>
                ))}
              </svg>
            </div>
            <p className="nexa-studio-iso-hint">Drag to rotate · Shift-drag to pan · Scroll to zoom</p>
          </div>
          <ul className="nexa-studio-iso-legend">
            {isoScene.routes.map((route) => (
              <li key={route.id}>
                <span style={{ background: route.colour }} />
                {route.label} · {route.metres.toFixed(2)} m
                {route.dropCount > 0
                  ? ` · ${route.dropCount}× drop`
                  : route.verticalM > 0
                    ? ` · ${route.verticalM.toFixed(1)} m vertical`
                    : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
