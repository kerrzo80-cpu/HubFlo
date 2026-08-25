"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Layers,
  MapPin,
  MessageCircle,
  PackagePlus,
  Phone,
  ShoppingCart,
  Video,
  Wrench,
} from "lucide-react";
import { ProgrammeBoard } from "@/components/field/ProgrammeBoard";
import { DayworkSheetForm } from "@/components/field/DayworkSheetForm";
import { useNexaClient } from "@/lib/field/nexa";
import { toggleMockRequirement } from "@/lib/field/nexa/mock-data";
import {
  dayworkSheetListLabel,
  formatFieldDayworkEvidenceSummary,
  isDayworkRequirement,
  isDayworkSubmittedToCore,
  isValidDayworkClientEmail,
  sortDayworkSheetsByNumber,
  type DayworkAccountRecord,
} from "@/lib/daywork-account-form";
import { formatDuration, mapsUrl } from "@/lib/field/format";
import { fieldPath } from "@/lib/field/routes";
import type {
  FieldAttachment,
  FieldEvidenceType,
  FieldJobStatus,
  FieldRequirement,
  FieldScheduleItem,
} from "@/lib/field/types";
import { isoDateToUk, toDateInputValue, toUkDateDisplay } from "@/lib/uk-date";

type FieldDayworkSheet = DayworkAccountRecord & { costCentreId?: string; updatedAt?: string };

type FieldWorkflowNote = {
  id: string;
  text: string;
  visibility: string;
  createdBy: string;
  createdAt: string;
};

type FieldWorkflowPoRequest = {
  id: string;
  poNumber?: string;
  supplier: string;
  note: string;
  costCentreName?: string;
  createdBy: string;
  createdAt: string;
  status: string;
};

type FieldWorkflowOutcome = {
  status: "Complete" | "Needs parts" | "Needs rebooked" | "Could not access" | "Office review required";
  note: string;
  createdBy: string;
  createdAt: string;
};

type FieldWorkflowState = {
  photos: FieldAttachment[];
  notes: FieldWorkflowNote[];
  poRequests: FieldWorkflowPoRequest[];
  outcome: FieldWorkflowOutcome | null;
};

function requirementsLookLikeDaywork(requirements: FieldRequirement[]) {
  return requirements.some((item) => isDayworkRequirement(item));
}

type Tab = "pack" | "checklist" | "photos" | "po";

type DraftValue = {
  text?: string;
  numberValue?: string;
  photoName?: string;
};

function evidenceTypeOf(item: FieldRequirement): FieldEvidenceType {
  return item.evidence || "Checkbox";
}

function validateRequirementDraft(item: FieldRequirement, draft: DraftValue): string | null {
  const evidenceType = evidenceTypeOf(item);
  if (evidenceType === "Checkbox") return null;

  const raw =
    evidenceType === "Number"
      ? draft.numberValue?.trim() || ""
      : evidenceType === "Photo"
        ? draft.photoName?.trim() || ""
        : draft.text?.trim() || "";

  if (!raw) {
    if (evidenceType === "Photo") return `Add a photo for “${item.label}” before saving.`;
    if (evidenceType === "Number") return `Enter a number for “${item.label}” before saving.`;
    return `Enter a value for “${item.label}” before saving.`;
  }

  const validation = item.validation;
  if (!validation) return null;

  if (validation.inputKind === "date") {
    const uk = toUkDateDisplay(raw);
    if (!/^\d{2}-\d{2}-\d{4}$/.test(uk)) {
      return `“${item.label}” must be a valid UK date (DD-MM-YYYY).`;
    }
    return null;
  }

  const compact = raw.replace(/\s+/g, "");
  if (typeof validation.exactDigits === "number") {
    const digits = compact.replace(/\D/g, "");
    if (digits.length !== validation.exactDigits || digits.length !== compact.length) {
      return `“${item.label}” must be exactly ${validation.exactDigits} digits (you entered ${digits.length || 0}).`;
    }
  }
  if (typeof validation.minLength === "number" && compact.length < validation.minLength) {
    return `“${item.label}” must be at least ${validation.minLength} characters.`;
  }
  if (typeof validation.maxLength === "number" && compact.length > validation.maxLength) {
    return `“${item.label}” must be no more than ${validation.maxLength} characters.`;
  }
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(raw) && !regex.test(compact)) {
        return validation.helpText
          ? `“${item.label}” is not valid. ${validation.helpText}`
          : `“${item.label}” is not in the required format.`;
      }
    } catch {
      // Ignore bad patterns.
    }
  }
  return null;
}

