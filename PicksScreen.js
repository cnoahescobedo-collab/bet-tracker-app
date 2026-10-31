// Picks: Player trends, Injuries & news, Value parlays (prop parlays + team longshots + model record).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, RefreshControl } from 'react-native';
import { LEAGUES, decToAm, tally } from './core';
import { useApp, ls } from './store';
import { useNav } from './nav';
import * as fb from './fb';
import { boards, loadBoard, leagueInjuries, leagueNews, injCache, newsCache, etDay, ago } from './espn';
import { TREND_LEAGUES, trendCache, scanTrends, buildPropParlays, legLine, findTeamValue } from './picks';
import { C, S, T, money, signed, pct, statusColor } from './theme';
import { Chips, Select, Field, Button, Empty, Card, Row, Spacer, Tag, Pill, Fine, Section, Stat, Grid, Ionicons, Banner } from './ui';
import { InjBadge } from './cards';

const pctS = x => (x == null ? '–' : Math.round(x * 100) + '%');
const amS = a => (a > 0 ? '+' : '') + a;

function useTrend(lg) {
  const [ts, setTs] = useState(trendCache.get(lg) || null);
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const run = async force => {
    if (force) trendCache.delete(lg);
    const c = trendCache.get(lg);
    if (c && Date.now() - c.at < 15 * 60000) { setTs(c); return; }
    setBusy(true); setTs(null);
    const r = await scanTrends(lg, setStatus); setTs(r); setStatus(''); setBusy(false);
  };
  useEffect(() => { setTs(trendCache.get(lg) || null); run(false); }, [lg]);
  return { ts, status, busy, refresh: () => run(true) };
}

