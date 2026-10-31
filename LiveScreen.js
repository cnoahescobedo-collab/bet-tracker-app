// Live: scan or add slips, then watch every open slip update.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LEAGUES, norm, tally, KIND_LABEL } from './core';
import { useApp, isPM, createdAt, ls } from './store';
import { useNav } from './nav';
import { gameById } from './espn';
import { C, S, T, money, signed } from './theme';
import { Button, Chips, Select, Empty, Banner, Row, Spacer, Tag, Fine } from './ui';
import { SlipCard, slipProgress, Leg } from './cards';

const SPORT_ITEMS = Object.entries(LEAGUES).map(([k, v]) => [k, v.label]);
export const kindsFor = lg => ({ bball: ['prop', 'total', 'spread', 'moneyline'], fball: ['prop', 'total', 'spread', 'moneyline'], base: ['prop', 'total', 'spread', 'moneyline'], hock: ['prop', 'total', 'spread', 'moneyline'], soc: ['moneyline', 'draw', 'total', 'spread'], ten: ['moneyline'], other: ['manual'] })[LEAGUES[lg]?.sport || 'other'] || ['prop'];

export default function LiveScreen() {
  const app = useApp();
  const { visible, me, people, isMine, legState, showMoney, refreshAll, updatedAt, liveErr, loadErr, toast } = app;
  const nav = useNav();
  const [league, setLeague] = useState('nba');
  const [view, setView] = useState('person');
  const [who, setWho] = useState('all');
  const [sortBy, setSortBy] = useState('close');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [pulling, setPulling] = useState(false);
  const [, tick] = useState(0);
  React.useEffect(() => { const t = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(t); }, []);
  React.useEffect(() => { ls.get('league', 'nba').then(setLeague); ls.get('sort', 'close').then(setSortBy); ls.get('open', []).then(a => setOpenIds(new Set(a))); }, []);
  const toggle = id => setOpenIds(cur => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); ls.set('open', [...n].slice(-200)); return n; });

  const open = useMemo(() => {
    let list = visible.filter(s => s.status === 'open' && (isPM(s) || !s.legs.some(l => l.result === 'lost')));
    if (who === 'me') list = list.filter(isMine); else if (who !== 'all') list = list.filter(s => norm(s.name) === who);
    const P = new Map(list.map(s => [s.id, slipProgress(s, legState)]));
    const key = { close: s => [P.get(s.id).remaining, -P.get(s.id).close], soon: s => [P.get(s.id).start, 0], pay: s => [-(Number(s.payout) || 0), 0], new: s => [-createdAt(s), 0] }[sortBy];
    return list.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1]; });
  }, [visible, who, sortBy, legState, app.liveTick]);

  const scan = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast('Allow photo access to scan a slip screenshot.', 'error'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    if (r.canceled || !r.assets?.[0]?.base64) return;
    const a = r.assets[0];
    nav.openEditor({ title: 'Reading your slip…', image: { uri: a.uri, base64: a.base64, mime: a.mimeType || 'image/jpeg' }, league });
  };
  const manual = () => nav.openEditor({ title: 'New slip', drafts: [{ league, kind: kindsFor(league)[0], side: 'over' }] });
  const sec = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  const whoOpts = [['all', 'Everyone'], ['me', 'Just me'], ...people.filter(([k]) => k !== norm(me.name))];

  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={pulling} tintColor={C.accent} onRefresh={async () => { setPulling(true); await refreshAll(); setPulling(false); }} />}>
      <View style={{ gap: S.sm }}>
        <Text style={T.tiny}>Sport for the next slip</Text>
        <Chips items={SPORT_ITEMS} value={league} onChange={k => { setLeague(k); ls.set('league', k); }} />
      </View>
      <Row gap={S.md}>
        <Button style={{ flex: 1 }} icon="scan-outline" label="Scan slip" onPress={() => scan().catch(e => toast(e.message, 'error'))} />
        <Button style={{ flex: 1 }} kind="ghost" icon="add" label="Add manually" onPress={manual} />
      </Row>
      <Banner text={loadErr || liveErr} />
      <Row>
        <Text style={T.tiny}>Open slips · {open.length}</Text><Spacer />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sec != null && sec < 45 ? C.win : C.faint }} />
        <Text style={T.small}>{sec == null ? 'Connecting…' : sec < 5 ? 'Updated just now' : sec < 60 ? `Updated ${sec}s ago` : `Updated ${Math.round(sec / 60)}m ago`}</Text>
      </Row>
      <Chips scroll={false} items={[['person', 'By person'], ['game', 'By game']]} value={view} onChange={setView} />
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} value={who} onChange={setWho} options={whoOpts} label="Whose slips" />
        <Select style={{ flex: 1 }} value={sortBy} onChange={v => { setSortBy(v); ls.set('sort', v); }} label="Sort"
          options={[['close', 'Closest to cashing'], ['soon', 'Starting soonest'], ['pay', 'Biggest payout'], ['new', 'Newest']]} />
      </Row>
      {view === 'person' && open.length > 0 && (
        <Row>
          <Button small kind="ghost" label="Expand all" onPress={() => setOpenIds(new Set(open.map(s => s.id)))} />
          <Button small kind="ghost" label="Collapse all" onPress={() => setOpenIds(new Set())} />
        </Row>
      )}
      {!open.length ? <Empty icon="pulse" title="No open slips" body={visible.length ? "Everything's settled. Check History and the Leaderboard." : 'Pick a sport, then scan a screenshot of your slip or add one by hand. Your friends will see it here live.'} />
        : view === 'game' ? <ByGame open={open} /> : <ByPerson open={open} openIds={openIds} toggle={toggle} />}
    </ScrollView>
  );
}