function doneSummary(item: FieldRequirement) {
  const textRaw =
    item.validation?.inputKind === "date"
      ? toUkDateDisplay(item.value?.text)
      : formatFieldDayworkEvidenceSummary(item.label, item.value?.text || "");
  const parts = [textRaw, item.value?.numberValue, item.value?.photoName]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

function attachmentKindFromFile(file: File): FieldAttachment["type"] {
  const lower = `${file.type} ${file.name}`.toLowerCase();
  if (lower.includes("video") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) return "Video";
  if (lower.includes("pdf") || /\.(pdf|docx?|xlsx?|txt)$/i.test(file.name)) return "PDF";
  return "Photo";
}

function outcomeToJobStatus(status: FieldWorkflowOutcome["status"]): FieldJobStatus | null {
  if (status === "Complete") return "Complete";
  if (status === "Needs parts") return "Needs parts";
  return null;
}

export default function JobDetailPage() {
  const params = useParams<{ scheduleId: string }>();
  const searchParams = useSearchParams();
  const client = useNexaClient();
  const [job, setJob] = useState<FieldScheduleItem | null>(null);
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftByRequirement, setDraftByRequirement] = useState<Record<string, DraftValue>>({});
  const [editingId, setEditingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "pack";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [checklistMode, setChecklistMode] = useState<"job" | "daywork">("job");
  const [dayworkBusy, setDayworkBusy] = useState(false);
  const [dayworkRecord, setDayworkRecord] = useState<DayworkAccountRecord | null>(null);
  const [dayworkCostCentreId, setDayworkCostCentreId] = useState("");
  const [dayworkSheets, setDayworkSheets] = useState<FieldDayworkSheet[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflow, setWorkflow] = useState<FieldWorkflowState>({
    photos: [],
    notes: [],
    poRequests: [],
    outcome: null,
  });
  const [noteText, setNoteText] = useState("");
  const [poSupplier, setPoSupplier] = useState("");
  const [poSupplierEmail, setPoSupplierEmail] = useState("");
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poSupplierQuery, setPoSupplierQuery] = useState("");
  const [poSupplierOpen, setPoSupplierOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; name: string; email?: string; account?: string; category?: string }>
  >([]);
  const [poNote, setPoNote] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const orderedDayworkSheets = useMemo(() => {
    if (!job?.jobId) return dayworkSheets;
    return sortDayworkSheetsByNumber(
      job.jobId,
      dayworkSheets.filter((sheet): sheet is FieldDayworkSheet & { costCentreId: string } =>
        Boolean(sheet.costCentreId),
      ),
    );
  }, [dayworkSheets, job?.jobId]);

  const canComplete = useMemo(() => {
    if (!job) return false;
    // Daywork sheets never gate job Complete — including Handover signature steps
    // whose stage is not "Daywork" but whose stepId/id is daywork-scoped.
    return !job.requirements.some(
      (item) => item.status === "missing" && !isDayworkRequirement(item),
    );
  }, [job]);

  const filteredSuppliers = useMemo(() => {
    const query = poSupplierQuery.trim().toLowerCase();
    if (!query) return suppliers.slice(0, 8);
    return suppliers
      .filter((supplier) => {
        const haystack = [supplier.name, supplier.account, supplier.category, supplier.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [poSupplierQuery, suppliers]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/field/suppliers", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          suppliers?: Array<{ id: string; name: string; email?: string; account?: string; category?: string }>;
        };
        if (!cancelled && Array.isArray(body.suppliers)) {
          setSuppliers(body.suppliers);
        }
      })
      .catch(() => {
        // Supplier directory optional until Core People → Suppliers is populated.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setSessionError("Not signed in — Daywork Save will not reach Core. Open /login, sign in, then come back.");
          return;
        }
        setSessionError("");
      })
      .catch(() => {
        if (!cancelled) setSessionError("Could not verify sign-in — Save may fail until you refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.scheduleId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const item = await client.getJob(params.scheduleId);
        if (cancelled) return;
        if (!item) {
          setError("Job not found on the schedule.");
          return;
        }
        const schedule = await client.getScheduleForDate(item.date);
        if (cancelled) return;
        setJob(item);
        setJobs(schedule);
        setError("");

        if (client.getConnection().mode === "nexa") {
          const response = await fetch(
            `/api/field/jobs/${encodeURIComponent(item.scheduleId)}/requirements`,
            { credentials: "include", cache: "no-store" },
          );
          let serverChecklistMode: "job" | "daywork" = "job";
          let serverDayworkCostCentreId = "";
          if (response.ok) {
            const body = (await response.json()) as {
              requirements?: FieldRequirement[];
              checklistMode?: "job" | "daywork";
              dayworkCostCentreId?: string | null;
            };
            if (!cancelled && body.requirements?.length) {
              setJob({ ...item, requirements: body.requirements });
            }
            if (body.checklistMode === "daywork" || requirementsLookLikeDaywork(body.requirements || [])) {
              serverChecklistMode = "daywork";
            }
            serverDayworkCostCentreId = String(body.dayworkCostCentreId || "").trim();
          }

          const dayworkResponse = await fetch(
            `/api/field/jobs/${encodeURIComponent(item.scheduleId)}/daywork?list=1`,
            { credentials: "include", cache: "no-store" },
          );
          let listedDayworkSheets: FieldDayworkSheet[] = [];
          if (dayworkResponse.ok) {
            const dayworkBody = (await dayworkResponse.json()) as { sheets?: FieldDayworkSheet[] };
            if (!cancelled && Array.isArray(dayworkBody.sheets)) {
              listedDayworkSheets = dayworkBody.sheets;
              setDayworkSheets(dayworkBody.sheets);
            }
          }

          const workflowResponse = await fetch(
            `/api/field/jobs/${encodeURIComponent(item.scheduleId)}/workflow`,
            { credentials: "include", cache: "no-store" },
          );
          if (workflowResponse.ok) {
            const body = (await workflowResponse.json()) as FieldWorkflowState;
            if (!cancelled) {
              setWorkflow({
                photos: body.photos ?? [],
                notes: body.notes ?? [],
                poRequests: body.poRequests ?? [],
                outcome: body.outcome ?? null,
              });
              const mapped = body.outcome ? outcomeToJobStatus(body.outcome.status) : null;
              if (mapped) {
                setJob((current) => (current ? { ...current, status: mapped } : current));
              }
            }
          }

          // Only auto-reopen an in-progress Daywork. Submitted sheets stay as Daywork 1/2/3 labels.
          if (!cancelled && serverChecklistMode === "daywork") {
            const targetId = serverDayworkCostCentreId;
            const targetSheet = targetId
              ? listedDayworkSheets.find((sheet) => sheet.costCentreId === targetId)
              : listedDayworkSheets[0];
            if (targetSheet && isDayworkSubmittedToCore(targetSheet)) {
              await fetch(`/api/field/jobs/${encodeURIComponent(item.scheduleId)}/daywork`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "clear" }),
              }).catch(() => undefined);
              setChecklistMode("job");
              setDayworkRecord(null);
              setDayworkCostCentreId("");
            } else {
              await openDayworkSheet({
                job: item,
                costCentreId: serverDayworkCostCentreId || undefined,
                quiet: true,
              });
            }
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load job.");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, params.scheduleId]);

  async function runWorkflowAction(
    action: "add_photos" | "add_note" | "request_po" | "set_outcome",
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    if (!job) return false;
    if (client.getConnection().mode !== "nexa") {
      setNotice(`${successMessage} (demo)`);
      return true;
    }
    setWorkflowBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(job.scheduleId)}/workflow`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload: { ...payload, createdBy: job.engineerName },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as FieldWorkflowState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update job.");
      setWorkflow({
        photos: body.photos ?? [],
        notes: body.notes ?? [],
        poRequests: body.poRequests ?? [],
        outcome: body.outcome ?? null,
      });
      if (action === "set_outcome" && body.outcome) {
        const mapped = outcomeToJobStatus(body.outcome.status);
        if (mapped) setJob((current) => (current ? { ...current, status: mapped } : current));
      }
      if (action === "add_photos" && body.photos?.length) {
        setJob((current) =>
          current
            ? {
                ...current,
                photos: [
                  ...body.photos.filter((photo) => photo.type === "Photo" || photo.type === "Video"),
                  ...current.photos.filter((photo) => !body.photos.some((item) => item.id === photo.id)),
                ],
              }
            : current,
        );
      }
      setNotice(successMessage);
      return true;
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : "Could not update job.");
      return false;
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const mapped = files.slice(0, 10).map((file) => ({
      name: file.name,
      type: attachmentKindFromFile(file),
    }));
    await runWorkflowAction(
      "add_photos",
      { files: mapped },
      `${mapped.length} file${mapped.length === 1 ? "" : "s"} sent to office.`,
    );
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!noteText.trim()) return;
    const saved = await runWorkflowAction(
      "add_note",
      { text: noteText, visibility: "Office review" },
      "Note sent to office.",
    );
    if (saved) setNoteText("");
  }

  async function submitPoRequest(event: FormEvent) {
    event.preventDefault();
    if (!job || !poNote.trim()) return;
    const selected =
      (poSupplierId
        ? suppliers.find((item) => item.id === poSupplierId)
        : undefined) ||
      suppliers.find((item) => item.name.toLowerCase() === poSupplier.trim().toLowerCase());
    if (!selected) {
      setError("Pick a supplier from the Core list — start typing, then tap the match.");
      return;
    }
    const saved = await runWorkflowAction(
      "request_po",
      {
        supplier: selected.name,
        supplierEmail: selected.email || poSupplierEmail || undefined,
        note: poNote,
        jobRef: job.jobRef,
        costCentreName: job.costCentre,
      },
      `PO request sent for ${job.jobRef} · ${selected.name}.`,
    );
    if (saved) {
      setPoSupplier("");
      setPoSupplierEmail("");
      setPoSupplierId("");
      setPoSupplierQuery("");
      setPoNote("");
    }
  }

  function selectPoSupplier(supplier: {
    id: string;
    name: string;
    email?: string;
  }) {
    setPoSupplier(supplier.name);
    setPoSupplierQuery(supplier.name);
    setPoSupplierId(supplier.id);
    setPoSupplierEmail(supplier.email || "");
    setPoSupplierOpen(false);
    setError("");
  }

  async function openDayworkSheet(options?: {
    fresh?: boolean;
    costCentreId?: string;
    quiet?: boolean;
    job?: FieldScheduleItem;
  }) {
    const activeJob = options?.job || job;
    if (!activeJob) return;
    setDayworkBusy(true);
    setError("");
    if (!options?.quiet) setNotice("");
    try {
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(activeJob.scheduleId)}/daywork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: options?.fresh ? "new" : "activate",
          ...(options?.costCentreId && !options.fresh ? { costCentreId: options.costCentreId } : {}),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        requirements?: FieldRequirement[];
        costCentreName?: string;
        costCentreId?: string;
        record?: DayworkAccountRecord | null;
        sheets?: FieldDayworkSheet[];
      };
      if (response.status === 401) {
        throw new Error("Not signed in — open /login, sign in, then try Add Daywork Account again.");
      }
      if (!response.ok) throw new Error(body.error || "Could not open daywork sheet.");
      if (body.sheets) setDayworkSheets(body.sheets);

      // Submitted sheets are listed only — don’t pull the full form again.
      if (!options?.fresh && isDayworkSubmittedToCore(body.record)) {
        const openedLabel =
          body.costCentreId || options?.costCentreId
            ? dayworkSheetListLabel(activeJob.jobId, body.costCentreId || options?.costCentreId || "")
            : "Daywork";
        setChecklistMode("job");
        setDayworkRecord(null);
        setDayworkCostCentreId("");
        setTab("pack");
        if (!options?.quiet) {
          setNotice(`${openedLabel} is submitted — shown as a label only. Office edits it in Core.`);
        }
        return;
      }

      setChecklistMode("daywork");
      setTab("checklist");
      setDayworkRecord(options?.fresh ? null : body.record || null);
      setDayworkCostCentreId(body.costCentreId || options?.costCentreId || "");
      if (body.requirements) {
        setJob((current) => {
          const base = current || activeJob;
          return {
            ...base,
            requirements: body.requirements!,
            costCentre: body.costCentreName || "Daywork account",
          };
        });
      }
      if (options?.quiet) return;
      const openedLabel =
        body.costCentreId || options?.costCentreId
          ? dayworkSheetListLabel(activeJob.jobId, body.costCentreId || options?.costCentreId || "")
          : "Daywork";
      setNotice(
        options?.fresh
          ? "New Daywork sheet open — fill Mon–Sun hours, materials and both signatures, then Save and finish. Or Discard if opened by mistake."
          : options?.costCentreId
            ? `${openedLabel} open — edit hours/materials/signatures if needed, then Save and finish. Discard if this sheet was opened by mistake.`
            : "Daywork Account open — enter Mon–Sun hours, materials and both signatures.",
      );
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open daywork sheet.");
    } finally {
      setDayworkBusy(false);
    }
  }

  async function backToJobChecklist(options?: { quiet?: boolean }) {
    if (!job) return null;
    setDayworkBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(job.scheduleId)}/daywork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const body = (await response.json()) as {
        requirements?: FieldRequirement[];
        sheets?: FieldDayworkSheet[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not leave daywork sheet.");
      setChecklistMode("job");
      setDayworkRecord(null);
      setDayworkCostCentreId("");
      if (Array.isArray(body.sheets)) setDayworkSheets(body.sheets);
      let nextRequirements = body.requirements;
      if (nextRequirements) {
        setJob((current) => (current ? { ...current, requirements: nextRequirements! } : current));
      } else {
        const item = await client.getJob(job.scheduleId);
        if (item) {
          setJob(item);
          nextRequirements = item.requirements;
        }
      }
      if (!options?.quiet) setNotice("Back on the job checklist.");
      return nextRequirements || null;
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "Could not leave daywork sheet.");
      return null;
    } finally {
      setDayworkBusy(false);
    }
  }

  async function discardDayworkSheet(costCentreId: string) {
    if (!job || !costCentreId) return;
    const label = dayworkSheetListLabel(job.jobId, costCentreId);
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Discard ${label}? This removes the in-progress Daywork opened by mistake. Submitted Dayworks stay locked.`)
    ) {
      return;
    }
    setDayworkBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(job.scheduleId)}/daywork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard", costCentreId }),
      });
      const body = (await response.json()) as {
        error?: string;
        requirements?: FieldRequirement[];
        sheets?: FieldDayworkSheet[];
      };
      if (!response.ok) throw new Error(body.error || "Could not discard Daywork.");
      setChecklistMode("job");
      setDayworkRecord(null);
      setDayworkCostCentreId("");
      if (Array.isArray(body.sheets)) setDayworkSheets(body.sheets);
      if (body.requirements) {
        setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
      } else {
        const item = await client.getJob(job.scheduleId);
        if (item) setJob(item);
      }
      setTab("pack");
      setNotice(`${label} discarded — back on the job checklist. You can Mark complete when job stop/go items are done.`);
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "Could not discard Daywork.");
    } finally {
      setDayworkBusy(false);
    }
  }

  async function emailDayworkClientCopy(costCentreId: string, presetEmail?: string) {
    if (!job || !costCentreId) return;
    const label = dayworkSheetListLabel(job.jobId, costCentreId);
    const sheet = orderedDayworkSheets.find((item) => item.costCentreId === costCentreId);
    const suggested = String(presetEmail || sheet?.clientEmail || "").trim();
    const entered =
      typeof window !== "undefined"
        ? window.prompt(`Email ${label} client copy (hours & materials only) to:`, suggested)
        : suggested;
    if (entered === null) return;
    const email = entered.trim();
    if (!isValidDayworkClientEmail(email)) {
      setError("Enter a valid client email address to send the Daywork copy.");
      return;
    }
    setDayworkBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(job.scheduleId)}/daywork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_copy",
          costCentreId,
          clientEmail: email,
          createdBy: job.engineerName,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        clientEmail?: string;
        sheets?: FieldDayworkSheet[];
      };
      if (!response.ok) throw new Error(body.error || "Could not email Daywork copy.");
      if (Array.isArray(body.sheets)) setDayworkSheets(body.sheets);
      setNotice(`${label} client copy emailed to ${body.clientEmail || email} (no costs).`);
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Could not email Daywork copy.");
    } finally {
      setDayworkBusy(false);
    }
  }

  async function setOutcome(status: FieldWorkflowOutcome["status"]) {
    if (status === "Complete") {
      // Leave a mistaken open Daywork first so we evaluate the real job checklist.
      let requirements = job?.requirements || [];
      if (checklistMode === "daywork") {
        const restored = await backToJobChecklist({ quiet: true });
        if (restored) requirements = restored;
      }
      const blocked = requirements.some((item) => item.status === "missing" && !isDayworkRequirement(item));
      if (blocked) {
        setError("Cannot mark complete yet. Finish required checklist items first.");
        setTab("checklist");
        return;
      }
    }
    await runWorkflowAction(
      "set_outcome",
      { status, note: outcomeNote },
      status === "Needs parts" ? "Marked awaiting parts — office notified." : `${status} sent to office.`,
    );
  }

  async function reopenRequirement(requirementId: string) {
    if (!job) return;
    setSavingId(requirementId);
    setError("");
    try {
      if (client.getConnection().mode === "nexa") {
        const response = await fetch(
          `/api/field/jobs/${encodeURIComponent(job.scheduleId)}/requirements`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requirementId,
              reopen: true,
              createdBy: job.engineerName,
            }),
          },
        );
        if (!response.ok) {
          const failed = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(failed.error || "Could not reopen checklist item.");
        }
        const body = (await response.json()) as { requirements?: FieldRequirement[] };
        if (body.requirements) {
          setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
        }
      } else {
        setJob(toggleMockRequirement(job.scheduleId, requirementId));
      }
      setEditingId(requirementId);
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "Could not reopen checklist item.");
    } finally {
      setSavingId("");
    }
  }

  async function saveRequirement(requirementId: string) {
    if (!job) return;
    const requirement = job.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;

    const draft = draftByRequirement[requirementId] || {};
    const connection = client.getConnection();
    const normalizedDraft = {
      ...draft,
      text:
        requirement.validation?.inputKind === "date" && draft.text
          ? toUkDateDisplay(draft.text)
          : draft.text,
    };
    const validationError = validateRequirementDraft(requirement, normalizedDraft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setNotice("");
    setSavingId(requirementId);

    if (connection.mode === "nexa") {
      const optimisticValue = {
        text: normalizedDraft.text,
        numberValue: normalizedDraft.numberValue,
        photoName: normalizedDraft.photoName,
        capturedAt: new Date().toISOString(),
      };
      setJob({
        ...job,
        requirements: job.requirements.map((item) =>
          item.id === requirementId
            ? { ...item, status: "done", value: optimisticValue }
            : item,
        ),
      });
      try {
        const response = await fetch(
          `/api/field/jobs/${encodeURIComponent(job.scheduleId)}/requirements`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requirementId,
              text: normalizedDraft.text,
              numberValue: normalizedDraft.numberValue,
              photoName: normalizedDraft.photoName,
              createdBy: job.engineerName,
            }),
          },
        );
        if (!response.ok) {
          const failed = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(failed.error || "Could not save checklist item.");
        }
        const body = (await response.json()) as { requirements?: FieldRequirement[] };
        if (body.requirements) {
          setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
        }
        setDraftByRequirement((current) => {
          const next = { ...current };
          delete next[requirementId];
          return next;
        });
        setEditingId("");
        setNotice("Saved.");
      } catch (saveError) {
        setJob(job);
        setError(saveError instanceof Error ? saveError.message : "Could not save checklist item.");
      } finally {
        setSavingId("");
      }
      return;
    }

    try {
      setJob(toggleMockRequirement(job.scheduleId, requirementId));
      setEditingId("");
      setNotice("Marked complete (demo).");
    } catch {
      // Demo-only toggle.
    } finally {
      setSavingId("");
    }
  }

  const drawings = useMemo(
    () => job?.attachments.filter((item) => item.type === "Drawing" || item.type === "PDF") ?? [],
    [job],
  );
  const photos = useMemo(() => {
    const packPhotos = [
      ...(job?.photos ?? []),
      ...(job?.attachments.filter((item) => item.type === "Photo" || item.type === "Video") ?? []),
    ];
    const workflowPhotos = workflow.photos ?? [];
    const seen = new Set<string>();
    const merged: FieldAttachment[] = [];
    for (const item of [...workflowPhotos, ...packPhotos]) {
      const key = item.id || `${item.name}-${item.uploadedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }, [job, workflow.photos]);

  if (error && !job) {
    return (
      <main className="field-screen">
        <Link href={fieldPath("/")} className="back-link">
          <ArrowLeft size={17} /> My Day
        </Link>
        <div className="feedback error">{error}</div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="field-screen">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="field-screen">
      <Link href={fieldPath("/")} className="back-link">
        <ArrowLeft size={17} /> My Day
      </Link>

      <header className="field-page-header">
        <p className="eyebrow">
          {job.start}–{job.end} · {formatDuration(job.durationHours)} · {job.jobRef}
        </p>
        <h1>{job.customer}</h1>
        <p className="field-page-sub">
          {checklistMode === "daywork" ? "Daywork account · variation sheet" : job.costCentre}
          {workflow.outcome
            ? ` · ${workflow.outcome.status === "Needs parts" ? "Awaiting parts" : workflow.outcome.status}`
            : ` · ${job.status}`}
        </p>
      </header>

      <p className="job-lead">{job.description}</p>

      {sessionError ? (
        <div className="feedback error" role="alert">
          {sessionError}{" "}
          <a href="/login" style={{ color: "inherit", fontWeight: 700 }}>
            Sign in
          </a>
        </div>
      ) : null}

      {error ? <div className="feedback error">{error}</div> : null}
      {notice ? <div className="feedback">{notice}</div> : null}

      <div className="field-outcome-actions" aria-label="Job outcome">
        <label className="check-field">
          <span>Completion / parts note</span>
          <textarea
            value={outcomeNote}
            onChange={(event) => setOutcomeNote(event.target.value)}
            placeholder="Optional note for office — what was done, or what parts are needed."
            rows={2}
          />
        </label>
        <div className="field-outcome-buttons">
          <button
            type="button"
            className="primary-btn"
            disabled={workflowBusy || dayworkBusy}
            onClick={() => void setOutcome("Complete")}
          >
            <CheckCircle2 size={17} /> Mark complete
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={workflowBusy}
            onClick={() => void setOutcome("Needs parts")}
          >
            <Wrench size={17} /> Awaiting parts
          </button>
        </div>
        {!canComplete && checklistMode === "job" ? (
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Finish the job checklist (not Daywork) before Mark complete. In-progress Daywork can be discarded.
          </p>
        ) : null}
        {workflow.outcome ? (
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Latest: {workflow.outcome.status === "Needs parts" ? "Awaiting parts" : workflow.outcome.status}
            {" · "}
            {workflow.outcome.createdAt}
            {workflow.outcome.note ? ` — ${workflow.outcome.note}` : ""}
          </p>
        ) : null}
      </div>

      <div className="field-daywork-actions">
        {checklistMode === "daywork" ? (
          <>
            <button
              type="button"
              className="primary-btn"
              disabled={dayworkBusy}
              onClick={() => void openDayworkSheet({ fresh: true })}
            >
              {dayworkBusy ? "Opening…" : "New Daywork sheet"}
            </button>
            {dayworkCostCentreId ? (
              <button
                type="button"
                className="secondary-btn"
                disabled={dayworkBusy}
                onClick={() => void discardDayworkSheet(dayworkCostCentreId)}
              >
                Discard this Daywork
              </button>
            ) : null}
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {dayworkCostCentreId
                ? `${dayworkSheetListLabel(job.jobId, dayworkCostCentreId)} open`
                : "Daywork open"}
              {orderedDayworkSheets.length
                ? ` · ${orderedDayworkSheets.length} on this job`
                : ""}
              . Save and finish locks it. Opened by mistake? Tap <strong>Discard this Daywork</strong> — it does not
              block Mark complete.
            </p>
          </>
        ) : (
          <>
            <button type="button" className="primary-btn" disabled={dayworkBusy} onClick={() => void openDayworkSheet()}>
              {dayworkBusy ? "Opening…" : "Add Daywork Account"}
            </button>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              The normal Checklist only updates the gas / job stop-go. Daywork materials and signatures need{" "}
              <strong>Add Daywork Account</strong> then <strong>Save and finish</strong>.
            </p>
          </>
        )}
        {orderedDayworkSheets.length ? (
          <div className="field-daywork-sheet-list" aria-label="Daywork sheets on this job">
            <strong>Dayworks on this job</strong>
            <div className="field-daywork-sheet-chips">
              {orderedDayworkSheets.map((sheet) => {
                const costCentreId = sheet.costCentreId!;
                const label = dayworkSheetListLabel(job.jobId, costCentreId);
                const active = checklistMode === "daywork" && dayworkCostCentreId === costCentreId;
                const locked = isDayworkSubmittedToCore(sheet);
                // Submitted sheets are labels only — don’t reopen (saves bandwidth; office edits in Core).
                if (locked) {
                  return (
                    <div key={costCentreId} className="field-daywork-sheet-chip-row">
                      <span
                        className="field-daywork-sheet-chip is-locked"
                        title="Submitted to Core — not reopened on Field"
                      >
                        <span>{label}</span>
                        <small>Submitted</small>
                      </span>
                      <button
                        type="button"
                        className="field-daywork-email-btn"
                        disabled={dayworkBusy}
                        onClick={() => void emailDayworkClientCopy(costCentreId, sheet.clientEmail)}
                      >
                        Email copy
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={costCentreId} className="field-daywork-sheet-chip-row">
                    <button
                      type="button"
                      className={active ? "field-daywork-sheet-chip is-active" : "field-daywork-sheet-chip"}
                      disabled={dayworkBusy || active}
                      onClick={() => void openDayworkSheet({ costCentreId })}
                    >
                      <span>{label}</span>
                      <small>In progress — tap to open</small>
                    </button>
                    <button
                      type="button"
                      className="field-daywork-discard-btn"
                      disabled={dayworkBusy}
                      onClick={() => void discardDayworkSheet(costCentreId)}
                    >
                      Discard
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <Link href={fieldPath(`/ask?job=${encodeURIComponent(job.scheduleId)}`)} className="field-ask-blake-link">
        Ask Ayla about this job
      </Link>

      <div className="site-block">
        <p>{job.address}</p>
        <span>{job.contactName}</span>
        <div className="site-actions">
          <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer">
            <MapPin size={16} /> Maps
          </a>
          <a href={`tel:${job.phone}`}>
            <Phone size={16} /> Call
          </a>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Job details">
        <button type="button" className={tab === "pack" ? "active" : undefined} onClick={() => setTab("pack")}>
          <Layers size={15} /> Job info
        </button>
        <button type="button" className={tab === "checklist" ? "active" : undefined} onClick={() => setTab("checklist")}>
          <ClipboardCheck size={15} /> Checklist
        </button>
        <button type="button" className={tab === "photos" ? "active" : undefined} onClick={() => setTab("photos")}>
          <Camera size={15} /> Photos
        </button>
        <button type="button" className={tab === "po" ? "active" : undefined} onClick={() => setTab("po")}>
          <ShoppingCart size={15} /> POs
        </button>
      </div>

      {tab === "pack" ? (
        <div className="stack">
          <ProgrammeBoard jobs={jobs} activeScheduleId={job.scheduleId} />
          <div className="soft-block">
            <strong>Access</strong>
            <p>{job.accessNotes}</p>
          </div>
          {job.officeNotes.slice(0, 2).map((note) => (
            <div className="soft-block" key={note}>
              <strong>Office</strong>
              <p>{note}</p>
            </div>
          ))}
          <h2 className="stack-title">Drawings &amp; docs</h2>
          <div className="file-list">
            {(drawings.length ? drawings : job.attachments).map((file) => (
              <div className="file-row" key={file.id}>
                <span>{file.type}</span>
                <strong>{file.name}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "checklist" ? (
        <div className="stack checklist-stack">
          {checklistMode === "daywork" ? (
            <DayworkSheetForm
              key={`daywork-${dayworkCostCentreId || "default"}-${dayworkRecord?.completedAt || "new"}`}
              scheduleId={job.scheduleId}
              costCentreId={dayworkCostCentreId || undefined}
              engineerName={job.engineerName}
              initialRecord={dayworkRecord}
              locked={isDayworkSubmittedToCore(dayworkRecord)}
              onCancel={() => void backToJobChecklist()}
              onSaved={(record) => {
                setDayworkRecord(record);
                setDayworkSheets((current) => {
                  const costCentreId = dayworkCostCentreId || `${job.jobId}-daywork-account`;
                  const next = current.filter((sheet) => sheet.costCentreId !== costCentreId);
                  return [
                    ...next,
                    { ...record, costCentreId, updatedAt: new Date().toISOString() },
                  ];
                });
                setNotice(
                  isDayworkSubmittedToCore(record)
                    ? "Submitted to Core and locked on Field. Office can edit in Core → Variations → Daywork account. Tap New Daywork sheet for another."
                    : "Saved to Core — open this job → Cost centres → Variations → Daywork account.",
                );
              }}
            />
          ) : (
            <>
              <p className="checklist-intro muted">
                This checklist is for the job stop/go only (e.g. boiler / gas). It does <strong>not</strong> fill the
                Daywork Account. Tap <strong>Add Daywork Account</strong> above for materials, hours and dual
                sign-off that appear in Core Variations.
              </p>
              {requirementsLookLikeDaywork(job.requirements) ? (
                <div className="soft-block">
                  <strong>Daywork sheet available</strong>
                  <p className="muted">
                    Hours and materials are edited on the Daywork form — not as raw checklist text.
                  </p>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={dayworkBusy}
                    onClick={() => void openDayworkSheet()}
                    style={{ marginTop: 8 }}
                  >
                    Open Daywork form
                  </button>
                </div>
              ) : null}
              {job.requirements
                .filter((item) => !isDayworkRequirement(item))
                .map((item) => {
                  const evidenceType = evidenceTypeOf(item);
                  const draft = draftByRequirement[item.id] || {};
                  const summary = doneSummary(item);
                  const isEditing = editingId === item.id || item.status === "missing";
                  const statusLabel =
                    item.status === "missing" ? "To do" : item.status === "done" ? "Done" : "Optional";
                  const placeholder =
                    item.validation?.placeholder ||
                    (evidenceType === "Signature"
                      ? "Signed by…"
                      : evidenceType === "Number"
                        ? "Enter reading…"
                        : "Type here…");
                  const maxLength = item.validation?.exactDigits || item.validation?.maxLength;
                  return (
                    <article
                      className={`check-card is-${item.status}${isEditing ? " is-editing" : ""}`}
                      key={item.id}
                    >
                      <header className="check-card-head">
                        <div className="check-card-copy">
                          <h3>{item.label}</h3>
                          <p className="check-card-meta">
                            {[item.stage, evidenceType, item.status === "optional" ? "Optional" : "Required"]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {item.status === "done" && summary && !isEditing ? (
                            <p className="check-card-value">{summary}</p>
                          ) : null}
                        </div>
                        <span className={`check-card-status is-${item.status}`}>{statusLabel}</span>
                      </header>

                      {item.status === "done" && !isEditing ? (
                        <div className="check-card-actions">
                          <button
                            type="button"
                            className="check-amend"
                            disabled={savingId === item.id}
                            onClick={() => void reopenRequirement(item.id)}
                          >
                            Amend
                          </button>
                        </div>
                      ) : null}

                      {isEditing && item.status !== "optional" ? (
                        <div className="check-card-capture">
                          {item.validation?.inputKind === "date" ? (
                            <label className="check-field">
                              <span>Date (UK)</span>
                              <input
                                type="date"
                                lang="en-GB"
                                value={toDateInputValue(draft.text)}
                                onChange={(event) =>
                                  setDraftByRequirement((current) => ({
                                    ...current,
                                    [item.id]: {
                                      ...current[item.id],
                                      text: event.target.value ? isoDateToUk(event.target.value) : "",
                                    },
                                  }))
                                }
                              />
                              {draft.text ? <small>Selected: {toUkDateDisplay(draft.text)}</small> : null}
                            </label>
                          ) : null}
                          {(evidenceType === "Text" || evidenceType === "Signature") &&
                          item.validation?.inputKind !== "date" ? (
                            <label className="check-field">
                              <span>{evidenceType === "Signature" ? "Signed by" : "Answer"}</span>
                              <input
                                type={item.validation?.inputKind === "digits" ? "tel" : "text"}
                                inputMode={
                                  item.validation?.inputKind === "digits"
                                    ? "numeric"
                                    : item.validation?.inputMode || "text"
                                }
                                pattern={item.validation?.inputKind === "digits" ? "[0-9]*" : undefined}
                                value={draft.text || ""}
                                placeholder={placeholder}
                                maxLength={maxLength}
                                onChange={(event) => {
                                  const nextValue =
                                    item.validation?.inputKind === "digits"
                                      ? event.target.value.replace(/\D/g, "")
                                      : event.target.value;
                                  setDraftByRequirement((current) => ({
                                    ...current,
                                    [item.id]: { ...current[item.id], text: nextValue },
                                  }));
                                }}
                              />
                            </label>
                          ) : null}
                          {evidenceType === "Number" ? (
                            <label className="check-field">
                              <span>Reading</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*[.]?[0-9]*"
                                value={draft.numberValue || ""}
                                placeholder={placeholder}
                                onChange={(event) => {
                                  const nextValue = event.target.value.replace(/[^0-9.]/g, "");
                                  setDraftByRequirement((current) => ({
                                    ...current,
                                    [item.id]: { ...current[item.id], numberValue: nextValue },
                                  }));
                                }}
                              />
                            </label>
                          ) : null}
                          {evidenceType === "Photo" ? (
                            <label className="check-field">
                              <span>Photo</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (!file) return;
                                  setDraftByRequirement((current) => ({
                                    ...current,
                                    [item.id]: { ...current[item.id], photoName: file.name },
                                  }));
                                  event.target.value = "";
                                }}
                              />
                              {draft.photoName ? <small>Selected: {draft.photoName}</small> : null}
                            </label>
                          ) : null}
                          {evidenceType === "Checkbox" ? (
                            <p className="check-card-hint muted">Confirm this check is complete on site.</p>
                          ) : null}
                          {item.validation?.helpText ? (
                            <p className="check-card-hint muted">{item.validation.helpText}</p>
                          ) : null}
                          <button
                            type="button"
                            className="check-save"
                            disabled={savingId === item.id}
                            onClick={() => void saveRequirement(item.id)}
                          >
                            {savingId === item.id
                              ? "Saving…"
                              : evidenceType === "Checkbox"
                                ? "Mark done"
                                : "Save"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
            </>
          )}
        </div>
      ) : null}

      {tab === "photos" ? (
        <div className="stack">
          <div className="field-upload-row">
            <button
              type="button"
              className="primary-btn"
              disabled={workflowBusy}
              onClick={() => photoInputRef.current?.click()}
            >
              <Camera size={17} /> Photos
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={workflowBusy}
              onClick={() => videoInputRef.current?.click()}
            >
              <Video size={17} /> Video
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={workflowBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={17} /> Files
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(event) => void uploadMedia(event)}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.webm,.m4v"
              capture="environment"
              multiple
              hidden
              onChange={(event) => void uploadMedia(event)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf"
              multiple
              hidden
              onChange={(event) => void uploadMedia(event)}
            />
          </div>

          {photos.length ? (
            <div className="file-list">
              {photos.map((photo) => (
                <div className="file-row" key={photo.id}>
                  <span>{photo.type}</span>
                  <strong>{photo.name}</strong>
                  <small className="muted">
                    {photo.uploadedBy} · {photo.uploadedAt}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No photos or files on this job yet.</p>
          )}

          <form className="field-po-form" onSubmit={(event) => void submitNote(event)}>
            <strong>
              <MessageCircle size={16} /> Site note
            </strong>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="What should the office know?"
              rows={3}
            />
            <button type="submit" className="primary-btn" disabled={workflowBusy || !noteText.trim()}>
              Send note
            </button>
          </form>

          {workflow.notes.length ? (
            <div className="file-list">
              {workflow.notes.map((note) => (
                <div className="file-row" key={note.id}>
                  <span>Note</span>
                  <strong>{note.text}</strong>
                  <small className="muted">
                    {note.createdBy} · {note.createdAt}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "po" ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Request materials against this job. Pick a supplier from Core, say what you need, and office raises the PO.
          </p>
          <form className="field-po-form" onSubmit={(event) => void submitPoRequest(event)}>
            <strong>
              <ShoppingCart size={16} /> Request PO
            </strong>
            <label className="check-field field-supplier-picker">
              <span>Supplier</span>
              <input
                value={poSupplierQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setPoSupplierQuery(value);
                  setPoSupplier(value);
                  setPoSupplierId("");
                  setPoSupplierEmail("");
                  setPoSupplierOpen(true);
                }}
                onFocus={() => setPoSupplierOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setPoSupplierOpen(false), 150);
                }}
                placeholder={suppliers.length ? "Start typing a Core supplier…" : "No suppliers in Core yet"}
                autoComplete="off"
                disabled={!suppliers.length}
              />
              {poSupplierId ? (
                <small className="muted">Selected from Core{poSupplierEmail ? ` · ${poSupplierEmail}` : ""}</small>
              ) : (
                <small className="muted">
                  {suppliers.length
                    ? "Linked to Core People → Suppliers — type then select."
                    : "Add suppliers in Core (People → Suppliers) first."}
                </small>
              )}
              {poSupplierOpen && suppliers.length ? (
                <div className="field-supplier-results" role="listbox" aria-label="Core suppliers">
                  {filteredSuppliers.length ? (
                    filteredSuppliers.map((supplier) => (
                      <button
                        key={supplier.id}
                        type="button"
                        role="option"
                        className={supplier.id === poSupplierId ? "is-selected" : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectPoSupplier(supplier)}
                      >
                        <strong>{supplier.name}</strong>
                        <small>
                          {[supplier.account, supplier.category].filter(Boolean).join(" · ") || "Core supplier"}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p className="muted">No match — check the name in Core Suppliers.</p>
                  )}
                </div>
              ) : null}
            </label>
            <label className="check-field">
              <span>What do you need?</span>
              <textarea
                value={poNote}
                onChange={(event) => setPoNote(event.target.value)}
                placeholder="Example: 15mm fittings and pump valves before reattendance."
                rows={3}
              />
            </label>
            <button
              type="submit"
              className="primary-btn"
              disabled={workflowBusy || !poSupplierId || !poNote.trim()}
            >
              <PackagePlus size={17} /> Send PO request
            </button>
          </form>

          {workflow.poRequests.length ? (
            <div className="file-list">
              {workflow.poRequests.map((request) => (
                <div className="file-row" key={request.id}>
                  <span>
                    {request.status === "Approved"
                      ? "Approved"
                      : request.status === "Rejected"
                        ? "Rejected"
                        : request.status === "Ordered"
                          ? "Ordered"
                          : request.poNumber
                            ? `${request.status} · ${request.poNumber}`
                            : request.status}
                  </span>
                  <strong>{request.supplier}</strong>
                  <small className="muted">
                    {request.note || "PO support requested."}
                    {request.poNumber ? ` · ${request.poNumber}` : ""} · {request.createdAt}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No PO requests on this job yet.</p>
          )}
        </div>
      ) : null}
    </main>
  );
}
