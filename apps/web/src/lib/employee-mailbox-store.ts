import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import type { EmailProvider } from "@/lib/email-integration-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type EmployeeMailboxInput = {
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  secret: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
  displayName?: string;
};

export type EmployeeMailboxStatus = {
  employeeId: string;
  configured: boolean;
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  secretStored: boolean;
  displayName: string;
  lastTestedAt?: string;
  lastTestRecipient?: string;
  lastTestMessageId?: string;
  lastSentAt?: string;
  lastSentMessageId?: string;
  lastError?: string;
};

type EmployeeMailboxRecord = {
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  encryptedSecret: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  displayName: string;
  lastTestedAt?: string;
  lastTestRecipient?: string;
  lastTestMessageId?: string;
  lastSentAt?: string;
  lastSentMessageId?: string;
  lastError?: string;
};

type EmployeeMailboxStore = {
  byEmployeeId: Record<string, EmployeeMailboxRecord>;
};

const defaultProviderHosts: Record<EmailProvider, { host: string; port: number; secure: boolean }> = {
  Outlook: { host: "smtp.office365.com", port: 587, secure: false },
  Gmail: { host: "smtp.gmail.com", port: 465, secure: true },
};

const emptyStore: EmployeeMailboxStore = { byEmployeeId: {} };

