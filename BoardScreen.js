// Leaderboard: running profit per person, win rankings, best sport.
import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { norm, tally, profitOf, slipCategory } from './core';
import { useApp, settledAt, isPerson } from './store';
import { C, S, T, money, signed, pct, statusColor } from './theme';
import { Chips, Empty, Row, Spacer, Tag, Pill, Section } from './ui';

// Running-profit line drawn with plain views (no chart library needed)
function Spark({ points }) {
  const [w, setW] = React.useState(0);
  if (points.length < 2) return null;
  const H = 44, P = 3; const ys = points.map(p => p.y);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = (hi - lo) || 1;
  const x = i => P + i * (w - 2 * P) / (points.length - 1), y = v => H - P - (v - lo) * (H - 2 * P) / span;
  const last = points[points.length - 1].y; const col = last > 0 ? C.win : last < 0 ? C.loss : C.muted;
  const segs = [];
  if (w) for (let i = 1; i < points.length; i++) {
    const x1 = x(i - 1), y1 = y(points[i - 1].y), x2 = x(i), y2 = y(points[i].y);
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
    segs.push(<View key={i} style={{ position: 'absolute', left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1, width: len, height: 2, backgroundColor: col, borderRadius: 1, transform: [{ rotate: ang + 'rad' }] }} />);
  }
  return (
    <View style={{ height: H }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w ? <>
        <View style={{ position: 'absolute', left: 0, right: 0, top: y(0), borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.line }} />
        {segs}
        <View style={{ position: 'absolute', left: x(points.length - 1) - 3, top: y(last) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
      </> : null}
    </View>
  );
}
const start = r => { const d = new Date(); d.setHours(0, 0, 0, 0); if (r === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); } if (r === 'month') { d.setDate(1); return d.getTime(); } return 0; };

export default function BoardScreen() {
  const { visible, people, me, showMoney, refreshAll } = useApp();
  const [range, setRange] = useState('all'); const [rankBy, setRankBy] = useState('won'); const [who, setWho] = useState('all');
  const [pulling, setPulling] = useState(false);
  const ppl = people.filter(([k]) => k !== 'model');
  const from = start(range);
  const settled = visible.filter(s => isPerson(s) && s.status !== 'open' && settledAt(s) >= from);
  const cards = ppl.map(([k, name]) => {
    const mine = settled.filter(s => norm(s.name) === k).sort((a, b) => settledAt(a) - settledAt(b));
    let run = 0; const pts = [{ y: 0 }]; mine.forEach(s => { run += profitOf(s); pts.push({ y: run }); });
    const t = tally(mine); const open = visible.filter(s => isPerson(s) && s.status === 'open' && norm(s.name) === k);
    return { k, name, net: run, t, pts, atRisk: open.reduce((m, s) => m + (Number(s.stake) || 0), 0), openN: open.length, me: k === norm(me.name) };
  }).filter(c => c.t.n || c.t.p || c.openN).sort((a, b) => (b.me - a.me) || (b.net - a.net));

  const rows = ppl.map(([k, name]) => {
    const wins = settled.filter(s => norm(s.name) === k && s.status === 'won');
    const amts = wins.map(s => Math.max(0, profitOf(s)));
    let best = null; wins.forEach((s, i) => { if (!best || amts[i] > best.amt) best = { amt: amts[i], legs: s.legs.length, cat: slipCategory(s) }; });
    const legsHit = settled.filter(s => norm(s.name) === k).reduce((m, s) => m + s.legs.filter(l => l.result === 'won').length, 0);
    return { name, won: amts.reduce((m, x) => m + x, 0), wins: wins.length, best, legsHit, me: k === norm(me.name), show: showMoney(name) };
  }).filter(r => r.wins > 0);
  const key = { won: r => r.won, wins: r => r.wins, best: r => r.best?.amt || 0 }[rankBy];
  rows.sort((a, b) => key(b) - key(a) || b.won - a.won);
  const big = r => rankBy === 'wins' ? `${r.wins} wins` : !r.show ? '$•••' : rankBy === 'best' ? '+' + money(r.best?.amt || 0) : '+' + money(r.won);

  const pool = who === 'all' ? settled : settled.filter(s => norm(s.name) === who);
  const byCat = new Map(); pool.forEach(s => { const c = slipCategory(s); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(s); });
  const cats = [...byCat].map(([c, ss]) => ({ c, t: tally(ss) })).filter(x => x.t.n || x.t.p).sort((a, b) => (b.t.pct || 0) - (a.t.pct || 0));
  const catMoney = who === 'all' ? !pool.some(z => !showMoney(z.name)) : showMoney(ppl.find(([k]) => k === who)?.[1] || '');

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.xl, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={pulling} tintColor={C.accent} onRefresh={async () => { setPulling(true); await refreshAll(); setPulling(false); }} />}>
      <Chips scroll={false} items={[['all', 'All-time'], ['month', 'This month'], ['week', 'This week']]} value={range} onChange={setRange} />
      <Section title={range === 'week' ? "This week's profit & loss" : range === 'month' ? "This month's profit & loss" : 'All-time profit & loss'}>
        {!cards.length ? <Empty icon="trophy-outline" title="No results yet" body="Each person's running profit shows here once slips settle." />
          : cards.map(c => {
            const tone = c.net > 0.004 ? 'won' : c.net < -0.004 ? 'lost' : 'push';
            const sm = showMoney(c.name);
            return (
              <View key={c.k} style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: tone === 'won' ? C.win + '55' : tone === 'lost' ? C.loss + '55' : C.line, padding: S.lg, gap: 6 }}>
                <Row><Text style={T.h2}>{c.name}</Text>{c.me ? <Tag label="YOU" color={C.accent} /> : null}<Spacer /><Pill small tone={tone} label={tone === 'won' ? 'In the green' : tone === 'lost' ? 'In the red' : 'Even'} /></Row>
                <Text style={[T.hero, T.num, { color: statusColor(tone === 'push' ? null : tone), fontSize: 28 }]}>{sm ? signed(c.net) : c.t.roi != null ? (c.t.roi > 0 ? '+' : '') + Math.round(c.t.roi * 100) + '% ROI' : '—'}</Text>
                <Spark points={c.pts} />
                <Text style={T.small}>{c.t.w}-{c.t.l}{c.t.p ? '-' + c.t.p : ''}{sm ? ` · ${money(c.t.staked)} staked` : ''}{c.t.roi != null ? ' · ROI ' + pct(c.t.roi) : ''}</Text>
                {c.openN ? <Text style={T.small}>{c.openN} open{sm ? ` · ${money(c.atRisk)} riding` : ''}</Text> : null}
              </View>
            );
          })}
      </Section>
      <Section title="Rankings">
        <Chips scroll={false} items={[['won', 'Most won'], ['wins', 'Most wins'], ['best', 'Biggest hit']]} value={rankBy} onChange={setRankBy} />
        {!rows.length ? <Empty icon="ribbon-outline" title="No wins yet" body="The first cashed slip puts someone on the board." />
          : rows.map((r, i) => (
            <View key={r.name} style={{ backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: i === 0 ? C.accent + '66' : C.line, padding: S.md, flexDirection: 'row', alignItems: 'center', gap: S.md }}>
              <Text style={{ width: 26, fontSize: 20, fontWeight: '900', color: i === 0 ? C.accent : C.muted, textAlign: 'center' }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Row><Text style={T.h3}>{r.name}</Text>{r.me ? <Tag label="YOU" color={C.accent} /> : null}</Row>
                <Text style={T.small} numberOfLines={2}>{r.wins} win{r.wins === 1 ? '' : 's'} · {r.legsHit} legs hit{r.best ? ` · best: ${r.show ? '+' + money(r.best.amt) + ' on a ' : 'a '}${r.best.legs}-leg ${r.best.cat}` : ''}</Text>
              </View>
              <Text style={[T.h2, T.num, { color: rankBy === 'wins' ? C.ink : C.win }]}>{big(r)}</Text>
            </View>
          ))}
      </Section>
      <Section title="Best sport">
        <Chips items={[['all', 'Whole group'], ...ppl]} value={who} onChange={setWho} />
        {!cats.length ? <Empty icon="stats-chart-outline" title="No results yet" body="Win rates by sport show up after the first slips settle." />
          : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>{cats.map((x, i) => (
            <View key={x.c} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: i === 0 ? C.accent + '66' : C.line, padding: S.md }}>
              <Row><Text style={T.tiny}>{x.c}</Text>{i === 0 ? <Tag label="BEST" color={C.accent} /> : null}</Row>
              <Text style={[T.h1, T.num, { marginTop: 4 }]}>{pct(x.t.pct)}</Text>
              <Text style={T.small}>{x.t.w}-{x.t.l}{x.t.p ? '-' + x.t.p : ''} · <Text style={{ color: x.t.profit > 0 ? C.win : x.t.profit < 0 ? C.loss : C.muted }}>{catMoney ? signed(x.t.profit) : x.t.roi != null ? Math.round(x.t.roi * 100) + '% ROI' : ''}</Text></Text>
            </View>
          ))}</View>}
      </Section>
    </ScrollView>
  );
}