/* ===================== Player trends ===================== */
export function TrendsScreen() {
  const nav = useNav();
  const [lg, setLg] = useState('nba');
  useEffect(() => { ls.get('tLeague', 'nba').then(setLg); }, []);
  const { ts, status, busy, refresh } = useTrend(lg);
  const [show, setShow] = useState('stats'); const [game, setGame] = useState('all'); const [stat, setStat] = useState('all');
  const [sort, setSort] = useState('hot'); const [price, setPrice] = useState('all'); const [cap, setCap] = useState(40);
  const [openI, setOpenI] = useState(null);
  const statsMode = show === 'stats';
  const SORTS = statsMode ? [['hot', 'Hottest right now'], ['cold', 'Coldest right now'], ['name', 'Name']] : [['edge', 'Biggest edge'], ['l10', 'Best last 10'], ['hot', 'Hottest (7 days vs season)'], ['price', 'Cheapest price']];
  useEffect(() => { if (!SORTS.some(([k]) => k === sort)) setSort(SORTS[0][0]); setStat('all'); setCap(40); }, [show]);
  const stats = statsMode ? [...new Set((ts?.statItems || []).flatMap(x => x.stats.map(y => y.label)))] : [...new Set((ts?.items || []).map(x => x.label))].sort();

  const list = useMemo(() => {
    if (!ts) return [];
    if (statsMode) {
      let l = ts.statItems.filter(x => game === 'all' || x.game?.id === game);
      if (stat !== 'all') l = l.filter(x => x.stats.some(y => y.label === stat));
      const r = x => stat === 'all' ? null : x.stats.find(y => y.label === stat)?.ratio;
      const key = { hot: x => -(r(x) ?? x.hot), cold: x => (r(x) ?? x.cold), name: () => 0 }[sort] || (x => 0);
      return [...l].sort((a, b) => sort === 'name' ? a.player.localeCompare(b.player) : key(a) - key(b));
    }
    let l = ts.items.filter(x => (game === 'all' || x.game.id === game) && (stat === 'all' || x.label === stat));
    if (price === 'long') l = l.filter(x => x.price < 0.4); else if (price === 'mid') l = l.filter(x => x.price >= 0.4 && x.price < 0.7); else if (price === 'fav') l = l.filter(x => x.price >= 0.7);
    if (show === 'edge') l = l.filter(x => x.edge >= 0.08 && x.S.W.l10.n >= 5 && x.price < 0.95 && x.inj?.cls !== 'out');
    const key = { edge: x => -x.edge, l10: x => -(x.S.W.l10.n ? x.S.W.l10.h / x.S.W.l10.n : 0), hot: x => -((x.S.W.d7.avg || 0) / ((x.S.W.season.avg) || 1e9)), price: x => x.price }[sort] || (x => -x.edge);
    return [...l].sort((a, b) => key(a) - key(b));
  }, [ts, show, game, stat, sort, price]);

  const add = it => nav.openEditor({ title: 'New slip from Player trends', drafts: [{ league: lg, kind: 'prop', side: it.side, player: it.player, team: it.ath?.team || '', market: it.label, line: it.line }] });
  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: 60 }}>
      <Fine>Players in today's games, with averages and hot or cold streaks from ESPN game logs. Where Polymarket has a prop, it shows how often the player cleared that exact line and whether the price looks like an edge.</Fine>
      <Chips items={TREND_LEAGUES.map(l => [l, LEAGUES[l].label])} value={lg} onChange={k => { setLg(k); ls.set('tLeague', k); setGame('all'); setStat('all'); }} />
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="View" value={show} onChange={setShow} options={[['stats', 'Player stats'], ['edge', 'Prop edges'], ['all', 'All props']]} />
        <Select style={{ flex: 1 }} label="Sort" value={sort} onChange={setSort} options={SORTS} />
      </Row>
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="Game" value={game} onChange={setGame} options={[['all', "All of today's games"], ...(ts?.games || []).map(g => [g.id, g.name + (g.state === 'in' ? ' (live)' : '')])]} />
        <Select style={{ flex: 1 }} label="Stat" value={stats.includes(stat) ? stat : 'all'} onChange={setStat} options={[['all', 'All stats'], ...stats.map(x => [x, x])]} />
      </Row>
      {!statsMode && <Select label="Price range" value={price} onChange={setPrice} options={[['all', 'Any price'], ['long', 'Longshots (under 40¢)'], ['mid', '40¢–70¢'], ['fav', 'Favorites (70¢+)']]} />}
      <Row><Text style={[T.small, { flex: 1 }]}>{busy ? status || 'Loading…' : ts ? `${statsMode ? ts.statItems.length + ' players' : ts.items.length + ' props checked'} · updated ${ago(ts.at)}` : ''}</Text><Button small kind="ghost" icon="refresh" label="Refresh" busy={busy} onPress={refresh} /></Row>
      {!ts ? <Empty icon="hourglass-outline" title={`Loading ${LEAGUES[lg].label} players…`} body="Pulling today's games and game logs from ESPN. The first load takes a little while." />
        : !list.length ? <Empty icon="search-outline" title={ts.note ? (statsMode ? 'No player stats yet' : 'No props yet') : show === 'edge' ? 'No clear edges right now' : 'Nothing matches'} body={ts.note || (show === 'edge' ? 'Switch View to “All props” to see every line.' : 'Try widening the filters.')} />
          : list.slice(0, cap).map((it, i) => statsMode ? <StatCard key={it.ath?.id || i} it={it} stat={stat} /> : <TrendCard key={it.slug + i} it={it} open={openI === i} onToggle={() => setOpenI(openI === i ? null : i)} onAdd={() => add(it)} />)}
      {list.length > cap && <Button kind="ghost" label={`Show ${Math.min(40, list.length - cap)} more (${list.length - cap} left)`} onPress={() => setCap(c => c + 40)} />}
      <Fine>Past results don't guarantee future ones. Injuries, minutes and matchups matter, so use this as a starting point.</Fine>
    </ScrollView>
  );
}

