import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { emailProviderSmtpDefaults, type EmailProvider } from "@/lib/email-integration-store";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

const EMAIL_PROVIDERS: EmailProvider[] = ["Outlook", "Gmail", "iCloud"];

function normalizeProvider(value: unknown): EmailProvider {
  return EMAIL_PROVIDERS.includes(value as EmailProvider) ? (value as EmailProvider) : "Outlook";
}

/** Apple app passwords are often pasted with spaces — strip them. Keep hyphens. */
export function normalizeMailboxSecret(secret: string) {
  return secret.replace(/\s+/g, "").trim();
}

function isAppleMailAddress(email: string) {
  return /@(icloud|me|mac)\.com$/i.test(email.trim());
}

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

const defaultProviderHosts = emailProviderSmtpDefaults;

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

/** Re-read disk/sqlite before every op — Render can have multiple Node instances with stale memory. */
function hydrateEmployeeMailboxStore() {
  const snapshot = readServerStoreSnapshot("employee-mailboxes") as EmployeeMailboxStore | null;
  if (snapshot && typeof snapshot === "object" && snapshot.byEmployeeId && typeof snapshot.byEmployeeId === "object") {
    employeeMailboxStore.byEmployeeId = snapshot.byEmployeeId;
  }
  return employeeMailboxStore;
}

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
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  return sanitize(id, id ? employeeMailboxStore.byEmployeeId[id] : undefined);
}

export function listConfiguredEmployeeMailboxes(): EmployeeMailboxStatus[] {
  hydrateEmployeeMailboxStore();
  return Object.entries(employeeMailboxStore.byEmployeeId)
    .map(([employeeId, record]) => sanitize(employeeId, record))
    .filter((item) => item.configured);
}

export function saveEmployeeMailboxSettings(employeeId: string, input: EmployeeMailboxInput) {
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  if (!id) throw new Error("Employee id is required.");

  const provider = normalizeProvider(input.provider);
  const senderEmail = input.senderEmail.trim().toLowerCase();
  const username = (input.username.trim() || senderEmail).toLowerCase();
  const secret = normalizeMailboxSecret(input.secret);
  if (!senderEmail) throw new Error("Enter the email address to send as.");
  if (provider === "iCloud" && !isAppleMailAddress(senderEmail)) {
    throw new Error("For iCloud, Sends as must be your Apple Mail address (@icloud.com, @me.com, or @mac.com).");
  }

  const current = employeeMailboxStore.byEmployeeId[id] ?? emptyRecord();
  const defaults = defaultProviderHosts[provider];
  // Always trust provider defaults for host/port/secure so a leftover Outlook host cannot break iCloud.
  const nextHost = provider === "iCloud" || provider === "Gmail" || provider === "Outlook"
    ? defaults.host
    : (input.smtpHost?.trim() || defaults.host);
  const nextPort = defaults.port;
  const nextSecure = defaults.secure;
  const connectionChanged = Boolean(
    secret
    || provider !== current.provider
    || senderEmail !== current.senderEmail
    || username !== current.username
    || nextHost !== current.smtpHost
    || nextPort !== current.smtpPort
    || nextSecure !== current.secure,
  );

  if (!secret && !current.encryptedSecret) {
    throw new Error("Paste the app-specific password before saving.");
  }

  const next: EmployeeMailboxRecord = {
    provider,
    senderEmail,
    username,
    encryptedSecret: secret ? encryptSecret(secret) : current.encryptedSecret,
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
  hydrateEmployeeMailboxStore();
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
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  if (!id) return null;
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return null;
  const secret = normalizeMailboxSecret(decryptSecret(record.encryptedSecret));
  if (!record.senderEmail.trim() || !record.username.trim() || !secret) return null;
  const provider = normalizeProvider(record.provider);
  const defaults = defaultProviderHosts[provider];
  const display = record.displayName.trim();
  return {
    source: "employee",
    employeeId: id,
    provider,
    from: record.senderEmail,
    fromHeader: display ? `${display} <${record.senderEmail}>` : record.senderEmail,
    username: record.username,
    secret,
    smtpHost: defaults.host,
    smtpPort: defaults.port,
    secure: defaults.secure,
  };
}

export function markEmployeeMailboxSent(employeeId: string, messageId: string, sentAt: string) {
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastSentAt = sentAt;
  record.lastSentMessageId = messageId;
  record.lastError = undefined;
  persist();
}

export function markEmployeeMailboxError(employeeId: string, error: string) {
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastError = error;
  persist();
}

export function markEmployeeMailboxTested(employeeId: string, recipient: string, messageId: string, testedAt: string) {
  hydrateEmployeeMailboxStore();
  const id = employeeId.trim();
  const record = employeeMailboxStore.byEmployeeId[id];
  if (!record) return;
  record.lastTestedAt = testedAt;
  record.lastTestRecipient = recipient;
  record.lastTestMessageId = messageId;
  record.lastError = undefined;
  persist();
}

function formatMailboxSendError(mailbox: ResolvedMailboxTransport, error: unknown) {
  const raw = error instanceof Error ? error.message : "Email authentication or send failed.";
  if (mailbox.provider === "iCloud") {
    return [
      raw,
      "iCloud needs: full Apple Mail address (@icloud.com / @me.com / @mac.com), an app-specific password from appleid.apple.com (not your Apple ID password), and 2FA turned on.",
    ].join(" — ");
  }
  return raw;
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
    tls: {
      minVersion: "TLSv1.2",
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
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
    const message = formatMailboxSendError(mailbox, error);
    if (mailbox.employeeId) {
      markEmployeeMailboxError(mailbox.employeeId, message);
    }
    throw new Error(message);
  } finally {
    transport.close();
  }
}

export async function testEmployeeMailboxConnection(employeeId: string) {
  const mailbox = resolveEmployeeMailboxTransport(employeeId);
  if (!mailbox) {
    throw new Error("Save the mailbox first (provider, Sends as, and app password), then test.");
  }
  if (mailbox.provider === "iCloud" && !isAppleMailAddress(mailbox.from)) {
    throw new Error("For iCloud, Sends as must be your Apple Mail address (@icloud.com, @me.com, or @mac.com).");
  }
  const result = await sendViaResolvedMailbox(mailbox, {
    to: mailbox.from,
    subject: "NeXa mailbox connection test",
    text: [
      "This test email was sent by NeXa from your personal mailbox settings.",
      "",
      `Provider: ${mailbox.provider}`,
      `Sent: ${new Date().toISOString()}`,
      "",
      "Receiving this message confirms NeXa can send as you on jobs and quotes.",
    ].join("\n"),
  });
  markEmployeeMailboxTested(employeeId, mailbox.from, result.messageId, result.sentAt);
  return getEmployeeMailboxStatus(employeeId);
}
