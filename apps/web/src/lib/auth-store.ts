import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { AccessOverride, HubRole } from "@/lib/access";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

export const nexaSessionCookie = "nexa_session";
export const nexaSessionMaxAgeSeconds = 60 * 60 * 24 * 30;

type AuthUserRecord = {
  id: string;
  employeeId?: string;
  name: string;
  username: string;
  role: HubRole;
  permissions: AccessOverride;
  passwordHash: string;
  passwordSalt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

type AuthSessionRecord = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type AuthLoginAttemptRecord = {
  key: string;
  failures: number;
  windowStartedAt: string;
  lockedUntil?: string;
};

type AuthStore = {
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
  loginAttempts: AuthLoginAttemptRecord[];
};

export type AuthUser = Omit<AuthUserRecord, "passwordHash" | "passwordSalt">;

const loginAttemptWindowMs = 15 * 60 * 1000;
const loginLockDurationMs = 15 * 60 * 1000;
const maximumLoginFailures = 5;
const emptyAuthStore: AuthStore = { users: [], sessions: [], loginAttempts: [] };
const authStore = loadServerStore<AuthStore>("auth-store", emptyAuthStore);

function refresh() {
  const snapshot = readServerStoreSnapshot("auth-store") as Partial<AuthStore> | null;
  if (!snapshot) return;
  authStore.users = Array.isArray(snapshot.users) ? snapshot.users : [];
  authStore.sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  authStore.loginAttempts = Array.isArray(snapshot.loginAttempts) ? snapshot.loginAttempts : [];
}

function normaliseUsername(value: string) {
  return value.trim().toLowerCase();
}

function normaliseLoginAttemptKey(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeUser(user: AuthUserRecord): AuthUser {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safe } = user;
  return { ...safe, permissions: { ...safe.permissions } };
}

function persist() {
  writeServerStore("auth-store", authStore);
}

function pruneExpiredSessions() {
  const now = Date.now();
  const next = authStore.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  if (next.length !== authStore.sessions.length) {
    authStore.sessions = next;
    persist();
  }
}

function pruneOldLoginAttempts() {
  const now = Date.now();
  const next = authStore.loginAttempts.filter((attempt) => {
    const lockedUntil = attempt.lockedUntil ? Date.parse(attempt.lockedUntil) : 0;
    const windowStartedAt = Date.parse(attempt.windowStartedAt);
    return lockedUntil > now || windowStartedAt + loginAttemptWindowMs > now;
  });
  if (next.length !== authStore.loginAttempts.length) {
    authStore.loginAttempts = next;
    persist();
  }
}

function bootstrapAdminFromEnvironment() {
  refresh();
  if (authStore.users.length > 0) return;
  const password = process.env.NEXA_ADMIN_PASSWORD?.trim();
  if (!password || password.length < 10) return;

  const createdAt = nowIso();
  const salt = randomBytes(16).toString("hex");
  authStore.users.push({
    id: "auth-user-brian",
    employeeId: process.env.NEXA_ADMIN_EMPLOYEE_ID?.trim() || "emp-brian",
    name: process.env.NEXA_ADMIN_NAME?.trim() || "Brian Kerr",
    username: normaliseUsername(process.env.NEXA_ADMIN_USERNAME || "brian.kerr"),
    role: "Owner/Admin",
    permissions: {},
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  });
  persist();
}

bootstrapAdminFromEnvironment();

export function isUserAuthenticationEnabled() {
  return process.env.NEXA_AUTH_MODE?.trim().toLowerCase() === "users";
}

export function hasBootstrapAdminConfiguration() {
  return (process.env.NEXA_ADMIN_PASSWORD?.trim().length ?? 0) >= 10;
}

export function getLoginAttemptStatus(identifier: string) {
  refresh();
  pruneOldLoginAttempts();
  const attempt = authStore.loginAttempts.find(
    (candidate) => candidate.key === normaliseLoginAttemptKey(identifier),
  );
  const lockedUntil = attempt?.lockedUntil ? Date.parse(attempt.lockedUntil) : 0;
  if (!attempt || lockedUntil <= Date.now()) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)),
  };
}

export function recordFailedLoginAttempt(identifier: string) {
  refresh();
  pruneOldLoginAttempts();
  const key = normaliseLoginAttemptKey(identifier);
  const now = Date.now();
  let attempt = authStore.loginAttempts.find((candidate) => candidate.key === key);
  if (!attempt || Date.parse(attempt.windowStartedAt) + loginAttemptWindowMs <= now) {
    attempt = { key, failures: 0, windowStartedAt: new Date(now).toISOString() };
    authStore.loginAttempts = authStore.loginAttempts.filter((candidate) => candidate.key !== key);
    authStore.loginAttempts.push(attempt);
  }
  attempt.failures += 1;
  if (attempt.failures >= maximumLoginFailures) {
    attempt.lockedUntil = new Date(now + loginLockDurationMs).toISOString();
  }
  persist();
  return getLoginAttemptStatus(identifier);
}

