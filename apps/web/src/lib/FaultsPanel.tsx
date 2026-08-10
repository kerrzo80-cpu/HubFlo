"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bug,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";

import { FileDropZone } from "@/components/FileDropZone";
import {
  FAULT_PRIORITY_LABELS,
  FAULT_PRIORITIES,
  FAULT_STATUS_LABELS,
  FAULT_STATUSES,
  FAULT_TYPE_LABELS,
  FAULT_TYPES,
  type FaultIssue,
  type FaultPriority,
  type FaultStatus,
  type FaultType,
} from "@/lib/faults-types";

type RequestHeaders = HeadersInit;
type TabKey = "overview" | "notes" | "attachments" | "activity" | "workflow";
type FolderKey = "open" | "inbox" | "development" | "testing" | "complete" | "feedback" | "all";

type FaultAttachment = {
  id: string;
  name: string;
  type: string;
  fileUrl: string;
  size?: number;
  uploadedAt?: string;
};

type Stats = {
  openFaults: number;
  urgentFaults: number;
  inDevelopment: number;
  waitingForTesting: number;
  openByModule: Record<string, number>;
  customerFeedbackOpen?: number;
};

type CustomerRequest = {
  id: string;
  companyName: string;
  title: string;
  description: string;
  customerStatus: string;
  linkedIssueReference?: string;
  reporterName: string;
  createdAt: string;
};

const OPEN_STATUSES = new Set<FaultStatus>([
  "inbox",
  "idea",
  "approved",
  "ready_for_development",
  "in_progress",
  "ready_to_test",
]);

function typeIcon(type: FaultType) {
  if (type === "fault") return <Bug size={14} />;
  if (type === "improvement") return <Wrench size={14} />;
  if (type === "new_feature") return <Sparkles size={14} />;
  return <ClipboardList size={14} />;
}