function HitChip({ label, x }) {
  if (!x || !x.n) return <Text style={st.hr}>{label} –</Text>;
  const r = x.h / x.n; const col = r >= 0.6 ? C.win : r <= 0.4 ? C.loss : C.muted;
  return <Text style={[st.hr, { color: col, borderColor: col + '55' }]}>{label} {x.h}/{x.n}{x.mixed ? '*' : ''}</Text>;
}
function TrendCard({ it, open, onToggle, onAdd }) {
  const S_ = it.S, W = S_.W, ln = Number(it.line);
  const thr = Number.isInteger(ln + 0.5) ? (it.side === 'over' ? (ln + 0.5) + '+' : (ln - 0.5) + ' or fewer') : (it.side === 'over' ? 'over ' : 'under ') + ln;
  const edge = Math.round(it.edge * 100);
  const max = Math.max(ln + 1, ...S_.recent.map(x => x.v)); const hitF = v => it.side === 'under' ? v < ln : v > ln;
  const trend = S_.hot ? (it.side === 'over' ? ['🔥 Trending up', C.accent] : ['⚠ Trending up', C.loss]) : S_.cold ? (it.side === 'under' ? ['❄ Trending down', C.win] : ['❄ Trending down', C.muted]) : null;
  return (
    <Pressable onPress={onToggle} style={st.card}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Row gap={6}><Text style={T.h3} numberOfLines={1}>{it.player}</Text><InjBadge o={it.inj} /></Row>
          <Text style={T.small} numberOfLines={1}>{it.ath?.team} · {it.game.name}</Text>
          <Text style={[T.body, { marginTop: 4 }]}>{it.label} <Text style={{ fontWeight: '800' }}>{thr}</Text>{trend ? <Text style={{ color: trend[1], fontSize: 13 }}>  {trend[0]}</Text> : null}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 0, paddingLeft: S.sm }}>
          <Text style={[T.h2, T.num]}>{Math.round(it.price * 100)}¢</Text>
          <Text style={T.small}>est. {Math.round(S_.p * 100)}% · <Text style={{ color: edge > 0 ? C.win : edge < 0 ? C.loss : C.muted, fontWeight: '700' }}>{edge > 0 ? '+' : ''}{edge}%</Text></Text>
        </View>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <HitChip label="L5" x={W.l5} /><HitChip label="L10" x={W.l10} /><HitChip label="7d" x={W.d7} /><HitChip label="30d" x={W.d30} /><HitChip label="Season" x={W.season} /><HitChip label="Last szn" x={W.last} />
      </View>
      {open && (
        <View style={{ gap: S.sm }}>
          <Text style={T.small}>Averages: season <B>{W.season.avg != null ? W.season.avg.toFixed(1) : '–'}</B> · last 7 days <B>{W.d7.avg != null ? W.d7.avg.toFixed(1) : '–'}</B> · last 10 <B>{W.l10.avg != null ? W.l10.avg.toFixed(1) : '–'}</B> · last season <B>{W.last.avg != null ? W.last.avg.toFixed(1) : '–'}</B></Text>
          {it.inj ? <Text style={{ color: it.inj.cls === 'out' ? C.loss : C.live, fontSize: 13 }}>⚠ Injury report: {it.inj.status}{it.inj.detail ? ' · ' + it.inj.detail : ''}{it.inj.comment ? '. ' + it.inj.comment : ''}</Text> : null}
          {it.teamOut?.length ? <Text style={T.small}>Teammates out: <B>{it.teamOut.slice(0, 6).join(', ')}</B>. That can mean more minutes and shots for this player.</Text> : null}
          <View style={{ height: 70, flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 4 }}>
            {S_.recent.map((x, i) => <View key={i} style={{ flex: 1, height: `${Math.max(5, x.v / max * 100)}%`, backgroundColor: hitF(x.v) ? C.win : C.track, borderRadius: 3 }} />)}
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: `${ln / max * 100}%`, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink + '88' }} />
          </View>
          <Fine>Last {S_.recent.length} games, oldest to newest. Green cleared the line. Dashed line = {ln}.{(W.l10.mixed || W.l5.mixed) ? ' * includes last season.' : ''}</Fine>
          <Fine>Price is what it costs to buy {it.side === 'over' ? 'Yes' : 'No'} on Polymarket right now ({Math.round(it.price * 100)}% implied).{it.wide ? ' ⚠ Thin market: buy and sell prices are far apart, so the price may move when you trade.' : ''} Estimate blends the hit rates above, weighted toward recent games.</Fine>
          <Button small icon="add" label="Add to a slip" onPress={onAdd} />
        </View>
      )}
    </Pressable>
  );
}
const B = ({ children }) => <Text style={{ color: C.ink, fontWeight: '700' }}>{children}</Text>;
function StatCard({ it, stat }) {
  const show = stat === 'all' ? it.stats : it.stats.filter(x => x.label === stat);
  const f = v => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(v >= 100 ? 0 : 1));
  const flag = it.hot >= 1.25 ? ['🔥 Hot', C.accent] : it.cold <= 0.75 ? ['❄ Cold', C.muted] : null;
  return (
    <View style={st.card}>
      <Row gap={6} style={{ flexWrap: 'wrap' }}><Text style={T.h3}>{it.player}</Text><InjBadge o={it.inj} />{flag ? <Text style={{ color: flag[1], fontSize: 13, fontWeight: '700' }}>{flag[0]}</Text> : null}</Row>
      <Text style={T.small}>{it.ath?.team}{it.ath?.pos ? ' ' + it.ath.pos : ''} · {it.game?.name} · {it.stats[0]?.games || 0} games this season{it.hasProp ? ' · has Polymarket props' : ''}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {show.map(x => (
          <View key={x.label} style={{ minWidth: '30%', flexGrow: 1, backgroundColor: C.sunk, borderRadius: 10, padding: S.sm }}>
            <Text style={T.tiny}>{x.label}</Text>
            <Text style={[T.h2, T.num]}>{f(x.season ?? x.last)}</Text>
            <Text style={[T.small, { fontSize: 11 }]}>L5 {f(x.l5)} · 7d {f(x.d7)}</Text>
            {x.ratio >= 1.2 ? <Text style={{ color: C.win, fontSize: 11, fontWeight: '700' }}>▲ {Math.round((x.ratio - 1) * 100)}%</Text> : x.ratio <= 0.8 ? <Text style={{ color: C.loss, fontSize: 11, fontWeight: '700' }}>▼ {Math.round((1 - x.ratio) * 100)}%</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ===================== Injuries & news ===================== */
const NEWS_LEAGUES = Object.keys(LEAGUES).filter(l => LEAGUES[l].path);
export function NewsScreen() {
  const [lg, setLg] = useState('nba'); const [scope, setScope] = useState('today'); const [showK, setShowK] = useState('both');
  const [statusF, setStatusF] = useState('all'); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [, bump] = useState(0);
  useEffect(() => { ls.get('nLeague', 'nba').then(setLg); }, []);
  const load = async force => { setBusy(true); try { await Promise.all([leagueInjuries(lg, force), leagueNews(lg, force), loadBoard(lg, etDay()).catch(() => [])]); } finally { setBusy(false); bump(x => x + 1); } };
  useEffect(() => { load(false); }, [lg]);
  const inj = injCache.get(lg)?.data, news = newsCache.get(lg)?.data || [];
  const nq = q.trim().toLowerCase();
  const keepInj = o => (statusF === 'all' || o.cls === statusF) && (!nq || (o.name + ' ' + o.team).toLowerCase().includes(nq));
  const keepNews = a => !nq || (a.head + ' ' + a.desc).toLowerCase().includes(nq);
  const Head = ({ a }) => <Pressable onPress={() => a.url && Linking.openURL(a.url)} style={{ paddingVertical: 6 }}><Text style={{ color: a.flag ? C.live : C.ink, fontSize: 14, lineHeight: 19 }}>{a.flag ? '⚠ ' : ''}{a.head} <Text style={T.small}>{ago(a.at)}</Text></Text></Pressable>;
  const team = (teamId, teamName) => {
    const list = (inj?.byTeam.get(String(teamId))?.list || []).filter(keepInj).sort((a, b) => ({ out: 0, gtd: 1, ok: 2 }[a.cls]) - ({ out: 0, gtd: 1, ok: 2 }[b.cls]));
    const heads = news.filter(a => a.teams.includes(String(teamId)) && keepNews(a)).sort((a, b) => (b.flag - a.flag) || (b.at - a.at)).slice(0, 4);
    if (nq && !list.length && !heads.length) return null;
    return (
      <View key={teamId} style={{ gap: 6, paddingTop: S.sm }}>
        <Text style={T.h3}>{teamName}</Text>
        {showK !== 'news' && (list.length ? list.map((o, i) => (
          <View key={o.name + i} style={{ gap: 2 }}>
            <Row gap={6} style={{ flexWrap: 'wrap' }}><InjBadge o={o} /><Text style={[T.body, { fontWeight: '700' }]}>{o.name}</Text><Text style={T.small}>{o.pos}{o.detail ? ' · ' + o.detail : ''}</Text></Row>
            {o.comment ? <Text style={T.small}>{o.comment.length > 220 ? o.comment.slice(0, 218) + '…' : o.comment}{o.date ? ' · ' + ago(Date.parse(o.date)) : ''}</Text> : null}
          </View>
        )) : <Fine>{inj?.ok ? 'No injuries listed.' : "ESPN doesn't publish an injury report for this league. Check the headlines."}</Fine>)}
        {showK !== 'inj' && heads.map((a, i) => <Head key={i} a={a} />)}
      </View>
    );
  };
  let body;
  const games = (boards[lg] || []).filter(g => etDay(g.date) === etDay()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (!inj && !news.length) body = <Empty icon="hourglass-outline" title={`Loading ${LEAGUES[lg].label}`} body="Injury reports and headlines are on their way." />;
  else if (scope === 'today') {
    body = !games.length ? <Empty icon="calendar-outline" title={`No ${LEAGUES[lg].label} games today`} body="Switch Teams to “All teams” to see every injury report and headline." />
      : games.map(g => {
        const inner = g.teams.map(t => team(t.id, t.name || t.abbr)).filter(Boolean); if (!inner.length) return null;
        return <View key={g.id} style={st.card}><Row><Text style={T.h2}>{g.name}</Text><Spacer /><Text style={T.small}>{g.state === 'pre' ? new Date(g.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : g.detail}</Text></Row>{inner}</View>;
      });
  } else {
    const teams = new Map(); inj?.byTeam.forEach((v, k) => teams.set(k, v.name));
    const general = showK === 'inj' ? [] : news.filter(a => !a.teams.length && keepNews(a)).slice(0, 8);
    body = <>
      {general.length ? <View style={st.card}><Text style={T.h2}>League headlines</Text>{general.map((a, i) => <Head key={i} a={a} />)}</View> : null}
      {[...teams].filter(([, n]) => n).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => { const b = team(id, n); return b ? <View key={id} style={st.card}>{b}</View> : null; })}
    </>;
  }
  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: 60 }}>
      <Fine>Injury reports and recent headlines from ESPN for every team playing today. Headlines about injuries, minutes limits or rest are highlighted.</Fine>
      <Chips items={NEWS_LEAGUES.map(l => [l, LEAGUES[l].label])} value={lg} onChange={k => { setLg(k); ls.set('nLeague', k); }} />
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="Teams" value={scope} onChange={setScope} options={[['today', 'Playing today'], ['all', 'All teams']]} />
        <Select style={{ flex: 1 }} label="Show" value={showK} onChange={setShowK} options={[['both', 'Injuries + headlines'], ['inj', 'Injuries only'], ['news', 'Headlines only']]} />
      </Row>
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="Status" value={statusF} onChange={setStatusF} options={[['all', 'Any status'], ['out', 'Out only'], ['gtd', 'Questionable / day-to-day']]} />
        <View style={{ flex: 1 }}><Field label="Search" placeholder="Player or team" value={q} onChangeText={setQ} /></View>
      </Row>
      <Row><Text style={[T.small, { flex: 1 }]}>{injCache.get(lg) ? 'Updated ' + ago(injCache.get(lg).at) : ''}</Text><Button small kind="ghost" icon="refresh" label="Refresh" busy={busy} onPress={() => load(true)} /></Row>
      {body}
    </ScrollView>
  );
}

/* ===================== Value parlays ===================== */
export function ValueScreen() {
  const { slips, uid, me, actions } = useApp();
  const nav = useNav();
  const [lg, setLg] = useState('nba');
  useEffect(() => { ls.get('ppLeague', 'nba').then(setLg); ls.get('picks', null).then(p => p && setTeam(p)); }, []);
  const { ts, status, busy, refresh } = useTrend(lg);
  const pp = useMemo(() => ts ? buildPropParlays(ts) : null, [ts]);
  const [team, setTeam] = useState(null); const [teamBusy, setTeamBusy] = useState(false); const [teamStatus, setTeamStatus] = useState('');
  const day = etDay().replace(/-/g, '');

  // Track the model's top picks as "Model" slips, like the web app
  const logModel = async (id, data) => {
    if (slips.some(s => s.id === id)) return;
    if (await fb.exists(`groups/${me.group}/slips/${id}`)) return;
    await actions.setSlip(id, { uid, name: 'Model', source: 'model', createdAt: fb.SERVER_TIME, stake: 10, status: 'open', ...data }).catch(() => {});
  };
  useEffect(() => {
    if (!pp?.list?.length) return;
    pp.list.filter(x => !x.alt).slice(0, 2).forEach((p, i) => logModel(`mprop_${day}_${lg}_${i + 1}`, { modelKind: 'props', payout: Math.round(10 * p.dec * 100) / 100, odds: decToAm(p.dec),
      legs: p.legs.map(x => ({ league: lg, kind: 'prop', side: x.side, player: x.player, team: x.ath?.team || null, market: x.label, line: x.line, gameId: x.game.id, result: null })) }));
  }, [pp]);
  const scanTeams = async () => {
    setTeamBusy(true); setTeamStatus("Checking today's games…");
    try {
      const r = await findTeamValue(setTeamStatus); setTeam(r); ls.set('picks', r); setTeamStatus('');
      r.parlays.slice(0, 2).forEach((p, i) => logModel(`model_${day}_${i + 1}`, { payout: Math.round(10 * p.dec * 100) / 100, odds: decToAm(p.dec),
        legs: p.legs.map(l => ({ league: l.league, kind: 'moneyline', side: 'over', team: l.team, player: null, market: null, line: null, gameId: l.gameId, result: null })) }));
    } catch (e) { setTeamStatus("Couldn't finish the scan. Try again in a minute."); }
    finally { setTeamBusy(false); }
  };
  const model = slips.filter(s => s.source === 'model'); const t = tally(model);
  const tp = tally(model.filter(s => s.modelKind === 'props')), tt = tally(model.filter(s => s.modelKind !== 'props'));

  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, gap: S.xl, paddingBottom: 60 }}>
      <Section title="Player prop parlays" sub="Built from Player trends edges: props where the player's hit rate on that exact line beats Polymarket's price. Injured players are skipped, and each parlay uses at most 2 legs from the same game.">
        <Chips items={TREND_LEAGUES.map(l => [l, LEAGUES[l].label])} value={lg} onChange={k => { setLg(k); ls.set('ppLeague', k); }} />
        <Row><Text style={[T.small, { flex: 1 }]}>{busy ? status || 'Checking props…' : pp ? `${pp.candidates} props with an edge · updated ${ago(ts.at)}` : ''}</Text><Button small kind="ghost" icon="refresh" label="Refresh" busy={busy} onPress={refresh} /></Row>
        {!pp ? <Empty icon="hourglass-outline" title={`Checking ${LEAGUES[lg].label} props…`} body="Pulling Player trends data." />
          : !pp.list.length ? <Empty icon="flash-off-outline" title="No prop parlays right now" body={ts.note || 'Not enough props beat their prices today. Check back closer to tip-off, when lines move.'} />
            : pp.list.map((p, i) => (
              <View key={i} style={st.card}>
                <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, paddingRight: S.sm }}><Row><Text style={[T.h2, { flexShrink: 1 }]}>{p.name}</Text>{p.alt ? <Tag label="ALT" /> : null}</Row><Text style={T.small}>{p.blurb}</Text></View><Pill tone="won" label={p.dec.toFixed(1) + 'x'} /></Row>
                {p.legs.map((x, j) => (
                  <View key={j} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
                    <Row style={{ alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}><Text style={T.h3}>{x.player}</Text><Text style={T.small}>{legLine(x)} · {x.game.name}</Text></View>
                      <View style={{ alignItems: 'flex-end' }}><Text style={[T.h3, T.num]}>{Math.round(x.price * 100)}¢</Text><Text style={T.small}>est. {Math.round(x.S.p * 100)}%</Text></View>
                    </Row>
                    <Text style={[T.small, { marginTop: 2 }]}>L10 {x.S.W.l10.h}/{x.S.W.l10.n} · season {x.S.W.season.n ? x.S.W.season.h + '/' + x.S.W.season.n : '–'} · <Text style={{ color: C.win, fontWeight: '700' }}>+{Math.round(x.edge * 100)} pts</Text>{x.S.hot && x.side === 'over' ? ' · 🔥 trending up' : ''}</Text>
                  </View>
                ))}
                <Text style={T.small}>Costs {Math.round(p.price * 100)}¢ per $1 payout ({decToAm(p.dec)}) · chance all hit {(p.prob * 100).toFixed(1)}% · expected return {p.ev >= 0 ? '+' : ''}{Math.round(p.ev * 100)}%</Text>
                <Button small icon="add" label="Add to a slip" onPress={() => nav.openEditor({ title: p.name + ' from Value parlays', odds: decToAm(p.dec),
                  drafts: p.legs.map(x => ({ league: lg, kind: 'prop', side: x.side, player: x.player, team: x.ath?.team || '', market: x.label, line: x.line })) })} />
              </View>
            ))}
        {pp?.list?.length ? <Fine>Estimates treat legs as independent. Two legs from the same game can move together. Polymarket prices a combo on its own, so check the real combo price before you buy.</Fine> : null}
      </Section>

      <Section title="Team longshots: high risk, high reward" sub="Compares DraftKings' odds with ESPN's win-probability model and the Polymarket price for the same game. When those estimates say a team wins more often than the odds imply, that's a value spot. These are estimates, not sure things. Longshots lose most of the time, even when the price is good.">
        <Row><Text style={[T.small, { flex: 1 }]}>{teamBusy ? teamStatus : team ? (team.day !== etDay() ? 'Last scan was an earlier day. Scan again for today.' : `Checked ${team.games} games ${ago(team.at)}`) : teamStatus}</Text></Row>
        <Button icon="search" label="Find today's value" busy={teamBusy} onPress={scanTeams} />
        {!team ? <Empty icon="flash-outline" title="Nothing scanned yet" body="Tap “Find today's value” to check today's games." />
          : !team.parlays.length ? <Empty icon="flash-off-outline" title="No good longshots right now" body="None of today's prices beat the estimates by enough. Check again closer to game time, when lines move." />
            : team.parlays.map((p, i) => (
              <View key={i} style={st.card}>
                <Row><Text style={T.h2}>{p.legs.length}-leg longshot</Text><Tag label={i < 2 ? 'TRACKED' : 'IDEA'} color={i < 2 ? C.accent : undefined} /></Row>
                <Text style={T.small}>Pays <B>{decToAm(p.dec)}</B> · $10 → <B>{money(10 * p.dec)}</B></Text>
                {p.legs.map((l, j) => (
                  <View key={j} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
                    <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, paddingRight: S.sm }}><Text style={T.h3}>{l.team}</Text><Text style={T.small}>To win vs {l.opp} · {LEAGUES[l.league].label} · {new Date(l.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></View><View style={{ alignItems: 'flex-end', flexShrink: 0 }}><Text style={[T.h3, T.num]}>{amS(l.ml)}</Text><Text style={T.small}>DraftKings</Text></View></Row>
                    <Text style={T.small}>Odds imply {pctS(l.fair)} · ESPN {pctS(l.espn)} · Polymarket {pctS(l.poly)} · <Text style={{ color: C.win, fontWeight: '700' }}>+{Math.round(l.edge * 100)} pts</Text></Text>
                  </View>
                ))}
                <Text style={T.small}>Estimated chance all hit: {(p.p * 100).toFixed(1)}% · expected return {p.ev >= 0 ? '+' : ''}{Math.round(p.ev * 100)}% per bet</Text>
                <Button small kind="ghost" label="Tail this" onPress={() => nav.openEditor({ title: 'Tail this parlay. Check the odds on your app first', stake: 10, odds: decToAm(p.dec), payout: Math.round(10 * p.dec * 100) / 100,
                  drafts: p.legs.map(l => ({ league: l.league, kind: 'moneyline', team: l.team, side: 'over' })) })} />
              </View>
            ))}
        {team?.spots?.length ? (
          <View style={[st.card, { gap: 0, padding: 0 }]}>
            <Text style={[T.tiny, { padding: S.md }]}>Value spots</Text>
            {team.spots.slice(0, 15).map((s, i) => (
              <Row key={i} style={{ paddingHorizontal: S.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
                <View style={{ flex: 1 }}><Text style={T.h3} numberOfLines={1}>{s.team}</Text><Text style={T.small} numberOfLines={1}>vs {s.opp} · {LEAGUES[s.league].label} · {amS(s.ml)}</Text></View>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[T.small, { width: 92, textAlign: 'right' }]}>{pctS(s.fair)} → {pctS((s.espn ?? s.poly))}</Text>
                <Text style={{ width: 44, textAlign: 'right', color: C.win, fontWeight: '800' }}>+{Math.round(s.edge * 100)}</Text>
              </Row>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="Model's track record">
        <Grid>
          <Stat label="Record" value={`${t.w}-${t.l}`} sub={`${model.filter(s => s.status === 'open').length} still open`} />
          <Stat label="Profit ($10 per pick)" value={signed(t.profit)} tone={t.profit > 0 ? 'won' : t.profit < 0 ? 'lost' : null} sub={'ROI ' + pctS(t.roi)} />
          <Stat label="Legs hit" value={pctS(t.legPct)} sub={`${t.legsW} of ${t.legsT}`} />
          <Stat label="Prop parlays" value={`${tp.w}-${tp.l}`} sub={`${signed(tp.profit)} · legs ${pctS(tp.legPct)}`} />
          <Stat label="Team longshots" value={`${tt.w}-${tt.l}`} sub={`${signed(tt.profit)} · legs ${pctS(tt.legPct)}`} />
        </Grid>
      </Section>
    </ScrollView>
  );
}

const st = {
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: S.lg, gap: S.sm },
  hr: { fontSize: 11, fontWeight: '700', color: C.muted, borderWidth: 1, borderColor: C.line, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
};
