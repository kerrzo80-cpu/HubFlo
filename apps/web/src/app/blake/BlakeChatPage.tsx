"use client";

import { ArrowLeft, Bug, Check, Lightbulb, Menu, MessageSquare, MoreHorizontal, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ASSISTANT_ASK, ASSISTANT_NAME } from "@/lib/product-brand";
import styles from "./blake.module.css";

type MessageAction = { id: string; title: string; detail: string; confirmLabel: string; kind: string };
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  aiUsed?: boolean;
  action?: MessageAction;
};
type Chat = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[] };
type AssistantResponse = { reply?: string; error?: string; aiUsed?: boolean; action?: MessageAction };

const WELCOME = `I’m ${ASSISTANT_NAME}. Ask me anything about your authorised blake. workspace, or think something through with me. You can also report a problem or suggest an improvement.`;

export default function BlakeChatPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuId, setMenuId] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(() => chats.find((chat) => chat.id === activeId) || chats[0] || null, [activeId, chats]);

  useEffect(() => {
    void loadChats();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, busy]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 29), 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }, [draft]);

  async function loadChats() {
    setLoading(true);
    try {
      const response = await fetch("/api/blake/chats", { credentials: "include" });
      const payload = await response.json() as { chats?: Chat[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Could not load your ${ASSISTANT_NAME} chats.`);
      const loaded = payload.chats || [];
      setChats(loaded);
      if (loaded[0]) setActiveId(loaded[0].id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not load your ${ASSISTANT_NAME} chats.`);
    } finally {
      setLoading(false);
    }
  }

  async function newChat() {
    const response = await fetch("/api/blake/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    const payload = await response.json() as { chat?: Chat; error?: string };
    if (!response.ok || !payload.chat) {
      setError(payload.error || "Could not create a new chat.");
      return;
    }
    setChats((current) => [payload.chat!, ...current]);
    setActiveId(payload.chat.id);
    setSidebarOpen(false);
    setDraft("");
  }

  async function persist(chat: Chat) {
    const response = await fetch("/api/blake/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: chat.id, title: chat.title, messages: chat.messages }),
    });
    const payload = await response.json() as { chat?: Chat; error?: string };
    if (!response.ok || !payload.chat) throw new Error(payload.error || "The chat could not be saved.");
    setChats((current) => current.map((item) => item.id === payload.chat!.id ? payload.chat! : item));
  }

  async function renameChat(chat: Chat) {
    const title = window.prompt("Rename chat", chat.title)?.trim();
    setMenuId("");
    if (!title || title === chat.title) return;
    try {
      await persist({ ...chat, title });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The chat could not be renamed.");
    }
  }

  async function removeChat(chat: Chat) {
    setMenuId("");
    if (!window.confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
    const response = await fetch(`/api/blake/chats?id=${encodeURIComponent(chat.id)}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error || "The chat could not be deleted.");
      return;
    }
    setChats((current) => current.filter((item) => item.id !== chat.id));
    if (activeId === chat.id) setActiveId(chats.find((item) => item.id !== chat.id)?.id || "");
  }

  async function ensureActiveChat() {
    if (active) return active;
    const response = await fetch("/api/blake/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const payload = await response.json() as { chat?: Chat };
    if (!response.ok || !payload.chat) throw new Error("Could not create a new chat.");
    setChats((current) => [payload.chat!, ...current]);
    setActiveId(payload.chat.id);
    return payload.chat;
  }

  async function startFeedback(kind: "problem" | "improvement") {
    const draftPrefix = kind === "problem" ? "Report a problem: " : "Suggest an improvement: ";
    const guide =
      kind === "problem"
        ? "Tell me what’s wrong (and where you are if it helps). I’ll draft a Faults entry for you to confirm."
        : "What should blake. do better? I’ll log it as an improvement for you to confirm.";
    setDraft(draftPrefix);
    setError("");
    try {
      const chat = await ensureActiveChat();
      const guideMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: guide,
        createdAt: new Date().toISOString(),
      };
      const next = { ...chat, messages: [...chat.messages, guideMessage] };
      setChats((current) => current.map((item) => (item.id === chat.id ? next : item)));
      await persist(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start feedback.");
    }
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    try {
      const chat = await ensureActiveChat();
      const userMessage: Message = { id: crypto.randomUUID(), role: "user", text, createdAt: new Date().toISOString() };
      const withUser = { ...chat, messages: [...chat.messages, userMessage] };
      setChats((current) => current.map((item) => item.id === chat.id ? withUser : item));

      const response = await fetch("/api/nexa-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          history: chat.messages.slice(-30).map((message) => ({ role: message.role, text: message.text })),
          sourceRoute: "/blake",
          sourcePage: ASSISTANT_ASK,
          channel: "web_text",
          conversationId: chat.id,
        }),
      });
      const result = await response.json() as AssistantResponse;
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.reply || result.error || "I could not complete that request.",
        createdAt: new Date().toISOString(),
        aiUsed: result.aiUsed,
        action: result.action,
      };
      await persist({ ...withUser, messages: [...withUser.messages, assistantMessage] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${ASSISTANT_NAME} could not complete that request.`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(message: Message) {
    if (!active || !message.action || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/nexa-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmActionId: message.action.id, channel: "web_text" }),
      });
      const result = await response.json() as AssistantResponse;
      const confirmation: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.reply || result.error || "The action could not be completed.",
        createdAt: new Date().toISOString(),
      };
      const messages = active.messages.map((item) => item.id === message.id ? { ...item, action: undefined } : item);
      await persist({ ...active, messages: [...messages, confirmation] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarHeader}>
          <a href="/" className={styles.coreLink}><ArrowLeft size={18} /> Core</a>
          <button className={styles.mobileClose} onClick={() => setSidebarOpen(false)} aria-label="Close chats"><X size={19} /></button>
        </div>
        <button className={styles.newChat} onClick={() => void newChat()}><Plus size={18} /> New chat</button>
        <nav className={styles.chatList} aria-label={`${ASSISTANT_NAME} chats`}>
          {chats.map((chat) => (
            <div className={`${styles.chatRow} ${active?.id === chat.id ? styles.activeChat : ""}`} key={chat.id}>
              <button className={styles.chatSelect} onClick={() => { setActiveId(chat.id); setSidebarOpen(false); }}>
                <MessageSquare size={16} />
                <span>{chat.title}</span>
              </button>
              <button className={styles.chatMenuButton} onClick={() => setMenuId(menuId === chat.id ? "" : chat.id)} aria-label={`Options for ${chat.title}`}><MoreHorizontal size={17} /></button>
              {menuId === chat.id ? (
                <div className={styles.chatMenu}>
                  <button onClick={() => void renameChat(chat)}><Pencil size={15} /> Rename</button>
                  <button className={styles.danger} onClick={() => void removeChat(chat)}><Trash2 size={15} /> Delete</button>
                </div>
              ) : null}
            </div>
          ))}
        </nav>
        <p className={styles.permissionNote}>Chats are private to your profile. {ASSISTANT_NAME} only uses the blake. areas your role can access.</p>
      </aside>

      {sidebarOpen ? <button className={styles.backdrop} onClick={() => setSidebarOpen(false)} aria-label="Close chats" /> : null}

      <section className={styles.workspace}>
        <header className={styles.header}>
          <button className={styles.mobileMenu} onClick={() => setSidebarOpen(true)} aria-label="Open chats"><Menu size={20} /></button>
          <div><strong>{ASSISTANT_ASK}</strong><span>{active?.title || "New conversation"}</span></div>
          <span className={styles.status}><i /> Connected to blake.</span>
        </header>

        <div className={styles.messages}>
          {loading ? <p className={styles.loading}>Loading your chats…</p> : null}
          {!loading && !active?.messages.length ? (
            <div className={styles.empty}>
              <div className={styles.blakeMark}>A</div>
              <h1>What can I help with?</h1>
              <p>{WELCOME}</p>
              <div className={styles.prompts}>
                <button type="button" onClick={() => void startFeedback("problem")}>
                  <Bug size={16} /> Report a problem
                </button>
                <button type="button" onClick={() => void startFeedback("improvement")}>
                  <Lightbulb size={16} /> Suggest an improvement
                </button>
                <button type="button" onClick={() => setDraft("Which jobs currently have the tightest margins?")}>Jobs with tight margins</button>
                <button type="button" onClick={() => setDraft("Which invoices are overdue and need chasing?")}>Overdue invoices</button>
              </div>
            </div>
          ) : null}
          {active?.messages.map((message) => (
            <article className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`} key={message.id}>
              {message.role === "assistant" ? <div className={styles.avatar}>A</div> : null}
              <div className={styles.messageBody}>
                <p>{message.text}</p>
                {message.action ? (
                  <div className={styles.actionCard}>
                    <strong>{message.action.title}</strong>
                    <span>{message.action.detail}</span>
                    <button disabled={busy} onClick={() => void confirmAction(message)}><Check size={16} /> {message.action.confirmLabel}</button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {busy ? <div className={`${styles.message} ${styles.assistantMessage}`}><div className={styles.avatar}>A</div><p className={styles.thinking}>{ASSISTANT_NAME} is working across blake.…</p></div> : null}
          <div ref={endRef} />
        </div>

        <div className={styles.composerWrap}>
          {error ? <div className={styles.error}>{error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
          <div className={styles.feedbackChips} aria-label="Feedback actions">
            <button type="button" className={styles.feedbackChip} disabled={busy} onClick={() => void startFeedback("problem")}>
              <Bug size={14} /> Report a problem
            </button>
            <button type="button" className={styles.feedbackChip} disabled={busy} onClick={() => void startFeedback("improvement")}>
              <Lightbulb size={14} /> Suggest an improvement
            </button>
          </div>
          <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}
              placeholder={`Message ${ASSISTANT_NAME}`}
              aria-label={`Message ${ASSISTANT_NAME}`}
              rows={1}
            />
            <button type="submit" disabled={!draft.trim() || busy} aria-label="Send"><Send size={19} /></button>
          </form>
          <small>{ASSISTANT_NAME} can read only what your blake. role permits. Operational and commercial changes require confirmation.</small>
        </div>
      </section>
    </main>
  );
}
