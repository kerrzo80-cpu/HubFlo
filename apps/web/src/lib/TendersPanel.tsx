"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { TenderAiTakeoffPanel } from "@/lib/TenderAiTakeoffPanel";
import {
  isTenderDocumentKind,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderPathLabel,
  type TenderDocumentFolder,
} from "@/lib/tender-document-folders";
import {
  filterBoqLinesBySheet,
  filterSelectedMeasuredLineIds,
  groupBoqLinesBySection,
  isBoqSheetEchoHeader,
  listBoqSheetTabs,
} from "@/lib/tender-boq-sections";
import {
  TENDER_AREAS,
  TENDER_CATEGORIES,
  TENDER_STATUSES,
  alertForDeadline,
  boqProgress,
  computeBoqTotal,
  daysLeftForDeadline,
  sortTendersByDueDate,
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

type TabKey = "overview" | "boq" | "documents" | "ai-takeoff" | "submit";

const BOQ_EDITOR_ACTIONS = new Set([
  "import-boq",
  "clear-boq",
  "update-boq-line",
  "add-boq-line",
  "delete-boq-lines",
  "add-boq-sheet",
  "rename-boq-sheet",
  "delete-boq-sheet",
  "move-boq-lines",
  "move-boq-lines-to-section",
  "merge-boq-lines",
]);

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
  businessName = "Company",
  actorName = "NeXa user",
  clients = [],
  onOpenPendingJob,
  jobExists,
  onTenderJobStructure,
  onOpenTenderChange,
  boqRefreshToken = 0,
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
  /** True when the linked Core job id still exists (stale links show Recreate). */
  jobExists?: (jobId: string) => boolean;
  /** Apply BoQ-built sections/cost centres into Core job state immediately. */
  onTenderJobStructure?: (payload: {
    jobId: string;
    job?: { id: string; ref: string; value?: number } | null;
    jobSections: Array<{ id: string; name: string; description: string }>;
    jobCostCentres: Array<Record<string, unknown>>;
  }) => void;
  /** Lets Ask Blake talk about the open tender. */
  onOpenTenderChange?: (tender: { id: string; name: string } | null) => void;
  /** Increment after Blake writes rates from Ask Blake so the open Bill reloads. */
  boqRefreshToken?: number;
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
  /** When lines already exist, default to appending supplier/extra items rather than wiping the bill. */
  const [boqImportMode, setBoqImportMode] = useState<"append" | "replace">("append");
  const [qualificationDraft, setQualificationDraft] = useState("");
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
  const [blakeBudgetBusy, setBlakeBudgetBusy] = useState(false);
  const [blakeBudgetStatus, setBlakeBudgetStatus] = useState<string | null>(null);
  const blakeBudgetAbortRef = useRef<AbortController | null>(null);
  const [boqBlakeLineIds, setBoqBlakeLineIds] = useState<string[]>([]);
  const [boqSheetTab, setBoqSheetTab] = useState<string | null>(null);
  const [boqSheetMoveMode, setBoqSheetMoveMode] = useState<"move" | "merge" | null>(null);
  const [boqMoveTarget, setBoqMoveTarget] = useState("__new__");
  const [boqSectionMoveOpen, setBoqSectionMoveOpen] = useState(false);
  const [boqSectionMoveTarget, setBoqSectionMoveTarget] = useState("__new__");
  const [uploadTarget, setUploadTarget] = useState<DocTargetValue>("kind:drawing");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<DocTargetValue>("kind:drawing");

  const selected = useMemo(
    () => tenders.find((tender) => tender.id === selectedId) ?? null,
    [selectedId, tenders],
  );

  const documentFolders = selected?.documentFolders || [];
  const folderOptions = useMemo(() => listFolderOptions(documentFolders), [documentFolders]);
  const boqSheetTabs = useMemo(
    () => listBoqSheetTabs(selected?.boqLines || []),
    [selected?.boqLines],
  );
  const activeBoqSheet = useMemo(() => {
    if (!boqSheetTabs.length) return null;
    if (boqSheetTab && boqSheetTabs.some((tab) => tab.key === boqSheetTab)) return boqSheetTab;
    return boqSheetTabs[0]?.key || null;
  }, [boqSheetTab, boqSheetTabs]);
  const boqVisibleLines = useMemo(
    () => filterBoqLinesBySheet(selected?.boqLines || [], activeBoqSheet),
    [activeBoqSheet, selected?.boqLines],
  );
  const boqSections = useMemo(
    () => groupBoqLinesBySection(boqVisibleLines),
    [boqVisibleLines],
  );
  const activeSheetMeasuredIds = useMemo(
    () => boqSheetTabs.find((tab) => tab.key === activeBoqSheet)?.measuredIds || [],
    [activeBoqSheet, boqSheetTabs],
  );
  const boqBlakeSelectedCount = useMemo(
    () => filterSelectedMeasuredLineIds(selected?.boqLines || [], boqBlakeLineIds).length,
    [boqBlakeLineIds, selected?.boqLines],
  );
  const boqSheetHasVisibleRows = useMemo(
    () =>
      boqVisibleLines.some(
        (line) => !(boqSheetTabs.length > 0 && isBoqSheetEchoHeader(line)),
      ),
    [boqSheetTabs.length, boqVisibleLines],
  );
  const boqOtherSheetTabs = useMemo(
    () => boqSheetTabs.filter((tab) => tab.key !== activeBoqSheet),
    [activeBoqSheet, boqSheetTabs],
  );

  useEffect(() => {
    setBoqBlakeLineIds([]);
    setBoqSheetTab(null);
    setBoqImportMode("append");
    setBoqSheetMoveMode(null);
    setBoqMoveTarget("__new__");
  }, [selectedId]);

  useEffect(() => {
    if (!boqSheetTabs.length) {
      setBoqSheetTab(null);
      return;
    }
    setBoqSheetTab((current) =>
      current && boqSheetTabs.some((tab) => tab.key === current) ? current : boqSheetTabs[0]!.key,
    );
  }, [boqSheetTabs]);

  useEffect(() => {
    if (!selected) return;
    const measured = new Set(
      selected.boqLines.filter((line) => line.kind === "measured").map((line) => line.id),
    );
    setBoqBlakeLineIds((current) => current.filter((id) => measured.has(id)));
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const valid = new Set(folderOptions.map((option) => option.value));
    if (!valid.has(uploadTarget)) setUploadTarget("kind:drawing");
    if (!valid.has(newFolderParent)) setNewFolderParent("kind:drawing");
  }, [folderOptions, newFolderParent, selected, uploadTarget]);

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
      // List is lean (no BoQ arrays) — preserve any BoQ already loaded for the open tender.
      setTenders((current) => {
        const previousById = new Map(current.map((row) => [row.id, row]));
        const next = Array.isArray(payload.tenders) ? payload.tenders : [];
        return next.map((row) => {
          const previous = previousById.get(row.id);
          if (previous?.boqLines?.length && !(row.boqLines && row.boqLines.length)) {
            return { ...row, boqLines: previous.boqLines, boqTitle: row.boqTitle || previous.boqTitle };
          }
          return row;
        });
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to load tenders");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedTenderBoq(tenderId: string) {
    try {
      const response = await fetch(`/api/tenders?id=${encodeURIComponent(tenderId)}`, {
        headers: requestHeaders,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { tender?: Tender };
      if (!payload.tender?.id) return;
      setTenders((current) => {
        const exists = current.some((row) => row.id === payload.tender!.id);
        if (!exists) return [...current, payload.tender!];
        return current.map((row) => (row.id === payload.tender!.id ? payload.tender! : row));
      });
    } catch {
      // Non-fatal — tracker still works without the open Bill.
    }
  }

  useEffect(() => {
    void loadTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setClientSuggestionsOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const open = tenders.find((row) => row.id === selectedId);
    if (open && Array.isArray(open.boqLines) && open.boqLines.length > 0) return;
    void loadSelectedTenderBoq(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    onOpenTenderChange?.(selected ? { id: selected.id, name: selected.name } : null);
  }, [onOpenTenderChange, selected?.id, selected?.name]);

  useEffect(() => () => onOpenTenderChange?.(null), [onOpenTenderChange]);

  useEffect(() => {
    if (!selectedId || !boqRefreshToken) return;
    void loadSelectedTenderBoq(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqRefreshToken]);

  useEffect(() => {
    if (selected && tenderNeedsJob(selected)) {
      setTab("overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.status, selected?.convertedJobId]);

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
        sheetKey?: string;
        movedCount?: number;
        sectionLabel?: string;
        addedSheets?: string[];
        job?: { id: string; ref: string; value?: number } | null;
        alreadyConverted?: boolean;
        recreated?: boolean;
        jobSections?: Array<{ id: string; name: string; description: string }>;
        jobCostCentres?: Array<Record<string, unknown>>;
        notice?: string;
        documentsCopied?: number;
        copied?: number;
        skipped?: number;
      };
      if (!response.ok) throw new Error(payload.error || "Request failed");
      const editor = payload.tender;
      const editorIncludesBoq =
        Boolean(editor?.id) &&
        BOQ_EDITOR_ACTIONS.has(String(body.action || "")) &&
        Array.isArray(editor?.boqLines);
      // Lean POST list strips boqLines to protect Render memory. Keep the open
      // Bill unless this action returned the full editor payload (add line / move / etc).
      setTenders((current) => {
        const previousById = new Map(current.map((row) => [row.id, row]));
        let next = current;
        if (Array.isArray(payload.tenders)) {
          next = payload.tenders.map((row) => {
            const previous = previousById.get(row.id);
            if (previous?.boqLines?.length && !(row.boqLines && row.boqLines.length)) {
              return { ...row, boqLines: previous.boqLines, boqTitle: row.boqTitle || previous.boqTitle };
            }
            return row;
          });
        }
        if (!editor?.id) return next;
        const existingRow = next.find((row) => row.id === editor.id);
        const merged: Tender = editorIncludesBoq
          ? editor
          : {
              ...(existingRow || editor),
              ...editor,
              boqLines: existingRow?.boqLines?.length ? existingRow.boqLines : editor.boqLines || [],
            };
        if (!existingRow) return [merged, ...next];
        return next.map((row) => (row.id === editor.id ? { ...row, ...merged } : row));
      });
      if (editor?.id) setSelectedId(editor.id);
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
      { key: "won" as const, label: "Won", tone: "green", items: won, detail: "Accepted — creates a Pending job for scheduling" },
      { key: "lost" as const, label: "Lost / archived", tone: "amber", items: lost, detail: "Lost or archived tenders" },
      { key: "all" as const, label: "All", tone: "blue", items: tenders, detail: "Everything" },
    ];
  }, [tenders]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const folderItems = folders.find((folder) => folder.key === folderKey)?.items ?? tenders;
    const matched = !query
      ? folderItems
      : folderItems.filter((tender) =>
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
    // Folder/search first, then soonest deadline — undated last.
    return sortTendersByDueDate(matched);
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

  function tenderNeedsJob(tender: Tender | null | undefined) {
    if (!tender || tender.status !== "Won") return false;
    if (!tender.convertedJobId) return true;
    if (!jobExists) return false;
    return !jobExists(tender.convertedJobId);
  }

  function tenderJobMissing(tender: Tender | null | undefined) {
    if (!tender?.convertedJobId || tender.status !== "Won") return false;
    if (!jobExists) return false;
    return !jobExists(tender.convertedJobId);
  }

  function applyJobStructureFromResult(result: {
    job?: { id: string; ref: string; value?: number } | null;
    tender?: Tender;
    jobSections?: Array<{ id: string; name: string; description: string }>;
    jobCostCentres?: Array<Record<string, unknown>>;
  }) {
    const jobId = result.job?.id || result.tender?.convertedJobId;
    if (!jobId) return;
    if (!result.jobSections?.length && !result.jobCostCentres?.length) return;
    onTenderJobStructure?.({
      jobId,
      job: result.job,
      jobSections: result.jobSections || [],
      jobCostCentres: result.jobCostCentres || [],
    });
  }

  async function markWon(tenderId: string, options?: { skipConfirm?: boolean }) {
    const tender = tenders.find((row) => row.id === tenderId);
    const missingLinkedJob = tenderJobMissing(tender);
    const alreadyLinked = Boolean(tender?.convertedJobId) && !missingLinkedJob;
    if (!options?.skipConfirm) {
      const ok = window.confirm(
        missingLinkedJob
          ? `Linked job ${tender?.convertedJobRef || tender?.convertedJobId} is missing. Recreate a Pending job from “${tender?.name || "this tender"}”?`
          : alreadyLinked
            ? `Mark “${tender?.name || "this tender"}” as Won? Linked job ${tender?.convertedJobRef || tender?.convertedJobId} stays — no second job.`
            : `Create a Pending job from “${tender?.name || "this tender"}” and mark it Won?\n\nSame as converting a quote — job record + value only. Cost centres and drawings can be added afterwards from the job.`,
      );
      if (!ok) return;
    }
    try {
      const result = await postAction({ action: "convert-won", id: tenderId });
      applyJobStructureFromResult(result);
      if (result.alreadyConverted && result.tender?.convertedJobId) {
        onNotice(`Already won — job ${result.tender.convertedJobRef || result.tender.convertedJobId}.`);
        onOpenPendingJob?.(result.tender.convertedJobId);
        return;
      }
      if (result.job?.id) {
        onNotice(
          result.recreated
            ? `Missing job recreated — pending job ${result.job.ref}. Use Rebuild cost centres / Sync drawings if needed.`
            : `Tender won — pending job ${result.job.ref} created (like a quote). Use Rebuild cost centres / Sync drawings if needed.`,
        );
        onOpenPendingJob?.(result.job.id);
      } else {
        onNotice("Tender marked Won.");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to mark won");
    }
  }

  async function rebuildJobCostCentres() {
    if (!selected?.convertedJobId) return;
    if (
      !window.confirm(
        `Rebuild lean cost centres for “${selected.name}” from tender sheet totals?\n\nFloor/service stubs replace the current structure (no BoQ line dump). Daywork centres are kept. Use Sync drawings separately.`,
      )
    ) {
      return;
    }
    try {
      const result = await postAction({ action: "rebuild-job-cost-centres", id: selected.id });
      applyJobStructureFromResult(result);
      onNotice(result.notice || "Rebuilt lean centres (no line dump)");
      if (result.job?.id || selected.convertedJobId) {
        onOpenPendingJob?.(result.job?.id || selected.convertedJobId!);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to rebuild cost centres");
    }
  }

  async function syncJobDocuments() {
    if (!selected?.convertedJobId) return;
    try {
      const result = await postAction({ action: "sync-job-documents", id: selected.id });
      onNotice(
        `Synced ${result.copied || 0} tender document(s) onto job ${selected.convertedJobRef || selected.convertedJobId}${
          result.skipped ? ` · ${result.skipped} skipped` : ""
        }.`,
      );
      if (selected.convertedJobId) onOpenPendingJob?.(selected.convertedJobId);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to sync documents");
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

  async function createDocumentFolder() {
    if (!selected) return;
    const name = newFolderName.trim();
    if (!name) {
      onNotice("Enter a folder name first.");
      return;
    }
    const parent = decodeDocTarget(newFolderParent);
    try {
      await postAction({
        action: "create-document-folder",
        id: selected.id,
        folderName: name,
        parentId: parent.folderId || parent.kind || null,
      });
      setNewFolderName("");
      onNotice(`Folder “${name}” created.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to create folder");
    }
  }

  async function deleteDocumentFolder(folderId: string, folderName: string) {
    if (!selected) return;
    if (!window.confirm(`Remove folder “${folderName}”? Files move up to the parent folder.`)) return;
    try {
      await postAction({ action: "delete-document-folder", id: selected.id, folderId });
      onNotice(`Removed folder ${folderName}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to remove folder");
    }
  }

  async function moveDocument(documentId: string, targetValue: string) {
    if (!selected) return;
    const target = decodeDocTarget(targetValue);
    try {
      await postAction({
        action: "move-document",
        id: selected.id,
        documentId,
        kind: target.kind,
        folderId: target.folderId ?? null,
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to move document");
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
      setBoqBlakeLineIds([]);
      onNotice("BoQ cleared — import a new spreadsheet when ready.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to clear BoQ");
    }
  }

  function confirmReplaceBoq(lineCount: number) {
    if (!lineCount) return true;
    return window.confirm(
      `Replace the existing BoQ (${lineCount} line${lineCount === 1 ? "" : "s"}) with this import?\n\nPricing on the old lines will be lost. Choose “Add to BoQ” if you only want to append supplier / extra items.`,
    );
  }

  function effectiveBoqImportMode(lineCount: number): "append" | "replace" {
    if (!lineCount) return "replace";
    return boqImportMode;
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
    // Route status→Won through convert so the confirm + job handoff stay consistent.
    if (patch.status === "Won" && selected.status !== "Won") {
      await markWon(selected.id);
      return;
    }
    try {
      const result = await postAction({ action: "update", id: selected.id, patch });
      if (patch.status && patch.status !== "Won" && selected.status === "Won") {
        const linked =
          result.tender?.convertedJobRef || result.tender?.convertedJobId || selected.convertedJobRef;
        onNotice(
          linked
            ? `Tender reopened as ${patch.status}. Linked job ${linked} kept — open it from Jobs anytime.`
            : `Tender reopened as ${patch.status}.`,
        );
      }
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
    const mode = effectiveBoqImportMode(selected.boqLines.length);
    if (mode === "replace" && !confirmReplaceBoq(selected.boqLines.length)) return;
    try {
      const result = await postAction({
        action: "import-boq",
        id: selected.id,
        boqText: boqImportText,
        mode,
        // Paste always lands on its own tab — never the active Sales Order / takeoff sheet.
        appendSheetLabel: "Additional items",
      });
      setBoqImportText("");
      setBoqBlakeLineIds([]);
      setTab("boq");
      const addedSheets = Array.isArray(result.addedSheets) ? result.addedSheets : [];
      const pastedSheet = addedSheets.find((name) => typeof name === "string" && name.trim());
      if (typeof pastedSheet === "string") setBoqSheetTab(pastedSheet);
      onNotice(
        mode === "append"
          ? "Pasted BoQ lines added on their own sheet tab — existing priced work kept."
          : "BoQ replaced — all issued lines kept; blank rates stay unpriced (not free).",
      );
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
        mode?: string;
        addedSheets?: string[];
      };
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      if (Array.isArray(payload.tenders)) {
        setTenders((prev) => {
          const leanById = new Map(payload.tenders!.map((row) => [row.id, row]));
          return prev.map((row) => {
            const lean = leanById.get(row.id);
            if (!lean) return row;
            return {
              ...row,
              ...lean,
              boqLines: lean.boqLines?.length ? lean.boqLines : row.boqLines,
            };
          });
        });
      }
      if (payload.tender?.id) {
        setTenders((current) => {
          const exists = current.some((row) => row.id === payload.tender!.id);
          const next = payload.tender!;
          if (exists) {
            return current.map((row) =>
              row.id === next.id
                ? { ...row, ...next, boqLines: next.boqLines?.length ? next.boqLines : row.boqLines }
                : row,
            );
          }
          return [next, ...current];
        });
      }
      if (payload.tender?.id) setSelectedId(payload.tender.id);
      if (action === "import-boq") {
        // PDF/Excel import must not also consume leftover takeoff text in the paste box.
        setBoqImportText("");
        setBoqBlakeLineIds([]);
        setTab("boq");
        const newSheet = payload.addedSheets?.find((name) => name.trim()) || null;
        if (newSheet) setBoqSheetTab(newSheet);
      }
      onNotice(
        payload.message ||
          (action === "import-boq"
            ? payload.mode === "append"
              ? "BoQ lines added."
              : "BoQ spreadsheet imported."
            : action === "import-tracker"
              ? `Tracker imported (${payload.created ?? 0} new, ${payload.updated ?? 0} updated).`
              : "Document uploaded."),
      );
      if (action === "upload-document") setTab("documents");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to upload");
    } finally {
      setSaving(false);
    }
  }

  async function onBoqFile(file: File | null) {
    if (!file || !selected) return;
    const mode = effectiveBoqImportMode(selected.boqLines.length);
    if (mode === "replace" && !confirmReplaceBoq(selected.boqLines.length)) return;
    const name = file.name.toLowerCase();
    const appendSheetLabel = file.name.replace(/\.[^.]+$/, "").trim() || "Additional items";
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".pdf") ||
      file.type === "application/pdf"
    ) {
      // File-only path — never parse the paste textarea together with the PDF/Excel.
      await uploadImportFile("import-boq", file, {
        tenderId: selected.id,
        mode,
        appendSheetLabel,
      });
      return;
    }
    const text = await file.text();
    setBoqImportText(text);
  }

  async function downloadBoqSpreadsheet(
    scope: "all" | "active",
    format: "xlsx" | "csv" | "pdf" = "xlsx",
    options?: { quiet?: boolean },
  ) {
    if (!selected || !selected.boqLines.length) return false;
    const params = new URLSearchParams({ format, scope });
    if (scope === "active" && activeBoqSheet) params.set("sheet", activeBoqSheet);
    const response = await fetch(`/api/tenders/${selected.id}/boq-export?${params}`, {
      headers: requestHeaders,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!options?.quiet) onNotice(payload.error || "Unable to export BoQ.");
      return false;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const disposition = response.headers.get("Content-Disposition") || "";
    const matched = /filename="([^"]+)"/i.exec(disposition);
    const ext = format === "csv" ? "csv" : format === "pdf" ? "pdf" : "xlsx";
    anchor.href = url;
    anchor.download =
      matched?.[1] || `BoQ_${selected.name.replace(/[^a-z0-9]+/gi, "_")}.${ext}`;
    anchor.click();
    URL.revokeObjectURL(url);
    const label = format === "pdf" ? "PDF" : format.toUpperCase();
    if (!options?.quiet) {
      onNotice(
        scope === "active"
          ? `Exported active sheet${activeBoqSheet ? ` (${activeBoqSheet})` : ""} as ${label}.`
          : `Exported full BoQ as ${label}.`,
      );
    }
    return true;
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

  async function addBoqLine() {
    if (!selected) return;
    try {
      await postAction({
        action: "add-boq-line",
        id: selected.id,
        sheetKey: activeBoqSheet || undefined,
        line: { description: "New item", quantity: 1, unit: "nr" },
      });
      setTab("boq");
      onNotice(activeBoqSheet ? `Line added on “${activeBoqSheet}”.` : "Line added.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to add BoQ line");
    }
  }

  async function deleteBoqLinesByIds(lineIds: string[]) {
    if (!selected || !lineIds.length) return;
    const count = lineIds.length;
    if (
      !window.confirm(
        `Delete ${count} BoQ line${count === 1 ? "" : "s"}?\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await postAction({
        action: "delete-boq-lines",
        id: selected.id,
        lineIds,
      });
      setBoqBlakeLineIds((current) => current.filter((id) => !lineIds.includes(id)));
      onNotice(`Deleted ${count} line${count === 1 ? "" : "s"}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to delete BoQ lines");
    }
  }

  function openBoqSheetMove(mode: "move" | "merge") {
    const fallback = boqOtherSheetTabs[0]?.key || "__new__";
    setBoqMoveTarget(fallback);
    setBoqSectionMoveOpen(false);
    setBoqSheetMoveMode(mode);
  }

  async function applyBoqSheetMove() {
    if (!selected || !boqSheetMoveMode) return;
    const lineIds = filterSelectedMeasuredLineIds(selected.boqLines, boqBlakeLineIds);
    const mergeWholeSource =
      boqSheetMoveMode === "merge" &&
      Boolean(activeBoqSheet) &&
      activeSheetMeasuredIds.length > 0 &&
      activeSheetMeasuredIds.every((id) => lineIds.includes(id));
    if (!lineIds.length && !mergeWholeSource) {
      onNotice("Tick the lines you want to move, or Select sheet then Merge into tab.");
      return;
    }
    let dest = boqMoveTarget.trim();
    if (!dest || dest === "__new__") {
      const suggested = window.prompt(
        "New sheet tab name",
        activeBoqSheet && /general/i.test(activeBoqSheet) ? "Heating" : "Sheet",
      );
      if (suggested === null) return;
      dest = suggested.trim();
    }
    if (!dest) {
      onNotice("Sheet name required.");
      return;
    }
    if (activeBoqSheet && dest.toLowerCase() === activeBoqSheet.toLowerCase() && dest !== "__new__") {
      const existingKey = boqSheetTabs.find((tab) => tab.key.toLowerCase() === dest.toLowerCase())?.key;
      if (existingKey === activeBoqSheet) {
        onNotice("Pick a different sheet, or type a new tab name.");
        return;
      }
    }
    try {
      const result = await postAction({
        action: boqSheetMoveMode === "merge" ? "merge-boq-lines" : "move-boq-lines",
        id: selected.id,
        lineIds,
        sheetName: dest,
        sourceSheet: activeBoqSheet || undefined,
        mergeWholeSource: mergeWholeSource || undefined,
      });
      const sheetKey = typeof result.sheetKey === "string" ? result.sheetKey : dest;
      const moved = typeof result.movedCount === "number" ? result.movedCount : lineIds.length;
      setBoqSheetTab(sheetKey);
      setBoqBlakeLineIds([]);
      setBoqSheetMoveMode(null);
      setTab("boq");
      onNotice(
        boqSheetMoveMode === "merge"
          ? `Merged ${moved} line${moved === 1 ? "" : "s"} into “${sheetKey}”.`
          : `Moved ${moved} line${moved === 1 ? "" : "s"} to “${sheetKey}”.`,
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to move BoQ lines");
    }
  }

  function openBoqSectionMove() {
    const first = boqSections.find((s) => s.headerId);
    setBoqSectionMoveTarget(first?.key || "__new__");
    setBoqSheetMoveMode(null);
    setBoqSectionMoveOpen(true);
  }

  async function applyBoqSectionMove() {
    if (!selected) return;
    const lineIds = filterSelectedMeasuredLineIds(selected.boqLines, boqBlakeLineIds);
    if (!lineIds.length) {
      onNotice("Tick the lines you want to move into a section.");
      return;
    }
    let targetSectionId = boqSectionMoveTarget;
    let newSectionName: string | undefined;
    if (!targetSectionId || targetSectionId === "__new__") {
      const suggested = window.prompt("New section name", "Heating");
      if (suggested === null) return;
      if (!suggested.trim()) {
        onNotice("Section name required.");
        return;
      }
      targetSectionId = "__new__";
      newSectionName = suggested.trim();
    }
    try {
      const result = await postAction({
        action: "move-boq-lines-to-section",
        id: selected.id,
        lineIds,
        sheetKey: activeBoqSheet || undefined,
        targetSectionId,
        newSectionName,
      });
      const moved = typeof result.movedCount === "number" ? result.movedCount : lineIds.length;
      const label = typeof result.sectionLabel === "string" ? result.sectionLabel : "section";
      setBoqBlakeLineIds([]);
      setBoqSectionMoveOpen(false);
      setTab("boq");
      onNotice(`Moved ${moved} line${moved === 1 ? "" : "s"} into "${label}".`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to move lines to section");
    }
  }

  async function addBoqSheet() {
    if (!selected) return;
    const suggested = window.prompt("New sheet tab name", "Sheet");
    if (suggested === null) return;
    try {
      const result = await postAction({
        action: "add-boq-sheet",
        id: selected.id,
        sheetName: suggested.trim() || "Sheet",
      });
      const sheetKey = typeof result.sheetKey === "string" ? result.sheetKey : null;
      if (sheetKey) setBoqSheetTab(sheetKey);
      setTab("boq");
      onNotice(sheetKey ? `Added sheet “${sheetKey}”.` : "Sheet added.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to add sheet");
    }
  }

  async function renameActiveBoqSheet(sheetKeyOverride?: string) {
    if (!selected) return;
    const currentKey = sheetKeyOverride || activeBoqSheet;
    if (!currentKey) return;
    const next = window.prompt("Rename sheet tab", currentKey);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentKey) return;
    try {
      const result = await postAction({
        action: "rename-boq-sheet",
        id: selected.id,
        sheetKey: currentKey,
        sheetName: trimmed,
      });
      const sheetKey = typeof result.sheetKey === "string" ? result.sheetKey : trimmed;
      setBoqSheetTab(sheetKey);
      onNotice(`Sheet renamed to “${sheetKey}”.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to rename sheet");
    }
  }

  async function deleteActiveBoqSheet() {
    if (!selected || !activeBoqSheet) return;
    const onSheet = filterBoqLinesBySheet(selected.boqLines, activeBoqSheet);
    const measured = onSheet.filter((line) => line.kind === "measured").length;
    const nonEmpty = onSheet.length > 0;
    if (nonEmpty) {
      const ok = window.confirm(
        measured
          ? `Remove sheet “${activeBoqSheet}” and delete its ${measured} measured line${measured === 1 ? "" : "s"}?\n\nThis cannot be undone.`
          : `Remove sheet “${activeBoqSheet}” (${onSheet.length} row${onSheet.length === 1 ? "" : "s"})?\n\nThis cannot be undone.`,
      );
      if (!ok) return;
    }
    try {
      await postAction({
        action: "delete-boq-sheet",
        id: selected.id,
        sheetKey: activeBoqSheet,
      });
      setBoqBlakeLineIds((current) =>
        current.filter((id) => !onSheet.some((line) => line.id === id)),
      );
      setBoqSheetTab(null);
      onNotice(`Removed sheet “${activeBoqSheet}”.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to remove sheet");
    }
  }

  async function runBlakeBudgetPrices(forceRefresh = false) {
    if (!selected) return;
    const measured = selected.boqLines.filter((line) => line.kind === "measured");
    if (!measured.length) {
      onNotice("Import a BoQ first — Blake needs measured lines to price.");
      return;
    }
    if (blakeBudgetBusy) return;

    const lineIds = filterSelectedMeasuredLineIds(selected.boqLines, boqBlakeLineIds);
    if (!lineIds.length) {
      onNotice("Tick the measured lines (or a whole sheet/section) you want Blake to budget-price first.");
      return;
    }

    blakeBudgetAbortRef.current?.abort();
    const abort = new AbortController();
    blakeBudgetAbortRef.current = abort;

    setBlakeBudgetBusy(true);
    setSaving(true);
    setBlakeBudgetStatus(`Matching library · ${lineIds.length} selected…`);
    try {
      const response = await fetch(`/api/tenders/${encodeURIComponent(selected.id)}/budget-prices?stream=1`, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ forceRefresh, actor: actorName, lineIds }),
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
        targetedCount?: number;
        targetedPricedCount?: number;
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
      if (payload.error && !(payload.pricedCount || payload.libraryFilled || payload.blakeFilled || payload.targetedPricedCount)) {
        throw new Error(payload.error);
      }

      if (Array.isArray(payload.tenders)) {
        setTenders((prev) => {
          const leanById = new Map(payload.tenders!.map((row) => [row.id, row]));
          return prev.map((row) => {
            const lean = leanById.get(row.id);
            if (!lean) return row;
            // Lean list strips BoQ — keep local bill lines when response has none.
            return {
              ...row,
              ...lean,
              boqLines: lean.boqLines?.length ? lean.boqLines : row.boqLines,
            };
          });
        });
      }
      if (payload.tender) {
        setTenders((prev) =>
          prev.map((row) => {
            if (row.id !== payload!.tender!.id) return row;
            const next = payload!.tender!;
            return {
              ...row,
              ...next,
              boqLines: next.boqLines?.length ? next.boqLines : row.boqLines,
            };
          }),
        );
      }
      const blank = payload.leftBlank ?? 0;
      const targeted = payload.targetedCount ?? lineIds.length;
      const targetedPriced = payload.targetedPricedCount ?? payload.pricedCount ?? 0;
      const notice = payload.aiUsed
        ? `Blake budget prices on ${targeted} selected · ${payload.blakeFilled ?? 0} Blake · ${payload.libraryFilled ?? 0} library · ${targetedPriced} of selected priced · ${blank} blank on bill · ${money(payload.budgetTotal)}. Guide rates only — amend before FoT.`
        : `Guide rates on ${targeted} selected · ${payload.libraryFilled ?? 0} from library · ${targetedPriced} of selected priced · ${blank} blank on bill · ${money(payload.budgetTotal)}. OpenAI offline or skipped — blanks stay unpriced.`;
      setBlakeBudgetStatus(
        `Done · ${targetedPriced}/${targeted} selected priced`,
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

  function toggleBoqBlakeLine(lineId: string, checked: boolean) {
    setBoqBlakeLineIds((current) => {
      if (checked) return current.includes(lineId) ? current : [...current, lineId];
      return current.filter((id) => id !== lineId);
    });
  }

  function toggleBoqBlakeSection(measuredIds: string[], checked: boolean) {
    setBoqBlakeLineIds((current) => {
      const set = new Set(current);
      if (checked) {
        for (const id of measuredIds) set.add(id);
      } else {
        for (const id of measuredIds) set.delete(id);
      }
      return Array.from(set);
    });
  }

  function clearBoqBlakeSelection() {
    setBoqBlakeLineIds([]);
  }

  function cancelBlakeBudgetPrices() {
    blakeBudgetAbortRef.current?.abort();
    setBlakeBudgetStatus("Cancelling…");
  }

  async function downloadFormOfTender(options?: { quiet?: boolean }) {
    if (!selected) return false;
    const params = new URLSearchParams({
      businessName,
      signatoryName: actorName,
      signatoryTitle: "Commercial Manager",
    });
    const response = await fetch(`/api/tenders/${selected.id}/form-of-tender?${params}`, {
      headers: requestHeaders,
    });
    if (!response.ok) {
      if (!options?.quiet) onNotice("Unable to generate Form of Tender.");
      return false;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Form_of_Tender_${selected.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    if (!options?.quiet) onNotice("Form of Tender downloaded.");
    return true;
  }

  async function submitTender() {
    if (!selected) return;
    const hasBoq = selected.boqLines.length > 0;
    try {
      await postAction({
        action: "submit",
        id: selected.id,
        tenderSum: computeBoqTotal(selected.boqLines),
      });
      // Prefer Excel BoQ (all sheets) + FoT PDF as the email attachment pack.
      const boqOk = hasBoq ? await downloadBoqSpreadsheet("all", "xlsx", { quiet: true }) : false;
      const fotOk = await downloadFormOfTender({ quiet: true });
      if (boqOk && fotOk) {
        onNotice("Tender marked Sent — Downloads BoQ + Form of Tender. Attach both to your email.");
      } else if (fotOk) {
        onNotice(
          hasBoq
            ? "Tender marked Sent — Form of Tender downloaded; BoQ export failed. Retry Export Excel on the BoQ tab."
            : "Tender marked Sent — Form of Tender downloaded (no BoQ lines to export).",
        );
      } else if (boqOk) {
        onNotice("Tender marked Sent — BoQ downloaded; Form of Tender failed. Retry from Submit.");
      } else {
        onNotice("Tender marked Sent — downloads failed. Use Export Excel + Form of Tender on Submit.");
      }
      setTab("submit");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to submit tender");
    }
  }

  if (selected) {
    const progress = boqProgress(selected.boqLines);
    const boqTotal = computeBoqTotal(selected.boqLines);
    const daysLeft = daysLeftForDeadline(selected.submissionDeadline);
    const alert = alertForDeadline(selected.submissionDeadline, undefined, selected.status);

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
            {selected.status === "Won" && tenderNeedsJob(selected) ? (
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={() => void markWon(selected.id)}
              >
                {tenderJobMissing(selected) ? "Recreate missing job" : "Create job from this tender"}
              </button>
            ) : null}
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
            ) : selected.convertedJobId && !tenderJobMissing(selected) ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => onOpenPendingJob?.(selected.convertedJobId!)}
              >
                Open job {selected.convertedJobRef || ""}
              </button>
            ) : null}
            {selected.status === "Won" ? (
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={() => void saveSelected({ status: "In Progress" })}
                title="Reopen the tender without deleting any linked job"
              >
                Reopen (In Progress)
              </button>
            ) : null}
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void downloadFormOfTender()}>
              <Download size={15} />
              Form of Tender
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void submitTender()}
              title="Downloads BoQ + Form of Tender"
            >
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
              ["ai-takeoff", "Blake"],
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
              <span className="tenders-hint" style={{ display: "block", marginTop: 4 }}>
                {selected.status === "Won"
                  ? tenderNeedsJob(selected)
                    ? tenderJobMissing(selected)
                      ? `Linked job ${selected.convertedJobRef || selected.convertedJobId} is missing — recreate it below.`
                      : "Won but no job yet — create one below."
                    : `Won keeps job ${selected.convertedJobRef || selected.convertedJobId}. Change status anytime to reopen — job is not deleted.`
                  : "Marking Won creates a Pending job for scheduling. You can change status back later."}
              </span>
            </label>
            {selected.status === "Won" && tenderNeedsJob(selected) ? (
              <div className="tenders-span-2 tenders-won-job-callout" role="status">
                <div>
                  <strong>
                    {tenderJobMissing(selected) ? "Linked job missing" : "Won — no scheduling job yet"}
                  </strong>
                  <p>
                    {tenderJobMissing(selected)
                      ? `This tender still points at ${selected.convertedJobRef || selected.convertedJobId}, but that job is gone. Recreate a Pending job for scheduling.`
                      : "Create a Pending Core job from this tender so it appears in Jobs for labour scheduling. Cost centres will be built from BoQ floors and services."}
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  disabled={saving}
                  onClick={() => void markWon(selected.id)}
                >
                  {tenderJobMissing(selected) ? "Recreate missing job" : "Create job from this tender"}
                </button>
              </div>
            ) : null}
            {selected.status === "Won" && selected.convertedJobId && !tenderNeedsJob(selected) ? (
              <div className="tenders-span-2 tenders-won-job-callout tenders-won-job-callout-secondary" role="status">
                <div>
                  <strong>Job {selected.convertedJobRef || selected.convertedJobId}</strong>
                  <p>
                    If cost centres look wrong or only show a partial amount, rebuild them from the current BoQ
                    (floors as sections, Heating / Hot & cold / Gas as cost centres). Sync also copies drawings into the job Documents tab.
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving}
                    onClick={() => void rebuildJobCostCentres()}
                  >
                    Rebuild cost centres from BoQ
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => void syncJobDocuments()}
                  >
                    Sync drawings to job
                  </button>
                </div>
              </div>
            ) : null}
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
              Tender sum (FoT) = BoQ total
              <input value={money(boqTotal)} readOnly title="Always matches the priced Bill of Quantities total" />
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
                  Price on their refs (e.g. 8/1/A). Excel sheets appear as workbook tabs below. Full bill wording is kept — leave Rate blank if not priced so they can see it was not priced (do not put £0 / NIL).
                </p>
                <p className="tenders-boq-blake-note">
                  Supplier priced PDF/Excel as extra lines: keep Add to BoQ (default when lines exist), then drop the file below — it appends new sheet tab(s) named from the file only (paste box is ignored and cleared). Supplier quote PDFs (Filpumps, William Wilson, etc.) merge into one tab named from the filename; other multi-page BoQ PDFs keep Page 1, Page 2…; Excel keeps worksheet names; duplicates get “ (2)”. Documents → Supplier quotes only stores the file; it does not pull lines into the bill. Use Replace BoQ only when you intend to wipe current lines.
                </p>
                <p className="tenders-boq-blake-note">
                  Sheet tabs: + Sheet / Rename / Remove sheet. Lines: Add line on the open sheet, edit cells, trash a row, or tick lines and Delete selected / Move to sheet… / Merge into tab… / Move to section…. Merge selected into another tab (or new); if the whole sheet is ticked, the empty tab is removed. Move to section assigns ticked lines to a section header (Heating, Hot & cold, Gas, etc.) on the same sheet — useful for orphaned lines after a merge. Takeoff push uses one tab per house type with Heating / Hot & cold / Gas as section headers inside. Tick measured lines then run Blake — only ticked lines are budget-priced. Guide rates only; unsure lines stay blank.
                </p>
                <div className="tenders-boq-blake-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.some((line) => line.kind === "measured")}
                    onClick={() => void runBlakeBudgetPrices(false)}
                  >
                    <Sparkles size={15} />
                    {blakeBudgetBusy
                      ? "Blake pricing…"
                      : boqBlakeSelectedCount
                        ? `Blake budget prices (${boqBlakeSelectedCount})`
                        : "Blake budget prices"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      saving
                      || blakeBudgetBusy
                      || !boqBlakeSelectedCount
                    }
                    onClick={() => void runBlakeBudgetPrices(true)}
                    title="Re-run Blake/library on selected budget or guide rates (manual rates kept)"
                  >
                    Refresh selected guides
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
                    disabled={saving || blakeBudgetBusy || !boqBlakeSelectedCount}
                    onClick={clearBoqBlakeSelection}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.length}
                    onClick={() => void downloadBoqSpreadsheet("all", "xlsx")}
                    title="Download the full BoQ as Excel (all sheet tabs)"
                  >
                    <Download size={15} />
                    Export Excel (all)
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.length}
                    onClick={() => void downloadBoqSpreadsheet(boqSheetTabs.length ? "active" : "all", "xlsx")}
                    title={
                      boqSheetTabs.length
                        ? `Download only the active sheet (${activeBoqSheet || "current"}) as Excel`
                        : "Download BoQ as Excel"
                    }
                  >
                    <FileSpreadsheet size={15} />
                    Export sheet
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.length}
                    onClick={() => void downloadBoqSpreadsheet(boqSheetTabs.length ? "active" : "all", "csv")}
                    title="Download active sheet as CSV"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || blakeBudgetBusy || !selected.boqLines.length}
                    onClick={() => {
                      const scope = window.confirm(
                        "Export PDF for the full BoQ (all sheet tabs)?\n\nOK = all sheets · Cancel = active sheet only",
                      )
                        ? "all"
                        : "active";
                      void downloadBoqSpreadsheet(boqSheetTabs.length && scope === "active" ? "active" : "all", "pdf");
                    }}
                    title="Download BoQ as PDF (prompt chooses all sheets or active sheet)"
                  >
                    Export PDF
                  </button>
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
                ) : boqBlakeSelectedCount ? (
                  <p className="tenders-boq-blake-progress" aria-live="polite">
                    {boqBlakeSelectedCount} measured line{boqBlakeSelectedCount === 1 ? "" : "s"} selected for Blake
                  </p>
                ) : null}
              </div>
              <div className="tenders-metric-row">
                <article>
                  <span>BoQ total</span>
                  <strong>{money(boqTotal)}</strong>
                </article>
                <article>
                  <span>FoT sum (= BoQ)</span>
                  <strong>{money(boqTotal)}</strong>
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
                Import Excel / CSV / paste (Ref + Description/Spec columns; all Excel sheets become tabs)
                <textarea
                  rows={5}
                  value={boqImportText}
                  onChange={(event) => setBoqImportText(event.target.value)}
                  placeholder={`Plumbing e-Enquiry [...]\nRef,Description,Quantity,Units,Rate,Value\n8/1/A,Doc M Toilet Pack,1,nr,1836,1836`}
                />
              </label>
              {selected.boqLines.length ? (
                <div className="tenders-boq-import-mode" role="group" aria-label="BoQ import mode">
                  <label>
                    <input
                      type="radio"
                      name="boq-import-mode"
                      checked={boqImportMode === "append"}
                      onChange={() => setBoqImportMode("append")}
                    />
                    <span>Add to BoQ (keep existing {selected.boqLines.length} lines)</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="boq-import-mode"
                      checked={boqImportMode === "replace"}
                      onChange={() => setBoqImportMode("replace")}
                    />
                    <span>Replace BoQ (wipe current lines)</span>
                  </label>
                </div>
              ) : null}
              <div className="tenders-inline-add">
                <FileDropZone
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  label="Drop BoQ spreadsheet or PDF here or click to browse"
                  hint={
                    selected.boqLines.length && boqImportMode === "append"
                      ? ".xlsx / .xls · supplier priced .pdf · .csv — adds as extra sheet tabs"
                      : ".xlsx / .xls · .pdf (text BoQ) · .csv"
                  }
                  disabled={saving}
                  onFiles={(files) => void onBoqFile(files[0] ?? null)}
                />
                <button type="button" className="primary-button" disabled={saving || !boqImportText.trim()} onClick={() => void importBoq()}>
                  <FileSpreadsheet size={15} />
                  {!selected.boqLines.length
                    ? "Import pasted BoQ"
                    : boqImportMode === "append"
                      ? "Add pasted BoQ"
                      : "Replace with pasted BoQ"}
                </button>
              </div>
            </div>

            <div className="tenders-boq-spreadsheet">
              <div className="tenders-boq-sheet-tabs" role="tablist" aria-label="BoQ workbook sheets">
                {boqSheetTabs.map((sheetTab) => {
                  const selectedInSheet = sheetTab.measuredIds.filter((id) =>
                    boqBlakeLineIds.includes(id),
                  ).length;
                  return (
                    <button
                      key={sheetTab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeBoqSheet === sheetTab.key}
                      className={activeBoqSheet === sheetTab.key ? "active" : ""}
                      title="Click to open · double-click to rename"
                      onClick={() => setBoqSheetTab(sheetTab.key)}
                      onDoubleClick={() => {
                        setBoqSheetTab(sheetTab.key);
                        void renameActiveBoqSheet(sheetTab.key);
                      }}
                    >
                      <span>{sheetTab.label}</span>
                      <em>
                        {sheetTab.measuredIds.length}
                        {selectedInSheet ? ` · ${selectedInSheet}` : ""}
                      </em>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="tenders-boq-sheet-add"
                  disabled={saving || blakeBudgetBusy}
                  onClick={() => void addBoqSheet()}
                  title="Add a blank sheet tab"
                >
                  <Plus size={14} />
                  Sheet
                </button>
                {activeBoqSheet ? (
                  <>
                    <button
                      type="button"
                      className="tenders-boq-sheet-tool"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => void renameActiveBoqSheet()}
                      title="Rename active sheet tab"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="tenders-boq-sheet-tool danger"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => void deleteActiveBoqSheet()}
                      title="Remove active sheet tab and its lines"
                    >
                      Remove sheet
                    </button>
                  </>
                ) : null}
                {activeSheetMeasuredIds.length ? (
                  <label className="tenders-boq-sheet-select-all">
                    <input
                      type="checkbox"
                      checked={
                        activeSheetMeasuredIds.length > 0 &&
                        activeSheetMeasuredIds.every((id) => boqBlakeLineIds.includes(id))
                      }
                      ref={(el) => {
                        if (!el) return;
                        const selectedInSheet = activeSheetMeasuredIds.filter((id) =>
                          boqBlakeLineIds.includes(id),
                        ).length;
                        el.indeterminate =
                          selectedInSheet > 0 && selectedInSheet < activeSheetMeasuredIds.length;
                      }}
                      aria-label="Select all measured lines on this sheet for Blake"
                      disabled={blakeBudgetBusy}
                      onChange={(event) =>
                        toggleBoqBlakeSection(activeSheetMeasuredIds, event.target.checked)
                      }
                    />
                    Select sheet
                  </label>
                ) : null}
              </div>

              <div className="tenders-boq-line-toolbar">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving || blakeBudgetBusy}
                  onClick={() => void addBoqLine()}
                  title={
                    activeBoqSheet
                      ? `Add a measured line on “${activeBoqSheet}”`
                      : "Add a measured line to this BoQ"
                  }
                >
                  <Plus size={15} />
                  Add line
                </button>
                {boqSectionMoveOpen ? (
                  <div className="tenders-boq-move-picker">
                    <label>
                      Move to section
                      <select
                        value={boqSectionMoveTarget}
                        disabled={saving || blakeBudgetBusy}
                        aria-label="Section to move lines into"
                        onChange={(event) => setBoqSectionMoveTarget(event.target.value)}
                      >
                        {boqSections
                          .filter((s) => s.headerId)
                          .map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        <option value="__new__">New section…</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => void applyBoqSectionMove()}
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => setBoqSectionMoveOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : boqSheetMoveMode ? (
                  <div className="tenders-boq-move-picker">
                    <label>
                      {boqSheetMoveMode === "merge" ? "Merge into" : "Move to"}
                      <select
                        value={boqMoveTarget}
                        disabled={saving || blakeBudgetBusy}
                        aria-label={
                          boqSheetMoveMode === "merge" ? "Sheet to merge into" : "Sheet to move lines onto"
                        }
                        onChange={(event) => setBoqMoveTarget(event.target.value)}
                      >
                        {boqOtherSheetTabs.map((tab) => (
                          <option key={tab.key} value={tab.key}>
                            {tab.label}
                          </option>
                        ))}
                        <option value="__new__">New sheet…</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => void applyBoqSheetMove()}
                    >
                      {boqSheetMoveMode === "merge" ? "Merge" : "Move"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || blakeBudgetBusy}
                      onClick={() => setBoqSheetMoveMode(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || blakeBudgetBusy || !boqBlakeSelectedCount}
                      onClick={() => openBoqSheetMove("move")}
                      title="Move ticked lines onto another sheet tab (or create a new one)"
                    >
                      Move to sheet…
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || blakeBudgetBusy || !boqBlakeSelectedCount}
                      onClick={() => openBoqSheetMove("merge")}
                      title="Merge ticked lines into another tab. Tick Select sheet first to merge the whole tab and remove it when empty."
                    >
                      Merge into tab…
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || blakeBudgetBusy || !boqBlakeSelectedCount}
                      onClick={() => openBoqSectionMove()}
                      title="Move ticked lines under a section header on this sheet (e.g. Heating, Hot & cold, Gas)"
                    >
                      Move to section…
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving || blakeBudgetBusy || !boqBlakeSelectedCount}
                  onClick={() =>
                    void deleteBoqLinesByIds(
                      filterSelectedMeasuredLineIds(selected.boqLines, boqBlakeLineIds),
                    )
                  }
                  title="Delete ticked measured lines"
                >
                  <Trash2 size={15} />
                  Delete selected{boqBlakeSelectedCount ? ` (${boqBlakeSelectedCount})` : ""}
                </button>
              </div>

              <div className="tenders-boq-table-wrap">
                <table className="tenders-boq-table tenders-boq-sheet-grid">
                  <thead>
                    <tr>
                      <th className="tenders-boq-check-col" scope="col">
                        <span className="sr-only">Select for Blake</span>
                      </th>
                      <th className="tenders-boq-ref-col">Ref</th>
                      <th className="tenders-boq-desc-col">Description</th>
                      <th className="tenders-boq-qty-col">Qty</th>
                      <th className="tenders-boq-unit-col">Unit</th>
                      <th className="tenders-boq-rate-col">Rate</th>
                      <th className="tenders-boq-amount-col">Amount</th>
                      <th className="tenders-boq-check-status-col">Status</th>
                      <th className="tenders-boq-row-actions-col">
                        <span className="sr-only">Row actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {boqSheetHasVisibleRows ? (
                      boqVisibleLines.map((line) => {
                        if (line.kind === "header") {
                          if (boqSheetTabs.length > 0 && isBoqSheetEchoHeader(line)) return null;
                          const section = boqSections.find((group) => group.headerId === line.id);
                          const measuredIds = section?.measuredIds || [];
                          const selectedInSection = measuredIds.filter((id) =>
                            boqBlakeLineIds.includes(id),
                          ).length;
                          const allSelected =
                            measuredIds.length > 0 && selectedInSection === measuredIds.length;
                          const someSelected = selectedInSection > 0 && !allSelected;
                          return (
                            <tr
                              key={`${(line.sheet || "").trim()}::${line.id}`}
                              className="tenders-boq-header-row"
                            >
                              <td className="tenders-boq-check-col">
                                {measuredIds.length ? (
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                      if (el) el.indeterminate = someSelected;
                                    }}
                                    aria-label={`Select all measured lines in ${line.description || "section"}`}
                                    disabled={blakeBudgetBusy}
                                    onChange={(event) =>
                                      toggleBoqBlakeSection(measuredIds, event.target.checked)
                                    }
                                  />
                                ) : null}
                              </td>
                              <td colSpan={7}>
                                <span className="tenders-boq-section-label">
                                  {line.section || line.description}
                                  {measuredIds.length ? (
                                    <em>
                                      {" "}
                                      · {measuredIds.length} item{measuredIds.length === 1 ? "" : "s"}
                                      {selectedInSection ? ` · ${selectedInSection} selected` : ""}
                                    </em>
                                  ) : null}
                                </span>
                              </td>
                              <td className="tenders-boq-row-actions-col">
                                <button
                                  type="button"
                                  className="tenders-boq-row-delete"
                                  disabled={saving || blakeBudgetBusy}
                                  aria-label={`Delete section heading ${line.description || line.section || ""}`}
                                  title="Delete this section heading"
                                  onClick={() => void deleteBoqLinesByIds([line.id])}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        }
                        if (line.kind === "note") {
                          return (
                            <tr
                              key={`${(line.sheet || "").trim()}::${line.id}`}
                              className="tenders-boq-header-row tenders-boq-note-row"
                            >
                              <td className="tenders-boq-check-col" />
                              <td colSpan={7}>
                                <span className="tenders-boq-section-label">
                                  {line.description}
                                  {line.note && line.note !== line.description ? (
                                    <em> · {line.note}</em>
                                  ) : null}
                                </span>
                              </td>
                              <td className="tenders-boq-row-actions-col">
                                <button
                                  type="button"
                                  className="tenders-boq-row-delete"
                                  disabled={saving || blakeBudgetBusy}
                                  aria-label={`Delete note ${line.description || ""}`}
                                  title="Delete this note"
                                  onClick={() => void deleteBoqLinesByIds([line.id])}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
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
                        const checked = boqBlakeLineIds.includes(line.id);
                        const rowKey = `${(line.sheet || "").trim()}::${line.id}`;
                        return (
                          <tr
                            key={rowKey}
                            className={`${priced ? "" : "unpriced"}${checked ? " tenders-boq-selected" : ""}`}
                          >
                            <td className="tenders-boq-check-col">
                              <input
                                type="checkbox"
                                checked={checked}
                                aria-label={`Select ${line.ref || line.description} for Blake`}
                                disabled={blakeBudgetBusy || line.kind !== "measured"}
                                onChange={(event) => toggleBoqBlakeLine(line.id, event.target.checked)}
                              />
                            </td>
                            <td className="tenders-boq-ref-col">
                              <input
                                type="text"
                                key={`${rowKey}-ref-${line.ref || ""}`}
                                defaultValue={line.ref || ""}
                                placeholder="—"
                                aria-label="Ref"
                                disabled={blakeBudgetBusy}
                                onBlur={(event) => {
                                  const ref = event.target.value.trim();
                                  if (ref === (line.ref || "")) return;
                                  void patchBoqLine(line.id, { ref: ref || undefined });
                                }}
                              />
                            </td>
                            <td className="tenders-boq-desc-col">
                              <textarea
                                key={`${rowKey}-desc-${line.description}`}
                                className="tenders-boq-desc-input"
                                defaultValue={line.description}
                                rows={2}
                                aria-label="Description"
                                disabled={blakeBudgetBusy}
                                onBlur={(event) => {
                                  const description = event.target.value.trim();
                                  if (!description || description === line.description) return;
                                  void patchBoqLine(line.id, { description });
                                }}
                              />
                              {line.note ? (
                                <div className="tenders-boq-desc-note" title={line.note}>
                                  {line.note}
                                </div>
                              ) : null}
                            </td>
                            <td className="tenders-boq-qty-col">
                              <input
                                type="number"
                                step="any"
                                key={`${rowKey}-qty-${line.quantity ?? "blank"}`}
                                defaultValue={line.quantity ?? ""}
                                aria-label="Quantity"
                                disabled={blakeBudgetBusy}
                                onBlur={(event) => {
                                  const raw = event.target.value.trim();
                                  const quantity = raw === "" ? null : Number(raw);
                                  const prev = line.quantity ?? null;
                                  if (quantity === prev) return;
                                  void patchBoqLine(line.id, { quantity });
                                }}
                              />
                            </td>
                            <td className="tenders-boq-unit-col">
                              <input
                                type="text"
                                key={`${rowKey}-unit-${line.unit || ""}`}
                                defaultValue={line.unit || ""}
                                aria-label="Unit"
                                disabled={blakeBudgetBusy}
                                onBlur={(event) => {
                                  const unit = event.target.value.trim();
                                  if (unit === (line.unit || "")) return;
                                  void patchBoqLine(line.id, { unit: unit || undefined });
                                }}
                              />
                            </td>
                            <td className="tenders-boq-rate-col">
                              <input
                                type="number"
                                step="0.01"
                                key={`${rowKey}-${line.rate ?? "blank"}-${line.pricingSource || ""}`}
                                defaultValue={line.rate ?? ""}
                                placeholder=""
                                aria-label={priced ? "Rate" : "Unpriced — leave blank"}
                                onBlur={(event) => {
                                  const raw = event.target.value.trim();
                                  const rate = raw === "" ? null : Number(raw);
                                  void patchBoqLine(line.id, {
                                    rate,
                                    value: rate === null ? null : undefined,
                                  });
                                }}
                              />
                            </td>
                            <td className="tenders-boq-amount-col">
                              {priced ? money(line.value) : ""}
                            </td>
                            <td className="tenders-boq-check-status-col">
                              <span className={`tenders-line-status ${statusClass}`}>{statusLabel}</span>
                            </td>
                            <td className="tenders-boq-row-actions-col">
                              <button
                                type="button"
                                className="tenders-boq-row-delete"
                                disabled={saving || blakeBudgetBusy}
                                aria-label={`Delete ${line.ref || line.description}`}
                                title="Delete this line"
                                onClick={() => void deleteBoqLinesByIds([line.id])}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <div className="tenders-boq-empty">
                            <span>
                              {selected.boqLines.length
                                ? "No lines on this sheet — add a measured line here, or import with Add to BoQ."
                                : "No BoQ lines yet — import their issued Excel/CSV bill, or add a line / sheet."}
                            </span>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={saving || blakeBudgetBusy}
                              onClick={() => void addBoqLine()}
                            >
                              <Plus size={15} />
                              Add line
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "documents" ? (
          <div className="tenders-docs">
            <p>
              Upload drawings, BoQ files and specs into built-in types or office folders (for example Drawings → Architect).
            </p>
            <div className="tenders-doc-folder-create">
              <label>
                New folder
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="e.g. Architect"
                  maxLength={80}
                />
              </label>
              <label>
                Under
                <select
                  value={newFolderParent}
                  onChange={(event) => setNewFolderParent(event.target.value as DocTargetValue)}
                >
                  {folderOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={saving || !newFolderName.trim()}
                onClick={() => void createDocumentFolder()}
              >
                <FolderPlus size={15} />
                Add folder
              </button>
            </div>
            <div className="tenders-doc-upload">
              <label>
                Upload into
                <select
                  value={uploadTarget}
                  onChange={(event) => setUploadTarget(event.target.value as DocTargetValue)}
                >
                  {folderOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
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
                    const target = decodeDocTarget(uploadTarget);
                    const kind =
                      target.folderId
                        ? resolveTenderDocumentFolderKind(documentFolders, target.folderId)
                        : target.kind || "other";
                    for (const file of files) {
                      await uploadImportFile("upload-document", file, {
                        tenderId: selected.id,
                        kind,
                        ...(target.folderId ? { folderId: target.folderId } : {}),
                      });
                    }
                  }}
                />
              </label>
            </div>
            <ul className="tenders-doc-list">
              {DOC_KINDS.map(({ kind, label }) => {
                const rootDocs = (selected.documents || []).filter(
                  (doc) => doc.kind === kind && !doc.folderId,
                );
                const childFolders = foldersUnderParent(documentFolders, kind);
                const orphanCustom = kind === "other"
                  ? foldersUnderParent(documentFolders, null)
                  : [];

                const renderDocs = (docs: TenderDocument[]) =>
                  docs.length ? (
                    <ul className="tenders-doc-file-list">
                      {docs.map((doc) => (
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
                          <label className="tenders-doc-move">
                            <span className="sr-only">Move {doc.name}</span>
                            <select
                              aria-label={`Move ${doc.name}`}
                              value={encodeDocTarget(doc.kind, doc.folderId)}
                              disabled={saving}
                              onChange={(event) => void moveDocument(doc.id, event.target.value)}
                            >
                              {folderOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
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
                  ) : null;

                const renderFolder = (folder: TenderDocumentFolder, depth = 0): ReactNode => {
                  const folderDocs = (selected.documents || []).filter((doc) => doc.folderId === folder.id);
                  const nested = foldersUnderParent(documentFolders, folder.id);
                  return (
                    <li key={folder.id} className="tenders-doc-folder" style={{ marginLeft: depth ? 12 : 0 }}>
                      <div className="tenders-doc-folder-head">
                        <strong>{folder.name}</strong>
                        <button
                          type="button"
                          className="secondary-button tenders-doc-delete"
                          disabled={saving}
                          title="Remove folder"
                          aria-label={`Remove folder ${folder.name}`}
                          onClick={() => void deleteDocumentFolder(folder.id, folder.name)}
                        >
                          <Trash2 size={14} />
                          Remove folder
                        </button>
                      </div>
                      {renderDocs(folderDocs)}
                      {nested.length ? (
                        <ul className="tenders-doc-subfolders">{nested.map((child) => renderFolder(child, depth + 1))}</ul>
                      ) : null}
                      {!folderDocs.length && !nested.length ? (
                        <span className="tenders-doc-empty">Empty folder</span>
                      ) : null}
                    </li>
                  );
                };

                return (
                  <li key={kind} className="tenders-doc-kind">
                    <strong>{label}</strong>
                    {renderDocs(rootDocs)}
                    {childFolders.length || orphanCustom.length ? (
                      <ul className="tenders-doc-subfolders">
                        {[...childFolders, ...orphanCustom].map((folder) => renderFolder(folder))}
                      </ul>
                    ) : null}
                    {!rootDocs.length && !childFolders.length && !orphanCustom.length ? (
                      <span className="tenders-doc-empty">Not attached yet</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {tab === "ai-takeoff" ? (
          <TenderAiTakeoffPanel
            tenderId={selected.id}
            tenderName={selected.name}
            requestHeaders={requestHeaders}
            onNotice={onNotice}
            onBoqApplied={() => {
              void loadSelectedTenderBoq(selected.id);
              setTab("boq");
            }}
          />
        ) : null}

        {tab === "submit" ? (
          <div className="tenders-submit">
            <article>
              <span className="permission-heading">Return pack</span>
              <h3>What goes back to the main contractor</h3>
              <ol>
                <li>Priced BoQ Excel (all sheets) — downloaded automatically when you Mark Sent.</li>
                <li>Form of Tender PDF — downloaded with the BoQ (not FoT alone).</li>
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
                  <span>FoT sum (= BoQ)</span>
                  <strong>{money(boqTotal)}</strong>
                </article>
              </div>
              <div className="tenders-toolbar-actions" style={{ marginTop: 16 }}>
                <button type="button" className="secondary-button" onClick={() => void downloadFormOfTender()}>
                  <Download size={15} />
                  Download Form of Tender
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={saving}
                  onClick={() => void submitTender()}
                  title="Downloads BoQ + Form of Tender"
                >
                  <Send size={15} />
                  Mark Sent — Downloads BoQ + Form of Tender
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
            {tenders.filter((t) => alertForDeadline(t.submissionDeadline, undefined, t.status) === "Due this week").length}
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
                const alert = alertForDeadline(tender.submissionDeadline, undefined, tender.status);
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
