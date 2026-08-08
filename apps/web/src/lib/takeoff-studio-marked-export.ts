/** Build marked-up SVG drawings from Studio geometry — master + per service layer. */

import {
  classificationLayer,
  polylineLength,
  polygonArea,
  scaleForPage,
  STUDIO_SERVICE_LAYERS,
  type StudioGeometry,
  type StudioServiceLayerId,
  type StudioState,
} from "@/lib/takeoff-studio";

export type StudioExportLayerId = StudioServiceLayerId | "all";

export type StudioMarkedSnapshot = {
  layerId: StudioExportLayerId;
  layerLabel: string;
  geometries: StudioGeometry[];
  documentId: string;
  page: number;
  width: number;
  height: number;
};

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function studioLayerLabel(layerId: StudioExportLayerId) {
  if (layerId === "all") return "Master all layers";
  return STUDIO_SERVICE_LAYERS.find((row) => row.id === layerId)?.label || layerId;
}

export function geometriesForStudioLayer(
  studio: StudioState,
  layerId: StudioExportLayerId,
  options?: { documentId?: string; page?: number },
) {
  return studio.geometries.filter((geo) => {
    if (options?.documentId && geo.documentId !== options.documentId) return false;
    if (options?.page && geo.page !== options.page) return false;
    if (layerId === "all") return true;
    const cls = studio.classifications.find((row) => row.id === geo.classificationId);
    if (!cls) return false;
    return classificationLayer(cls) === layerId;
  });
}

export function buildStudioMarkedSnapshot(
  studio: StudioState,
  layerId: StudioExportLayerId,
  options: {
    documentId: string;
    page: number;
    width: number;
    height: number;
  },
): StudioMarkedSnapshot {
  return {
    layerId,
    layerLabel: studioLayerLabel(layerId),
    geometries: geometriesForStudioLayer(studio, layerId, {
      documentId: options.documentId,
      page: options.page,
    }),
    documentId: options.documentId,
    page: options.page,
    width: options.width,
    height: options.height,
  };
}

export function layersWithStudioMarks(
  studio: StudioState,
  options?: { documentId?: string; page?: number },
): StudioExportLayerId[] {
  return STUDIO_SERVICE_LAYERS
    .map((layer) => layer.id)
    .filter((layerId) => geometriesForStudioLayer(studio, layerId, options).length > 0);
}

function geometrySvg(geo: StudioGeometry, colour: string) {
  const stroke = escapeSvg(colour);
  if (geo.kind === "count") {
    return `<circle cx="${geo.point.x}" cy="${geo.point.y}" r="11" fill="${stroke}" fill-opacity="0.85" stroke="#fff" stroke-width="2" />`;
  }
  if (geo.kind === "linear") {
    const points = geo.points.map((point) => `${point.x},${point.y}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (geo.kind === "area" && geo.points.length >= 3) {
    const points = geo.points.map((point) => `${point.x},${point.y}`).join(" ");
    return `<polygon points="${points}" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="2" />`;
  }
  return "";
}

function buildLegend(
  studio: StudioState,
  geometries: StudioGeometry[],
  width: number,
  height: number,
) {
  const byClass = new Map<string, { colour: string; label: string; lengthM: number; count: number; kind: string }>();
  for (const geo of geometries) {
    const cls = studio.classifications.find((row) => row.id === geo.classificationId);
    if (!cls) continue;
    const current = byClass.get(cls.id) || {
      colour: cls.colour,
      label: cls.name,
      lengthM: 0,
      count: 0,
      kind: cls.kind,
    };
    current.count += 1;
    const scale = scaleForPage(studio, geo.documentId, geo.page);
    const mpu = scale?.metresPerUnit || 0;
    if (geo.kind === "linear" && mpu) current.lengthM += polylineLength(geo.points) * mpu;
    if (geo.kind === "area" && geo.closed && mpu) current.lengthM += polygonArea(geo.points) * mpu * mpu;
    byClass.set(cls.id, current);
  }
  const entries = [...byClass.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (!entries.length) return { height: 48, svg: "" };

  const rows = entries.map((entry, index) => {
    const y = height + 28 + index * 16;
    const qty = entry.kind === "linear" && entry.lengthM > 0
      ? `${entry.lengthM.toFixed(1)} m`
      : entry.kind === "area" && entry.lengthM > 0
        ? `${entry.lengthM.toFixed(1)} m²`
        : `×${entry.count}`;
    return `<g><line x1="28" x2="46" y1="${y - 4}" y2="${y - 4}" stroke="${escapeSvg(entry.colour)}" stroke-width="3" stroke-linecap="round" /><text x="54" y="${y}" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-size="11" font-weight="700" fill="#143044">${escapeSvg(`${entry.label} ${qty}`)}</text></g>`;
  }).join("");

  const boxHeight = entries.length * 16 + 36;
  return {
    height: boxHeight + 24,
    svg: `<g><rect x="16" y="${height + 8}" width="${Math.min(width - 32, 420)}" height="${boxHeight}" rx="8" fill="#fff" stroke="#c6dde8" /><text x="28" y="${height + 26}" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-size="11" font-weight="800" fill="#102a43">Drawing key</text>${rows}</g>`,
  };
}

/** SVG marked drawing for one layer (or master). Optional PDF page as data URL background. */
export function buildStudioMarkedDrawingSvg(
  studio: StudioState,
  snapshot: StudioMarkedSnapshot,
  options: {
    projectReference: string;
    drawingFileName?: string;
    backgroundDataUrl?: string;
  },
) {
  const { width, height } = snapshot;
  const background = options.backgroundDataUrl
    ? `<image href="${escapeSvg(options.backgroundDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.92" />`
    : `<rect x="0" y="0" width="${width}" height="${height}" fill="#f4f7f9" /><text x="28" y="40" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-size="16" font-weight="700" fill="#5f7583">${escapeSvg(options.drawingFileName || "Drawing")}</text>`;

  const marks = snapshot.geometries.map((geo) => {
    const cls = studio.classifications.find((row) => row.id === geo.classificationId);
    return geometrySvg(geo, cls?.colour || "#1998cf");
  }).join("");

  const legend = buildLegend(studio, snapshot.geometries, width, height);
  const footerHeight = Math.max(56, legend.height);
  const exportHeight = height + footerHeight;
  const title = `${options.projectReference} · ${snapshot.layerLabel} · page ${snapshot.page}`;
  const footer = `<rect x="0" y="${height}" width="${width}" height="${footerHeight}" fill="#ffffff" /><line x1="0" x2="${width}" y1="${height}" y2="${height}" stroke="#d8e7ef" /><text x="28" y="${height + 22}" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-size="13" font-weight="700" fill="#102a43">${escapeSvg(title)}</text>${legend.svg}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${exportHeight}" viewBox="0 0 ${width} ${exportHeight}">${background}${marks}${footer}</svg>`;
}

export function markedDrawingFileName(
  projectReference: string,
  drawingFileName: string,
  layerLabel: string,
  page: number,
) {
  const base = drawingFileName.replace(/\.[^/.]+$/, "") || "drawing";
  const raw = `${projectReference}-${base}-p${page}-${layerLabel}`;
  return `${raw.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.svg`;
}

/** Render a PDF page to a PNG data URL for marked-drawing backgrounds. */
export async function renderTakeoffPdfPageDataUrl(
  projectId: string,
  documentId: string,
  pageNumber: number,
  targetWidth: number,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const response = await fetch(
      `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/file`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false }).promise;
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, Math.max(1, targetWidth / Math.max(base.width, 1)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}
