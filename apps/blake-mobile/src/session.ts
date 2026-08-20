import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "nexa.blake.session.v1";

export type StoredSession = { token: string; user: { id: string; name: string; role: string } };

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StoredSession; } catch { return null; }
}

export async function saveSession(session: StoredSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
