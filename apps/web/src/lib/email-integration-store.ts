import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

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

  await new Promise<void>((resolve, reject) => {
    const timeoutMs = 5000;
    const done = (error?: Error) => {
      if (error) reject(error);
      else resolve();
    };

    const socket = emailIntegrationStore.secure
      ? tls.connect({
          host: emailIntegrationStore.smtpHost,
          port: emailIntegrationStore.smtpPort,
          servername: emailIntegrationStore.smtpHost,
          rejectUnauthorized: false,
        })
      : net.createConnection({
          host: emailIntegrationStore.smtpHost,
          port: emailIntegrationStore.smtpPort,
        });

    const finish = (error?: Error) => {
      socket.removeAllListeners();
      socket.end();
      socket.destroy();
      done(error);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error("Connection timed out.")));
    socket.once("error", (error) => finish(error instanceof Error ? error : new Error("Connection failed.")));
    socket.once("connect", () => finish());
    if ("once" in socket) {
      socket.once("secureConnect" as never, () => finish());
    }
  });

  emailIntegrationStore.lastTestedAt = new Date().toISOString();
  emailIntegrationStore.lastError = undefined;
  persist(emailIntegrationStore);
  return sanitizeStore(emailIntegrationStore);
}
