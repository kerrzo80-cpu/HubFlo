import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type EmailProvider = "Outlook" | "Gmail";

export type EmailIntegrationInput = {
  provider: EmailProvider;
  senderEmail: string;
  username: string;
  secret: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
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
  lastError?: string;
};

const defaultProviderHosts: Record<EmailProvider, { host: string; port: number; secure: boolean }> = {
  Outlook: { host: "smtp.office365.com", port: 587, secure: false },
  Gmail: { host: "smtp.gmail.com", port: 465, secure: true },
};

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
    lastError: store.lastError,
  };
}

export function getEmailIntegrationStatus() {
  return sanitizeStore(emailIntegrationStore);
}

export function saveEmailIntegrationSettings(input: EmailIntegrationInput) {
  const defaults = defaultProviderHosts[input.provider];
  const next: EmailIntegrationStore = {
    provider: input.provider,
    senderEmail: input.senderEmail.trim(),
    username: input.username.trim(),
    encryptedSecret: input.secret.trim() ? encryptSecret(input.secret.trim()) : emailIntegrationStore.encryptedSecret,
    smtpHost: input.smtpHost?.trim() || defaults.host,
    smtpPort: input.smtpPort && Number.isFinite(input.smtpPort) ? input.smtpPort : defaults.port,
    secure: input.secure ?? defaults.secure,
    lastTestedAt: emailIntegrationStore.lastTestedAt,
    lastTestRecipient: emailIntegrationStore.lastTestRecipient,
    lastTestMessageId: emailIntegrationStore.lastTestMessageId,
    lastError: emailIntegrationStore.lastError,
  };
  Object.assign(emailIntegrationStore, next);
  persist(emailIntegrationStore);
  return sanitizeStore(emailIntegrationStore);
}

export function clearEmailIntegrationError() {
  emailIntegrationStore.lastError = undefined;
  persist(emailIntegrationStore);
}

export async function testEmailIntegrationConnection() {
  const secret = decryptSecret(emailIntegrationStore.encryptedSecret);
  if (!emailIntegrationStore.senderEmail.trim() || !emailIntegrationStore.username.trim() || !secret.trim()) {
    throw new Error("Add the sender email, username and app password before testing.");
  }

  const transport = nodemailer.createTransport({
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

  try {
    await transport.verify();
    const sent = await transport.sendMail({
      from: emailIntegrationStore.senderEmail,
      to: emailIntegrationStore.senderEmail,
      subject: "NeXa email connection test",
      text: [
        "This test email was sent by NeXa.",
        "",
        `Provider: ${emailIntegrationStore.provider}`,
        `Sent: ${new Date().toISOString()}`,
        "",
        "Receiving this message confirms that NeXa authenticated with your email provider and sent successfully.",
      ].join("\n"),
    });

    emailIntegrationStore.lastTestedAt = new Date().toISOString();
    emailIntegrationStore.lastTestRecipient = emailIntegrationStore.senderEmail;
    emailIntegrationStore.lastTestMessageId = sent.messageId;
    emailIntegrationStore.lastError = undefined;
    persist(emailIntegrationStore);
    return sanitizeStore(emailIntegrationStore);
  } catch (error) {
    emailIntegrationStore.lastError = error instanceof Error ? error.message : "Email authentication or send failed.";
    persist(emailIntegrationStore);
    throw error;
  } finally {
    transport.close();
  }
}
