"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import { FileDropZone } from "@/components/FileDropZone";
import {
  isTenderDocumentKind,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderPathLabel,
  type TenderDocumentFolder,
} from "@/lib/tender-document-folders";
import {
  TENDER_AREAS,
  TENDER_CATEGORIES,
  TENDER_STATUSES,
  alertForDeadline,
  boqProgress,
  computeBoqTotal,
  daysLeftForDeadline,
  type Tender,
  type TenderBoqLine,
  type TenderDocument,
  type TenderDocumentKind,
  type TenderStatus,
} from "@/lib/tenders-types";

// TenderStatus kept for status dropdowns inside overview.

type RequestHeaders = HeadersInit;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return gbp.format(value);
}

type TabKey = "overview" | "boq" | "documents" | "submit";

const DOC_KINDS: Array<{ kind: TenderDocumentKind; label: string }> = [
  { kind: "issued-boq", label: "Issued BoQ" },
  { kind: "priced-boq", label: "Priced BoQ return" },
  { kind: "form-of-tender", label: "Form of Tender" },
  { kind: "drawing", label: "Drawings" },
  { kind: "specification", label: "Specification" },
  { kind: "supplier-quote", label: "Supplier quotes" },
  { kind: "other", label: "Other" },
];

const DOC_KIND_LABELS = Object.fromEntries(DOC_KINDS.map((item) => [item.kind, item.label])) as Record<
  TenderDocumentKind,
  string
>;

type DocTargetValue = `kind:${TenderDocumentKind}` | `folder:${string}`;

function encodeDocTarget(kind: TenderDocumentKind, folderId?: string | null): DocTargetValue {
  if (folderId) return `folder:${folderId}`;
  return `kind:${kind}`;
}

function decodeDocTarget(value: string): { kind?: TenderDocumentKind; folderId?: string } {
  if (value.startsWith("folder:")) return { folderId: value.slice("folder:".length) };
  if (value.startsWith("kind:")) {
    const kind = value.slice("kind:".length);
    return { kind: isTenderDocumentKind(kind) ? kind : "other" };
  }
  if (isTenderDocumentKind(value)) return { kind: value };
  return { kind: "other" };
}

function listFolderOptions(
  folders: TenderDocumentFolder[],
): Array<{ value: DocTargetValue; label: string; kind: TenderDocumentKind }> {
  const options: Array<{ value: DocTargetValue; label: string; kind: TenderDocumentKind }> = [];
  for (const item of DOC_KINDS) {
    options.push({ value: encodeDocTarget(item.kind), label: item.label, kind: item.kind });
  }
  for (const folder of folders) {
    const kind = resolveTenderDocumentFolderKind(folders, folder.id);
    options.push({
      value: encodeDocTarget(kind, folder.id),
      label: tenderDocumentFolderPathLabel(folders, folder.id, DOC_KIND_LABELS),
      kind,
    });
  }
  return options;
}