export function clearFailedLoginAttempts(identifier: string) {
  refresh();
  const key = normaliseLoginAttemptKey(identifier);
  const next = authStore.loginAttempts.filter((candidate) => candidate.key !== key);
  if (next.length !== authStore.loginAttempts.length) {
    authStore.loginAttempts = next;
    persist();
  }
}

export function listAuthUsers(): AuthUser[] {
  refresh();
  return authStore.users.map(safeUser);
}

export function authenticateUser(username: string, password: string): AuthUser | null {
  refresh();
  const user = authStore.users.find(
    (candidate) => candidate.enabled && candidate.username === normaliseUsername(username),
  );
  if (!user || !password) return null;

  const actual = Buffer.from(hashPassword(password, user.passwordSalt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  user.lastLoginAt = nowIso();
  user.updatedAt = user.lastLoginAt;
  persist();
  return safeUser(user);
}

export function createUserSession(userId: string) {
  refresh();
  pruneExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + nexaSessionMaxAgeSeconds * 1000).toISOString();
  authStore.sessions = [
    { tokenHash: hashSessionToken(token), userId, createdAt, expiresAt },
    ...authStore.sessions.filter((session) => session.userId !== userId),
  ];
  persist();
  return { token, expiresAt };
}

export function getAuthUserForSession(token: string | undefined): AuthUser | null {
  if (!token) return null;
  refresh();
  pruneExpiredSessions();
  const tokenHash = hashSessionToken(token);
  const session = authStore.sessions.find((candidate) => candidate.tokenHash === tokenHash);
  if (!session) return null;
  const user = authStore.users.find((candidate) => candidate.id === session.userId && candidate.enabled);
  return user ? safeUser(user) : null;
}

export function revokeUserSession(token: string | undefined) {
  if (!token) return;
  refresh();
  const tokenHash = hashSessionToken(token);
  const next = authStore.sessions.filter((session) => session.tokenHash !== tokenHash);
  if (next.length !== authStore.sessions.length) {
    authStore.sessions = next;
    persist();
  }
}

export function createAuthUser(input: {
  employeeId?: string;
  name: string;
  username: string;
  password: string;
  role: HubRole;
  permissions?: AccessOverride;
}) {
  refresh();
  const username = normaliseUsername(input.username);
  if (!username || input.password.length < 10 || !input.name.trim()) {
    throw new Error("Name, username and a password of at least 10 characters are required.");
  }
  if (authStore.users.some((user) => user.username === username)) {
    throw new Error("That username is already in use.");
  }

  const createdAt = nowIso();
  const salt = randomBytes(16).toString("hex");
  const user: AuthUserRecord = {
    id: `auth-user-${crypto.randomUUID()}`,
    employeeId: input.employeeId?.trim() || undefined,
    name: input.name.trim(),
    username,
    role: input.role,
    permissions: { ...(input.permissions ?? {}) },
    passwordHash: hashPassword(input.password, salt),
    passwordSalt: salt,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  };
  authStore.users.push(user);
  persist();
  return safeUser(user);
}

export function updateAuthUser(
  id: string,
  input: Partial<Pick<AuthUserRecord, "employeeId" | "name" | "role" | "permissions" | "enabled">> & {
    username?: string;
    password?: string;
  },
) {
  refresh();
  const user = authStore.users.find((candidate) => candidate.id === id);
  if (!user) return null;

  if (input.username !== undefined) {
    const username = normaliseUsername(input.username);
    if (!username || authStore.users.some((candidate) => candidate.id !== id && candidate.username === username)) {
      throw new Error("That username is not available.");
    }
    user.username = username;
  }
  if (input.password !== undefined) {
    if (input.password.length < 10) throw new Error("Passwords must contain at least 10 characters.");
    user.passwordSalt = randomBytes(16).toString("hex");
    user.passwordHash = hashPassword(input.password, user.passwordSalt);
    authStore.sessions = authStore.sessions.filter((session) => session.userId !== id);
  }
  if (input.employeeId !== undefined) user.employeeId = input.employeeId.trim() || undefined;
  if (input.name !== undefined && input.name.trim()) user.name = input.name.trim();
  if (input.role !== undefined) user.role = input.role;
  if (input.permissions !== undefined) user.permissions = { ...input.permissions };
  if (input.enabled !== undefined) {
    user.enabled = input.enabled;
    if (!user.enabled) authStore.sessions = authStore.sessions.filter((session) => session.userId !== id);
  }
  user.updatedAt = nowIso();
  persist();
  return safeUser(user);
}
