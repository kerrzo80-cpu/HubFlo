"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Archive, Brain, RefreshCw, Save, Search } from "lucide-react";

import styles from "./knowledge.module.css";

type KnowledgeItem = {
  id: string;
  scope: string;
  scopeId?: string;
  category: string;
  key: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "superseded" | "archived";
  version: number;
  sourceConversationId?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  revisions?: Array<{ version: number; content: string; title: string; changedBy: string; changedAt: string }>;
};

const scopes = ["all", "company", "user", "customer", "site", "lead", "quote", "job", "employee"];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function BlakeKnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (scope !== "all") params.set("scope", scope);
      const response = await fetch(`/api/blake/knowledge?${params.toString()}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json() as { items?: KnowledgeItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Ayla Knowledge could not be loaded.");
      setItems(payload.items ?? []);
      if (selectedId && !(payload.items ?? []).some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ayla Knowledge could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [scope]);

  function choose(item: KnowledgeItem) {
    setSelectedId(item.id);
    setTitle(item.title);
    setContent(item.content);
    setNotice("");
    setError("");
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/blake/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: selected.id, title, content }),
      });
      const payload = await response.json() as { item?: KnowledgeItem; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || "Knowledge could not be updated.");
      setItems((current) => current.map((item) => item.id === payload.item!.id ? payload.item! : item));
      setNotice(`Saved as version ${payload.item.version}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Knowledge could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/blake/knowledge?id=${encodeURIComponent(selected.id)}`, { method: "DELETE", credentials: "include" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Knowledge could not be archived.");
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setSelectedId(null);
      setNotice("Ayla has forgotten that active rule. Its audit history is retained.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Knowledge could not be archived.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/blake" className={styles.back}><ArrowLeft size={16} /> Ayla</Link>
          <div className={styles.heading}><Brain size={24} /><div><h1>Ayla Knowledge</h1><p>What Ayla has been taught, scoped and governed by NeXa.</p></div></div>
        </div>
        <button className={styles.secondary} onClick={() => void load()} disabled={busy}><RefreshCw size={16} /> Refresh</button>
      </header>

      <section className={styles.toolbar}>
        <label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="Search rules, pricing, terminology…" /></label>
        <select value={scope} onChange={(event) => setScope(event.target.value)}>{scopes.map((item) => <option key={item} value={item}>{item === "all" ? "All scopes" : label(item)}</option>)}</select>
        <button className={styles.secondary} onClick={() => void load()} disabled={busy}>Search</button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.layout}>
        <section className={styles.list}>
          <div className={styles.listHeader}><strong>{items.length} active items</strong><span>Company, personal and record-linked knowledge</span></div>
          {items.map((item) => (
            <button key={item.id} className={`${styles.card} ${selectedId === item.id ? styles.selected : ""}`} onClick={() => choose(item)}>
              <div className={styles.cardTop}><span>{label(item.scope)}</span><em>{label(item.category)}</em></div>
              <strong>{item.title}</strong>
              <p>{item.content}</p>
              <small>v{item.version} · {item.createdBy} · {when(item.updatedAt)}</small>
            </button>
          ))}
          {!items.length && !busy ? <div className={styles.empty}>No matching active Ayla knowledge.</div> : null}
        </section>

        <aside className={styles.detail}>
          {selected ? (
            <>
              <div className={styles.meta}><span>{label(selected.scope)}</span><span>{label(selected.category)}</span><span>Version {selected.version}</span></div>
              <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Knowledge<textarea rows={8} value={content} onChange={(event) => setContent(event.target.value)} /></label>
              <dl>
                <div><dt>Stable key</dt><dd>{selected.key}</dd></div>
                {selected.scopeId ? <div><dt>Linked record</dt><dd>{selected.sourceEntityType || selected.scope} · {selected.scopeId}</dd></div> : null}
                <div><dt>Created by</dt><dd>{selected.createdBy}</dd></div>
                <div><dt>Updated</dt><dd>{when(selected.updatedAt)}</dd></div>
                {selected.sourceConversationId ? <div><dt>Conversation</dt><dd>{selected.sourceConversationId}</dd></div> : null}
              </dl>
              <div className={styles.actions}>
                <button className={styles.primary} onClick={() => void save()} disabled={busy || !title.trim() || !content.trim()}><Save size={16} /> Save update</button>
                <button className={styles.danger} onClick={() => void forget()} disabled={busy}><Archive size={16} /> Forget / archive</button>
              </div>
              {selected.revisions?.length ? (
                <section className={styles.history}><h2>Previous versions</h2>{[...selected.revisions].reverse().map((revision) => <article key={`${revision.version}-${revision.changedAt}`}><strong>v{revision.version} · {revision.title}</strong><p>{revision.content}</p><small>{when(revision.changedAt)} · {revision.changedBy}</small></article>)}</section>
              ) : null}
            </>
          ) : <div className={styles.emptyDetail}><Brain size={34} /><strong>Select a knowledge item</strong><p>Review its scope, provenance and version history here.</p></div>}
        </aside>
      </div>
    </main>
  );
}
