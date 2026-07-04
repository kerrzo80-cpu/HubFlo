import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  applyTakeoffExtractionDraft,
  getTakeoffProject,
  type TakeoffDocument,
  type TakeoffExtractionDraft,
  type TakeoffMeasurement,
  type TakeoffPipeRun,
  type TakeoffProject,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

type SurveyDraftPayload = {
  actor?: string;
};

class SurveyDraftInputError extends Error {}

type OpenAiTextContent = { type: "input_text"; text: string };
type OpenAiInputContent =
  | OpenAiTextContent
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; file_data: string; filename: string; detail: "high" };

type OpenAiSurveyPayload = {
  summary: string;
  confidence: "Low" | "Medium" | "High";
  rooms: Array<{
    name: string;
    level: string;
    lengthM: number;
    widthM: number;
    heightM: number;
    areaM2: number;
    heatLoadWatts: number;
    visibleEvidence: string;
    notes: string;
  }>;
  measurements: Array<{
    roomName: string;
    label: string;
    quantity: number;
    unit: string;
  }>;
  pipeRuns: Array<{
    roomName: string;
    service: TakeoffPipeRun["service"];
    route: string;
    diameter: string;
    material: string;
    lengthM: number;
    fittings: number;
    insulation: boolean;
    notes: string;
  }>;
  radiators: Array<{
    roomName: string;
    outputWatts: number;
    model: string;
    quantity: number;
    supplierRequired: boolean;
    notes: string;
  }>;
  materialAllowances: Array<{
    section: string;
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
    markupPercent: number;
    supplierRequired: boolean;
    preferredSupplier: string;
  }>;
  labourAllowances: Array<{
    section: string;
    role: string;
    hours: number;
    costRate: number;
    markupPercent: number;
    notes: string;
  }>;
  supplierRequests: Array<{
    supplier: string;
    description: string;
    quantity: number;
    unit: string;
    notes: string;
  }>;
  riskFlags: string[];
  questions: string[];
};

const OPENAI_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const OPENAI_FILE_LIMIT_COUNT = 12;
const OPENAI_CONVERTED_IMAGE_MAX_EDGE = 2400;
const execFileAsync = promisify(execFile);
const serviceOptions: TakeoffPipeRun["service"][] = [
  "Heating flow/return",
  "Hot water",
  "Cold water",
  "Gas",
  "Waste",
  "Condensate",
  "Other",
];

const surveyQuoteSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "confidence",
    "rooms",
    "measurements",
    "pipeRuns",
    "radiators",
    "materialAllowances",
    "labourAllowances",
    "supplierRequests",
    "riskFlags",
    "questions",
  ],
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "level", "lengthM", "widthM", "heightM", "areaM2", "heatLoadWatts", "visibleEvidence", "notes"],
        properties: {
          name: { type: "string" },
          level: { type: "string" },
          lengthM: { type: "number" },
          widthM: { type: "number" },
          heightM: { type: "number" },
          areaM2: { type: "number" },
          heatLoadWatts: { type: "number" },
          visibleEvidence: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    measurements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "label", "quantity", "unit"],
        properties: {
          roomName: { type: "string" },
          label: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
        },
      },
    },
    pipeRuns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "service", "route", "diameter", "material", "lengthM", "fittings", "insulation", "notes"],
        properties: {
          roomName: { type: "string" },
          service: { type: "string", enum: serviceOptions },
          route: { type: "string" },
          diameter: { type: "string" },
          material: { type: "string" },
          lengthM: { type: "number" },
          fittings: { type: "number" },
          insulation: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    },
    radiators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "outputWatts", "model", "quantity", "supplierRequired", "notes"],
        properties: {
          roomName: { type: "string" },
          outputWatts: { type: "number" },
          model: { type: "string" },
          quantity: { type: "number" },
          supplierRequired: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    },
    materialAllowances: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "description", "quantity", "unit", "unitCost", "markupPercent", "supplierRequired", "preferredSupplier"],
        properties: {
          section: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitCost: { type: "number" },
          markupPercent: { type: "number" },
          supplierRequired: { type: "boolean" },
          preferredSupplier: { type: "string" },
        },
      },
    },
    labourAllowances: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "role", "hours", "costRate", "markupPercent", "notes"],
        properties: {
          section: { type: "string" },
          role: { type: "string" },
          hours: { type: "number" },
          costRate: { type: "number" },
          markupPercent: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    supplierRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["supplier", "description", "quantity", "unit", "notes"],
        properties: {
          supplier: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    riskFlags: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
};

function asText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown) {
  return value === true;
}

