// App frame: sign-in gate, slide-out side menu, top bar, pop-up messages, slip editor.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Dimensions, Share, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './store';
import { C, S, T } from './theme';
import { Ionicons } from './ui';
import { SignIn, Verify, Join, Pending } from './AuthScreen';
import LiveScreen from './LiveScreen';
import HistoryScreen from './HistoryScreen';
import BoardScreen from './BoardScreen';
import MeScreen from './MeScreen';
import MembersScreen from './MembersScreen';
import ReactionsScreen from './ReactionsScreen';
import { TrendsScreen, NewsScreen, ValueScreen } from './PicksScreen';
import PolymarketScreen from './PolymarketScreen';
import SlipEditor from './SlipEditorScreen';
import { PolyProvider } from './poly';
import { Nav } from './nav';


const MENU = [
  { key: 'live', label: 'Live', icon: 'pulse' },
  { key: 'history', label: 'History', icon: 'time-outline' },
  { group: 'Picks' },
  { key: 'trends', label: 'Player trends', icon: 'trending-up' },
  { key: 'news', label: 'Injuries & news', icon: 'medkit-outline' },
  { key: 'value', label: 'Value parlays', icon: 'flash-outline' },
  { group: 'Group' },
  { key: 'board', label: 'Leaderboard', icon: 'trophy-outline' },
  { key: 'reactions', label: 'Reactions', icon: 'notifications-outline' },
  { key: 'members', label: 'Members', icon: 'people-outline' },
  { group: 'You' },
  { key: 'me', label: 'Me & settings', icon: 'person-circle-outline' },
  { key: 'polymarket', label: 'Polymarket', icon: 'link-outline' },
];
const SCREENS = { live: LiveScreen, history: HistoryScreen, trends: TrendsScreen, news: NewsScreen, value: ValueScreen, board: BoardScreen, reactions: ReactionsScreen, members: MembersScreen, me: MeScreen, polymarket: PolymarketScreen };
const TITLES = Object.fromEntries(MENU.filter(m => m.key).map(m => [m.key, m.label]));

export default function Root() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppProvider><Gate /></AppProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { user, phase } = useApp();
  let body;
  if (user === undefined || (user && user.emailVerified && phase === 'loading')) body = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
  else if (!user) body = <SignIn />;
  else if (!user.emailVerified) body = <Verify user={user} />;
  else if (phase === 'join') body = <Join />;
  else if (phase === 'pending') body = <Pending />;
  else body = <PolyProvider><Main /></PolyProvider>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={phase === 'ready' && user?.emailVerified ? ['left', 'right'] : ['top', 'left', 'right', 'bottom']}>{body}<Toast /></SafeAreaView>;
}

