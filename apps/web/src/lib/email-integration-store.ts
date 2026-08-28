import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { getHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type EmailProvider = "Outlook" | "Gmail" | "iCloud";

export const emailProviderSmtpDefaults: Record<EmailProvider, { host: string; port: number; secure: boolean }> = {
  Outlook: { host: "smtp.office365.com", port: 587, secure: false },
  Gmail: { host: "smtp.gmail.com", port: 465, secure: true },
  iCloud: { host: "smtp.mail.me.com", port: 587, secure: false },
};

export type EmailIntegrationInput = {
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  secret: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
};

export type OutboundEmailInput = {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  /** Logged-in employee. Uses their People → Mailbox when configured; otherwise company SMTP. */
  employeeId?: string;
  /** Optional override; otherwise uses the employee's People card email. */
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
};

type EmailIntegrationStore = {
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  encryptedSecret: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  lastTestedAt?: string;
  lastTestRecipient?: string;
  lastTestMessageId?: string;
  lastSentAt?: string;
  lastSentMessageId?: string;
  lastError?: string;
};

export type EmailIntegrationStatus = {
  configured: boolean;
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  secretStored: boolean;
  lastTestedAt?: string;
  lastTestRecipient?: string;
  lastTestMessageId?: string;
  lastSentAt?: string;
  lastSentMessageId?: string;
  lastError?: string;
};

const defaultProviderHosts = emailProviderSmtpDefaults;

const emptyStore: EmailIntegrationStore = {
  provider: "Outlook",
  senderEmail: "",
  username: "",
  encryptedSecret: "",
  smtpHost: defaultProviderHosts.Outlook.host,
  smtpPort: defaultProviderHosts.Outlook.port,
  secure: defaultProviderHosts.Outlook.secure,
};

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

const emailIntegrationStore = loadServerStore<EmailIntegrationStore>("email-integration", emptyStore);

function persist(next: EmailIntegrationStore) {
  writeServerStore("email-integration", next);
}

function sanitizeStore(store: EmailIntegrationStore): EmailIntegrationStatus {
  return {
    configured: Boolean(store.senderEmail.trim() && store.username.trim() && store.encryptedSecret),
    provider: store.provider,
    senderEmail: store.senderEmail,
    username: store.username,
    smtpHost: store.smtpHost,
    smtpPort: store.smtpPort,
    secure: store.secure,
    secretStored: Boolean(store.encryptedSecret),
    lastTestedAt: store.lastTestedAt,
    lastTestRecipient: store.lastTestRecipient,
    lastTestMessageId: store.lastTestMessageId,
    lastSentAt: store.lastSentAt,
    lastSentMessageId: store.lastSentMessageId,
    lastError: store.lastError,
  };
}

export function getEmailIntegrationStatus() {
  return sanitizeStore(emailIntegrationStore);
}

export function saveEmailIntegrationSettings(input: EmailIntegrationInput) {
  const defaults = defaultProviderHosts[input.provider];
  const nextHost = input.smtpHost?.trim() || defaults.host;
  const nextPort = input.smtpPort && Number.isFinite(input.smtpPort) ? input.smtpPort : defaults.port;
  const nextSecure = input.secure ?? defaults.secure;
  const connectionChanged = Boolean(
    input.secret.trim()
    || input.provider !== emailIntegrationStore.provider
    || input.senderEmail.trim() !== emailIntegrationStore.senderEmail
    || input.username.trim() !== emailIntegrationStore.username
    || nextHost !== emailIntegrationStore.smtpHost
    || nextPort !== emailIntegrationStore.smtpPort
    || nextSecure !== emailIntegrationStore.secure,
  );
  const next: EmailIntegrationStore = {
    provider: input.provider,
    senderEmail: input.senderEmail.trim(),
    username: input.username.trim(),
    encryptedSecret: input.secret.trim() ? encryptSecret(input.secret.trim()) : emailIntegrationStore.encryptedSecret,
    smtpHost: nextHost,
    smtpPort: nextPort,
    secure: nextSecure,
    lastTestedAt: connectionChanged ? undefined : emailIntegrationStore.lastTestedAt,
    lastTestRecipient: connectionChanged ? undefined : emailIntegrationStore.lastTestRecipient,
    lastTestMessageId: connectionChanged ? undefined : emailIntegrationStore.lastTestMessageId,
    lastSentAt: emailIntegrationStore.lastSentAt,
    lastSentMessageId: emailIntegrationStore.lastSentMessageId,
    lastError: connectionChanged ? undefined : emailIntegrationStore.lastError,
  };
  Object.assign(emailIntegrationStore, next);
  persist(emailIntegrationStore);
  return sanitizeStore(emailIntegrationStore);
}

export function clearEmailIntegrationError() {
  emailIntegrationStore.lastError = undefined;
  persist(emailIntegrationStore);
}

function companySmtpSecret() {
  return decryptSecret(emailIntegrationStore.encryptedSecret);
}

export function isCompanySmtpConfigured() {
  return Boolean(
    emailIntegrationStore.senderEmail.trim()
    && emailIntegrationStore.username.trim()
    && companySmtpSecret().trim(),
  );
}

function isEmployeeMailboxConfigured(employeeId?: string) {
  const id = employeeId?.trim();
  if (!id) return false;
  const store = loadServerStore<{ byEmployeeId: Record<string, { senderEmail?: string; username?: string; encryptedSecret?: string }> }>(
    "employee-mailboxes",
    { byEmployeeId: {} },
  );
  const record = store.byEmployeeId[id];
  return Boolean(record?.senderEmail?.trim() && record?.username?.trim() && record?.encryptedSecret);
}

/** Which outbound path NeXa will use for the logged-in employee. */
export function resolveOutboundEmailRoute(employeeId?: string): "employee" | "company" | null {
  if (isEmployeeMailboxConfigured(employeeId)) return "employee";
  if (isCompanySmtpConfigured()) return "company";
  return null;
}

function resolveEmployeeReplyIdentity(employeeId?: string): { email: string; name: string } | null {
  const id = employeeId?.trim();
  if (!id) return null;
  const employees = getHubDetailState().employees;
  if (!Array.isArray(employees)) return null;
  for (const raw of employees) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as { id?: unknown; name?: unknown; profile?: { email?: unknown } };
    if (String(record.id || "").trim() !== id) continue;
    const email = String(record.profile?.email || "").trim();
    const name = String(record.name || "").trim();
    if (!email.includes("@")) return null;
    return { email, name };
  }
  return null;
}

