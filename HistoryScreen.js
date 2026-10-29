// History: every settled slip, with the web app's filters, summary and CSV export.
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { norm, slipCategory, tally, profitOf } from './core';
import { useApp, settledAt, ls } from './store';
import { C, S, T, money, signed, pct, statusColor } from './theme';
import { Chips, Select, Field, Button, Empty, Row, Spacer, Ionicons, Fine } from './ui';
import { legTitle } from './cards';
import { toCsv, shareCsv } from './export';

const DEF = { who: 'all', cat: 'all', res: 'all', when: 'all', src: 'all', legs: 'all', sort: 'new', q: '' };
function range(w) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (w === 'today') return [d.getTime(), Infinity];
  if (w === 'yday') { const e = d.getTime(); d.setDate(d.getDate() - 1); return [d.getTime(), e]; }
  if (w === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d.getTime(), Infinity]; }
  if (w === 'month') { d.setDate(1); return [d.getTime(), Infinity]; }
  if (w === '7' || w === '30') return [Date.now() - Number(w) * 864e5, Infinity];
  return [0, Infinity];
}
export const srcOf = s => s.source === 'pmus' ? 'pmus' : s.source === 'polymarket' ? 'polymarket' : s.source === 'model' ? 'model' : 'manual';
const SRC_LABEL = { pmus: 'Polymarket US', polymarket: 'Polymarket.com', model: 'Model pick', manual: 'Added by hand' };

export default function HistoryScreen() {
  const { visible, me, people, isMine, showMoney, refreshAll, toast } = useApp();
  const [f, setF] = useState(DEF); const [more, setMore] = useState(false); const [openIds, setOpenIds] = useState(new Set());
  const [pulling, setPulling] = useState(false); const [cap, setCap] = useState(100);
  useEffect(() => { ls.get('hf', {}).then(v => setF({ ...DEF, ...v, q: '' })); }, []);
  const upd = (k, v) => setF(cur => { const n = { ...cur, [k]: v }; const { q, ...keep } = n; ls.set('hf', keep); return n; });
  const done = visible.filter(s => s.status !== 'open');
  const cats = [...new Set(done.map(slipCategory))].sort();
  const list = useMemo(() => {
    let l = done;
    if (f.who === 'me') l = l.filter(isMine); else if (f.who !== 'all') l = l.filter(s => norm(s.name) === f.who);
    if (f.cat !== 'all') l = l.filter(s => slipCategory(s) === f.cat);
    if (f.res !== 'all') l = l.filter(s => s.status === f.res);
    if (f.when !== 'all') { const [a, b] = range(f.when); l = l.filter(s => { const t = settledAt(s); return t >= a && t < b; }); }
    if (f.src !== 'all') l = l.filter(s => srcOf(s) === f.src);
    if (f.legs !== 'all') { const n = s => s.legs.length; l = l.filter(s => f.legs === '1' ? n(s) === 1 : f.legs === '2-3' ? n(s) >= 2 && n(s) <= 3 : f.legs === '4-6' ? n(s) >= 4 && n(s) <= 6 : n(s) >= 7); }
    if (f.q) { const q = norm(f.q); l = l.filter(s => norm(s.name + ' ' + s.legs.map(x => [legTitle(x), x.player, x.team, x.market].filter(Boolean).join(' ')).join(' ')).includes(q)); }
    const key = { new: s => -settledAt(s), old: s => settledAt(s), bigwin: s => -profitOf(s), bigloss: s => profitOf(s), stake: s => -(Number(s.stake) || 0), legs: s => -s.legs.length }[f.sort];
    return [...l].sort((a, b) => key(a) - key(b) || settledAt(b) - settledAt(a));
  }, [visible, f]);
  const t = tally(list); const moneyOk = list.every(s => showMoney(s.name));
  const active = Object.entries(f).filter(([k, v]) => k !== 'sort' && v && v !== 'all').length;
  const moreOn = ['res', 'src', 'legs'].filter(k => f[k] !== 'all').length;
  const whoOpts = [['all', 'Everyone'], ['me', 'Just me'], ...people.filter(([k]) => k !== norm(me.name))];

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={pulling} tintColor={C.accent} onRefresh={async () => { setPulling(true); await refreshAll(); setPulling(false); }} />}>
      <Field placeholder="Search player, team or market" value={f.q} onChangeText={v => upd('q', v)} />
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="Who" value={f.who} options={whoOpts} onChange={v => upd('who', v)} />
        <Select style={{ flex: 1 }} label="Sport" value={cats.includes(f.cat) ? f.cat : 'all'} options={[['all', 'All sports'], ...cats.map(c => [c, c])]} onChange={v => upd('cat', v)} />
      </Row>
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="When" value={f.when} onChange={v => upd('when', v)} options={[['all', 'All time'], ['today', 'Today'], ['yday', 'Yesterday'], ['week', 'This week'], ['7', 'Last 7 days'], ['month', 'This month'], ['30', 'Last 30 days']]} />
        <Select style={{ flex: 1 }} label="Sort" value={f.sort} onChange={v => upd('sort', v)} options={[['new', 'Newest first'], ['old', 'Oldest first'], ['bigwin', 'Biggest win'], ['bigloss', 'Biggest loss'], ['stake', 'Biggest stake'], ['legs', 'Most legs']]} />
      </Row>
      <Pressable onPress={() => setMore(m => !m)}><Row><Text style={{ color: C.accent, fontWeight: '700' }}>{moreOn ? `More filters (${moreOn} on)` : 'More filters'}</Text><Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={16} color={C.accent} /></Row></Pressable>
      {more && (
        <View style={{ gap: S.md }}>
          <Select label="Result" value={f.res} onChange={v => upd('res', v)} options={[['all', 'All results'], ['won', 'Wins'], ['lost', 'Losses'], ['push', 'Pushes']]} />
          <Row gap={S.md}>
            <Select style={{ flex: 1 }} label="Type" value={f.src} onChange={v => upd('src', v)} options={[['all', 'All bets'], ['pmus', 'Polymarket US'], ['polymarket', 'Polymarket.com'], ['manual', 'Added by hand'], ['model', 'Model picks']]} />
            <Select style={{ flex: 1 }} label="Legs" value={f.legs} onChange={v => upd('legs', v)} options={[['all', 'Any size'], ['1', 'Singles'], ['2-3', '2–3 legs'], ['4-6', '4–6 legs'], ['7+', '7+ legs']]} />
          </Row>
        </View>
      )}
      {list.length > 0 && (
        <View style={{ backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: S.md, flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          <Sum k="Slips" v={String(list.length)} />
          <Sum k="Record" v={`${t.w}-${t.l}${t.p ? '-' + t.p : ''}`} sub={t.pct != null ? pct(t.pct) : ''} />
          {moneyOk && <Sum k="Net" v={signed(t.profit)} tone={t.profit > 0 ? 'won' : t.profit < 0 ? 'lost' : null} />}
          {moneyOk && <Sum k="Staked" v={money(t.staked)} />}
          {t.roi != null && <Sum k="ROI" v={pct(t.roi)} />}
          {t.legPct != null && <Sum k="Legs hit" v={pct(t.legPct)} />}
        </View>
      )}
      <Row>
        {active > 0 && <Button small kind="ghost" label="Reset filters" onPress={() => { setF(DEF); ls.set('hf', {}); toast('Filters cleared.'); }} />}
        <Spacer />
        <Button small kind="ghost" icon="download-outline" label="Export CSV" onPress={() => shareCsv(`bets-${me.group}.csv`, toCsv(list, showMoney)).catch(e => toast(e.message, 'error'))} />
      </Row>
      {!list.length ? <Empty icon="time-outline" title={done.length ? 'Nothing matches these filters' : 'No settled slips yet'} body={done.length ? 'Try widening the filters or tap Reset filters.' : 'Slips land here once every leg is decided.'} />
        : list.slice(0, cap).map(s => <HistRow key={s.id} s={s} open={openIds.has(s.id)} onToggle={() => setOpenIds(c => { const n = new Set(c); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })} />)}
      {list.length > cap && <Button kind="ghost" label={`Show more (${list.length - cap} left)`} onPress={() => setCap(c => c + 100)} />}
    </ScrollView>
  );
}
const Sum = ({ k, v, sub, tone }) => <View><Text style={T.tiny}>{k}</Text><Text style={[T.h3, T.num, tone && { color: statusColor(tone) }]}>{v}{sub ? <Text style={T.small}>  {sub}</Text> : null}</Text></View>;

