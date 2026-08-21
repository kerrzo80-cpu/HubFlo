import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from "expo-audio";

import {
  askBlake,
  confirmBlakeAction,
  createBlakeChat,
  createDrivingModeHandoff,
  deleteBlakeChat,
  listBlakeChats,
  renameBlakeChat,
  saveBlakeChat,
  signIn,
  transcribeBlakeRecording,
  type BlakeAction,
  type BlakeChat,
  type BlakeMessage,
} from "./src/api";
import { clearSession, loadSession, saveSession, type StoredSession } from "./src/session";

const WELCOME = "Ask me anything about your authorised NeXa workspace, just as you would in ChatGPT.";

function messageId() {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [chats, setChats] = useState<BlakeChat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renameId, setRenameId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState(48);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<FlatList<BlakeMessage>>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const active = chats.find((chat) => chat.id === activeId) || chats[0] || null;
  const messages = active?.messages || [];
  const pendingAction = [...messages].reverse().find((message) => message.action)?.action || null;

  useEffect(() => {
    loadSession().then((stored) => {
      setSession(stored);
      if (stored) void refreshChats(stored);
    }).finally(() => setReady(true));
  }, []);

  async function refreshChats(current: StoredSession) {
    try {
      const result = await listBlakeChats(current.token);
      setChats(result.chats);
      const firstChat = result.chats[0];
      if (firstChat) setActiveId((id) => result.chats.some((chat) => chat.id === id) ? id : firstChat.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your chats could not be loaded.");
    }
  }

  async function login() {
    setBusy(true); setError("");
    try {
      const result = await signIn(username.trim(), password);
      if (result.user.mustChangePassword) throw new Error("Open NeXa Core once to set your personal password before using Blake mobile.");
      const next = { token: result.sessionToken, user: result.user };
      await saveSession(next); setSession(next); setPassword("");
      await refreshChats(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function addChat() {
    if (!session || busy) return null;
    setBusy(true); setError("");
    try {
      const result = await createBlakeChat(session.token);
      setChats((current) => [result.chat, ...current]);
      setActiveId(result.chat.id); setDrawerOpen(false);
      return result.chat;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A new chat could not be created.");
      return null;
    } finally { setBusy(false); }
  }

  async function ensureChat() {
    if (active) return active;
    if (!session) throw new Error("Sign in to continue.");
    const result = await createBlakeChat(session.token);
    setChats((current) => [result.chat, ...current]); setActiveId(result.chat.id);
    return result.chat;
  }

  async function send() {
    const text = draft.trim();
    if (!text || !session || busy) return;
    setBusy(true); setError(""); setDraft("");
    try {
      const chat = await ensureChat();
      const userMessage: BlakeMessage = { id: messageId(), role: "user", text, createdAt: new Date().toISOString() };
      const withUser = { ...chat, messages: [...chat.messages, userMessage] };
      setChats((current) => current.map((item) => item.id === chat.id ? withUser : item));
      const result = await askBlake({ token: session.token, message: text, history: chat.messages.slice(-30), channel: "mobile_text", conversationId: chat.id });
      const assistant: BlakeMessage = {
        id: messageId(), role: "assistant", text: result.reply, createdAt: new Date().toISOString(),
        card: result.data?.resultCard, action: result.action,
      };
      const saved = await saveBlakeChat(session.token, { ...withUser, messages: [...withUser.messages, assistant] });
      setChats((current) => current.map((item) => item.id === saved.chat.id ? saved.chat : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Blake could not answer."); }
    finally { setBusy(false); setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50); }
  }

  async function toggleVoice() {
    if (!session || busy) return;
    setError("");
    if (listening) {
      setListening(false);
      setBusy(true);
      try {
        await recorder.stop();
        if (!recorder.uri) throw new Error("No recording was captured.");
        const result = await transcribeBlakeRecording(session.token, recorder.uri);
        setDraft((current) => current ? `${current.trim()} ${result.text}` : result.text);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Blake could not hear that recording.");
      } finally { setBusy(false); }
      return;
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission is required to talk to Blake.");
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 30 });
      setListening(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The microphone could not start.");
    }
  }

  async function startDrivingMode() {
    if (!session || busy) return;
    setBusy(true); setError("");
    try {
      if (listening) {
        await recorder.stop().catch(() => undefined);
        setListening(false);
      }
      const handoff = await createDrivingModeHandoff(session.token);
      const canOpen = await Linking.canOpenURL(handoff.url);
      if (!canOpen) throw new Error("This phone could not open Blake Driving Mode.");
      await Linking.openURL(handoff.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Driving Mode could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(action: BlakeAction) {
    if (!session || !active || busy) return;
    setBusy(true); setError("");
    try {
      const result = await confirmBlakeAction(session.token, action.id);
      const cleared = active.messages.map((message) => message.action?.id === action.id ? { ...message, action: undefined } : message);
      const confirmation: BlakeMessage = { id: messageId(), role: "assistant", text: result.reply, createdAt: new Date().toISOString() };
      const saved = await saveBlakeChat(session.token, { ...active, messages: [...cleared, confirmation] });
      setChats((current) => current.map((item) => item.id === saved.chat.id ? saved.chat : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The action was not completed."); }
    finally { setBusy(false); }
  }

  async function applyRename() {
    if (!session || !renameId || !renameDraft.trim()) return;
    try {
      const result = await renameBlakeChat(session.token, renameId, renameDraft.trim());
      setChats((current) => current.map((chat) => chat.id === result.chat.id ? result.chat : chat));
      setRenameId(""); setRenameDraft("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The chat could not be renamed."); }
  }

  function remove(chat: BlakeChat) {
    if (!session) return;
    Alert.alert("Delete chat", `Delete “${chat.title}”? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteBlakeChat(session.token, chat.id);
          const remaining = chats.filter((item) => item.id !== chat.id);
          setChats(remaining); if (activeId === chat.id) setActiveId(remaining[0]?.id || "");
        } catch (reason) { setError(reason instanceof Error ? reason.message : "The chat could not be deleted."); }
      } },
    ]);
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
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={() => setDrawerOpen(true)}><Text style={styles.headerIcon}>☰</Text></Pressable>
          <View style={styles.headerTitle}><Text style={styles.brandSmall}>Blake</Text><Text style={styles.chatTitle} numberOfLines={1}>{active?.title || "New conversation"}</Text></View>
          <Pressable style={styles.headerButton} onPress={() => void addChat()}><Text style={styles.headerIcon}>＋</Text></Pressable>
        </View>

        <Pressable style={styles.driveBanner} onPress={() => void startDrivingMode()} disabled={busy}>
          <View style={styles.driveIcon}><Text style={styles.driveIconText}>◉</Text></View>
          <View style={styles.driveCopy}>
            <Text style={styles.driveTitle}>Start Driving Mode</Text>
            <Text style={styles.driveSub}>Hands-free live conversation · interrupt Blake naturally</Text>
          </View>
          <Text style={styles.driveArrow}>›</Text>
        </Pressable>

        <FlatList
          ref={list}
          data={messages.length ? messages : [{ id: "welcome", role: "assistant", text: WELCOME }]}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.thread}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.blakeBubble, item.card ? styles.cardBubble : null]}>
              <Text style={styles.message}>{item.text}</Text>
              {item.card ? (
                <View style={styles.resultCard}>
                  <Text style={styles.cardTitle}>{item.card.title}</Text>
                  {item.card.subtitle ? <Text style={styles.subtle}>{item.card.subtitle}</Text> : null}
                  <View style={styles.metrics}>{item.card.metrics.map((metric) => <View key={metric.label} style={styles.metric}><Text style={styles.metricLabel}>{metric.label}</Text><Text style={styles.metricValue}>{metric.value}</Text></View>)}</View>
                  {item.card.rows?.slice(0, 10).map((row) => <View key={row.id} style={styles.resultRow}><View style={styles.rowCopy}><Text style={styles.rowPrimary}>{row.primary}</Text><Text style={styles.rowSecondary}>{row.secondary}</Text></View>{row.value ? <Text style={styles.rowValue}>{row.value}</Text> : null}</View>)}
                </View>
              ) : null}
            </View>
          )}
        />
        {pendingAction ? <View style={styles.action}><Text style={styles.actionTitle}>{pendingAction.title}</Text><Text style={styles.subtle}>{pendingAction.detail}</Text><Pressable style={styles.primary} onPress={() => void confirm(pendingAction)}><Text style={styles.primaryText}>{pendingAction.confirmLabel}</Text></Pressable></View> : null}
        {error ? <Text style={styles.errorBar}>{error}</Text> : null}
        <View style={styles.composer}>
          <Pressable style={[styles.voice, listening ? styles.voiceActive : null]} onPress={() => void toggleVoice()} disabled={busy}><Text style={listening ? styles.primaryText : styles.voiceText}>{listening ? "Stop" : "Talk"}</Text></Pressable>
          <TextInput
            style={[styles.composerInput, { height: composerHeight }]}
            value={draft}
            onChangeText={setDraft}
            onContentSizeChange={(event) => setComposerHeight(Math.min(132, Math.max(48, event.nativeEvent.contentSize.height + 20)))}
            placeholder={listening ? "Listening… tap Stop when finished" : "Message Blake…"}
            multiline
            scrollEnabled={composerHeight >= 132}
          />
          <Pressable style={styles.send} onPress={send} disabled={busy || listening}><Text style={styles.primaryText}>{busy ? "…" : "Send"}</Text></Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={drawerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDrawerOpen(false)}>
        <SafeAreaView style={styles.drawer}>
          <View style={styles.drawerHeader}><View><Text style={styles.brandSmall}>Your chats</Text><Text style={styles.subtle}>{session.user.name} · private to this profile</Text></View><Pressable onPress={() => setDrawerOpen(false)}><Text style={styles.link}>Done</Text></Pressable></View>
          <Pressable style={styles.newChat} onPress={() => void addChat()}><Text style={styles.primaryText}>＋ New chat</Text></Pressable>
          <Pressable style={styles.drawerDrive} onPress={() => { setDrawerOpen(false); void startDrivingMode(); }}><Text style={styles.driveTitle}>◉ Start Driving Mode</Text><Text style={styles.driveSub}>Continuous hands-free Blake</Text></Pressable>
          <FlatList data={chats} keyExtractor={(chat) => chat.id} contentContainerStyle={styles.chatList} renderItem={({ item }) => (
            <View style={[styles.chatRow, item.id === active?.id ? styles.chatRowActive : null]}>
              <Pressable style={styles.chatSelect} onPress={() => { setActiveId(item.id); setDrawerOpen(false); }}><Text style={styles.chatName} numberOfLines={1}>{item.title}</Text><Text style={styles.chatDate}>{new Date(item.updatedAt).toLocaleDateString("en-GB")}</Text></Pressable>
              <Pressable onPress={() => { setRenameId(item.id); setRenameDraft(item.title); }}><Text style={styles.rowAction}>Rename</Text></Pressable>
              <Pressable onPress={() => remove(item)}><Text style={styles.delete}>Delete</Text></Pressable>
            </View>
          )} />
          <Pressable style={styles.signOut} onPress={async () => { await clearSession(); setSession(null); setDrawerOpen(false); }}><Text style={styles.delete}>Sign out</Text></Pressable>
        </SafeAreaView>
      </Modal>

      <Modal visible={Boolean(renameId)} transparent animationType="fade" onRequestClose={() => setRenameId("")}>
        <View style={styles.modalBackdrop}><View style={styles.renameCard}><Text style={styles.actionTitle}>Rename chat</Text><TextInput style={styles.input} value={renameDraft} onChangeText={setRenameDraft} autoFocus /><View style={styles.renameActions}><Pressable onPress={() => setRenameId("")}><Text style={styles.link}>Cancel</Text></Pressable><Pressable style={styles.smallPrimary} onPress={() => void applyRename()}><Text style={styles.primaryText}>Save</Text></Pressable></View></View></View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f5fbfd" }, center: { flex: 1, alignItems: "center", justifyContent: "center" },
  login: { flex: 1, justifyContent: "center", padding: 28, gap: 12 }, brand: { color: "#087ca7", fontSize: 46, fontWeight: "800" }, brandSmall: { color: "#087ca7", fontSize: 22, fontWeight: "800" }, heading: { color: "#173747", fontSize: 28, fontWeight: "700" }, subtle: { color: "#617985", fontSize: 13 },
  input: { minHeight: 50, borderWidth: 1, borderColor: "#bed5df", borderRadius: 8, backgroundColor: "white", paddingHorizontal: 14, fontSize: 16 }, primary: { minHeight: 46, borderRadius: 8, backgroundColor: "#087ca7", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 }, smallPrimary: { minHeight: 40, borderRadius: 7, backgroundColor: "#087ca7", justifyContent: "center", paddingHorizontal: 18 }, primaryText: { color: "white", fontWeight: "700" }, error: { color: "#b42318" },
  header: { minHeight: 64, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#d7e7ed", backgroundColor: "white", flexDirection: "row", alignItems: "center", gap: 8 }, headerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" }, headerIcon: { color: "#173747", fontSize: 23 }, headerTitle: { flex: 1, alignItems: "center" }, chatTitle: { maxWidth: "90%", color: "#617985", fontSize: 12 }, link: { color: "#087ca7", fontWeight: "700", fontSize: 16 },
  driveBanner: { marginHorizontal: 12, marginTop: 10, padding: 12, minHeight: 66, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#e5f6fb", borderWidth: 1, borderColor: "#9ed5e7" }, driveIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#087ca7" }, driveIconText: { color: "white", fontSize: 20, fontWeight: "800" }, driveCopy: { flex: 1 }, driveTitle: { color: "#075d7c", fontSize: 15, fontWeight: "800" }, driveSub: { color: "#53717e", fontSize: 12, marginTop: 2 }, driveArrow: { color: "#087ca7", fontSize: 30, lineHeight: 32 }, drawerDrive: { marginHorizontal: 14, marginBottom: 12, minHeight: 62, borderRadius: 9, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "#e5f6fb", borderWidth: 1, borderColor: "#9ed5e7" },
  thread: { padding: 16, gap: 10 }, bubble: { maxWidth: "88%", borderRadius: 8, padding: 13 }, blakeBubble: { alignSelf: "flex-start", backgroundColor: "white", borderWidth: 1, borderColor: "#d7e7ed" }, userBubble: { alignSelf: "flex-end", backgroundColor: "#dff3fa" }, message: { color: "#173747", fontSize: 16, lineHeight: 23 },
  cardBubble: { maxWidth: "96%", width: "96%" }, resultCard: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#d7e7ed", paddingTop: 12, gap: 8 }, cardTitle: { color: "#173747", fontSize: 18, fontWeight: "800" }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { minWidth: 100, flexGrow: 1, backgroundColor: "#f3f8fa", borderRadius: 6, padding: 10 }, metricLabel: { color: "#617985", fontSize: 12 }, metricValue: { color: "#173747", fontSize: 17, fontWeight: "800", marginTop: 3 }, resultRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#e6eef1", paddingTop: 9 }, rowCopy: { flex: 1 }, rowPrimary: { color: "#173747", fontWeight: "700" }, rowSecondary: { color: "#617985", fontSize: 12, marginTop: 2 }, rowValue: { color: "#173747", fontWeight: "800" },
  action: { marginHorizontal: 16, marginBottom: 8, padding: 14, gap: 8, backgroundColor: "#fff8e8", borderWidth: 1, borderColor: "#dec48b", borderRadius: 8 }, actionTitle: { color: "#173747", fontWeight: "800", fontSize: 17 }, errorBar: { color: "#b42318", paddingHorizontal: 16, paddingBottom: 8 },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#d7e7ed", backgroundColor: "white", alignItems: "flex-end" }, composerInput: { flex: 1, maxHeight: 120, minHeight: 48, borderWidth: 1, borderColor: "#bed5df", borderRadius: 8, padding: 12, fontSize: 16 }, send: { height: 48, minWidth: 58, borderRadius: 8, backgroundColor: "#087ca7", alignItems: "center", justifyContent: "center" }, voice: { height: 48, minWidth: 54, borderWidth: 1, borderColor: "#8fb8c8", borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "white" }, voiceActive: { backgroundColor: "#b42318", borderColor: "#b42318" }, voiceText: { color: "#087ca7", fontWeight: "800" },
  drawer: { flex: 1, backgroundColor: "#f5fbfd" }, drawerHeader: { padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#d7e7ed" }, newChat: { margin: 14, minHeight: 46, borderRadius: 8, backgroundColor: "#087ca7", alignItems: "center", justifyContent: "center" }, chatList: { paddingHorizontal: 14, paddingBottom: 20, gap: 5 }, chatRow: { minHeight: 62, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 7, backgroundColor: "white", borderWidth: 1, borderColor: "#d7e7ed" }, chatRowActive: { borderColor: "#42a2c5", backgroundColor: "#eaf7fb" }, chatSelect: { flex: 1 }, chatName: { color: "#173747", fontSize: 15, fontWeight: "700" }, chatDate: { color: "#71858e", fontSize: 11, marginTop: 3 }, rowAction: { color: "#087ca7", fontSize: 12, fontWeight: "700" }, delete: { color: "#b42318", fontWeight: "700" }, signOut: { margin: 14, minHeight: 48, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderTopColor: "#d7e7ed" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(10,35,46,.45)", alignItems: "center", justifyContent: "center", padding: 22 }, renameCard: { width: "100%", maxWidth: 420, padding: 18, gap: 14, borderRadius: 10, backgroundColor: "white" }, renameActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 20 },
});