function Main() {
  const { notifs, members, isOwner, me } = useApp();
  const [screen, setScreen] = useState('live');
  const [editor, setEditor] = useState(null);   // {drafts, stake, odds, payout, title, editingId}
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const W = Math.min(310, Dimensions.get('window').width * 0.82);
  const x = useRef(new Animated.Value(-W)).current;
  useEffect(() => { Animated.timing(x, { toValue: open ? 0 : -W, duration: 220, useNativeDriver: true }).start(); }, [open]);
  const unread = notifs.filter(n => !n.read).length;
  const waiting = isOwner ? Object.values(members).filter(m => m.status === 'pending' && !m.removed).length : 0;
  const go = k => { setScreen(k); setOpen(false); };
  const nav = { screen, go, openEditor: e => setEditor(e), closeEditor: () => setEditor(null) };
  const Screen = SCREENS[screen];
  const badge = k => k === 'reactions' ? unread : k === 'members' ? waiting : 0;

  return (
    <Nav.Provider value={nav}>
      <View style={{ flex: 1 }}>
        <View style={[st.top, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={() => setOpen(true)} hitSlop={10} style={st.iconBtn} accessibilityLabel="Open menu">
            <Ionicons name="menu" size={26} color={C.ink} />
            {unread + waiting > 0 && <View style={st.dotBadge} />}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={T.tiny}>{me?.name} · Group {me?.group}</Text>
            <Text style={[T.h2, { fontSize: 19 }]}>{TITLES[screen]}</Text>
          </View>
          <Pressable onPress={() => go('reactions')} hitSlop={10} style={st.iconBtn} accessibilityLabel="Reactions">
            <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={23} color={unread ? C.accent : C.muted} />
            {unread > 0 && <View style={st.countBadge}><Text style={st.countText}>{unread > 9 ? '9+' : unread}</Text></View>}
          </Pressable>
        </View>
        <View style={{ flex: 1 }}><Screen /></View>

        {open && <Pressable style={st.scrim} onPress={() => setOpen(false)} />}
        <Animated.View style={[st.drawer, { width: W, paddingTop: insets.top + S.lg, paddingBottom: insets.bottom, transform: [{ translateX: x }] }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
            <View style={{ paddingHorizontal: S.lg, marginBottom: S.lg }}>
              <Text style={{ color: C.ink, fontWeight: '900', letterSpacing: 2, fontSize: 13 }}>LIVE BET <Text style={{ color: C.accent }}>TRACKER</Text></Text>
              <Text style={[T.small, { marginTop: 6 }]}>You're <Text style={{ color: C.ink, fontWeight: '700' }}>{me?.name}</Text> · Group <Text style={{ color: C.ink, fontWeight: '700', letterSpacing: 1 }}>{me?.group}</Text></Text>
            </View>
            {MENU.map((m, i) => m.group ? <Text key={'g' + i} style={[T.tiny, { paddingHorizontal: S.lg, marginTop: S.lg, marginBottom: 6 }]}>{m.group}</Text> : (
              <Pressable key={m.key} onPress={() => go(m.key)} style={({ pressed }) => [st.item, screen === m.key && st.itemOn, pressed && { opacity: 0.7 }]}>
                <Ionicons name={m.icon} size={20} color={screen === m.key ? C.accent : C.muted} />
                <Text style={[st.itemText, screen === m.key && { color: C.ink }]}>{m.label}</Text>
                {badge(m.key) > 0 && <View style={st.countBadgeInline}><Text style={st.countText}>{badge(m.key)}</Text></View>}
              </Pressable>
            ))}
            <Pressable onPress={() => { setOpen(false); invite(me); }} style={({ pressed }) => [st.item, pressed && { opacity: 0.7 }, { marginTop: S.lg }]}>
              <Ionicons name="share-social-outline" size={20} color={C.muted} /><Text style={st.itemText}>Invite friends</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
        {editor && <SlipEditor {...editor} onClose={() => setEditor(null)} />}
      </View>
    </Nav.Provider>
  );
}

function invite(me) {
  const url = 'https://cnoahescobedo-collab.github.io/?join=' + me.group;
  Share.share({ message: `Join my bet tracker group (code ${me.group}): ${url}` }).catch(() => {});
}

function Toast() {
  const { toastMsg } = useApp();
  const insets = useSafeAreaInsets();
  if (!toastMsg) return null;
  const col = toastMsg.kind === 'error' ? C.loss : C.ink;
  return <View pointerEvents="none" style={[st.toast, { bottom: insets.bottom + 24 }]}><Text style={{ color: col, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>{toastMsg.msg}</Text></View>;
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingBottom: 10, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dotBadge: { position: 'absolute', top: 4, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: C.accent },
  countBadge: { position: 'absolute', top: 0, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countBadgeInline: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 'auto' },
  countText: { color: C.accentInk, fontSize: 11, fontWeight: '800' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000a' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.line },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: S.lg, marginHorizontal: S.sm, borderRadius: 12 },
  itemOn: { backgroundColor: C.raised },
  itemText: { color: C.muted, fontSize: 16, fontWeight: '700' },
  toast: { position: 'absolute', left: 24, right: 24, backgroundColor: C.raised, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line },
});
