import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Message = {
  id: string;
  relationship_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const colors = {
  ink: '#25332E', muted: '#829089', green: '#527D68', pale: '#EAF2EC',
  paper: '#F8FAF7', white: '#FFFFFF', line: '#E5EBE6', sent: '#DCEBDD',
  danger: '#B74D4D',
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [partnerLabel, setPartnerLabel] = useState('Your person');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!session || !client) {
      setRelationshipId(null);
      setMessages([]);
      return;
    }
    let active = true;
    const loadRelationship = async () => {
      const { data, error } = await client
        .from('relationships')
        .select('id, member_one, member_two')
        .or(`member_one.eq.${session.user.id},member_two.eq.${session.user.id}`)
        .maybeSingle();
      if (!active) return;
      if (error) {
        Alert.alert('Could not load your chat', error.message);
        return;
      }
      setRelationshipId(data?.id ?? null);
      if (data) {
        const partnerId = data.member_one === session.user.id ? data.member_two : data.member_one;
        setPartnerLabel(partnerId ? 'Your person' : 'Waiting for your person');
      }
    };
    loadRelationship();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!relationshipId || !supabase) return;
    let active = true;
    setLoadingMessages(true);
    supabase.from('messages').select('*').eq('relationship_id', relationshipId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) Alert.alert('Could not load messages', error.message);
        setMessages((data ?? []).reverse());
        setLoadingMessages(false);
      });
    const channel = supabase.channel(`chat:${relationshipId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `relationship_id=eq.${relationshipId}`,
      }, (payload) => {
        const incoming = payload.new as Message;
        setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      }).subscribe();
    return () => {
      active = false;
      supabase?.removeChannel(channel);
    };
  }, [relationshipId]);

  const signIn = async (createAccount: boolean) => {
    if (!supabase) return;
    if (!email.trim() || password.length < 6) {
      Alert.alert('Check your details', 'Enter an email and a password with at least 6 characters.');
      return;
    }
    setBusy(true);
    const result = createAccount
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) Alert.alert(createAccount ? 'Could not create account' : 'Could not sign in', result.error.message);
    else if (createAccount && !result.data.session) Alert.alert('Check your email', 'Confirm your email, then come back and sign in.');
  };

  const createInvite = async () => {
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_chat_invitation');
    setBusy(false);
    if (error) return Alert.alert('Could not create invite', error.message);
    const result = Array.isArray(data) ? data[0] : data;
    setRelationshipId(result.relationship_id);
    setInviteCode(result.invite_code);
    setPartnerLabel('Waiting for your person');
  };

  const joinChat = async () => {
    if (!supabase || !inviteInput.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('accept_chat_invitation', { invitation_code: inviteInput.trim() });
    setBusy(false);
    if (error) return Alert.alert('Could not join chat', error.message);
    setRelationshipId(data as string);
    setPartnerLabel('Your person');
  };

  const sendMessage = async () => {
    const body = draft.trim();
    if (!supabase || !session || !relationshipId || !body) return;
    setDraft('');
    const { data, error } = await supabase.from('messages')
      .insert({ relationship_id: relationshipId, sender_id: session.user.id, body })
      .select().single();
    if (error) {
      setDraft(body);
      Alert.alert('Message not sent', error.message);
      return;
    }
    setMessages((current) => current.some((item) => item.id === data.id) ? current : [...current, data]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (!authReady) return <LoadingScreen />;
  if (!session) return <AuthScreen
    email={email} password={password} busy={busy}
    setEmail={setEmail} setPassword={setPassword} signIn={signIn}
  />;
  if (!relationshipId) return <ConnectScreen
    email={session.user.email ?? 'Your account'} busy={busy} inviteInput={inviteInput}
    setInviteInput={setInviteInput} createInvite={createInvite} joinChat={joinChat}
    signOut={() => supabase?.auth.signOut()}
  />;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
    <View style={styles.header}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>d</Text></View>
      <View style={styles.headerCopy}>
        <Text style={styles.brand}>duora</Text>
        <Text style={styles.headerSub}>{partnerLabel}</Text>
      </View>
      <Pressable onPress={() => supabase?.auth.signOut()} hitSlop={12}>
        <Text style={styles.headerAction}>Sign out</Text>
      </Pressable>
    </View>
    {inviteCode && <View style={styles.inviteBanner}>
      <Text style={styles.inviteTitle}>Share this invite code with your person</Text>
      <Text selectable style={styles.inviteCode}>{inviteCode}</Text>
      <Text style={styles.inviteHint}>It expires in 24 hours. Keep it private.</Text>
    </View>}
    <View style={styles.dayLabel}><View style={styles.dayLine} /><Text style={styles.dayText}>YOUR SPACE TOGETHER</Text><View style={styles.dayLine} /></View>
    {loadingMessages ? <View style={styles.center}><ActivityIndicator color={colors.green} /></View> :
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<View style={styles.emptyChat}>
          <View style={styles.heartCircle}><Text style={styles.heart}>♡</Text></View>
          <Text style={styles.emptyTitle}>A little space for the two of you</Text>
          <Text style={styles.emptyText}>Say hello, share a thought, or let them know you’re thinking of them.</Text>
        </View>}
        renderItem={({ item }) => {
          const mine = item.sender_id === session.user.id;
          return <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowTheirs]}>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={styles.messageText}>{item.body}</Text>
              <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          </View>;
        }}
      />}
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <TextInput
            value={draft} onChangeText={setDraft} placeholder="Write a message…"
            placeholderTextColor="#9AA59E" style={styles.input} multiline maxLength={4000}
            onSubmitEditing={sendMessage} blurOnSubmit={false}
          />
          <Pressable onPress={sendMessage} disabled={!draft.trim()} style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}>
            <Text style={styles.sendArrow}>↑</Text>
          </Pressable>
        </View>
        <Text style={styles.composerNote}>A private conversation between the two of you</Text>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function SetupScreen() {
  return <View style={styles.setupScreen}>
    <View style={styles.brandMarkLarge}><Text style={styles.brandMarkText}>d</Text></View>
    <Text style={styles.setupTitle}>One small step to get Duora going</Text>
    <Text style={styles.setupBody}>Create a Supabase project, then copy its project URL and publishable key into a <Text style={styles.codeText}>.env</Text> file. Apply the chat migration in <Text style={styles.codeText}>supabase/migrations</Text>, then restart Expo.</Text>
    <View style={styles.setupCard}><Text style={styles.setupCardTitle}>Setup checklist</Text>
      <Text style={styles.setupStep}>01  Create a Supabase project</Text>
      <Text style={styles.setupStep}>02  Copy .env.example to .env and add both keys</Text>
      <Text style={styles.setupStep}>03  Run the SQL migration in Supabase</Text>
      <Text style={styles.setupStep}>04  Start the app with pnpm start</Text>
    </View>
    <Text style={styles.setupFoot}>No service keys are included in the app.</Text>
  </View>;
}

function LoadingScreen() {
  return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /><Text style={styles.loadingText}>Getting your space ready…</Text></View>;
}

function AuthScreen(props: {
  email: string; password: string; busy: boolean; setEmail: (s: string) => void;
  setPassword: (s: string) => void; signIn: (create: boolean) => void;
}) {
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
    <View style={styles.authTop}><View style={styles.brandMark}><Text style={styles.brandMarkText}>d</Text></View><Text style={styles.brand}>duora</Text></View>
    <KeyboardAvoidingView style={styles.authBody} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.authEyebrow}><View style={styles.eyebrowDot} /><Text style={styles.eyebrowText}>CLOSER, EVEN ON BUSY DAYS</Text></View>
      <Text style={styles.authTitle}>A little closer,{ '\n' }one message at a time.</Text>
      <Text style={styles.authDescription}>Your shared space for the everyday moments that matter.</Text>
      <View style={styles.form}>
        <Text style={styles.fieldLabel}>EMAIL</Text>
        <TextInput value={props.email} onChangeText={props.setEmail} placeholder="you@example.com" placeholderTextColor="#9AA59E" autoCapitalize="none" keyboardType="email-address" autoComplete="email" style={styles.field} />
        <Text style={[styles.fieldLabel, styles.passwordLabel]}>PASSWORD</Text>
        <TextInput value={props.password} onChangeText={props.setPassword} placeholder="At least 6 characters" placeholderTextColor="#9AA59E" secureTextEntry autoComplete="password" style={styles.field} />
        <Pressable disabled={props.busy} onPress={() => props.signIn(false)} style={styles.primaryButton}>
          {props.busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
        </Pressable>
        <Pressable disabled={props.busy} onPress={() => props.signIn(true)} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Create an account</Text>
        </Pressable>
      </View>
      <Text style={styles.authPrivacy}>Your account is yours. Your conversation is shared only with your partner.</Text>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function ConnectScreen(props: {
  email: string; busy: boolean; inviteInput: string; setInviteInput: (s: string) => void;
  createInvite: () => void; joinChat: () => void; signOut: () => void;
}) {
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
    <View style={styles.header}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>d</Text></View>
      <View style={styles.headerCopy}><Text style={styles.brand}>duora</Text><Text style={styles.headerSub}>{props.email}</Text></View>
      <Pressable onPress={props.signOut}><Text style={styles.headerAction}>Sign out</Text></Pressable>
    </View>
    <View style={styles.connectBody}>
      <View style={styles.heartCircle}><Text style={styles.heart}>♡</Text></View>
      <Text style={styles.connectTitle}>Make it the two of you</Text>
      <Text style={styles.connectDescription}>Create your private chat and invite your person, or join with a code they shared.</Text>
      <Pressable disabled={props.busy} onPress={props.createInvite} style={styles.primaryButton}>
        {props.busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Create your chat</Text>}
      </Pressable>
      <View style={styles.orRow}><View style={styles.dayLine} /><Text style={styles.orText}>OR JOIN WITH A CODE</Text><View style={styles.dayLine} /></View>
      <TextInput value={props.inviteInput} onChangeText={props.setInviteInput} placeholder="Paste their invite code" placeholderTextColor="#9AA59E" autoCapitalize="none" autoCorrect={false} style={styles.field} />
      <Pressable disabled={props.busy || !props.inviteInput.trim()} onPress={props.joinChat} style={[styles.secondaryButton, (!props.inviteInput.trim() || props.busy) && styles.disabledButton]}>
        <Text style={styles.secondaryButtonText}>Join their chat</Text>
      </Pressable>
      <Text style={styles.connectFoot}>Invite codes expire after 24 hours and can only be used once.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  loadingText: { marginTop: 14, color: colors.muted, fontSize: 14 },
  header: { height: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.paper },
  brandMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  brandMarkLarge: { width: 54, height: 54, borderRadius: 20, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  brandMarkText: { color: colors.white, fontFamily: 'Georgia', fontSize: 27, fontWeight: '600', marginTop: -3 },
  headerCopy: { marginLeft: 11, flex: 1 },
  brand: { fontFamily: 'Georgia', fontSize: 21, lineHeight: 24, color: colors.ink, letterSpacing: -0.8 },
  headerSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  headerAction: { color: colors.green, fontSize: 13, fontWeight: '600' },
  inviteBanner: { marginHorizontal: 18, marginTop: 14, padding: 15, backgroundColor: colors.pale, borderRadius: 16 },
  inviteTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  inviteCode: { fontSize: 19, fontWeight: '700', letterSpacing: 2, color: colors.green, marginTop: 8 },
  inviteHint: { color: colors.muted, fontSize: 11, marginTop: 5 },
  dayLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'center', marginVertical: 22 },
  dayLine: { height: 1, backgroundColor: colors.line, flex: 1 },
  dayText: { color: colors.muted, fontSize: 9, letterSpacing: 1.5, fontWeight: '600' },
  messageList: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 22 },
  messageRow: { width: '100%', marginBottom: 10, flexDirection: 'row' },
  messageRowMine: { justifyContent: 'flex-end' },
  messageRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleMine: { backgroundColor: colors.sent, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: colors.white, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: colors.line },
  messageText: { fontSize: 15, lineHeight: 21, color: colors.ink },
  messageTime: { color: colors.muted, fontSize: 10, alignSelf: 'flex-end', marginTop: 4 },
  messageTimeMine: { color: '#6D8A74' },
  emptyChat: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  heartCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  heart: { fontSize: 35, color: colors.green, lineHeight: 40 },
  emptyTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 20, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 9 },
  composerWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 10 : 14, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
  composer: { minHeight: 50, borderRadius: 24, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 17, paddingRight: 6 },
  input: { flex: 1, color: colors.ink, fontSize: 15, maxHeight: 110, paddingTop: 12, paddingBottom: 12 },
  sendButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { backgroundColor: '#BFCFC4' },
  sendArrow: { color: colors.white, fontSize: 23, lineHeight: 27, fontWeight: '500', marginTop: -2 },
  composerNote: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 7 },
  authTop: { height: 76, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 23 },
  authBody: { flex: 1, paddingHorizontal: 26, paddingTop: 43 },
  authEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  eyebrowText: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  authTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 34, lineHeight: 41, letterSpacing: -0.8 },
  authDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 300 },
  form: { marginTop: 36 },
  fieldLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1.1, fontWeight: '700', marginBottom: 8 },
  passwordLabel: { marginTop: 18 },
  field: { height: 51, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 15, color: colors.ink, fontSize: 14 },
  primaryButton: { height: 52, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  secondaryButton: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  authPrivacy: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 28, paddingHorizontal: 18 },
  connectBody: { flex: 1, paddingHorizontal: 24, paddingTop: 60 },
  connectTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 28, textAlign: 'center', marginTop: 5 },
  connectDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 11, marginBottom: 16, paddingHorizontal: 10 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26, marginBottom: 17 },
  orText: { color: colors.muted, fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  connectFoot: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 16, paddingHorizontal: 15 },
  disabledButton: { opacity: 0.55 },
  setupScreen: { flex: 1, backgroundColor: colors.paper, justifyContent: 'center', paddingHorizontal: 28 },
  setupTitle: { fontFamily: 'Georgia', color: colors.ink, fontSize: 28, lineHeight: 35 },
  setupBody: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 12 },
  codeText: { color: colors.green, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  setupCard: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 18, marginTop: 25 },
  setupCardTitle: { color: colors.ink, fontWeight: '700', fontSize: 14, marginBottom: 13 },
  setupStep: { color: colors.muted, fontSize: 12, lineHeight: 24 },
  setupFoot: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 18 },
});

