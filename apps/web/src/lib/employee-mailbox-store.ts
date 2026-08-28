import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { emailProviderSmtpDefaults, type EmailProvider } from "@/lib/email-integration-store";
import { formatOutboundEmailError } from "@/lib/outbound-email-errors";
import { readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

const STORE_NAME = "employee-mailboxes";
const SECRET_STORE_NAME = "email-settings-secret";
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
  persisted?: boolean;
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

function emptyStore(): EmployeeMailboxStore {
  return { byEmployeeId: {} };
}

/** Stable key: env first, else existing disk value, else create once. Never overwrite an existing key. */
function getEncryptionKey() {
  const explicit = process.env.NEXA_EMAIL_SETTINGS_SECRET?.trim();
  if (explicit) {
    return createHash("sha256").update(explicit).digest();
  }

  const existing = readServerStoreSnapshot(SECRET_STORE_NAME) as { value?: string } | null;
  const existingValue = existing?.value?.trim();
  if (existingValue) {
    return createHash("sha256").update(existingValue).digest();
  }

  const value = randomBytes(32).toString("hex");
  // Re-check before write to reduce dual-instance key races.
  const raced = readServerStoreSnapshot(SECRET_STORE_NAME) as { value?: string } | null;
  const racedValue = raced?.value?.trim();
  if (racedValue) {
    return createHash("sha256").update(racedValue).digest();
  }

  const wrote = writeServerStore(SECRET_STORE_NAME, { value });
  if (!wrote) {
    throw new Error("Unable to persist email encryption key to disk.");
  }
  return createHash("sha256").update(value).digest();
}

function encryptSecret(secret: string) {
  const normalized = normalizeMailboxSecret(secret);
  if (!normalized) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(payload: string) {
  if (!payload) return "";
  try {
    const [ivHex, tagHex, encryptedHex] = payload.split(":");
    if (!ivHex || !tagHex || !encryptedHex) return "";
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return normalizeMailboxSecret(decrypted.toString("utf8"));
  } catch {
    return "";
  }
}

/** Always read from sqlite/disk — never trust process memory across Render instances. */
function readMailboxStore(): EmployeeMailboxStore {
  const snapshot = readServerStoreSnapshot(STORE_NAME) as EmployeeMailboxStore | null;
  if (snapshot && typeof snapshot === "object" && snapshot.byEmployeeId && typeof snapshot.byEmployeeId === "object") {
    return { byEmployeeId: { ...snapshot.byEmployeeId } };
  }
  return emptyStore();
}

function writeMailboxStore(store: EmployeeMailboxStore) {
  const ok = writeServerStore(STORE_NAME, store);
  if (!ok) {
    throw new Error("Unable to persist mailbox settings to the server disk.");
  }
  const verify = readMailboxStore();
  return verify;
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

function sanitize(employeeId: string, record: EmployeeMailboxRecord | undefined, persisted = true): EmployeeMailboxStatus {
  const store = record ?? emptyRecord();
  return {
    employeeId,
    configured: Boolean(store.senderEmail.trim() && store.username.trim() && store.encryptedSecret),
    provider: normalizeProvider(store.provider),
    senderEmail: store.senderEmail,
    username: store.username,
    smtpHost: store.smtpHost,
    smtpPort: store.smtpPort,
    secure: store.secure,
    secretStored: Boolean(store.encryptedSecret),
    displayName: store.displayName,
    persisted,
    lastTestedAt: store.lastTestedAt,
    lastTestRecipient: store.lastTestRecipient,
    lastTestMessageId: store.lastTestMessageId,
    lastSentAt: store.lastSentAt,
    lastSentMessageId: store.lastSentMessageId,
    lastError: store.lastError,
  };
}

function upsertRecord(employeeId: string, record: EmployeeMailboxRecord) {
  const id = employeeId.trim();
  const store = readMailboxStore();
  store.byEmployeeId[id] = record;
  const written = writeMailboxStore(store);
  const saved = written.byEmployeeId[id];
  if (!saved || saved.senderEmail !== record.senderEmail || !saved.encryptedSecret) {
    throw new Error("Mailbox save did not stick on the server. Please try Save again.");
  }
  return saved;
}

export function getEmployeeMailboxStatus(employeeId: string): EmployeeMailboxStatus {
  const id = employeeId.trim();
  const store = readMailboxStore();
  return sanitize(id, id ? store.byEmployeeId[id] : undefined, Boolean(id && store.byEmployeeId[id]));
}

export function listConfiguredEmployeeMailboxes(): EmployeeMailboxStatus[] {
  const store = readMailboxStore();
  return Object.entries(store.byEmployeeId)
    .map(([employeeId, record]) => sanitize(employeeId, record))
    .filter((item) => item.configured);
}

export function saveEmployeeMailboxSettings(employeeId: string, input: EmployeeMailboxInput) {
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

  const current = readMailboxStore().byEmployeeId[id] ?? emptyRecord();
  const defaults = defaultProviderHosts[provider];
  const nextHost = defaults.host;
  const nextPort = defaults.port;
  const nextSecure = defaults.secure;

  if (!secret && !current.encryptedSecret) {
    throw new Error("Paste the app-specific password before saving.");
  }

  const encryptedSecret = secret ? encryptSecret(secret) : current.encryptedSecret;
  if (!encryptedSecret) {
    throw new Error("Unable to encrypt the app password. Check server email secret configuration.");
  }

  // Round-trip check so we never save a password we cannot decrypt on this server.
  if (secret) {
    const roundTrip = decryptSecret(encryptedSecret);
    if (roundTrip !== secret) {
      throw new Error("Mailbox password encryption check failed. Try Save again — if it keeps failing, set NEXA_EMAIL_SETTINGS_SECRET on Render.");
    }
  }

  const connectionChanged = Boolean(
    secret
    || provider !== current.provider
    || senderEmail !== current.senderEmail
    || username !== current.username
    || nextHost !== current.smtpHost
    || nextPort !== current.smtpPort
    || nextSecure !== current.secure,
  );

  const next: EmployeeMailboxRecord = {
    provider,
    senderEmail,
    username,
    encryptedSecret,
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

  const saved = upsertRecord(id, next);
  return sanitize(id, saved, true);
}

export function clearEmployeeMailbox(employeeId: string) {
  const id = employeeId.trim();
  const store = readMailboxStore();
  if (!id || !store.byEmployeeId[id]) {
    return sanitize(id, undefined, false);
  }
  delete store.byEmployeeId[id];
  writeMailboxStore(store);
  return sanitize(id, undefined, false);
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
  const record = readMailboxStore().byEmployeeId[id];
  if (!record) return null;
  const secret = decryptSecret(record.encryptedSecret);
  if (!record.senderEmail.trim() || !record.username.trim()) return null;
  if (!secret) {
    throw new Error(
      "Saved mailbox password cannot be read on this server. Open People → Mailbox, paste the app password again, and Save.",
    );
  }
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

function patchRecord(employeeId: string, patch: Partial<EmployeeMailboxRecord>) {
  const id = employeeId.trim();
  const store = readMailboxStore();
  const current = store.byEmployeeId[id];
  if (!current) return;
  store.byEmployeeId[id] = { ...current, ...patch };
  writeMailboxStore(store);
}

export function markEmployeeMailboxSent(employeeId: string, messageId: string, sentAt: string) {
  patchRecord(employeeId, {
    lastSentAt: sentAt,
    lastSentMessageId: messageId,
    lastError: undefined,
  });
}

export function markEmployeeMailboxError(employeeId: string, error: string) {
  patchRecord(employeeId, { lastError: error });
}

export function markEmployeeMailboxTested(employeeId: string, recipient: string, messageId: string, testedAt: string) {
  patchRecord(employeeId, {
    lastTestedAt: testedAt,
    lastTestRecipient: recipient,
    lastTestMessageId: messageId,
    lastError: undefined,
  });
}

function formatMailboxSendError(mailbox: ResolvedMailboxTransport, error: unknown) {
  const raw = error instanceof Error ? error.message : "Email authentication or send failed.";
  return formatOutboundEmailError(raw, mailbox.provider);
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
      replyTo: mailbox.from,
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
  let mailbox: ResolvedMailboxTransport | null = null;
  try {
    mailbox = resolveEmployeeMailboxTransport(employeeId);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unable to load mailbox.");
  }
  if (!mailbox) {
    throw new Error("Save the mailbox first (provider, Sends as, and app password), then test.");
  }
  if (mailbox.provider === "iCloud" && !isAppleMailAddress(mailbox.from)) {
    throw new Error("For iCloud, Sends as must be your Apple Mail address (@icloud.com, @me.com, or @mac.com).");
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