function ByPerson({ open, openIds, toggle }) {
  const { visible, me, isMine, showMoney } = useApp();
  const by = new Map();
  for (const s of open) { const k = norm(s.name); if (!by.has(k)) by.set(k, { name: s.name, mine: isMine(s), slips: [] }); by.get(k).slips.push(s); }
  const groups = [...by.values()].sort((a, b) => (b.mine - a.mine) || a.name.localeCompare(b.name));
  return groups.map(g => {
    const t = tally(visible.filter(s => norm(s.name) === norm(g.name)));
    return (
      <View key={g.name} style={{ gap: S.md }}>
        <Row>
          <Text style={[T.h2, { flexShrink: 1 }]} numberOfLines={1}>{g.name}</Text>{g.mine ? <Tag label="YOU" color={C.accent} /> : null}<Spacer />
          <Text numberOfLines={1} adjustsFontSizeToFit style={[T.small, T.num, { flexShrink: 1 }]}>{t.w}-{t.l}{t.p ? '-' + t.p : ''} · {showMoney(g.name) ? signed(t.profit) : '$•••'} · {g.slips.length} open</Text>
        </Row>
        {g.slips.map(s => <SlipCard key={s.id} slip={s} open={openIds.has(s.id)} onToggle={() => toggle(s.id)} />)}
      </View>
    );
  });
}

function ByGame({ open }) {
  const { legState, isMine } = useApp();
  const games = new Map(); const loose = [];
  for (const s of open) s.legs.forEach((l, i) => {
    if (l.result) return;
    const st = legState(s, l, i); const g = st.game;
    if (g) { if (!games.has(g.id)) games.set(g.id, { g, rows: [] }); games.get(g.id).rows.push({ s, l, i, st }); } else loose.push({ s, l, i, st });
  });
  const rank = g => g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2;
  const order = [...games.values()].sort((a, b) => rank(a.g) - rank(b.g) || Date.parse(a.g.date) - Date.parse(b.g.date));
  const block = (key, title, sub, rows) => (
    <View key={key} style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      <View style={{ padding: S.lg, paddingBottom: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Text style={T.h2}>{title}</Text>{sub ? <Text style={[T.small, { marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      {rows.map(r => (
        <View key={r.s.id + r.i}>
          <Text style={[T.tiny, { paddingHorizontal: S.lg, paddingTop: S.md }]}>{r.s.name}</Text>
          <Leg slip={r.s} leg={r.l} i={r.i} state={r.st} owner={isMine(r.s)} />
        </View>
      ))}
    </View>
  );
  return [
    ...order.map(x => block(x.g.id, x.g.name || x.g.teams.map(t => t.abbr).join(' vs '), [x.g.teams.map(t => `${t.abbr} ${t.score}`).join(' · '), x.g.detail].filter(Boolean).join(' · '), x.rows)),
    loose.length ? block('loose', 'Other legs', 'Not matched to a game yet', loose) : null,
  ];
}
