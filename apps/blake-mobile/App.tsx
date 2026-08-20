import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { askBlake, confirmBlakeAction, signIn, type BlakeMessage } from "./src/api";
import { clearSession, loadSession, saveSession, type StoredSession } from "./src/session";

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [messages, setMessages] = useState<BlakeMessage[]>([{ role: "assistant", text: "What do you need from NeXa?" }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<{ id: string; title: string; detail: string; confirmLabel: string } | null>(null);
  const list = useRef<FlatList<BlakeMessage>>(null);

  useEffect(() => { loadSession().then(setSession).finally(() => setReady(true)); }, []);

  async function login() {
    setBusy(true); setError("");
    try {
      const result = await signIn(username.trim(), password);
      if (result.user.mustChangePassword) throw new Error("Open NeXa Core once to set your personal password before using Blake mobile.");
      const next = { token: result.sessionToken, user: result.user };
      await saveSession(next); setSession(next); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !session || busy) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next); setDraft(""); setBusy(true); setError(""); setPendingAction(null);
    try {
      const result = await askBlake({ token: session.token, message: text, history: next.slice(-16), channel: "mobile_text" });
      setMessages((current) => [...current, { role: "assistant", text: result.reply }]);
      setPendingAction(result.action ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Blake could not answer."); }
    finally { setBusy(false); setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50); }
  }

  async function confirm() {
    if (!session || !pendingAction || busy) return;
    setBusy(true); setError("");
    try {
      const result = await confirmBlakeAction(session.token, pendingAction.id);
      setMessages((current) => [...current, { role: "assistant", text: result.reply }]); setPendingAction(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The action was not completed."); }
    finally { setBusy(false); }
  }

  if (!ready) return <SafeAreaView style={styles.center}><ActivityIndicator color="#087ca7" /></SafeAreaView>;
  if (!session) return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <View style={styles.login}>
        <Text style={styles.brand}>Blake</Text><Text style={styles.heading}>in Your Pocket</Text>
        <Text style={styles.subtle}>Sign in with your NeXa account.</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="Username" />
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" onSubmitEditing={login} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.primary} onPress={login} disabled={busy}><Text style={styles.primaryText}>{busy ? "Signing in…" : "Sign in"}</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}><View><Text style={styles.brandSmall}>Blake</Text><Text style={styles.subtle}>{session.user.name} · {session.user.role}</Text></View><Pressable onPress={async () => { await clearSession(); setSession(null); }}><Text style={styles.link}>Sign out</Text></Pressable></View>
        <FlatList ref={list} data={messages} keyExtractor={(_, index) => String(index)} contentContainerStyle={styles.thread} renderItem={({ item }) => <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.blakeBubble]}><Text style={styles.message}>{item.text}</Text></View>} />
        {pendingAction ? <View style={styles.action}><Text style={styles.actionTitle}>{pendingAction.title}</Text><Text style={styles.subtle}>{pendingAction.detail}</Text><Pressable style={styles.primary} onPress={confirm}><Text style={styles.primaryText}>{pendingAction.confirmLabel}</Text></Pressable></View> : null}
        {error ? <Text style={styles.errorBar}>{error}</Text> : null}
        <View style={styles.composer}><TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} placeholder="Ask Blake anything about NeXa…" multiline /><Pressable style={styles.send} onPress={send} disabled={busy}><Text style={styles.primaryText}>{busy ? "…" : "Send"}</Text></Pressable></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f5fbfd" }, center: { flex: 1, alignItems: "center", justifyContent: "center" },
  login: { flex: 1, justifyContent: "center", padding: 28, gap: 12 }, brand: { color: "#087ca7", fontSize: 46, fontWeight: "800" }, brandSmall: { color: "#087ca7", fontSize: 24, fontWeight: "800" }, heading: { color: "#173747", fontSize: 28, fontWeight: "700" }, subtle: { color: "#617985", fontSize: 14 },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#bed5df", borderRadius: 8, backgroundColor: "white", paddingHorizontal: 14, fontSize: 17 }, primary: { minHeight: 48, borderRadius: 8, backgroundColor: "#087ca7", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 }, primaryText: { color: "white", fontWeight: "700" }, error: { color: "#b42318" },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#d7e7ed", backgroundColor: "white", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, link: { color: "#087ca7", fontWeight: "700" },
  thread: { padding: 16, gap: 10 }, bubble: { maxWidth: "88%", borderRadius: 8, padding: 13 }, blakeBubble: { alignSelf: "flex-start", backgroundColor: "white", borderWidth: 1, borderColor: "#d7e7ed" }, userBubble: { alignSelf: "flex-end", backgroundColor: "#dff3fa" }, message: { color: "#173747", fontSize: 16, lineHeight: 23 },
  action: { marginHorizontal: 16, marginBottom: 8, padding: 14, gap: 8, backgroundColor: "#fff8e8", borderWidth: 1, borderColor: "#dec48b", borderRadius: 8 }, actionTitle: { color: "#173747", fontWeight: "800", fontSize: 16 }, errorBar: { color: "#b42318", paddingHorizontal: 16, paddingBottom: 8 },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#d7e7ed", backgroundColor: "white", alignItems: "flex-end" }, composerInput: { flex: 1, maxHeight: 120, minHeight: 48, borderWidth: 1, borderColor: "#bed5df", borderRadius: 8, padding: 12, fontSize: 16 }, send: { height: 48, minWidth: 64, borderRadius: 8, backgroundColor: "#087ca7", alignItems: "center", justifyContent: "center" },
});
