import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { createClient, Session } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseKey || 'missing-key');

type Profile = { id: string; username: string | null; display_name: string | null };
type Conversation = { id: string; kind: 'direct' | 'group' | 'channel'; title: string | null; created_at: string };
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
const C = { bg:'#0b1420', panel:'#142235', panel2:'#1d3047', border:'#2b4058', text:'#f4f7fb', muted:'#9eb0c5', blue:'#54a9ff', green:'#47d7a2' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login'|'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [authError, setAuthError] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [targetUsername, setTargetUsername] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<'group'|'channel'>('group');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setNotice('Сначала настрой .env — инструкция есть в README.md.');
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setActive(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setMyProfile(null); setConversations([]); return; }
    void loadProfile();
    void loadConversations();
  }, [session?.user.id]);

  async function loadProfile() {
    if (!session) return;
    const { data, error } = await supabase.from('profiles').select('id,username,display_name').eq('id', session.user.id).single();
    if (error) { setNotice(error.message); return; }
    setMyProfile(data as Profile);
    setDisplayName(data.display_name || '');
    setUsername(data.username || '');
  }

  async function loadConversations() {
    const { data, error } = await supabase.from('conversation_members').select('conversation_id, conversations(id,kind,title,created_at)').order('created_at', { ascending: false, referencedTable: 'conversations' });
    if (error) { setNotice(error.message); return; }
    const list = (data || []).map((x: any) => x.conversations).filter(Boolean) as Conversation[];
    const unique = Array.from(new Map(list.map(c => [c.id, c])).values());
    setConversations(unique);
  }

  async function authenticate() {
    setAuthError('');
    if (!email.trim() || password.length < 8) { setAuthError('Укажи email и пароль не короче 8 символов.'); return; }
    if (mode === 'signup') {
      const clean = username.trim().replace(/^@/, '').toLowerCase();
      if (!/^[a-z][a-z0-9_]{2,19}$/.test(clean)) { setAuthError('Юзернейм: 3–20 символов, латиница, цифры и _.'); return; }
      const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() || 'User' } } });
      if (error) { setAuthError(error.message); return; }
      // When email confirmation is enabled, the user may need to confirm before signing in.
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) { setAuthError('Аккаунт создан. Подтверди email, если это требуется, затем войди.'); return; }
      const { error: claimError } = await supabase.rpc('claim_username', { desired_username: clean });
      if (claimError) setAuthError('Вход выполнен, но ник не удалось забрать: ' + claimError.message);
      else setNotice('Аккаунт WyGram создан.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setAuthError(error.message);
    }
  }

  async function saveProfile() {
    const clean = username.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(clean)) { setNotice('Ник должен быть 3–20 символов: латиница, цифры и _.'); return; }
    const { error } = await supabase.rpc('claim_username', { desired_username: clean });
    if (error) { setNotice(error.message); return; }
    const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName.trim() || 'User' }).eq('id', session!.user.id);
    if (profileError) { setNotice(profileError.message); return; }
    await loadProfile(); setNotice('Профиль сохранён.');
  }

  async function startDirectChat() {
    const clean = targetUsername.trim().replace(/^@/, '').toLowerCase();
    if (!clean) return;
    const { data, error } = await supabase.rpc('create_direct_chat', { target_username: clean });
    if (error) { setNotice(error.message); return; }
    setTargetUsername('');
    await loadConversations();
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', data).single();
    if (conv) await openConversation(conv as Conversation);
    setNotice('Чат открыт.');
  }

  async function createGroupOrChannel() {
    const title = newTitle.trim();
    if (!title) { setNotice('Введи название.'); return; }
    const { data, error } = await supabase.rpc('create_group_or_channel', { conversation_title: title, conversation_kind: newKind });
    if (error) { setNotice(error.message); return; }
    setNewTitle('');
    await loadConversations();
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', data).single();
    if (conv) await openConversation(conv as Conversation);
  }

  async function openConversation(conv: Conversation) {
    setActive(conv);
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: true }).limit(200);
    if (error) setNotice(error.message); else setMessages((data || []) as Message[]);
  }

  async function sendMessage() {
    const body = messageText.trim();
    if (!body || !active || !session) return;
    setMessageText('');
    const { error } = await supabase.from('messages').insert({ conversation_id: active.id, sender_id: session.user.id, body });
    if (error) setNotice(error.message);
  }

  useEffect(() => {
    if (!active) return;
    const channel = supabase.channel('messages-' + active.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + active.id }, payload => {
        const incoming = payload.new as Message;
        setMessages(old => old.some(m => m.id === incoming.id) ? old : [...old, incoming]);
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active?.id]);

  async function signOut() { await supabase.auth.signOut(); setMyProfile(null); setActive(null); }

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue}/><Text style={s.muted}>Загружаем WyGram…</Text></View>;

  if (!session) return <SafeAreaView style={s.page}><ExpoStatusBar style="light"/><View style={s.authCard}>
    <View style={s.logo}><Text style={s.logoText}>W</Text></View>
    <Text style={s.title}>WyGram</Text><Text style={s.subtitle}>Твои люди. Твои чаты.</Text>
    {mode === 'signup' && <><TextInput style={s.input} placeholder="Имя" placeholderTextColor={C.muted} value={displayName} onChangeText={setDisplayName}/><TextInput style={s.input} placeholder="@юзернейм" placeholderTextColor={C.muted} autoCapitalize="none" value={username} onChangeText={setUsername}/></>}
    <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/>
    <TextInput style={s.input} placeholder="Пароль (минимум 8 символов)" placeholderTextColor={C.muted} secureTextEntry value={password} onChangeText={setPassword}/>
    {!!authError && <Text style={s.error}>{authError}</Text>}
    <Pressable style={s.primary} onPress={authenticate}><Text style={s.primaryText}>{mode === 'signup' ? 'Создать аккаунт' : 'Войти'}</Text></Pressable>
    <Pressable onPress={() => {setMode(mode === 'signup' ? 'login' : 'signup'); setAuthError('')}}><Text style={s.link}>{mode === 'signup' ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</Text></Pressable>
    {!!notice && <Text style={s.muted}>{notice}</Text>}
  </View></SafeAreaView>;

  return <SafeAreaView style={s.page}><ExpoStatusBar style="light"/>
    <View style={s.header}><View style={s.logoSmall}><Text style={s.logoText}>W</Text></View><View style={{flex:1}}><Text style={s.brand}>WyGram</Text><Text style={s.muted}>{myProfile?.username ? '@'+myProfile.username : session.user.email}</Text></View><Pressable onPress={signOut}><Text style={s.link}>Выйти</Text></Pressable></View>
    {!!notice && <Pressable onPress={() => setNotice('')} style={s.notice}><Text style={s.noticeText}>{notice}　×</Text></Pressable>}
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}><Text style={s.section}>ТВОЙ ПРОФИЛЬ</Text><TextInput style={s.input} placeholder="Имя" placeholderTextColor={C.muted} value={displayName} onChangeText={setDisplayName}/><TextInput style={s.input} placeholder="@юзернейм" placeholderTextColor={C.muted} autoCapitalize="none" value={username} onChangeText={setUsername}/><Pressable style={s.primary} onPress={saveProfile}><Text style={s.primaryText}>Сохранить профиль / забрать ник</Text></Pressable></View>
      <View style={s.card}><Text style={s.section}>НАЙТИ ПОЛЬЗОВАТЕЛЯ</Text><TextInput style={s.input} placeholder="@username" placeholderTextColor={C.muted} autoCapitalize="none" value={targetUsername} onChangeText={setTargetUsername}/><Pressable style={s.primary} onPress={startDirectChat}><Text style={s.primaryText}>Открыть личный чат</Text></Pressable></View>
      <View style={s.card}><Text style={s.section}>СОЗДАТЬ ГРУППУ ИЛИ КАНАЛ</Text><TextInput style={s.input} placeholder="Название" placeholderTextColor={C.muted} value={newTitle} onChangeText={setNewTitle}/><View style={s.row}><Pressable style={[s.choice,newKind==='group'&&s.choiceOn]} onPress={()=>setNewKind('group')}><Text style={s.text}>Группа</Text></Pressable><Pressable style={[s.choice,newKind==='channel'&&s.choiceOn]} onPress={()=>setNewKind('channel')}><Text style={s.text}>Канал</Text></Pressable></View><Pressable style={s.primary} onPress={createGroupOrChannel}><Text style={s.primaryText}>Создать</Text></Pressable></View>
      <View style={s.card}><Text style={s.section}>МОИ ЧАТЫ</Text>{conversations.length===0?<Text style={s.muted}>Пока нет чатов. Найди пользователя или создай группу.</Text>:conversations.map(c=><Pressable key={c.id} style={[s.conversation,active?.id===c.id&&s.choiceOn]} onPress={()=>openConversation(c)}><Text style={s.text}>{c.kind==='channel'?'📢':c.kind==='group'?'👥':'💬'} {c.title || 'Личный чат'}</Text><Text style={s.muted}>{c.kind}</Text></Pressable>)}</View>
      {active && <View style={s.card}><Text style={s.section}>ЧАТ: {active.title || 'Личный чат'}</Text><View style={s.messageBox}>{messages.length===0?<Text style={s.muted}>Сообщений пока нет.</Text>:messages.map(m=><View key={m.id} style={[s.message,m.sender_id===session.user.id?s.mine:s.theirs]}><Text style={s.text}>{m.body}</Text><Text style={s.stamp}>{new Date(m.created_at).toLocaleString()}</Text></View>)}</View><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}><TextInput style={s.input} placeholder="Написать сообщение…" placeholderTextColor={C.muted} value={messageText} onChangeText={setMessageText} multiline/><Pressable style={s.primary} onPress={sendMessage}><Text style={s.primaryText}>Отправить</Text></Pressable></KeyboardAvoidingView></View>}
      <View style={s.card}><Text style={s.section}>ЗВЁЗДЫ И ПОДАРКИ</Text><Text style={s.muted}>Следующий этап: безопасный серверный баланс звёзд, каталог подарков и коллекционные ники. Не добавляй реальные платежи, пока не настроены проверки и правила возвратов.</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
 page:{flex:1,backgroundColor:C.bg}, center:{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center',gap:12}, authCard:{width:'100%',maxWidth:440,alignSelf:'center',padding:24,marginTop:30},
 logo:{width:64,height:64,borderRadius:22,backgroundColor:C.blue,alignItems:'center',justifyContent:'center',alignSelf:'center',marginBottom:12}, logoSmall:{width:42,height:42,borderRadius:14,backgroundColor:C.blue,alignItems:'center',justifyContent:'center'},
 logoText:{fontSize:28,fontWeight:'900',color:'#071421'},title:{fontSize:34,fontWeight:'900',color:C.text,textAlign:'center'},subtitle:{fontSize:15,color:C.muted,textAlign:'center',marginBottom:22},
 header:{padding:14,borderBottomWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',gap:12},brand:{fontSize:21,fontWeight:'900',color:C.text}, content:{padding:14,gap:12,maxWidth:800,width:'100%',alignSelf:'center'},card:{backgroundColor:C.panel,borderColor:C.border,borderWidth:1,borderRadius:18,padding:14,gap:10},section:{fontSize:12,fontWeight:'900',letterSpacing:1,color:C.muted},
 input:{backgroundColor:'#0d1b2a',borderWidth:1,borderColor:C.border,color:C.text,paddingHorizontal:13,paddingVertical:12,borderRadius:12,fontSize:15},primary:{backgroundColor:C.blue,padding:13,borderRadius:12,alignItems:'center',justifyContent:'center'},primaryText:{fontWeight:'800',color:'#061525'},link:{color:C.blue,textAlign:'center',padding:12,fontWeight:'700'},error:{color:'#ff9c9c',marginVertical:5},muted:{color:C.muted,fontSize:13},text:{color:C.text,fontSize:15},row:{flexDirection:'row',gap:8},choice:{flex:1,padding:11,borderRadius:12,backgroundColor:C.panel2,borderWidth:1,borderColor:C.border,alignItems:'center'},choiceOn:{borderColor:C.blue,backgroundColor:'#24496b'},conversation:{padding:12,borderRadius:12,backgroundColor:C.panel2,marginTop:6},notice:{backgroundColor:'#21486b',padding:10},noticeText:{color:C.text},messageBox:{gap:8,maxHeight:360},message:{padding:10,borderRadius:13,maxWidth:'90%',alignSelf:'flex-start',backgroundColor:C.panel2},mine:{alignSelf:'flex-end',backgroundColor:'#285985'},theirs:{alignSelf:'flex-start'},stamp:{fontSize:10,color:C.muted,marginTop:4}
});