function foldersUnderParent(folders: TenderDocumentFolder[], parentId: string | null) {
  return folders
    .filter((folder) => (folder.parentId || null) === parentId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function TendersPanel({
  requestHeaders,
  onNotice,
  businessName = "Errol Watson Group Ltd",
  actorName = "NeXa user",
  clients = [],
  onOpenPendingJob,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  businessName?: string;
  actorName?: string;
  clients?: Array<{
    id: string;
    name: string;
    accountReference?: string;
    primaryContact?: string;
    billingAddress?: string;
  }>;
  onOpenPendingJob?: (jobId: string) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folderKey, setFolderKey] = useState<"open" | "won" | "lost" | "all">("open");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [boqImportText, setBoqImportText] = useState("");
  const [qualificationDraft, setQualificationDraft] = useState("");
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
  const [blakeBudgetBusy, setBlakeBudgetBusy] = useState(false);
  const [blakeBudgetStatus, setBlakeBudgetStatus] = useState<string | null>(null);
  const blakeBudgetAbortRef = useRef<AbortController | null>(null);

  const selected = useMemo(
    () => tenders.find((tender) => tender.id === selectedId) ?? null,
    [selectedId, tenders],
  );

  const clientSuggestions = useMemo(() => {
    const query = (selected?.client || "").trim().toLowerCase();
    if (!query || query.length < 1 || query === "client tbc") return [];
    return clients
      .filter((client) => {
        const haystack = [
          client.name,
          client.accountReference ?? "",
          client.primaryContact ?? "",
          client.billingAddress ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [clients, selected?.client]);

  async function loadTenders() {
    setLoading(true);
    try {
      const response = await fetch("/api/tenders", { headers: requestHeaders });
      if (!response.ok) throw new Error("Unable to load tenders");
      const payload = (await response.json()) as { tenders?: Tender[] };
      setTenders(Array.isArray(payload.tenders) ? payload.tenders : []);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to load tenders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setClientSuggestionsOpen(false);
  }, [selectedId]);

  async function postAction(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch("/api/tenders", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        tenders?: Tender[];
        tender?: Tender;
        job?: { id: string; ref: string } | null;
        alreadyConverted?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Request failed");
      if (Array.isArray(payload.tenders)) setTenders(payload.tenders);
      if (payload.tender?.id) setSelectedId(payload.tender.id);
      return payload;
    } finally {
      setSaving(false);
    }
  }

  const folders = useMemo(() => {
    const open = tenders.filter((tender) => !["Won", "Lost"].includes(tender.status));
    const won = tenders.filter((tender) => tender.status === "Won");
    const lost = tenders.filter((tender) => tender.status === "Lost");
    return [
      { key: "open" as const, label: "Open", tone: "blue", items: open, detail: "Live and in-progress tenders" },
      { key: "won" as const, label: "Won", tone: "green", items: won, detail: "Accepted — pending job created when marked won" },
      { key: "lost" as const, label: "Lost / archived", tone: "amber", items: lost, detail: "Lost or archived tenders" },
      { key: "all" as const, label: "All", tone: "blue", items: tenders, detail: "Everything" },
    ];
  }, [tenders]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const folderItems = folders.find((folder) => folder.key === folderKey)?.items ?? tenders;
    if (!query) return folderItems;
    return folderItems.filter((tender) =>
      [
        tender.name,
        tender.client,
        tender.category,
        tender.area,
        tender.status,
        tender.owner,
        tender.externalId ?? "",
      ].some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [folderKey, folders, search, tenders]);

  const pipelineValue = useMemo(
    () =>
      tenders
        .filter((tender) => !["Lost", "Won"].includes(tender.status))
        .reduce((sum, tender) => sum + (tender.tenderSum || tender.bidValue || 0), 0),
    [tenders],
  );

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectAllVisible() {
    setSelectedIds(filtered.map((tender) => tender.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function bulkArchive() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Archive ${selectedIds.length} tender(s) as Lost?`)) return;
    try {
      await postAction({ action: "archive-bulk", ids: selectedIds });
      clearSelection();
      onNotice("Selected tenders archived as Lost.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to archive");
    }
  }

  async function bulkDelete() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Permanently delete ${selectedIds.length} tender(s)?`)) return;
    try {
      await postAction({ action: "delete-bulk", ids: selectedIds });
      clearSelection();
      onNotice("Selected tenders deleted.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to delete");
    }
  }

  async function markWon(tenderId: string) {
    try {
      const result = await postAction({ action: "convert-won", id: tenderId });
      if (result.alreadyConverted && result.tender?.convertedJobId) {
        onNotice(`Already won — job ${result.tender.convertedJobRef || result.tender.convertedJobId}.`);
        onOpenPendingJob?.(result.tender.convertedJobId);
        return;
      }
      if (result.job?.id) {
        onNotice(`Tender won — pending job ${result.job.ref} created.`);
        onOpenPendingJob?.(result.job.id);
      } else {
        onNotice("Tender marked Won.");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to mark won");
    }
  }

  async function deleteDocument(documentId: string, documentName: string) {
    if (!selected) return;
    if (!window.confirm(`Remove “${documentName}” from this tender?`)) return;
    const tenderId = selected.id;
    // Optimistic UI so Remove feels instant even if the network is slow.
    setTenders((current) =>
      current.map((row) =>
        row.id === tenderId
          ? { ...row, documents: row.documents.filter((doc) => doc.id !== documentId) }
          : row,
      ),
    );
    try {
      await postAction({ action: "delete-document", id: tenderId, documentId });
      onNotice(`Removed ${documentName}.`);
    } catch (error) {
      await loadTenders();
      onNotice(error instanceof Error ? error.message : "Unable to remove document");
    }
  }

  async function clearBoq() {
    if (!selected || !selected.boqLines.length) return;
    const lineCount = selected.boqLines.length;
    if (
      !window.confirm(
        `Clear the imported BoQ (${lineCount} line${lineCount === 1 ? "" : "s"}) from this tender?\n\nDocument uploads are kept — remove those under Documents if needed. You can re-import afterwards.`,
      )
    ) {
      return;
    }
    try {
      await postAction({ action: "clear-boq", id: selected.id });
      setBoqImportText("");
      onNotice("BoQ cleared — import a new spreadsheet when ready.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to clear BoQ");
    }
  }

  function confirmReplaceBoq(lineCount: number) {
    if (!lineCount) return true;
    return window.confirm(
      `Replace the existing BoQ (${lineCount} line${lineCount === 1 ? "" : "s"}) with this import? Pricing on the old lines will be lost.`,
    );
  }

  async function openOrCreateTakeoff(createNew = false) {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/tenders/${selected.id}/send-to-takeoff`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ createNew, actor: actorName }),
      });
      const payload = (await response.json()) as {
        error?: string;
        tender?: Tender;
        takeoff?: { id: string; reference: string };
        created?: boolean;
        drawingsCopied?: number;
        href?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to open Takeoff");
      if (payload.tender) {
        setTenders((current) => current.map((row) => (row.id === payload.tender!.id ? payload.tender! : row)));
      }
      const drawingNote =
        payload.drawingsCopied && payload.drawingsCopied > 0
          ? ` · ${payload.drawingsCopied} drawing${payload.drawingsCopied === 1 ? "" : "s"} copied across`
          : "";
      onNotice(
        payload.created
          ? `Takeoff ${payload.takeoff?.reference || ""} created from this tender${drawingNote}.`
          : `Opening linked takeoff ${payload.takeoff?.reference || ""}${drawingNote}.`,
      );
      if (payload.href) {
        window.location.href = payload.href;
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to link Takeoff");
    } finally {
      setSaving(false);
    }
  }

  async function createTender() {
    try {
      await postAction({
        action: "upsert",
        tender: {
          name: "New tender opportunity",
          client: "Client TBC",
          category: "Plumbing",
          area: "Aberdeen",
          status: "Not Started",
          owner: actorName,
          bidValue: 0,
          tenderSum: 0,
        },
      });
      setTab("overview");
      onNotice("Tender created.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to create tender");
    }
  }

  async function saveSelected(patch: Partial<Tender>) {
    if (!selected) return;
    try {
      await postAction({ action: "update", id: selected.id, patch });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to save tender");
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!window.confirm(`Delete tender "${selected.name}"?`)) return;
    try {
      await postAction({ action: "delete", id: selected.id });
      setSelectedId(null);
      onNotice("Tender deleted.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to delete tender");
    }
  }

  async function importBoq() {
    if (!selected || !boqImportText.trim()) return;
    if (!confirmReplaceBoq(selected.boqLines.length)) return;
    try {
      await postAction({
        action: "import-boq",
        id: selected.id,
        boqText: boqImportText,
      });
      setBoqImportText("");
      setTab("boq");
      onNotice("BoQ imported — all issued lines kept; blank rates stay unpriced (not free).");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to import BoQ");
    }
  }

  async function uploadImportFile(action: "import-boq" | "import-tracker" | "upload-document", file: File | null, extra?: Record<string, string>) {
    if (!file) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.set("action", action);
      body.set("file", file);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) body.set(key, value);
      }
      const response = await fetch("/api/tenders/import", {
        method: "POST",
        headers: requestHeaders,
        body,
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        tenders?: Tender[];
        tender?: Tender;
        created?: number;
        updated?: number;
      };
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      if (Array.isArray(payload.tenders)) setTenders(payload.tenders);
      else if (payload.tender?.id) {
        setTenders((current) => {
          const exists = current.some((row) => row.id === payload.tender!.id);
          if (exists) return current.map((row) => (row.id === payload.tender!.id ? payload.tender! : row));
          return [payload.tender!, ...current];
        });
      }
      if (payload.tender?.id) setSelectedId(payload.tender.id);
      onNotice(
        payload.message ||
          (action === "import-boq"
            ? "BoQ spreadsheet imported."
            : action === "import-tracker"
              ? `Tracker imported (${payload.created ?? 0} new, ${payload.updated ?? 0} updated).`
              : "Document uploaded."),
      );
      if (action === "import-boq") setTab("boq");
      if (action === "upload-document") setTab("documents");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to upload");
    } finally {
      setSaving(false);
    }
  }

  async function onBoqFile(file: File | null) {
    if (!file || !selected) return;
    if (!confirmReplaceBoq(selected.boqLines.length)) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      await uploadImportFile("import-boq", file, { tenderId: selected.id });
      return;
    }
    const text = await file.text();
    setBoqImportText(text);
  }

  async function patchBoqLine(lineId: string, linePatch: Partial<TenderBoqLine>) {
    if (!selected) return;
    try {
      const nextPatch =
        linePatch.rate !== undefined && linePatch.pricingSource === undefined
          ? { ...linePatch, pricingSource: linePatch.rate === null ? undefined : ("manual" as const) }
          : linePatch;
      await postAction({
        action: "update-boq-line",
        id: selected.id,
        lineId,
        linePatch: nextPatch,
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to update BoQ line");
    }
  }

  async function runBlakeBudgetPrices(forceRefresh = false) {
    if (!selected) return;
    const measured = selected.boqLines.filter((line) => line.kind === "measured").length;
    if (!measured) {
      onNotice("Import a BoQ first — Blake needs measured lines to price.");
      return;
    }
    if (blakeBudgetBusy) return;

    blakeBudgetAbortRef.current?.abort();
    const abort = new AbortController();
    blakeBudgetAbortRef.current = abort;

    setBlakeBudgetBusy(true);
    setSaving(true);
    setBlakeBudgetStatus("Matching library…");
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(selected.id)}/budget-prices?stream=1`, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ forceRefresh, actor: actorName }),
        signal: abort.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok && !contentType.includes("ndjson")) {
        const fail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(fail.error || "Blake budget pricing failed");
      }

      type BlakePayload = {
        type?: string;
        error?: string;
        tender?: Tender;
        tenders?: Tender[];
        aiUsed?: boolean;
        libraryFilled?: number;
        blakeFilled?: number;
        leftBlank?: number;
        budgetTotal?: number;
        pricedCount?: number;
        message?: string;
        stage?: string;
      };

      let payload: BlakePayload | null = null;

      if (contentType.includes("ndjson") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line) continue;
            let event: BlakePayload;
            try {
              event = JSON.parse(line) as BlakePayload;
            } catch {
              continue;
            }
            if (event.type === "progress" && event.message) {
              setBlakeBudgetStatus(event.message);
            } else if (event.type === "result") {
              payload = event;
            } else if (event.type === "error") {
              throw new Error(event.error || "Blake budget pricing failed");
            }
          }
        }
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as BlakePayload;
            if (event.type === "result") payload = event;
            else if (event.type === "error") throw new Error(event.error || "Blake budget pricing failed");
          } catch (error) {
            if (error instanceof Error && /Blake budget/.test(error.message)) throw error;
          }
        }
      } else {
        payload = (await response.json()) as BlakePayload;
        if (!response.ok) throw new Error(payload.error || "Blake budget pricing failed");
      }

      if (!payload) throw new Error("Blake budget pricing returned no result");
      if (payload.error && !(payload.pricedCount || payload.libraryFilled || payload.blakeFilled)) {
        throw new Error(payload.error);
      }

      if (Array.isArray(payload.tenders)) setTenders(payload.tenders);
      else if (payload.tender) {
        setTenders((prev) => prev.map((row) => (row.id === payload!.tender!.id ? payload!.tender! : row)));
      }
      const blank = payload.leftBlank ?? 0;
      const priced = payload.pricedCount ?? 0;
      const notice = payload.aiUsed
        ? `Blake budget prices applied · ${payload.blakeFilled ?? 0} Blake · ${payload.libraryFilled ?? 0} library · ${priced} priced · ${blank} blank · ${money(payload.budgetTotal)}. Guide rates only — amend before FoT.`
        : `Guide rates applied · ${payload.libraryFilled ?? 0} from library · ${priced} priced · ${blank} blank · ${money(payload.budgetTotal)}. OpenAI offline or skipped — blanks stay unpriced.`;
      setBlakeBudgetStatus(
        blank
          ? `Done · ${priced} priced · ${blank} blank`
          : `Done · ${priced} priced`,
      );
      onNotice(notice);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setBlakeBudgetStatus("Cancelled");
        onNotice("Blake budget pricing cancelled.");
      } else {
        setBlakeBudgetStatus(null);
        onNotice(error instanceof Error ? error.message : "Unable to run Blake budget prices");
      }
    } finally {
      if (blakeBudgetAbortRef.current === abort) blakeBudgetAbortRef.current = null;
      setBlakeBudgetBusy(false);
      setSaving(false);
      window.setTimeout(() => setBlakeBudgetStatus(null), 4000);
    }
  }

  function cancelBlakeBudgetPrices() {
    blakeBudgetAbortRef.current?.abort();
    setBlakeBudgetStatus("Cancelling…");
  }

  async function downloadFormOfTender() {
    if (!selected) return;
    const params = new URLSearchParams({
      businessName,
      signatoryName: actorName,
      signatoryTitle: "Commercial Manager",
    });
    const response = await fetch(`/api/tenders/${selected.id}/form-of-tender?${params}`, {
      headers: requestHeaders,
    });
    if (!response.ok) {
      onNotice("Unable to generate Form of Tender.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Form_of_Tender_${selected.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotice("Form of Tender downloaded.");
  }

  async function submitTender() {
    if (!selected) return;
    try {
      await postAction({
        action: "submit",
        id: selected.id,
        tenderSum: selected.tenderSum ?? computeBoqTotal(selected.boqLines),
      });
      await downloadFormOfTender();
      onNotice("Tender marked Sent — attach the FoT PDF + priced BoQ for return.");
      setTab("submit");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to submit tender");
    }
  }

  if (selected) {
    const progress = boqProgress(selected.boqLines);
    const boqTotal = computeBoqTotal(selected.boqLines);
    const daysLeft = daysLeftForDeadline(selected.submissionDeadline);
    const alert = alertForDeadline(selected.submissionDeadline);

    return (
      <section className="tenders-workspace" aria-label="Tender record">
        <div className="tenders-toolbar">
          <button type="button" className="secondary-button" onClick={() => setSelectedId(null)}>
            <ArrowLeft size={15} />
            Tracker
          </button>
          <div>
            <span className="permission-heading">Tender</span>
            <h2>{selected.name}</h2>
            <p>
              {selected.client} · {selected.category} · {selected.area}
              {selected.submissionDeadline ? ` · due ${selected.submissionDeadline}` : ""}
              {daysLeft !== null ? ` · ${daysLeft}d` : ""}
              {alert ? ` · ${alert}` : ""}
              {selected.linkedTakeoffRef ? ` · Takeoff ${selected.linkedTakeoffRef}` : ""}
            </p>
          </div>
          <div className="tenders-toolbar-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void openOrCreateTakeoff(false)}
            >
              {selected.linkedTakeoffId ? "Open Takeoff" : "Send to Takeoff"}
            </button>
            {selected.linkedTakeoffId ? (
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={() => void openOrCreateTakeoff(true)}
              >
                New Takeoff
              </button>
            ) : null}
            {selected.status !== "Won" ? (
              <button type="button" className="primary-button" disabled={saving} onClick={() => void markWon(selected.id)}>
                Mark Won → Pending job
              </button>
            ) : selected.convertedJobId ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => onOpenPendingJob?.(selected.convertedJobId!)}
              >
                Open job {selected.convertedJobRef || ""}
              </button>
            ) : null}
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void downloadFormOfTender()}>
              <Download size={15} />
              Form of Tender
            </button>
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void submitTender()}>
              <Send size={15} />
              Mark submitted
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void saveSelected({ status: "Lost" })}
            >
              Archive as Lost
            </button>
            <button type="button" className="secondary-button" onClick={() => void deleteSelected()}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="tenders-tabs" role="tablist">
          {(
            [
              ["overview", "Overview"],
              ["boq", "BoQ pricing"],
              ["documents", "Documents"],
              ["submit", "Submit pack"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={tab === key ? "active" : ""}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="tenders-detail-grid">
            <label>
              Opportunity name
              <input
                value={selected.name}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, name: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ name: event.target.value })}
              />
            </label>
            <label className="tenders-client-field">
              Client
              <div className="tenders-client-combobox">
                <input
                  value={selected.client}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={clientSuggestionsOpen && clientSuggestions.length > 0}
                  aria-controls="tender-client-suggestions"
                  placeholder="Start typing an existing client…"
                  onFocus={() => setClientSuggestionsOpen(true)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setClientSuggestionsOpen(true);
                    setTenders((current) =>
                      current.map((row) =>
                        row.id === selected.id
                          ? {
                              ...row,
                              client: value,
                              clientId:
                                row.clientId &&
                                clients.some((client) => client.id === row.clientId && client.name === value)
                                  ? row.clientId
                                  : undefined,
                            }
                          : row,
                      ),
                    );
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setClientSuggestionsOpen(false), 120);
                    const matched = clients.find(
                      (client) => client.name.toLowerCase() === selected.client.trim().toLowerCase(),
                    );
                    void saveSelected({
                      client: selected.client,
                      clientId: matched?.id || selected.clientId,
                    });
                  }}
                />
                {clientSuggestionsOpen && clientSuggestions.length > 0 ? (
                  <ul id="tender-client-suggestions" className="tenders-client-suggestions" role="listbox">
                    {clientSuggestions.map((client) => (
                      <li key={client.id} role="option">
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setTenders((current) =>
                              current.map((row) =>
                                row.id === selected.id
                                  ? { ...row, client: client.name, clientId: client.id }
                                  : row,
                              ),
                            );
                            setClientSuggestionsOpen(false);
                            void saveSelected({ client: client.name, clientId: client.id });
                          }}
                        >
                          <strong>{client.name}</strong>
                          <small>
                            {[client.accountReference, client.primaryContact, client.billingAddress]
                              .filter(Boolean)
                              .join(" · ") || "Existing client"}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {selected.clientId ? (
                <span className="tenders-client-linked">Linked to existing client record</span>
              ) : selected.client.trim() && selected.client.trim().toLowerCase() !== "client tbc" ? (
                <span className="tenders-client-hint">No client selected — keep typing or pick from the list</span>
              ) : null}
            </label>
            <label>
              Category
              <select
                value={selected.category}
                onChange={(event) => void saveSelected({ category: event.target.value })}
              >
                {TENDER_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Area
              <select value={selected.area} onChange={(event) => void saveSelected({ area: event.target.value })}>
                {TENDER_AREAS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={selected.status}
                onChange={(event) => void saveSelected({ status: event.target.value as TenderStatus })}
              >
                {TENDER_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <input
                value={selected.owner}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, owner: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ owner: event.target.value })}
              />
            </label>
            <label>
              Submission deadline
              <input
                type="date"
                value={selected.submissionDeadline || ""}
                onChange={(event) => void saveSelected({ submissionDeadline: event.target.value || undefined })}
              />
            </label>
            <label>
              Tender ID
              <input
                value={selected.externalId || ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) => (row.id === selected.id ? { ...row, externalId: event.target.value } : row)),
                  )
                }
                onBlur={(event) => void saveSelected({ externalId: event.target.value || undefined })}
              />
            </label>
            <label>
              Bid value (BoQ)
              <input value={money(boqTotal)} readOnly />
            </label>
            <label>
              Tender sum (FoT)
              <input
                type="number"
                step="0.01"
                value={selected.tenderSum ?? ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id ? { ...row, tenderSum: Number(event.target.value) || 0 } : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ tenderSum: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              Win probability %
              <input
                type="number"
                min={0}
                max={100}
                value={selected.winProbability ?? ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id
                        ? { ...row, winProbability: Number(event.target.value) || undefined }
                        : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ winProbability: Number(event.target.value) || undefined })}
              />
            </label>
            <label className="tenders-span-2">
              Materials / supplier notes
              <input
                value={selected.materialsNote || ""}
                onChange={(event) =>
                  setTenders((current) =>
                    current.map((row) =>
                      row.id === selected.id ? { ...row, materialsNote: event.target.value } : row,
                    ),
                  )
                }
                onBlur={(event) => void saveSelected({ materialsNote: event.target.value })}
                placeholder="e.g. awaiting Plumbase prices"
              />
            </label>
            <div className="tenders-span-2 tenders-qualifications">
              <div className="tenders-inline-head">
                <strong>Qualifications</strong>
                <span>
                  {progress.priced} priced · {progress.unpriced} unpriced (blank rate — not free)
                </span>
              </div>
              <ul>
                {selected.qualifications.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>
                    <span>{item}</span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void saveSelected({
                          qualifications: selected.qualifications.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="tenders-inline-add">
                <input
                  value={qualificationDraft}
                  onChange={(event) => setQualificationDraft(event.target.value)}
                  placeholder="Add qualification / caveat"
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    if (!qualificationDraft.trim()) return;
                    void saveSelected({
                      qualifications: [...selected.qualifications, qualificationDraft.trim()],
                    });
                    setQualificationDraft("");
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "boq" ? (
          <div className="tenders-boq">
            <div className="tenders-boq-summary">
              <div>
                <span className="permission-heading">Client BoQ</span>
                <h3>{selected.boqTitle || "Import their spreadsheet structure"}</h3>
                <p>
                  Price on their refs (e.g. 8/1/A). Keep every issued line — leave Rate blank if not priced so they can see it was not priced (do not put £0 / NIL).
                </p>
                <p className="tenders-boq-blake-note">
                  Blake budget prices fill blanks from the NeXa rate library first, then UK trade ballpark for gaps. Values are budget guides — not firm quotes. Unsure lines stay blank.
                </p>
                <div className="tenders-boq-blake-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.some((line) => line.kind === "measured")}
                    onClick={() => void runBlakeBudgetPrices(false)}
                  >
                    <Sparkles size={15} />
                    {blakeBudgetBusy ? "Blake pricing…" : "Blake budget prices"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.some((line) => line.kind === "measured")}
                    onClick={() => void runBlakeBudgetPrices(true)}
                    title="Re-run Blake/library on previous budget or guide rates (manual rates kept)"
                  >
                    Refresh budget guides
                  </button>
                  {blakeBudgetBusy ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={cancelBlakeBudgetPrices}
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.length}
                    onClick={() => void clearBoq()}
                    title="Remove imported lines so you can re-import a replacement BoQ"
                  >
                    <Trash2 size={15} />
                    Clear BoQ
                  </button>
                </div>
                {blakeBudgetStatus ? (
                  <p className="tenders-boq-blake-progress" aria-live="polite">
                    {blakeBudgetStatus}
                  </p>
                ) : null}
              </div>
              <div className="tenders-metric-row">
                <article>
                  <span>BoQ total</span>
                  <strong>{money(boqTotal)}</strong>
                </article>
                <article>
                  <span>FoT sum</span>
                  <strong>{money(selected.tenderSum ?? boqTotal)}</strong>
                </article>
                <article>
                  <span>Progress</span>
                  <strong>
                    {progress.priced}/{progress.measured}
                  </strong>
                </article>
              </div>
            </div>

            <div className="tenders-boq-import">
              <label>
                Import Excel / CSV / paste (columns: Ref, Description, Quantity, Units, Rate, Value)
                <textarea
                  rows={5}
                  value={boqImportText}
                  onChange={(event) => setBoqImportText(event.target.value)}
                  placeholder={`Plumbing e-Enquiry [...]\nRef,Description,Quantity,Units,Rate,Value\n8/1/A,Doc M Toilet Pack,1,nr,1836,1836`}
                />
              </label>
              <div className="tenders-inline-add">
                <FileDropZone
                  accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  label="Drop BoQ spreadsheet here or click to browse"
                  hint=".xlsx / .xls (all sheets) · .csv"
                  disabled={saving}
                  onFiles={(files) => void onBoqFile(files[0] ?? null)}
                />
                <button type="button" className="primary-button" disabled={saving || !boqImportText.trim()} onClick={() => void importBoq()}>
                  <FileSpreadsheet size={15} />
                  {selected.boqLines.length ? "Replace with pasted BoQ" : "Import pasted BoQ"}
                </button>
              </div>
            </div>

            <div className="tenders-boq-table-wrap">
              <table className="tenders-boq-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Value</th>
                    <th>Note</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.boqLines.length ? (
                    selected.boqLines.map((line) => {
                      if (line.kind === "header") {
                        return (
                          <tr key={line.id} className="tenders-boq-header-row">
                            <td colSpan={8}>{line.description}</td>
                          </tr>
                        );
                      }
                      const priced =
                        (typeof line.rate === "number" && Number.isFinite(line.rate)) ||
                        (typeof line.value === "number" && Number.isFinite(line.value));
                      const statusClass = !priced
                        ? "unpriced"
                        : line.pricingSource === "blake-budget"
                          ? "budget"
                          : line.pricingSource === "rate-library"
                            ? "guide"
                            : "priced";
                      const statusLabel = !priced
                        ? "Unpriced"
                        : line.pricingSource === "blake-budget"
                          ? "Budget"
                          : line.pricingSource === "rate-library"
                            ? "Guide"
                            : "Priced";
                      return (
                        <tr key={line.id} className={priced ? "" : "unpriced"}>
                          <td>{line.ref || "—"}</td>
                          <td>{line.description}</td>
                          <td>{line.quantity ?? ""}</td>
                          <td>{line.unit || ""}</td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              key={`${line.id}-${line.rate ?? "blank"}-${line.pricingSource || ""}`}
                              defaultValue={line.rate ?? ""}
                              placeholder=""
                              aria-label={priced ? "Rate" : "Unpriced — leave blank"}
                              onBlur={(event) => {
                                const raw = event.target.value.trim();
                                const rate = raw === "" ? null : Number(raw);
                                void patchBoqLine(line.id, { rate, value: rate === null ? null : undefined });
                              }}
                            />
                          </td>
                          <td>{priced ? money(line.value) : ""}</td>
                          <td>
                            <input
                              key={`${line.id}-note-${line.note || ""}`}
                              defaultValue={line.note || ""}
                              onBlur={(event) => void patchBoqLine(line.id, { note: event.target.value })}
                            />
                          </td>
                          <td>
                            <span className={`tenders-line-status ${statusClass}`}>{statusLabel}</span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8}>No BoQ lines yet — import their issued Excel/CSV bill.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "documents" ? (
          <div className="tenders-docs">
            <p>Upload the issued pack, priced return, drawings, specs and supplier quotes against this tender.</p>
            <div className="tenders-doc-upload">
              <label>
                Document type
                <select id="tender-doc-kind" defaultValue="drawing">
                  {DOC_KINDS.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Files
                <FileDropZone
                  multiple
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg,.zip"
                  label="Drop tender documents here or click to browse"
                  hint="PDF, drawings, Excel, Word, images"
                  disabled={saving}
                  onFiles={async (files) => {
                    const kindSelect = document.getElementById("tender-doc-kind") as HTMLSelectElement | null;
                    const kind = (kindSelect?.value || "other") as TenderDocumentKind;
                    for (const file of files) {
                      await uploadImportFile("upload-document", file, {
                        tenderId: selected.id,
                        kind,
                      });
                    }
                  }}
                />
              </label>
            </div>
            <ul className="tenders-doc-list">
              {DOC_KINDS.map(({ kind, label }) => {
                const matched = (selected.documents || []).filter((doc) => doc.kind === kind);
                return (
                  <li key={kind} className="tenders-doc-kind">
                    <strong>{label}</strong>
                    {matched.length ? (
                      <ul className="tenders-doc-file-list">
                        {matched.map((doc) => (
                          <li key={doc.id} className="tenders-doc-file-row">
                            <div className="tenders-doc-file-meta">
                              {doc.url ? (
                                <a href={doc.url} target="_blank" rel="noreferrer">
                                  {doc.name}
                                </a>
                              ) : (
                                <span>{doc.name}</span>
                              )}
                              {doc.note ? <small>{doc.note}</small> : null}
                            </div>
                            <button
                              type="button"
                              className="secondary-button tenders-doc-delete"
                              disabled={saving}
                              aria-label={`Remove ${doc.name}`}
                              title="Remove document"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void deleteDocument(doc.id, doc.name);
                              }}
                            >
                              <Trash2 size={14} />
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="tenders-doc-empty">Not attached yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {tab === "submit" ? (
          <div className="tenders-submit">
            <article>
              <span className="permission-heading">Return pack</span>
              <h3>What goes back to the main contractor</h3>
              <ol>
                <li>Priced BoQ on <em>their</em> spreadsheet structure (export/CSV you imported and priced).</li>
                <li>Form of Tender PDF (NeXa generated from this record).</li>
                <li>Optional covering note with qualifications already on the FoT appendix.</li>
              </ol>
              <div className="tenders-metric-row">
                <article>
                  <span>Status</span>
                  <strong>{selected.status}</strong>
                </article>
                <article>
                  <span>Submitted</span>
                  <strong>{selected.submittedAt ? selected.submittedAt.slice(0, 10) : "Not yet"}</strong>
                </article>
                <article>
                  <span>FoT sum</span>
                  <strong>{money(selected.tenderSum ?? boqTotal)}</strong>
                </article>
              </div>
              <div className="tenders-toolbar-actions" style={{ marginTop: 16 }}>
                <button type="button" className="secondary-button" onClick={() => void downloadFormOfTender()}>
                  <Download size={15} />
                  Download Form of Tender
                </button>
                <button type="button" className="primary-button" disabled={saving} onClick={() => void submitTender()}>
                  <Send size={15} />
                  Mark Sent + download FoT
                </button>
              </div>
            </article>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="quote-panel record-directory workflow-directory tender-directory tenders-workspace" aria-label="Tender tracker">
      <div className="panel-header">
        <div>
          <h2>Tender register</h2>
          <p>Deadlines, owners and bid values — open a row to price their BoQ and generate the Form of Tender.</p>
        </div>
        <div className="panel-controls">
          <FileDropZone
            compact
            className="tenders-tracker-drop"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            label="Import tracker Excel"
            hint="Drop spreadsheet or click"
            disabled={saving || loading}
            onFiles={(files) => void uploadImportFile("import-tracker", files[0] ?? null)}
          />
          <button type="button" className="secondary-button" onClick={() => void loadTenders()} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" className="primary-button" onClick={() => void createTender()} disabled={saving}>
            <Plus size={15} />
            New tender
          </button>
        </div>
      </div>

      <div className="directory-register-search-row">
        <label className="directory-panel-search directory-panel-search-wide">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Search tenders"
            placeholder="Search tenders..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="record-folder-grid register-kpi-grid">
        <article className="record-folder-card blue">
          <span>Live tenders</span>
          <strong>{tenders.filter((t) => !["Won", "Lost"].includes(t.status)).length}</strong>
        </article>
        <article className="record-folder-card green">
          <span>Pipeline value</span>
          <strong>{money(pipelineValue)}</strong>
        </article>
        <article className="record-folder-card amber">
          <span>Due this week</span>
          <strong>
            {tenders.filter((t) => alertForDeadline(t.submissionDeadline) === "Due this week").length}
          </strong>
        </article>
      </div>

      <div className="po-register-tabs" role="tablist" aria-label="Tender folders">
        {folders.map((folder) => (
          <button
            key={folder.key}
            type="button"
            role="tab"
            aria-selected={folderKey === folder.key}
            className={folderKey === folder.key ? "active" : ""}
            onClick={() => {
              setFolderKey(folder.key);
              clearSelection();
            }}
          >
            {folder.label}
          </button>
        ))}
      </div>

      <div className="directory-bulk-action-bar quote-bulk-action-bar">
        <span>{selectedIds.length} selected</span>
        <button className="simpro-options-button" type="button" onClick={selectAllVisible} disabled={!filtered.length}>
          Select all
        </button>
        <button className="simpro-options-button" type="button" onClick={clearSelection} disabled={!selectedIds.length}>
          Deselect all
        </button>
        <button className="simpro-options-button" type="button" disabled={!selectedIds.length || saving} onClick={() => void bulkArchive()}>
          Archive selected
        </button>
        <button className="simpro-options-button" type="button" disabled={!selectedIds.length || saving} onClick={() => void bulkDelete()}>
          Delete selected
        </button>
        <button
          className="simpro-options-button"
          type="button"
          disabled={selectedIds.length !== 1 || saving}
          onClick={() => {
            const id = selectedIds[0];
            if (id) void markWon(id);
          }}
        >
          Mark Won → job
        </button>
      </div>

      <div className="tenders-table-wrap">
        {loading ? (
          <p className="tenders-hint">Loading tenders…</p>
        ) : filtered.length === 0 ? (
          <p className="tenders-hint">
            <ClipboardList size={16} style={{ marginRight: 6 }} />
            {search.trim() ? "No tenders match this search in the current folder." : "No tenders in this folder."}
          </p>
        ) : (
          <table className="tenders-table">
            <thead>
              <tr>
                <th className="tenders-check-col">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((tender) => selectedIds.includes(tender.id))}
                    onChange={(event) => {
                      if (event.target.checked) selectAllVisible();
                      else clearSelection();
                    }}
                    aria-label="Select all visible tenders"
                  />
                </th>
                <th>Opportunity</th>
                <th>Client</th>
                <th>Category</th>
                <th>Area</th>
                <th>Deadline</th>
                <th>Days</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Bid value</th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tender) => {
                const days = daysLeftForDeadline(tender.submissionDeadline);
                const alert = alertForDeadline(tender.submissionDeadline);
                const openTender = () => {
                  setSelectedId(tender.id);
                  setTab("overview");
                };
                return (
                  <tr
                    key={tender.id}
                    className="tenders-row-clickable"
                    onClick={openTender}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTender();
                      }
                    }}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open tender ${tender.name}`}
                  >
                    <td className="tenders-check-col" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(tender.id)}
                        onChange={() => toggleSelected(tender.id)}
                        aria-label={`Select ${tender.name}`}
                      />
                    </td>
                    <td>
                      <strong>{tender.name}</strong>
                      {tender.externalId ? <small> #{tender.externalId}</small> : null}
                      {tender.convertedJobRef ? <div className="tenders-note">Job {tender.convertedJobRef}</div> : null}
                      {tender.linkedTakeoffRef ? <div className="tenders-note">Takeoff {tender.linkedTakeoffRef}</div> : null}
                      {tender.materialsNote ? <div className="tenders-note">{tender.materialsNote}</div> : null}
                    </td>
                    <td>{tender.client}</td>
                    <td>{tender.category}</td>
                    <td>{tender.area}</td>
                    <td>{tender.submissionDeadline || "—"}</td>
                    <td>{days === null ? "—" : days}</td>
                    <td>
                      <span className={`tenders-status ${tender.status.replace(/\s+/g, "-").toLowerCase()}`}>
                        {tender.status}
                      </span>
                    </td>
                    <td>{tender.owner || "—"}</td>
                    <td>{money(tender.tenderSum || tender.bidValue)}</td>
                    <td>
                      {alert ? (
                        <span className={`tenders-alert ${alert.replace(/\s+/g, "-").toLowerCase()}`}>
                          {alert === "Overdue" || alert === "Due this week" ? <AlertTriangle size={12} /> : null}
                          {alert}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