function listOfText(values: unknown, limit: number) {
  return Array.isArray(values)
    ? values.map((value) => asText(value, "")).filter(Boolean).slice(0, limit)
    : [];
}

function roomIdForName(roomIds: Map<string, string>, roomName: string) {
  return roomIds.get(roomName.trim().toLowerCase());
}

function normalizeOpenAiPayload(project: TakeoffProject, payload: OpenAiSurveyPayload): TakeoffExtractionDraft {
  const rooms = (Array.isArray(payload.rooms) ? payload.rooms : []).slice(0, 40).map((room, index) => {
    const lengthM = asNumber(room.lengthM);
    const widthM = asNumber(room.widthM);
    const heightM = asNumber(room.heightM);
    const measuredArea = lengthM > 0 && widthM > 0 ? Number((lengthM * widthM).toFixed(2)) : 0;
    const evidence = asText(room.visibleEvidence, "");
    const notes = [asText(room.notes, "Survey AI draft; office review required."), evidence ? `Evidence: ${evidence}` : ""]
      .filter(Boolean)
      .join(" ");

    return {
      id: `openai-survey-room-${project.id}-${index}`,
      name: asText(room.name, `Survey room ${index + 1}`),
      level: asText(room.level, "To confirm"),
      lengthM,
      widthM,
      heightM,
      areaM2: asNumber(room.areaM2, measuredArea) || measuredArea,
      heatLoadWatts: asNumber(room.heatLoadWatts),
      notes,
    };
  });
  const roomIds = new Map(rooms.map((room) => [room.name.trim().toLowerCase(), room.id]));

  return {
    rooms,
    measurements: (Array.isArray(payload.measurements) ? payload.measurements : []).slice(0, 80).map((measurement, index): TakeoffMeasurement => ({
      id: `openai-survey-measure-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, measurement.roomName),
      label: asText(measurement.label, `Survey measurement ${index + 1}`),
      quantity: asNumber(measurement.quantity),
      unit: asText(measurement.unit, "item"),
      source: "Manual",
    })),
    pipeRuns: (Array.isArray(payload.pipeRuns) ? payload.pipeRuns : []).slice(0, 60).map((run, index) => ({
      id: `openai-survey-pipe-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, run.roomName),
      service: serviceOptions.includes(run.service) ? run.service : "Other",
      route: asText(run.route, `Survey route ${index + 1}`),
      diameter: asText(run.diameter, "TBC"),
      material: asText(run.material, "TBC"),
      lengthM: asNumber(run.lengthM),
      fittings: asNumber(run.fittings),
      insulation: asBoolean(run.insulation),
      notes: asText(run.notes, "Survey AI draft; confirm visible route and access."),
    })),
    radiators: (Array.isArray(payload.radiators) ? payload.radiators : []).slice(0, 60).map((radiator, index) => ({
      id: `openai-survey-radiator-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, radiator.roomName),
      roomName: asText(radiator.roomName, "Room to confirm"),
      outputWatts: asNumber(radiator.outputWatts),
      model: asText(radiator.model, "Radiator size/model to confirm"),
      quantity: asNumber(radiator.quantity, 1),
      supplierRequired: asBoolean(radiator.supplierRequired),
      notes: asText(radiator.notes, "Survey AI draft; supplier to confirm output and size."),
    })),
    materialAllowances: (Array.isArray(payload.materialAllowances) ? payload.materialAllowances : []).slice(0, 120).map((material, index) => ({
      id: `openai-survey-material-${project.id}-${index}`,
      section: asText(material.section, "Survey quote materials"),
      description: asText(material.description, `Survey material allowance ${index + 1}`),
      quantity: asNumber(material.quantity, 1),
      unit: asText(material.unit, "item"),
      unitCost: asNumber(material.unitCost),
      markupPercent: asNumber(material.markupPercent, 30),
      supplierRequired: asBoolean(material.supplierRequired),
      preferredSupplier: asText(material.preferredSupplier, ""),
    })),
    labourAllowances: (Array.isArray(payload.labourAllowances) ? payload.labourAllowances : []).slice(0, 40).map((labour, index) => ({
      id: `openai-survey-labour-${project.id}-${index}`,
      section: asText(labour.section, "Survey quote labour"),
      role: asText(labour.role, "Engineer labour"),
      hours: asNumber(labour.hours),
      costRate: asNumber(labour.costRate, 38),
      markupPercent: asNumber(labour.markupPercent, 45),
      notes: asText(labour.notes, "Survey AI draft labour allowance."),
    })),
    supplierRequests: (Array.isArray(payload.supplierRequests) ? payload.supplierRequests : []).slice(0, 60).map((request, index) => ({
      id: `openai-survey-supplier-${project.id}-${index}`,
      supplier: asText(request.supplier, ""),
      description: asText(request.description, `Survey supplier request ${index + 1}`),
      quantity: asNumber(request.quantity, 1),
      unit: asText(request.unit, "item"),
      notes: asText(request.notes, "Confirm price, availability, exclusions and lead time."),
    })),
    riskFlags: listOfText(payload.riskFlags, 30),
    questions: listOfText(payload.questions, 30),
  };
}

function isSurveyDocument(document: TakeoffDocument) {
  return document.kind === "Survey note" || document.kind === "Survey photo" || document.kind === "LiDAR scan";
}

function fileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function imageMimeTypeFromFileName(fileName: string) {
  const extension = fileExtension(fileName);
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  if (extension === ".dng") return "image/x-adobe-dng";
  if (extension === ".tif" || extension === ".tiff") return "image/tiff";
  if (extension === ".json") return "application/json";
  if (extension === ".usd") return "model/vnd.usd";
  if (extension === ".usdz") return "model/vnd.usdz+zip";
  if (extension === ".obj") return "model/obj";
  if (extension === ".glb") return "model/gltf-binary";
  if (extension === ".gltf") return "model/gltf+json";
  return undefined;
}

function imageMimeTypeForDocument(document: TakeoffDocument) {
  return document.mimeType || imageMimeTypeFromFileName(document.fileName);
}

function isDirectOpenAiImage(document: TakeoffDocument) {
  const mimeType = imageMimeTypeForDocument(document);
  return mimeType === "image/jpeg"
    || mimeType === "image/png"
    || mimeType === "image/webp"
    || mimeType === "image/gif";
}

function isDirectOpenAiFile(document: TakeoffDocument) {
  const extension = fileExtension(document.fileName);
  const mimeType = imageMimeTypeForDocument(document);
  return extension === ".json"
    || extension === ".txt"
    || extension === ".csv"
    || extension === ".pdf"
    || mimeType === "application/json"
    || mimeType === "text/plain"
    || mimeType === "application/pdf";
}

function shouldConvertToJpeg(document: TakeoffDocument) {
  const extension = fileExtension(document.fileName);
  const mimeType = imageMimeTypeForDocument(document);
  return isSurveyDocument(document)
    && (
      extension === ".dng"
      || extension === ".jpg"
      || extension === ".jpeg"
      || extension === ".heic"
      || extension === ".heif"
      || extension === ".png"
      || extension === ".tif"
      || extension === ".tiff"
      || mimeType === "image/x-adobe-dng"
      || mimeType === "image/jpeg"
      || mimeType === "image/heic"
      || mimeType === "image/heif"
      || mimeType === "image/png"
      || mimeType === "image/tiff"
    );
}

async function convertImageToJpeg(filePath: string, documentId: string) {
  const outputPath = path.join(os.tmpdir(), `${documentId}-survey-ai.jpg`);
  await execFileAsync(
    "/usr/bin/sips",
    [
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "75",
      "-Z",
      String(OPENAI_CONVERTED_IMAGE_MAX_EDGE),
      filePath,
      "--out",
      outputPath,
    ],
    { timeout: 60000 },
  );
  try {
    return await readFile(outputPath);
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

function storedFilePath(document: TakeoffDocument) {
  if (!document.storageKey) return null;
  const storeDirectory = getServerStoreDirectory();
  const resolved = path.normalize(path.join(storeDirectory, document.storageKey));
  const allowedRoot = path.normalize(`${storeDirectory}${path.sep}`);
  return resolved.startsWith(allowedRoot) ? resolved : null;
}

function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = response && typeof response === "object" && "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";

  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
    return item.content.map((content: unknown) => (
      content && typeof content === "object" && "text" in content && typeof content.text === "string"
        ? content.text
        : ""
    ));
  }).filter(Boolean).join("\n");
}

async function buildOpenAiContent(project: TakeoffProject) {
  const surveyDocuments = project.documents.filter(isSurveyDocument).slice(0, OPENAI_FILE_LIMIT_COUNT);
  const skipped: string[] = [];
  const intro: OpenAiTextContent = {
    type: "input_text",
    text: [
      `Project: ${project.name}`,
      `Customer: ${project.customer}`,
      `Site: ${project.site}`,
      `Scope: ${project.description}`,
      `Survey evidence: ${surveyDocuments.map((document) => `${document.kind}: ${document.fileName}`).join("; ") || "None"}`,
      `Existing rooms in project: ${project.rooms.map((room) => `${room.name} (${room.areaM2}m2, ${room.heatLoadWatts}W)`).join("; ") || "None"}`,
      "Create a conservative draft quote from handwritten site notes and room photos for office review.",
      "Read visible handwriting and labels where possible. If dimensions are written down, populate lengthM, widthM, heightM and areaM2. If a dimension is not visible, use 0 and add a question instead of guessing.",
      "Include likely plumbing/heating materials, radiator allowances, labour hours, supplier-request items, exclusions and access risks. Unit costs are draft allowances only.",
    ].join("\n"),
  };
  const content: OpenAiInputContent[] = [intro];

  let sourceFiles = 0;
  for (const document of surveyDocuments) {
    const filePath = storedFilePath(document);
    if (!filePath) {
      skipped.push(`${document.fileName} was uploaded before file storage was enabled`);
      continue;
    }
    const shouldConvertImage = shouldConvertToJpeg(document);
    if ((document.size ?? 0) > OPENAI_FILE_LIMIT_BYTES && !shouldConvertImage) {
      skipped.push(`${document.fileName} is over the OpenAI pilot scan limit`);
      continue;
    }

    try {
      const mimeType = imageMimeTypeForDocument(document) || "application/octet-stream";
      if (shouldConvertImage) {
        try {
          const jpegBuffer = await convertImageToJpeg(filePath, document.id);
          if (jpegBuffer.length > OPENAI_FILE_LIMIT_BYTES) {
            skipped.push(`${document.fileName} converted for AI but is still too large. Export it as a smaller JPG/PNG and re-upload if this repeats.`);
            continue;
          }
          const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
          content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
        } catch {
          skipped.push(`${document.fileName} could not be converted to JPEG for AI. Export it as JPG/PNG and re-upload if this repeats.`);
          continue;
        }
      } else if (isDirectOpenAiImage(document)) {
        const buffer = await readFile(filePath);
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
      } else if (isDirectOpenAiFile(document)) {
        const buffer = await readFile(filePath);
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        content.push({ type: "input_file", file_data: dataUrl, filename: document.fileName, detail: "high" });
      } else {
        skipped.push(`${document.fileName} is stored as LiDAR evidence but is not sent to AI until a RoomPlan/3D parser is connected`);
        continue;
      }
      sourceFiles += 1;
    } catch {
      skipped.push(`${document.fileName} could not be read from local storage`);
    }
  }

  if (skipped.length) {
    intro.text = `${intro.text}\nSkipped files: ${skipped.join("; ")}`;
  }

  return { content, sourceFiles, surveyDocuments };
}

async function runOpenAiSurveyDraft(project: TakeoffProject, actor: string, apiKey: string, model: string) {
  const { content, sourceFiles, surveyDocuments } = await buildOpenAiContent(project);
  if (surveyDocuments.length === 0) {
    throw new SurveyDraftInputError("Upload handwritten notes or room photos in Survey quote before drafting.");
  }
  if (sourceFiles === 0) {
    throw new SurveyDraftInputError("OpenAI is connected, but no AI-ready survey files are stored. Re-upload the notes/photos, then run AI draft quote again.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: "You are a UK plumbing and heating estimating assistant for NeXa. Turn site survey notes/photos into a conservative draft quote for office review. Never present uncertain photo-based quantities as final measurements. Put uncertainty into riskFlags and questions.",
          }],
        },
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nexa_survey_quote_draft",
          strict: true,
          schema: surveyQuoteSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI survey draft failed (${response.status}). Check OPENAI_API_KEY and NEXA_TAKEOFF_OPENAI_MODEL.`);
  }

  const body = await response.json();
  const outputText = getOutputText(body);
  if (!outputText) {
    throw new Error("OpenAI did not return survey quote JSON.");
  }

  const payload = JSON.parse(outputText) as OpenAiSurveyPayload;
  const draft = normalizeOpenAiPayload(project, payload);
  return applyTakeoffExtractionDraft(project.id, draft, {
    actor,
    provider: "OpenAI",
    model,
    summary: payload.summary,
    confidence: payload.confidence,
    documentNote: "OpenAI survey quote draft created from stored notes/photos; office review still required.",
    sourceFiles,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SurveyDraftPayload>(request);
  const { id } = await params;
  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Survey quote";
  const openAiConfig = getTakeoffOpenAiConfig();
  const project = getTakeoffProject(id);

  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }
  if (!openAiConfig.apiKey) {
    return NextResponse.json({ error: "Connect OpenAI before running a survey quote draft." }, { status: 400 });
  }

  try {
    const result = await runOpenAiSurveyDraft(project, actor, openAiConfig.apiKey, openAiConfig.model);
    if (!result) {
      return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run OpenAI survey quote draft" },
      { status: error instanceof SurveyDraftInputError ? 400 : 502 },
    );
  }
}
