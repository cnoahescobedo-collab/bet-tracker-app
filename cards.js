// Slip and leg cards shared by Live and History.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { LEAGUES, sportOf, slipCategory } from './core';
import { injFor } from './espn';
import { useApp, isPM } from './store';
import { useNav } from './nav';
import { usePoly } from './poly';
import { C, R, S, T, statusColor, money, signed } from './theme';
import { Pill, Bar, Tag, Button, ConfirmButton, Row, Spacer, Ionicons } from './ui';

export const legTitle = l =>
  (l.kind === 'poly' || l.kind === 'pmus') ? l.team
    : l.kind === 'prop' ? l.player
      : l.kind === 'total' || l.kind === 'draw' ? ([l.team, l.opponent].filter(Boolean).join(' vs ') || 'Game')
        : l.kind === 'manual' ? (l.player || l.team || 'Other bet') : l.team;
export function legBet(l) {
  const line = l.line ?? ''; const side = (l.side || 'over').toUpperCase();
  if (l.kind === 'prop') return `${side} ${line} ${l.market || ''}`;
  if (l.kind === 'total') return `${side} ${line} total ${['soc', 'hock'].includes(sportOf(l.league)) ? 'goals' : 'points'}`;
  if (l.kind === 'spread') return `${l.team} ${Number(line) > 0 ? '+' : ''}${line} spread`;
  if (l.kind === 'draw') return 'Draw';
  if (l.kind === 'manual' || l.kind === 'poly' || l.kind === 'pmus') return l.market || '';
  return `${l.team} to win`;
}
function needText(l, s) {
  if (s.result || s.cur == null || l.line == null) return '';
  if (l.kind === 'prop' || l.kind === 'total') {
    const line = Number(l.line);
    if ((l.side || 'over') === 'over') {
      const need = Math.floor(line) + 1 - s.cur; if (need <= 0) return '';
      const unit = l.kind === 'total' ? 'pts' : (l.market || '').replace(/^pts\+.*/, '').trim();
      return `Needs ${Math.round(need * 10) / 10} more${unit ? ' ' + unit : ''}`;
    }
    const room = line - s.cur; return room > 0 ? `${Math.round(room * 10) / 10} to spare` : '';
  }
  return '';
}
export function InjBadge({ o }) {
  if (!o) return null;
  const col = o.cls === 'out' ? C.loss : o.cls === 'gtd' ? C.live : C.muted;
  return <Text style={{ color: col, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: col + '66', borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' }}>{o.cls === 'out' ? 'OUT' : String(o.status || 'Injury').toUpperCase()}</Text>;
}

export function Leg({ slip, leg: l, i, state: s, owner }) {
  const { actions, toast } = useApp();
  const pm = l.kind === 'poly' || l.kind === 'pmus';
  const res = s.result;
  const tone = res === 'won' ? 'won' : res === 'lost' ? 'lost' : res === 'push' ? 'push' : s.live ? 'live' : 'pending';
  const label = pm ? (res === 'won' ? 'Won' : res === 'lost' ? 'Lost' : res === 'push' ? 'Even' : 'Open')
    : res === 'won' ? 'Hit' : res === 'lost' ? 'Miss' : res === 'push' ? 'Void' : s.live ? 'Live' : 'Pending';
  const cur = s.cur == null ? '–' : Math.round(s.cur * 10) / 10;
  const of = (l.kind === 'prop' || l.kind === 'total') ? `of ${l.line}` : l.kind === 'spread' || l.kind === 'moneyline' ? (s.mine ? `${s.mine} ${l.kind === 'spread' ? 'w/ spread' : 'lead'}` : '') : l.kind === 'draw' ? 'goal gap' : '';
  const lg = LEAGUES[l.league]; const g = s.game; const need = needText(l, s);
  const espn = g && lg?.path ? `https://www.espn.com/${lg.path.split('/')[0]}/${lg.path.startsWith('soccer') ? 'match/_/gameId' : 'game/_/gameId'}/${g.id}` : '';
  const inj = l.kind === 'prop' && !res && l.player ? injFor(l.league, l.player) : null;
  const canMark = owner && !res && !pm && (l.kind === 'manual' || s.missing);
  const { polyLive } = usePoly();
  const pl = l.kind === 'poly' ? polyLive[l.key + '_' + slip.uid] : null;
  const pmPrice = !pm || slip.status !== 'open' ? ''
    : pl ? `Worth ${money(pl.currentValue)} now (${signed(pl.cashPnl || 0)}) · ${Math.round(pl.curPrice * 100)}¢ chance`
      : slip.liveValue != null ? `Worth ${money(slip.liveValue)} now (${signed(slip.livePnl || 0)})` : '';
  return (
    <View style={st.leg}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: S.md }}>
          <Row gap={6}><Text style={st.legName} numberOfLines={1}>{legTitle(l) || '—'}</Text><InjBadge o={inj} /></Row>
          <Text style={st.legBet} numberOfLines={2}>{legBet(l)}</Text>
        </View>
        {!pm && l.kind !== 'manual' && (
          <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: 110 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[st.legCur, T.num, res && { color: statusColor(tone) }]}>{cur}</Text>
            {of ? <Text style={T.small}>{of}</Text> : null}
          </View>
        )}
      </View>
      {s.cur != null && s.pct != null && <Bar pct={s.pct} tick={s.tick} tone={res ? tone : null} />}
      {l.raw && l.kind !== 'pmus' && l.kind !== 'moneyline' ? <Text style={st.statline}>Polymarket: {l.raw.length > 90 ? l.raw.slice(0, 88) + '…' : l.raw}</Text> : null}
      {(s.detail || need || pmPrice) ? (
        <Text style={st.statline}>
          {s.detail || pmPrice}{s.pace != null && !res ? ` · on pace for ${s.pace.toFixed(1)}` : ''}
          {need ? <Text style={{ color: C.live, fontWeight: '700' }}>{s.detail ? '  ·  ' : ''}{need}</Text> : null}
        </Text>
      ) : null}
      <View style={st.meta}>
        <Pill label={label} tone={tone} small />
        <Text style={[T.small, { flex: 1 }]} numberOfLines={1}>
          {pm ? (l.kind === 'pmus' ? 'Polymarket US' : 'Polymarket') + ' · ' + (l.cat || 'Other') : lg?.label || ''}
          {g?.detail ? ` · ${g.detail}` : ''}{!res && s.missing ? ` · ${s.missing}` : ''}
        </Text>
        {espn ? <Text onPress={() => Linking.openURL(espn)} style={st.link}>ESPN</Text> : null}
        {pm && l.slug && l.kind === 'poly' ? <Text onPress={() => Linking.openURL('https://polymarket.com/event/' + encodeURIComponent(l.slug))} style={st.link}>Market</Text> : null}
      </View>
      {canMark && (
        <Row style={{ marginTop: S.sm }}>
          <Button small kind="ghost" icon="checkmark" label="Mark hit" onPress={() => actions.markLeg(slip.id, i, 'won').catch(e => toast(e.message, 'error'))} />
          <Button small kind="ghost" icon="close" label="Mark miss" onPress={() => actions.markLeg(slip.id, i, 'lost').catch(e => toast(e.message, 'error'))} />
        </Row>
      )}
    </View>
  );
}