function HistRow({ s, open, onToggle }) {
  const { showMoney } = useApp();
  const p = profitOf(s); const sm = showMoney(s.name);
  const r = s.status === 'won' ? 'W' : s.status === 'lost' ? 'L' : 'P';
  const d = (s.settledAt || s.createdAt)?.toDate?.();
  const hits = s.legs.filter(l => l.result === 'won').length;
  const col = statusColor(s.status);
  return (
    <Pressable onPress={onToggle} style={{ backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: col + '22', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: col, fontWeight: '900' }}>{r}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={T.h3} numberOfLines={1}>{s.name} · {s.legs.length}-leg {slipCategory(s)}</Text>
          <Text style={T.small} numberOfLines={1}>{d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''} · {hits}/{s.legs.length} legs hit{s.stake && sm ? ` · ${money(+s.stake)} stake` : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[T.h3, T.num, { color: p > 0 ? C.win : p < 0 ? C.loss : C.muted }]}>{sm ? signed(p) : '$•••'}</Text>
          {s.status === 'won' && sm && s.stake ? <Text style={T.small}>returned {money(Number(s.stake) + p)}</Text> : null}
        </View>
      </View>
      {open && (
        <View style={{ paddingHorizontal: S.md, paddingBottom: S.md, gap: 6, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md }}>
          {s.legs.map((l, i) => {
            const c = l.result || 'none';
            return <Row key={i} style={{ alignItems: 'flex-start' }}>
              <Text style={{ width: 16, color: statusColor(c), fontWeight: '900' }}>{c === 'won' ? '✓' : c === 'lost' ? '✗' : c === 'push' ? '–' : '·'}</Text>
              <Text style={[T.body, { flex: 1, fontSize: 14 }]}>{legTitle(l) || l.market}{l.final != null ? <Text style={T.small}>  ({String(l.final)})</Text> : null}{l.kind === 'prop' ? <Text style={T.small}>  {(l.side || 'over')} {l.line} {l.market}</Text> : null}</Text>
            </Row>;
          })}
          <Fine>{SRC_LABEL[srcOf(s)]}{s.odds ? ` · odds ${s.odds}` : ''}{s.payout && sm ? ` · paid ${money(+s.payout)}` : ''}{d ? ` · ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</Fine>
        </View>
      )}
    </Pressable>
  );
}