function priorityTone(priority: FaultPriority) {
  if (priority === "urgent") return "urgent";
  if (priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

export function FaultsPanel({
  requestHeaders,
  onNotice,
  actorName = "NeXa user",
  canTriage = true,
  sourceRoute,
  sourcePage,
}: {
  requestHeaders: RequestHeaders;
  onNotice: (message: string) => void;
  actorName?: string;
  canTriage?: boolean;
  sourceRoute?: string;
  sourcePage?: string;
}) {
  const [issues, setIssues] = useState<FaultIssue[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folderKey, setFolderKey] = useState<FolderKey>("open");
  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [tab, setTab] = useState<TabKey>("overview");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftModule, setDraftModule] = useState("Core");
  const [draftType, setDraftType] = useState<FaultType>("fault");
  const [draftPriority, setDraftPriority] = useState<FaultPriority>("medium");
  const [commentDraft, setCommentDraft] = useState("");
  const [failNote, setFailNote] = useState("");
  const [buildVersion, setBuildVersion] = useState("");
  const [customerRequests, setCustomerRequests] = useState<CustomerRequest[]>([]);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [taskMarkdown, setTaskMarkdown] = useState("");
  const [attachments, setAttachments] = useState<FaultAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  const selected = useMemo(
    () => issues.find((issue) => issue.id === selectedId) ?? null,
    [issues, selectedId],
  );

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/faults", { headers: requestHeaders, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Could not load faults");
      setIssues(Array.isArray(data.issues) ? data.issues : []);
      setModules(Array.isArray(data.modules) ? data.modules : []);
      setStats(data.stats || null);
      setCustomerRequests(Array.isArray(data.customerRequests) ? data.customerRequests : []);
      setGithubConfigured(Boolean(data.githubConfigured));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load faults");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAttachments(reference: string) {
    const recordRef = reference.trim();
    if (!recordRef) {
      setAttachments([]);
      return;
    }
    setAttachmentsLoading(true);
    try {
      const response = await fetch(
        `/api/record-documents?scope=fault&recordRef=${encodeURIComponent(recordRef)}`,
        { headers: requestHeaders, cache: "no-store" },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not load attachments");
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      setAttachments(
        docs.map((doc: FaultAttachment) => ({
          id: String(doc.id || ""),
          name: String(doc.name || "Attachment"),
          type: String(doc.type || "Attachment"),
          fileUrl: String(doc.fileUrl || ""),
          size: typeof doc.size === "number" ? doc.size : undefined,
          uploadedAt: typeof doc.uploadedAt === "string" ? doc.uploadedAt : undefined,
        })).filter((doc: FaultAttachment) => Boolean(doc.id && doc.fileUrl)),
      );
    } catch (error) {
      setAttachments([]);
      onNotice(error instanceof Error ? error.message : "Could not load attachments");
    } finally {
      setAttachmentsLoading(false);
    }
  }

  useEffect(() => {
    if (!selected?.reference) {
      setAttachments([]);
      return;
    }
    if (tab !== "attachments") return;
    void loadAttachments(selected.reference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.reference, tab]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (folderKey === "open" && !OPEN_STATUSES.has(issue.status)) return false;
      if (folderKey === "inbox" && issue.status !== "inbox" && issue.status !== "idea") return false;
      if (folderKey === "development" && !["approved", "ready_for_development", "in_progress"].includes(issue.status)) {
        return false;
      }
      if (folderKey === "testing" && issue.status !== "ready_to_test") return false;
      if (folderKey === "complete" && issue.status !== "complete" && issue.status !== "rejected") return false;
      if (folderKey === "feedback") return false;
      if (filterModule !== "all" && issue.module !== filterModule) return false;
      if (filterType !== "all" && issue.type !== filterType) return false;
      if (filterPriority !== "all" && issue.priority !== filterPriority) return false;
      if (!query) return true;
      const haystack = [
        issue.reference,
        issue.title,
        issue.originalDescription,
        issue.aiDescription || "",
        issue.reporterName,
        issue.assignedToName || "",
        issue.module,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filterModule, filterPriority, filterType, folderKey, issues, search]);

  async function postAction(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch("/api/faults", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actorName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Save failed");
      if (Array.isArray(data.issues)) setIssues(data.issues);
      if (data.stats) setStats(data.stats);
      if (data.issue?.id) setSelectedId(data.issue.id);
      return data;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function createIssue() {
    if (!draftDescription.trim()) {
      onNotice("Describe the problem or improvement first.");
      return;
    }
    const data = await postAction({
      action: "create",
      title: draftTitle,
      description: draftDescription,
      module: draftModule,
      type: draftType,
      priority: draftPriority,
      sourceRoute,
      sourcePage,
      classifyWithAi: true,
    });
    if (data?.issue) {
      onNotice(`Added as ${data.issue.reference}`);
      setComposerOpen(false);
      setDraftTitle("");
      setDraftDescription("");
      setDraftType("fault");
      setDraftPriority("medium");
      setFolderKey("inbox");
    }
  }

  async function patchSelected(patch: Record<string, unknown>) {
    if (!selected) return;
    await postAction({ action: "update", id: selected.id, ...patch });
  }

  async function addComment() {
    if (!selected || !commentDraft.trim()) return;
    const data = await postAction({
      action: "comment",
      id: selected.id,
      comment: commentDraft,
      commentKind: "comment",
    });
    if (data) {
      setCommentDraft("");
      setTab("activity");
    }
  }

  async function uploadFiles(files: File[]) {
    if (!selected || !files.length) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("scope", "fault");
      form.set("recordRef", selected.reference);
      form.set("folderId", "evidence");
      form.set("visibility", "Private");
      for (const file of files) form.append("files", file);
      const response = await fetch("/api/record-documents", {
        method: "POST",
        headers: requestHeaders,
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Upload failed");
      onNotice(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"} to ${selected.reference}`);
      await loadAttachments(selected.reference);
      await postAction({
        action: "comment",
        id: selected.id,
        comment: `Attached: ${files.map((file) => file.name).join(", ")}`,
        commentKind: "comment",
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="faults-workspace" aria-label="Faults and improvements">
      <div className="panel-header">
        <div>
          <h2>Faults & Improvements</h2>
          <p>Company development backlog for NeXa — report, prioritise, develop and test.</p>
        </div>
        <div className="faults-header-actions">
          <button type="button" className="ghost-button" onClick={() => void refresh()} disabled={loading || saving}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" className="primary-button" onClick={() => setComposerOpen(true)}>
            <Plus size={15} /> New item
          </button>
        </div>
      </div>

      <div className="faults-kpi-row" aria-label="Development dashboard">
        <article>
          <small>Open faults</small>
          <strong>{stats?.openFaults ?? "—"}</strong>
        </article>
        <article className="tone-urgent">
          <small>Urgent</small>
          <strong>{stats?.urgentFaults ?? "—"}</strong>
        </article>
        <article>
          <small>In development</small>
          <strong>{stats?.inDevelopment ?? "—"}</strong>
        </article>
        <article className="tone-amber">
          <small>Waiting for testing</small>
          <strong>{stats?.waitingForTesting ?? "—"}</strong>
        </article>
      </div>

      {stats?.openByModule && Object.keys(stats.openByModule).length ? (
        <div className="faults-module-strip" aria-label="Open issues by module">
          {Object.entries(stats.openByModule)
            .sort((a, b) => b[1] - a[1])
            .map(([module, count]) => (
              <button
                key={module}
                type="button"
                className={filterModule === module ? "on" : ""}
                onClick={() => setFilterModule(filterModule === module ? "all" : module)}
              >
                {module} <b>{count}</b>
              </button>
            ))}
        </div>
      ) : null}

      <div className="faults-toolbar">
        <div className="faults-folders" role="tablist" aria-label="Backlog folders">
          {(
            [
              ["open", "Open"],
              ["inbox", "Inbox"],
              ["development", "Development"],
              ["testing", "Ready to test"],
              ["complete", "Complete"],
              ["feedback", "Customer feedback"],
              ["all", "All"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={folderKey === key}
              className={folderKey === key ? "on" : ""}
              onClick={() => setFolderKey(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="faults-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, title, description…"
          />
        </label>
        <select value={filterType} onChange={(event) => setFilterType(event.target.value)} aria-label="Filter type">
          <option value="all">All types</option>
          {FAULT_TYPES.map((type) => (
            <option key={type} value={type}>
              {FAULT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(event) => setFilterPriority(event.target.value)}
          aria-label="Filter priority"
        >
          <option value="all">All priorities</option>
          {FAULT_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {FAULT_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <select value={filterModule} onChange={(event) => setFilterModule(event.target.value)} aria-label="Filter module">
          <option value="all">All modules</option>
          {modules.map((module) => (
            <option key={module} value={module}>
              {module}
            </option>
          ))}
        </select>
      </div>

      {composerOpen ? (
        <div className="faults-composer">
          <header>
            <strong>New backlog item</strong>
            <button type="button" className="ghost-button" onClick={() => setComposerOpen(false)}>
              Cancel
            </button>
          </header>
          <div className="faults-composer-grid">
            <label>
              Title
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Optional short title" />
            </label>
            <label>
              Module
              <select value={draftModule} onChange={(event) => setDraftModule(event.target.value)}>
                {modules.map((module) => (
                  <option key={module} value={module}>
                    {module}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={draftType} onChange={(event) => setDraftType(event.target.value as FaultType)}>
                {FAULT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FAULT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={draftPriority} onChange={(event) => setDraftPriority(event.target.value as FaultPriority)}>
                {FAULT_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {FAULT_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              rows={5}
              placeholder="Describe the fault, improvement or feature request…"
            />
          </label>
          <button type="button" className="primary-button" disabled={saving} onClick={() => void createIssue()}>
            Create item
          </button>
        </div>
      ) : null}

      <div className={`faults-layout${selected ? " has-detail" : ""}`}>
        <div className="faults-list" aria-label="Backlog list">
          {folderKey === "feedback" ? (
            <>
              {!customerRequests.length ? <p className="faults-hint">No customer feedback waiting.</p> : null}
              {customerRequests.map((request) => (
                <div key={request.id} className="faults-row">
                  <span className="faults-row-top">
                    <b>{request.companyName}</b>
                    <em>{request.customerStatus}</em>
                  </span>
                  <strong>{request.title}</strong>
                  <p className="faults-hint">{request.description}</p>
                  <span className="faults-row-meta">
                    <span>{request.reporterName}</span>
                    <span>{request.linkedIssueReference || "Not promoted"}</span>
                  </span>
                  {canTriage && !request.linkedIssueReference ? (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={saving}
                      onClick={() =>
                        void postAction({ action: "promote-feedback", requestId: request.id }).then((data) => {
                          if (data?.issue) onNotice(`Promoted to ${data.issue.reference}`);
                        })
                      }
                    >
                      Promote to NeXa Development
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
          {folderKey !== "feedback" && loading ? <p className="faults-hint">Loading backlog…</p> : null}
          {folderKey !== "feedback" && !loading && !filtered.length ? (
            <p className="faults-hint">No items match these filters.</p>
          ) : null}
          {folderKey !== "feedback" && filtered.map((issue) => (
            <button
              key={issue.id}
              type="button"
              className={`faults-row priority-${priorityTone(issue.priority)}${selectedId === issue.id ? " on" : ""}`}
              onClick={() => {
                setSelectedId(issue.id);
                setTab("overview");
              }}
            >
              <span className="faults-row-top">
                <b>{issue.reference}</b>
                <em className={`faults-priority priority-${priorityTone(issue.priority)}`}>
                  {FAULT_PRIORITY_LABELS[issue.priority]}
                </em>
              </span>
              <strong>{issue.title}</strong>
              <span className="faults-row-meta">
                <span>
                  {typeIcon(issue.type)} {FAULT_TYPE_LABELS[issue.type]}
                </span>
                <span>{issue.module}</span>
                <span>{FAULT_STATUS_LABELS[issue.status]}</span>
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="faults-detail" aria-label={`${selected.reference} detail`}>
            <header>
              <div>
                <small>
                  {selected.reference} · {selected.module}
                </small>
                <h3>{selected.title}</h3>
              </div>
              <div className="faults-header-actions">
                {canTriage ? (
                  <button
                    type="button"
                    className="ghost-button danger"
                    disabled={saving}
                    onClick={() => {
                      if (!window.confirm(`Delete ${selected.reference}? This can’t be undone.`)) return;
                      void postAction({ action: "delete", id: selected.id }).then((data) => {
                        if (!data) return;
                        setSelectedId(null);
                        onNotice(`${selected.reference} deleted`);
                      });
                    }}
                  >
                    <Trash2 size={15} /> Delete
                  </button>
                ) : null}
                <button type="button" className="ghost-button" onClick={() => setSelectedId(null)}>
                  Close
                </button>
              </div>
            </header>

            <div className="faults-detail-tabs" role="tablist">
              {(
                [
                  ["overview", "Overview"],
                  ["workflow", "Workflow"],
                  ["notes", "Notes"],
                  ["attachments", "Attachments"],
                  ["activity", "Activity"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className={tab === key ? "on" : ""}
                  onClick={() => {
                    setTab(key);
                    if (key === "workflow") {
                      setTaskMarkdown(selected.developmentTaskMarkdown || selected.developmentBrief?.editableMarkdown || "");
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <div className="faults-detail-body">
                <div className="faults-badge-row">
                  <span>
                    {typeIcon(selected.type)} {FAULT_TYPE_LABELS[selected.type]}
                  </span>
                  <span className={`faults-priority priority-${priorityTone(selected.priority)}`}>
                    {FAULT_PRIORITY_LABELS[selected.priority]}
                  </span>
                  <span>{FAULT_STATUS_LABELS[selected.status]}</span>
                </div>

                {canTriage ? (
                  <div className="faults-composer-grid">
                    <label>
                      Status
                      <select
                        value={selected.status}
                        disabled={saving}
                        onChange={(event) => void patchSelected({ status: event.target.value as FaultStatus })}
                      >
                        {FAULT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {FAULT_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Priority
                      <select
                        value={selected.priority}
                        disabled={saving}
                        onChange={(event) => void patchSelected({ priority: event.target.value as FaultPriority })}
                      >
                        {FAULT_PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>
                            {FAULT_PRIORITY_LABELS[priority]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Type
                      <select
                        value={selected.type}
                        disabled={saving}
                        onChange={(event) => void patchSelected({ type: event.target.value as FaultType })}
                      >
                        {FAULT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {FAULT_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Module
                      <select
                        value={selected.module}
                        disabled={saving}
                        onChange={(event) => void patchSelected({ module: event.target.value })}
                      >
                        {modules.map((module) => (
                          <option key={module} value={module}>
                            {module}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Assigned to
                      <input
                        defaultValue={selected.assignedToName || ""}
                        key={`${selected.id}-assignee`}
                        disabled={saving}
                        placeholder="Developer / owner"
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value !== (selected.assignedToName || "")) {
                            void patchSelected({ assignedToName: value || null, assignedToId: null });
                          }
                        }}
                      />
                    </label>
                    <label>
                      Title
                      <input
                        defaultValue={selected.title}
                        key={`${selected.id}-title`}
                        disabled={saving}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value && value !== selected.title) void patchSelected({ title: value });
                        }}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="faults-block">
                  <h4>Original description</h4>
                  <p>{selected.originalDescription}</p>
                </div>
                {selected.aiDescription ? (
                  <div className="faults-block">
                    <h4>Structured description</h4>
                    <p>{selected.aiDescription}</p>
                  </div>
                ) : null}
                <dl className="faults-meta">
                  <div>
                    <dt>Reported by</dt>
                    <dd>{selected.reporterName}</dd>
                  </div>
                  <div>
                    <dt>Date reported</dt>
                    <dd>{new Date(selected.createdAt).toLocaleString("en-GB")}</dd>
                  </div>
                  {selected.sourceRoute ? (
                    <div>
                      <dt>Source route</dt>
                      <dd>{selected.sourceRoute}</dd>
                    </div>
                  ) : null}
                  {selected.completedAt ? (
                    <div>
                      <dt>Completed</dt>
                      <dd>{new Date(selected.completedAt).toLocaleString("en-GB")}</dd>
                    </div>
                  ) : null}
                  {selected.linkedRequestIds?.length ? (
                    <div>
                      <dt>Linked customer requests</dt>
                      <dd>{selected.linkedRequestIds.length}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}

            {tab === "workflow" && canTriage ? (
              <div className="faults-detail-body">
                <div className="faults-header-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() =>
                      void postAction({ action: "generate-brief", id: selected.id }).then((data) => {
                        if (data?.brief?.editableMarkdown) setTaskMarkdown(data.brief.editableMarkdown);
                        if (data?.issue) onNotice("Development brief generated");
                      })
                    }
                  >
                    Generate development brief
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving}
                    onClick={() =>
                      void postAction({ action: "send-to-development", id: selected.id }).then((data) => {
                        if (data?.developmentTaskMarkdown) setTaskMarkdown(data.developmentTaskMarkdown);
                        if (data?.issue) onNotice("Development task ready");
                      })
                    }
                  >
                    Send to development
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving || !githubConfigured}
                    title={githubConfigured ? "Sync to GitHub" : "Set GITHUB_TOKEN + GITHUB_FAULTS_REPO"}
                    onClick={() =>
                      void postAction({ action: "sync-github", id: selected.id }).then((data) => {
                        if (data?.issue?.github?.issueUrl) onNotice(`GitHub: ${data.issue.github.issueUrl}`);
                      })
                    }
                  >
                    Sync GitHub
                  </button>
                </div>

                {selected.status === "ready_to_test" ? (
                  <div className="faults-block">
                    <h4>Testing queue</h4>
                    <label>
                      Build / version
                      <input value={buildVersion} onChange={(event) => setBuildVersion(event.target.value)} placeholder="Optional commit or build" />
                    </label>
                    <label>
                      Fail note (required for FAIL)
                      <textarea value={failNote} onChange={(event) => setFailNote(event.target.value)} rows={3} />
                    </label>
                    <div className="faults-header-actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={saving}
                        onClick={() =>
                          void postAction({
                            action: "test-result",
                            id: selected.id,
                            testResult: "pass",
                            buildVersion,
                          }).then((data) => {
                            if (data?.issue) onNotice(`${data.issue.reference} PASS → Complete`);
                          })
                        }
                      >
                        PASS
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={saving}
                        onClick={() =>
                          void postAction({
                            action: "test-result",
                            id: selected.id,
                            testResult: "fail",
                            testNote: failNote,
                            buildVersion,
                          }).then((data) => {
                            if (data?.issue) {
                              setFailNote("");
                              onNotice(`${data.issue.reference} FAIL → In Progress`);
                            }
                          })
                        }
                      >
                        FAIL
                      </button>
                    </div>
                  </div>
                ) : null}

                {selected.testHistory?.length ? (
                  <div className="faults-block">
                    <h4>Test history</h4>
                    <ol className="faults-activity">
                      {selected.testHistory.map((row) => (
                        <li key={row.id}>
                          <time>{new Date(row.at).toLocaleString("en-GB")}</time>
                          <strong>
                            {row.result.toUpperCase()} · {row.testedByName}
                            {row.buildVersion ? ` · ${row.buildVersion}` : ""}
                          </strong>
                          {row.note ? <p>{row.note}</p> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <label>
                  Development task / brief
                  <textarea
                    value={taskMarkdown || selected.developmentBrief?.editableMarkdown || selected.developmentTaskMarkdown || ""}
                    onChange={(event) => setTaskMarkdown(event.target.value)}
                    rows={14}
                    placeholder="Generate a brief or send to development to populate this package."
                  />
                </label>
                {selected.github?.issueUrl ? (
                  <p className="faults-hint">
                    GitHub: <a href={selected.github.issueUrl}>{selected.github.issueUrl}</a>
                  </p>
                ) : null}
              </div>
            ) : null}

            {tab === "notes" ? (
              <div className="faults-detail-body">
                <label>
                  Development notes
                  <textarea
                    defaultValue={selected.developmentNotes || ""}
                    key={`${selected.id}-dev`}
                    rows={5}
                    disabled={!canTriage || saving}
                    onBlur={(event) => {
                      if (event.target.value !== (selected.developmentNotes || "")) {
                        void patchSelected({ developmentNotes: event.target.value });
                      }
                    }}
                  />
                </label>
                <label>
                  Testing notes
                  <textarea
                    defaultValue={selected.testingNotes || ""}
                    key={`${selected.id}-test`}
                    rows={5}
                    disabled={!canTriage || saving}
                    onBlur={(event) => {
                      if (event.target.value !== (selected.testingNotes || "")) {
                        void patchSelected({ testingNotes: event.target.value });
                      }
                    }}
                  />
                </label>
                <label>
                  Add comment
                  <textarea
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    rows={3}
                    placeholder="Add information for the team…"
                  />
                </label>
                <button type="button" className="primary-button" disabled={saving} onClick={() => void addComment()}>
                  Add comment
                </button>
              </div>
            ) : null}

            {tab === "attachments" ? (
              <div className="faults-detail-body">
                <p className="faults-hint">Screenshots, photos, screen recordings and documents for {selected.reference}.</p>
                <FileDropZone
                  label="Drop evidence here or choose files"
                  multiple
                  disabled={saving}
                  onFiles={(files) => void uploadFiles(files)}
                />
                {attachmentsLoading ? (
                  <p className="faults-hint">Loading attachments…</p>
                ) : attachments.length ? (
                  <ul className="faults-attachment-list">
                    {attachments.map((doc) => (
                      <li key={doc.id}>
                        <div>
                          <strong>{doc.name}</strong>
                          <small>
                            {doc.type}
                            {doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleString("en-GB")}` : ""}
                            {typeof doc.size === "number" ? ` · ${Math.max(1, Math.round(doc.size / 1024))} KB` : ""}
                          </small>
                        </div>
                        <a className="secondary-button" href={doc.fileUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} /> Open
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="faults-hint">No attachments yet — drop files above.</p>
                )}
              </div>
            ) : null}

            {tab === "activity" ? (
              <div className="faults-detail-body">
                <ol className="faults-activity">
                  {selected.activity.map((row) => (
                    <li key={row.id}>
                      <time>{new Date(row.at).toLocaleString("en-GB")}</time>
                      <strong>{row.summary}</strong>
                      {row.detail ? <p>{row.detail}</p> : null}
                    </li>
                  ))}
                </ol>
                {!selected.activity.length ? (
                  <p className="faults-hint">
                    <CheckCircle2 size={14} /> No activity yet.
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