const REACTS = ['🔥', '💰', '👀', '😬', '🙏', '🤡'];
function Reacts({ slip }) {
  const { reactions, uid, actions, toast } = useApp();
  const mine = reactions.find(r => r.slipId === slip.id && r.uid === uid)?.emoji;
  const counts = {}; reactions.filter(r => r.slipId === slip.id).forEach(r => (counts[r.emoji] = (counts[r.emoji] || 0) + 1));
  return (
    <View style={st.reacts}>
      {REACTS.map(e => (
        <Pressable key={e} onPress={() => actions.react(slip, e).catch(err => toast("Couldn't react: " + err.message, 'error'))}
          style={({ pressed }) => [st.react, mine === e && st.reactOn, pressed && { opacity: 0.6 }]}>
          <Text style={{ fontSize: 16 }}>{e}</Text>{counts[e] ? <Text style={[T.small, { color: C.ink, fontWeight: '700' }]}>{counts[e]}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function slipProgress(slip, legState) {
  const states = slip.legs.map((l, i) => legState(slip, l, i));
  const won = states.filter(x => x.result === 'won' || x.result === 'push').length;
  const lost = states.some(x => x.result === 'lost');
  const rem = states.filter(x => !x.result);
  const close = rem.length ? rem.reduce((m, x) => m + (x.pct ?? 0), 0) / rem.length : 1;
  const start = Math.min(...states.map(x => Date.parse(x.game?.date || '') || Infinity));
  return { states, won, lost, remaining: rem.length, close, start, live: states.some(x => x.live && !x.result) };
}

export function SlipCard({ slip: s, open, onToggle, showOwner }) {
  const { legState, showMoney, isMine, actions, toast, liveTick } = useApp();
  const nav = useNav();
  const pr = slipProgress(s, legState);
  const pm = isPM(s);
  const status = s.status !== 'open' ? s.status : pr.lost && !pm ? 'lost' : 'open';
  let [tone, label] = status === 'won' ? ['won', 'Cashed'] : status === 'lost' ? ['lost', 'Busted'] : status === 'push' ? ['push', 'Push'] : [pr.live ? 'live' : 'pending', `${pr.won}/${s.legs.length} hit`];
  if (status === 'open' && pm && pr.lost) [tone, label] = ['lost', 'Likely lost'];
  const sweat = status === 'open' && pr.remaining === 1 && s.legs.length > 1 ? '1 leg away' : status === 'open' && pr.remaining === 0 ? 'Settling…' : '';
  const when = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const sm = showMoney(s.name); const amt = n => (sm ? money(+n) : '$•••');
  const mine = isMine(s);
  const border = status === 'won' ? C.win : status === 'lost' ? C.loss : sweat === '1 leg away' ? C.live : C.line;
  const edit = () => nav.openEditor({ title: 'Edit slip', editingId: s.id, stake: s.stake, odds: s.odds, payout: s.payout,
    drafts: s.legs.map(l => ({ league: l.league, kind: l.kind, side: l.side || 'over', player: l.player || '', team: l.team || '', market: l.market || '', line: l.line ?? '' })) });
  return (
    <View style={[st.card, { borderColor: border }]}>
      <Pressable onPress={onToggle} style={({ pressed }) => [st.head, pressed && { opacity: 0.85 }]}>
        <View style={{ flex: 1, paddingRight: S.sm }}>
          {showOwner ? <Text style={[T.tiny, { marginBottom: 3 }]}>{s.name}</Text> : null}
          <Text style={T.h2}>{s.legs.length}-leg {slipCategory(s)}  <Text style={T.small}>{when}</Text></Text>
          <Text numberOfLines={2} style={[T.small, T.num, { marginTop: 2 }]}>
            {s.stake ? amt(s.stake) : ''}{s.payout ? `  →  ${amt(s.payout)}` : ''}{s.odds ? `  ·  ${s.odds}` : ''}
            {s.source === 'model' ? '  ·  model pick' : pm ? '  ·  Polymarket' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Pill label={label} tone={tone} />
          {sweat ? <Text style={st.sweat}>{sweat}</Text> : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} style={{ marginLeft: 6, marginTop: 2 }} />
      </Pressable>
      <View style={st.dots}>
        {pr.states.map((x, i) => <View key={i} style={[st.dot, { backgroundColor: x.result === 'won' || x.result === 'push' ? C.win : x.result === 'lost' ? C.loss : x.live ? C.live : C.track }]} />)}
      </View>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.line }}>
          {s.legs.map((l, i) => <Leg key={i} slip={s} leg={l} i={i} state={pr.states[i]} owner={mine} />)}
          <Reacts slip={s} />
          {mine && !pm && (
            <Row style={{ padding: S.md, paddingTop: 0, flexWrap: 'wrap' }}>
              {!s.source && <Button small kind="ghost" icon="create-outline" label="Edit" onPress={edit} />}
              {status === 'open' && <Button small kind="ghost" label="Won" icon="checkmark-circle-outline" onPress={() => actions.settleSlip(s.id, 'won').catch(e => toast(e.message, 'error'))} />}
              {status === 'open' && <Button small kind="ghost" label="Lost" icon="close-circle-outline" onPress={() => actions.settleSlip(s.id, 'lost').catch(e => toast(e.message, 'error'))} />}
              <Spacer />
              <ConfirmButton small kind="danger" icon="trash-outline" label="Delete" confirmLabel="Tap to delete" onConfirm={() => actions.deleteSlip(s.id).then(() => toast('Slip deleted.')).catch(e => toast("Couldn't delete: " + e.message, 'error'))} />
            </Row>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'flex-start', padding: S.lg, paddingBottom: S.sm },
  dots: { flexDirection: 'row', gap: 4, paddingHorizontal: S.lg, paddingBottom: S.md },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  leg: { padding: S.lg, borderBottomWidth: 1, borderBottomColor: C.line },
  legName: { fontSize: 16, fontWeight: '700', color: C.ink, flexShrink: 1 },
  legBet: { fontSize: 13, color: C.muted, marginTop: 2 },
  legCur: { fontSize: 26, fontWeight: '800', color: C.ink, lineHeight: 28 },
  statline: { fontSize: 12, color: C.muted, marginTop: S.sm, lineHeight: 17 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md },
  link: { color: C.accent, fontWeight: '700', fontSize: 13 },
  sweat: { color: C.live, fontWeight: '800', fontSize: 12 },
  reacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: S.md },
  react: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.sunk, borderWidth: 1, borderColor: C.line },
  reactOn: { borderColor: C.accent, backgroundColor: C.accent + '22' },
});