function formatCompanyFromHeader(displayName: string | undefined, mailbox: string) {
  const name = displayName?.trim();
  if (!name) return mailbox;
  const safe = name.replace(/[\r\n"<>]/g, "").trim();
  return safe ? `"${safe}" <${mailbox}>` : mailbox;
}

function configuredTransport() {
  const secret = companySmtpSecret();
  if (!emailIntegrationStore.senderEmail.trim() || !emailIntegrationStore.username.trim() || !secret.trim()) {
    throw new Error(
      "Connect the company Outlook mailbox in Setup → Communications (one shared address + app password), then Test.",
    );
  }

  return nodemailer.createTransport({
    host: emailIntegrationStore.smtpHost,
    port: emailIntegrationStore.smtpPort,
    secure: emailIntegrationStore.secure,
    requireTLS: !emailIntegrationStore.secure,
    auth: {
      user: emailIntegrationStore.username,
      pass: secret,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function sendEmailMessage(input: OutboundEmailInput) {
  if (!input.to.trim() || !input.subject.trim() || !input.text.trim()) {
    throw new Error("Recipient, subject and message are required.");
  }

  const employeeId = input.employeeId?.trim();
  const identity = resolveEmployeeReplyIdentity(employeeId);

  if (employeeId) {
    const { resolveEmployeeMailboxTransport, sendViaResolvedMailbox } = await import("@/lib/employee-mailbox-store");
    try {
      const employeeMailbox = resolveEmployeeMailboxTransport(employeeId);
      if (employeeMailbox) {
        return sendViaResolvedMailbox(employeeMailbox, {
          to: input.to,
          cc: input.cc,
          subject: input.subject,
          text: input.text,
          attachments: input.attachments,
        });
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error("Unable to use the employee mailbox.");
    }
  }

  if (isCompanySmtpConfigured()) {
    const transport = configuredTransport();
    const companyMailbox = emailIntegrationStore.senderEmail.trim();
    const replyTo = (input.replyTo?.trim() || identity?.email || companyMailbox).trim();
    const fromHeader = formatCompanyFromHeader(identity?.name, companyMailbox);
    try {
      await transport.verify();
      const sent = await transport.sendMail({
        from: fromHeader,
        replyTo,
        to: input.to.trim(),
        cc: input.cc?.trim() || undefined,
        subject: input.subject.trim(),
        text: input.text,
        attachments: input.attachments,
      });

      emailIntegrationStore.lastSentAt = new Date().toISOString();
      emailIntegrationStore.lastSentMessageId = sent.messageId;
      emailIntegrationStore.lastError = undefined;
      persist(emailIntegrationStore);
      return {
        provider: emailIntegrationStore.provider,
        from: companyMailbox,
        replyTo,
        source: "company" as const,
        employeeId: employeeId || undefined,
        messageId: sent.messageId,
        accepted: sent.accepted.map(String),
        rejected: sent.rejected.map(String),
        sentAt: emailIntegrationStore.lastSentAt,
      };
    } catch (error) {
      emailIntegrationStore.lastError = error instanceof Error ? error.message : "Email authentication or send failed.";
      persist(emailIntegrationStore);
      throw error;
    } finally {
      transport.close();
    }
  }

  throw new Error(
    "Connect your personal mailbox on People → your card → Mailbox (app password), or ask an admin to connect the company Outlook mailbox in Setup → Communications.",
  );
}

export async function testEmailIntegrationConnection() {
  const result = await sendEmailMessage({
    to: emailIntegrationStore.senderEmail,
    subject: "NeXa company mailbox connection test",
    text: [
      "This test email was sent by NeXa through the company Outlook / Microsoft 365 mailbox.",
      "",
      `Provider: ${emailIntegrationStore.provider}`,
      `Company send address: ${emailIntegrationStore.senderEmail}`,
      `Sent: ${new Date().toISOString()}`,
      "",
      "Receiving this confirms outbound email is ready. Customer emails use this mailbox to send;",
      "Reply-To is the logged-in person's People card email so replies land in their Outlook.",
    ].join("\n"),
  });
  emailIntegrationStore.lastTestedAt = result.sentAt;
  emailIntegrationStore.lastTestRecipient = emailIntegrationStore.senderEmail;
  emailIntegrationStore.lastTestMessageId = result.messageId;
  persist(emailIntegrationStore);
  return sanitizeStore(emailIntegrationStore);
}