function getEncryptionKey() {
  const explicit = process.env.NEXA_EMAIL_SETTINGS_SECRET?.trim();
  const generated = loadServerStore("email-settings-secret", {
    value: randomBytes(32).toString("hex"),
  }) as { value: string };
  const secret = explicit || generated.value;
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(secret: string) {
  if (!secret.trim()) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(payload: string) {
  if (!payload) return "";
  const [ivHex, tagHex, encryptedHex] = payload.split(":");
  if (!ivHex || !tagHex || !encryptedHex) return "";
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

const employeeMailboxStore = loadServerStore<EmployeeMailboxStore>("employee-mailboxes", emptyStore);

function persist() {
  writeServerStore("employee-mailboxes", employeeMailboxStore);
}

function emptyRecord(): EmployeeMailboxRecord {
  return {
    provider: "Outlook",
    senderEmail: "",
    username: "",
    encryptedSecret: "",
    smtpHost: defaultProviderHosts.Outlook.host,
    smtpPort: defaultProviderHosts.Outlook.port,
    secure: defaultProviderHosts.Outlook.secure,
    displayName: "",
  };
}

function sanitize(employeeId: string, record: EmployeeMailboxRecord | undefined): EmployeeMailboxStatus {
  const store = record ?? emptyRecord();
  return {
    employeeId,
    configured: Boolean(store.senderEmail.trim() && store.username.trim() && store.encryptedSecret),
    provider: store.provider,
    senderEmail: store.senderEmail,
    username: store.username,
    smtpHost: store.smtpHost,
    smtpPort: store.smtpPort,
    secure: store.secure,
    secretStored: Boolean(store.encryptedSecret),
    displayName: store.displayName,
    lastTestedAt: store.lastTestedAt,
    lastTestRecipient: store.lastTestRecipient,
    lastTestMessageId: store.lastTestMessageId,
    lastSentAt: store.lastSentAt,
    lastSentMessageId: store.lastSentMessageId,
    lastError: store.lastError,
  };
}

export function getEmployeeMailboxStatus(employeeId: string): EmployeeMailboxStatus {
  const id = employeeId.trim();
  return sanitize(id, id ? employeeMailboxStore.byEmployeeId[id] : undefined);
}

export function listConfiguredEmployeeMailboxes(): EmployeeMailboxStatus[] {
  return Object.entries(employeeMailboxStore.byEmployeeId)
    .map(([employeeId, record]) => sanitize(employeeId, record))
    .filter((item) => item.configured);
}

export function saveEmployeeMailboxSettings(employeeId: string, input: EmployeeMailboxInput) {
  const id = employeeId.trim();
  if (!id) throw new Error("Employee id is required.");

  const current = employeeMailboxStore.byEmployeeId[id] ?? emptyRecord();
  const defaults = defaultProviderHosts[input.provider];
  const nextHost = input.smtpHost?.trim() || defaults.host;
  const nextPort = input.smtpPort && Number.isFinite(input.smtpPort) ? input.smtpPort : defaults.port;
  const nextSecure = input.secure ?? defaults.secure;
  const connectionChanged = Boolean(
    input.secret.trim()
    || input.provider !== current.provider
    || input.senderEmail.trim() !== current.senderEmail
    || input.username.trim() !== current.username
    || nextHost !== current.smtpHost
    || nextPort !== current.smtpPort
    || nextSecure !== current.secure,
  );

  const next: EmployeeMailboxRecord = {
    provider: input.provider,
    senderEmail: input.senderEmail.trim(),
    username: input.username.trim(),
    encryptedSecret: input.secret.trim() ? encryptSecret(input.secret.trim()) : current.encryptedSecret,
    smtpHost: nextHost,
    smtpPort: nextPort,
    secure: nextSecure,
    displayName: (input.displayName ?? current.displayName).trim(),
    lastTestedAt: connectionChanged ? undefined : current.lastTestedAt,
    lastTestRecipient: connectionChanged ? undefined : current.lastTestRecipient,
    lastTestMessageId: connectionChanged ? undefined : current.lastTestMessageId,
    lastSentAt: current.lastSentAt,
    lastSentMessageId: current.lastSentMessageId,
    lastError: connectionChanged ? undefined : current.lastError,
  };

  employeeMailboxStore.byEmployeeId[id] = next;
  persist();
  return sanitize(id, next);
}

export function clearEmployeeMailbox(employeeId: string) {
  const id = employeeId.trim();
  if (!id || !employeeMailboxStore.byEmployeeId[id]) {
    return sanitize(id, undefined);
  }
  delete employeeMailboxStore.byEmployeeId[id];
  persist();
  return sanitize(id, undefined);
}

export type ResolvedMailboxTransport = {
  source: "employee" | "company";
  employeeId?: string;
  provider: EmailProvider;
  from: string;
  fromHeader: string;
  username: string;
  secret: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
};

export function resolveEmployeeMailboxTransport(employeeId: string): ResolvedMailboxTransport | null {
  const id = employeeId.trim();
  if (!id) return null;
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return null;
  const secret = decryptSecret(record.encryptedSecret);
  if (!record.senderEmail.trim() || !record.username.trim() || !secret.trim()) return null;
  const display = record.displayName.trim();
  return {
    source: "employee",
    employeeId: id,
    provider: record.provider,
    from: record.senderEmail,
    fromHeader: display ? `${display} <${record.senderEmail}>` : record.senderEmail,
    username: record.username,
    secret,
    smtpHost: record.smtpHost,
    smtpPort: record.smtpPort,
    secure: record.secure,
  };
}

export function markEmployeeMailboxSent(employeeId: string, messageId: string, sentAt: string) {
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastSentAt = sentAt;
  record.lastSentMessageId = messageId;
  record.lastError = undefined;
  persist();
}

export function markEmployeeMailboxError(employeeId: string, error: string) {
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastError = error;
  persist();
}

export function markEmployeeMailboxTested(employeeId: string, recipient: string, messageId: string, testedAt: string) {
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastTestedAt = testedAt;
  record.lastTestRecipient = recipient;
  record.lastTestMessageId = messageId;
  record.lastError = undefined;
  persist();
}

export async function sendViaResolvedMailbox(
  mailbox: ResolvedMailboxTransport,
  input: { to: string; cc?: string; subject: string; text: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }> },
) {
  const transport = nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.secure,
    requireTLS: !mailbox.secure,
    auth: {
      user: mailbox.username,
      pass: mailbox.secret,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  try {
    await transport.verify();
    const sent = await transport.sendMail({
      from: mailbox.fromHeader,
      to: input.to.trim(),
      cc: input.cc?.trim() || undefined,
      subject: input.subject.trim(),
      text: input.text,
      attachments: input.attachments,
    });
    const sentAt = new Date().toISOString();
    if (mailbox.employeeId) {
      markEmployeeMailboxSent(mailbox.employeeId, sent.messageId, sentAt);
    }
    return {
      provider: mailbox.provider,
      from: mailbox.from,
      source: mailbox.source,
      employeeId: mailbox.employeeId,
      messageId: sent.messageId,
      accepted: sent.accepted.map(String),
      rejected: sent.rejected.map(String),
      sentAt,
    };
  } catch (error) {
    if (mailbox.employeeId) {
      markEmployeeMailboxError(
        mailbox.employeeId,
        error instanceof Error ? error.message : "Email authentication or send failed.",
      );
    }
    throw error;
  } finally {
    transport.close();
  }
}

export async function testEmployeeMailboxConnection(employeeId: string) {
  const mailbox = resolveEmployeeMailboxTransport(employeeId);
  if (!mailbox) {
    throw new Error("Connect this employee's Outlook/Gmail mailbox before testing.");
  }
  const result = await sendViaResolvedMailbox(mailbox, {
    to: mailbox.from,
    subject: "Blake mailbox connection test",
    text: [
      "This test email was sent by Blake from your personal mailbox settings.",
      "",
      `Provider: ${mailbox.provider}`,
      `Sent: ${new Date().toISOString()}`,
      "",
      "Receiving this message confirms Blake can send as you on jobs and quotes.",
    ].join("\n"),
  });
  markEmployeeMailboxTested(employeeId, mailbox.from, result.messageId, result.sentAt);
  return getEmployeeMailboxStatus(employeeId);
}
