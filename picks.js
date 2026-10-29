// Picks engine: player trends from ESPN game logs vs Polymarket US prop prices,
// prop parlays built from those edges, and team longshots (DraftKings vs ESPN model vs Polymarket).
import { LEAGUES, ESPN, sportOf, sameName, marketFor, valueSides, buildParlays, polySlugs, norm } from './core';
import { getJSON, pool, etDay, loadBoard, teamRoster, leagueInjuries, injFor } from './espn';
import { pmToLeg } from './poly';

export const TREND_LEAGUES = ['nba', 'wnba', 'nfl', 'ncaafb', 'ncaamb', 'nhl', 'mlb'];
export const PICK_LEAGUES = ['nba', 'nfl', 'ncaafb', 'ncaamb', 'wnba', 'ncaawb', 'nhl', 'mlb'];
const PMUS_LEAGUE = { nba: 'nba', wnba: 'wnba', nfl: 'nfl', ncaafb: 'cfb', ncaamb: 'cbb', mlb: 'mlb', nhl: 'nhl' };
const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/';
export const KEY_STATS = {
  bball: [['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST'], ['threePointFieldGoalsMade', '3PM'], ['steals', 'STL'], ['blocks', 'BLK']],
  fball: [['passingYards', 'Pass yds'], ['passingTouchdowns', 'Pass TD'], ['rushingYards', 'Rush yds'], ['receivingYards', 'Rec yds'], ['receptions', 'Rec'], ['totalTackles', 'Tackles']],
  hock: [['goals', 'Goals'], ['assists', 'Assists'], ['points', 'Points'], ['shotsTotal|shots', 'Shots'], ['saves', 'Saves']],
  base: [['hits', 'Hits'], ['homeRuns', 'HR'], ['RBIs', 'RBI'], ['runs', 'Runs'], ['strikeouts', 'K']],
};
export const trendCache = new Map();   // league -> scan result
const logCache = new Map();

function splitStats(names, vals) {
  const o = {};
  names.forEach((k, i) => {
    const raw = vals[i]; if (raw == null || raw === '') return;
    const ks = String(k).split('-'), vs = String(raw).split('-');
    if (ks.length > 1 && ks.length === vs.length) ks.forEach((kk, j) => { const n = parseFloat(vs[j]); if (!isNaN(n)) o[kk] = n; });
    else { const n = parseFloat(raw); if (!isNaN(n)) o[k] = n; }
  });
  if (o.totalRebounds != null && o.rebounds == null) o.rebounds = o.totalRebounds;
  if (o.threePointFieldGoalsMade == null && o.threePointersMade != null) o.threePointFieldGoalsMade = o.threePointersMade;
  return o;
}
function parseLog(d) {
  const meta = d.events || {}, byId = new Map();
  for (const st of d.seasonTypes || []) {
    if (/pre\s*season|preseason/i.test(st.displayName || '')) continue;
    for (const c of st.categories || []) for (const ev of c.events || []) {
      const o = splitStats(c.names || d.names || [], ev.stats || []); const prev = byId.get(ev.eventId);
      if (prev) Object.assign(prev.o, o); else byId.set(ev.eventId, { id: ev.eventId, t: Date.parse(meta[ev.eventId]?.gameDate) || 0, opp: meta[ev.eventId]?.opponent?.abbreviation || '', o });
    }
  }
  return [...byId.values()].sort((a, b) => b.t - a.t);
}
async function playerLog(lg, id) {
  const ck = lg + ':' + id; const c = logCache.get(ck); if (c && Date.now() - c.at < 30 * 60000) return c;
  const base = ESPN_WEB + LEAGUES[lg].path + '/athletes/' + id + '/gamelog';
  const d = await getJSON(base);
  const cur = parseLog(d); let prev = [];
  const sf = (d.filters || []).find(f => f.name === 'season'); const opts = sf?.options || [];
  const curSeason = sf?.value || opts[0]?.value;
  const prevSeason = opts.map(o => o.value).find(v => String(v) !== String(curSeason)) || (curSeason ? String(Number(curSeason) - 1) : null);
  if (prevSeason && cur.length < 25) { const pd = await getJSON(base + '?season=' + prevSeason).catch(() => null); if (pd) prev = parseLog(pd); }
  const out = { at: Date.now(), cur, prev }; logCache.set(ck, out); return out;
}
const statVal = (o, keys) => { let t = 0; for (const k of keys) { const v = o[k] ?? o[String(k).split('.').pop()]; if (v == null) return null; t += v; } return t; };
export function lineStats(log, keys, line, side) {
  const now = Date.now();
  const vals = rows => rows.map(r => ({ v: statVal(r.o, keys), t: r.t, opp: r.opp })).filter(x => x.v != null);
  const cur = vals(log.cur), prev = vals(log.prev);
  const hit = v => side === 'under' ? v < line : v > line;
  const w = rows => ({ n: rows.length, h: rows.filter(x => hit(x.v)).length, avg: rows.length ? rows.reduce((m, x) => m + x.v, 0) / rows.length : null });
  const W = { l5: w(cur.slice(0, 5)), l10: w(cur.slice(0, 10)), d7: w(cur.filter(x => x.t >= now - 7 * 864e5)), d30: w(cur.filter(x => x.t >= now - 30 * 864e5)), season: w(cur), last: w(prev) };
  if (W.l10.n < 10 && prev.length) { W.l10 = w([...cur, ...prev].slice(0, 10)); W.l10.mixed = true; }
  if (W.l5.n < 5 && prev.length) { W.l5 = w([...cur, ...prev].slice(0, 5)); W.l5.mixed = true; }
  const wt = { l10: [0.35, 10], season: [0.25, 10], last: [0.15, 25], l5: [0.15, 5], d30: [0.10, 6] }; let sw = 0, sp = 0;
  for (const [k, [wgt, full]] of Object.entries(wt)) { const x = W[k]; if (!x.n) continue; const ww = wgt * Math.min(1, x.n / full); sw += ww; sp += ww * (x.h / x.n); }
  const raw = sw ? sp / sw : null; const eff = Math.min(30, W.season.n + W.last.n);
  const p = raw == null ? null : Math.min(0.97, Math.max(0.03, (raw * eff + 0.5 * 4) / (eff + 4)));
  const recent = [...cur, ...prev].slice(0, 10).reverse();
  return { W, p, eff, recent, hot: W.d7.n >= 2 && W.season.avg > 0 && W.d7.avg / W.season.avg >= 1.25, cold: W.d7.n >= 2 && W.season.avg > 0 && W.d7.avg / W.season.avg <= 0.75 };
}
function statSummary(log, sport) {
  const now = Date.now(), out = [];
  for (const [keyAlt, label] of KEY_STATS[sport] || []) {
    const keys = keyAlt.split('|'); const val = o => { for (const k of keys) if (o[k] != null) return o[k]; return null; };
    const cur = log.cur.map(r => ({ v: val(r.o), t: r.t })).filter(x => x.v != null), prev = log.prev.map(r => ({ v: val(r.o) })).filter(x => x.v != null);
    const avg = a => a.length ? a.reduce((m, x) => m + x.v, 0) / a.length : null;
    const season = avg(cur), last = avg(prev), base = season ?? last;
    if (!base && !avg(cur.slice(0, 5))) continue;
    const l5 = avg(cur.slice(0, 5)), d7 = avg(cur.filter(x => x.t >= now - 7 * 864e5));
    const ref = d7 ?? l5; const ratio = base > 0 && ref != null ? ref / base : 1;
    out.push({ label, season, last, l5, d7, games: cur.length, ratio });
  }
  return out;
}
async function pmEventForGame(lg, g) {
  const pl = PMUS_LEAGUE[lg]; if (!pl) return null;
  const ab = t => ({ utah: 'uta', wsh: 'was' })[String(t.abbr || '').toLowerCase()] || String(t.abbr || '').toLowerCase();
  const away = g.teams.find(t => !t.home) || g.teams[0], home = g.teams.find(t => t.home) || g.teams[1]; if (!away || !home) return null;
  const day = etDay(g.date);
  for (const slug of [`${pl}-${ab(away)}-${ab(home)}-${day}`, `${pl}-${ab(home)}-${ab(away)}-${day}`]) {
    const r = await getJSON('https://gateway.polymarket.us/v1/events/slug/' + slug).catch(() => null);
    const ev = r?.event || r; if (ev && Array.isArray(ev.markets)) return ev;
  }
  return null;
}
function propFromMarket(m) {
  if (!/player/.test(String(m.sportsMarketType || '')) || m.closed || m.active === false) return null;
  if (m.status && !/OPEN/i.test(String(m.status))) return null;
  const mk = { slug: m.slug, q: m.question || '', short: m.titleShort || m.title || '', title: m.title || '', line: m.line != null ? Number(m.line) : null, type: String(m.sportsMarketType || '').toLowerCase(),
    sides: (m.marketSides || []).map(x => ({ d: x.description || '', long: !!x.long, team: '', teamName: '' })) };
  const leg = pmToLeg(mk, 'SIDE_BUY', m.title); if (leg.kind !== 'prop') return null;
  const yes = (m.marketSides || []).find(x => x.long), no = (m.marketSides || []).find(x => !x.long);
  const canBuy = side => side && side.tradable !== false && Number(side.quote?.value) > 0 && Number(side.quote?.value) < 1;
  const py = canBuy(yes) ? Number(yes.quote.value) : NaN, pn = canBuy(no) ? Number(no.quote.value) : NaN;
  if (!(py > 0) && !(pn > 0)) return null;
  const spread = py > 0 && pn > 0 ? (py + pn) - 1 : (py > 0 ? py - Number(yes?.price || 0) : pn - Number(no?.price || 0));
  return { ...leg, slug: m.slug, title: m.titleShort || m.title, pYes: py, pNo: pn, wide: spread > 0.12 };
}

const scanning = new Map();
export async function scanTrends(lg, onStatus = () => {}) {
  if (scanning.has(lg)) return scanning.get(lg);
  const job = (async () => {
    try {
      onStatus("Loading today's games…");
      const today = etDay();
      const games = (await loadBoard(lg, today).catch(() => [])).filter(g => etDay(g.date) === today && g.state !== 'post');
      if (!games.length) return { lg, day: today, at: Date.now(), items: [], statItems: [], games: [], note: 'No ' + LEAGUES[lg].label + ' games left today.' };
      onStatus(`Finding player props for ${games.length} game${games.length === 1 ? '' : 's'}…`);
      const evs = await pool(games, 4, g => pmEventForGame(lg, g));
      const props = []; games.forEach((g, i) => (evs[i]?.markets || []).forEach(m => { const p = propFromMarket(m); if (p) props.push({ ...p, game: g }); }));
      const rosters = {}; await pool(games, 4, async g => { for (const t of g.teams) rosters[g.id + ':' + t.id] = await teamRoster(lg, t.id); });
      const findAth = (name, g) => { for (const t of g.teams) { const a = (rosters[g.id + ':' + t.id] || []).find(x => sameName(x.name, name)); if (a) return { ...a, team: t.abbr }; } return null; };
      const ath = new Map(); props.forEach(p => { const a = findAth(p.player, p.game); if (a) { p.ath = a; ath.set(String(a.id), { ...a, game: p.game }); } });
      const raw = await getJSON(ESPN + LEAGUES[lg].path + '/scoreboard?dates=' + today.replace(/-/g, '')).catch(() => null);
      for (const e of raw?.events || []) {
        const g = games.find(x => x.id === e.id); if (!g) continue; const comp = e.competitions?.[0] || {};
        const groups = [...(comp.leaders || []), ...(comp.competitors || []).flatMap(c => (c.leaders || []).map(L => ({ ...L, team: c.team })))];
        for (const L of groups) for (const x of (L.leaders || []).slice(0, 2)) {
          const a = x.athlete; if (!a?.id || ath.has(String(a.id))) continue;
          const tm = x.team || L.team || a.team || {}; const t = g.teams.find(tt => String(tt.id) === String(tm.id)) || null;
          ath.set(String(a.id), { id: String(a.id), name: a.displayName || a.fullName, pos: a.position?.abbreviation || '', team: t?.abbr || tm.abbreviation || '', game: g });
        }
      }
      if (ath.size < games.length * 4) for (const g of games) for (const t of g.teams) (rosters[g.id + ':' + t.id] || []).slice(0, 5).forEach(a => { if (!ath.has(String(a.id))) ath.set(String(a.id), { ...a, team: t.abbr, game: g }); });
      const ids = [...ath.keys()]; let done = 0;
      await pool(ids, 6, async id => { await playerLog(lg, id).catch(() => null); done++; if (done % 5 === 0 || done === ids.length) onStatus(`Reading game logs… ${done}/${ids.length} players`); });
      const injData = await leagueInjuries(lg).catch(() => null);
      const items = [];
      for (const p of props) {
        if (!p.ath) continue; const log = logCache.get(lg + ':' + p.ath.id); if (!log) continue;
        const mk = marketFor(lg, p.market); if (!mk) continue;
        const over = lineStats(log, mk.keys, Number(p.line), 'over'), under = lineStats(log, mk.keys, Number(p.line), 'under');
        if (over.p == null) continue;
        const eo = p.pYes > 0 ? over.p - p.pYes : -1, eu = (under.p != null && p.pNo > 0) ? under.p - p.pNo : -1;
        if (eo === -1 && eu === -1) continue;
        const pickUnder = p.pYes > 0 ? (eu > eo && eu > 0.05) : true;
        const S = pickUnder ? under : over, price = pickUnder ? p.pNo : p.pYes;
        const teamOut = injData ? (injData.byTeam.get(String(p.game.teams.find(t => t.abbr === p.ath.team)?.id))?.list || []).filter(o => o.cls === 'out' && !sameName(o.name, p.player)).map(o => o.name) : [];
        items.push({ ...p, side: pickUnder ? 'under' : 'over', price, S, edge: S.p - price, label: mk.label, keys: mk.keys, inj: injFor(lg, p.player), teamOut });
      }
      const sport = sportOf(lg); const statItems = [];
      for (const a of ath.values()) {
        const log = logCache.get(lg + ':' + a.id); if (!log) continue; const sm = statSummary(log, sport); if (!sm.length) continue;
        statItems.push({ player: a.name, ath: a, game: a.game, stats: sm, inj: injFor(lg, a.name), hot: Math.max(...sm.map(x => x.ratio)), cold: Math.min(...sm.map(x => x.ratio)), hasProp: props.some(p => p.ath?.id === a.id) });
      }
      return { lg, day: today, at: Date.now(), items, statItems, games, note: props.length ? '' : "Polymarket doesn't have player props for today's " + LEAGUES[lg].label + ' games yet, so only player stats are shown.' };
    } catch (e) {
      return { lg, day: etDay(), at: Date.now(), items: [], statItems: [], games: [], note: "Couldn't load players right now (" + (e.message || e) + '). Tap Refresh to try again.' };
    }
  })();
  scanning.set(lg, job);
  try { const r = await job; trendCache.set(lg, r); return r; } finally { scanning.delete(lg); }
}

/* ---------- Prop parlays ---------- */
function propCandidates(ts) {
  const best = new Map();
  for (const x of ts?.items || []) {
    if (x.edge < 0.05 || x.edge > 0.35 || x.wide || x.S.W.l10.n < 5 || x.price < 0.15 || x.price > 0.92) continue;
    if (x.inj && x.inj.cls !== 'ok') continue;
    const k = norm(x.player); if (!best.has(k) || best.get(k).edge < x.edge) best.set(k, x);
  }
  return [...best.values()];
}
export function buildPropParlays(ts) {
  const c = propCandidates(ts); const out = []; const seen = new Set();
  const make = (pl, n, skip) => {
    const legs = [], games = {};
    for (const x of pl.slice(skip)) { if (legs.length >= n) break; const g = x.game.id; if ((games[g] || 0) >= 2) continue; if (legs.some(l => norm(l.player) === norm(x.player))) continue; legs.push(x); games[g] = (games[g] || 0) + 1; }
    if (legs.length < n) return null;
    const price = legs.reduce((m, x) => m * x.price, 1), prob = legs.reduce((m, x) => m * x.S.p, 1), dec = 1 / price;
    return { legs, price, prob, dec, ev: prob * dec - 1 };
  };
  const T = [
    { name: 'Steady 2-leg', blurb: 'Two of the most reliable lines on the board.', n: 2, pool: [...c].filter(x => x.S.p >= 0.62 && x.price >= 0.5).sort((a, b) => b.S.p - a.S.p || b.edge - a.edge) },
    { name: 'Value 3-leg', blurb: 'The three biggest edges, spread across games.', n: 3, pool: [...c].sort((a, b) => b.edge - a.edge) },
    { name: 'Big swing 4-leg', blurb: 'Bigger payout. Still positive by the estimate, but expect it to miss more often than not.', n: 4, pool: [...c].sort((a, b) => (b.edge / b.price) - (a.edge / a.price)) },
  ];
  for (const t of T) for (let skip = 0; skip < 3; skip++) {
    const p = make(t.pool, t.n, skip); if (!p || p.ev <= 0.05) continue;
    const key = p.legs.map(l => l.slug).sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    out.push({ ...t, ...p, alt: skip > 0 }); if (out.filter(o => o.name === t.name).length >= 2) break;
  }
  return { list: out, candidates: c.length };
}
export function legLine(x) { const ln = Number(x.line); return Number.isInteger(ln + 0.5) ? (x.side === 'over' ? `${ln + 0.5}+ ${x.label}` : `${ln - 0.5} or fewer ${x.label}`) : `${x.side} ${ln} ${x.label}`; }

/* ---------- Team longshots ---------- */
async function polyMoneyline(league, g) {
  for (const slug of polySlugs(league, g)) {
    try {
      const ev = (await getJSON('https://gamma-api.polymarket.com/events?slug=' + encodeURIComponent(slug)))[0]; if (!ev) continue;
      const m = (ev.markets || []).find(x => x.sportsMarketType === 'moneyline' && !x.closed) || (ev.markets || []).find(x => x.question === ev.title);
      if (!m) continue;
      const outs = JSON.parse(m.outcomes || '[]'), prices = JSON.parse(m.outcomePrices || '[]').map(Number);
      const find = team => { const i = outs.findIndex(o => { const n = norm(o); return n && (norm(team.nick) === n || norm(team.name).includes(n)); }); return i >= 0 ? prices[i] : null; };
      const pa = find(g.awayT), ph = find(g.homeT);
      if (pa != null && ph != null && pa + ph > 0.5) return { pa: pa / (pa + ph), ph: ph / (pa + ph) };
    } catch (e) {}
  }
  return null;
}
async function scanLeagueOdds(lg) {
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/scoreboard').catch(() => null); if (!d) return [];
  const soon = Date.now() + 30 * 3600e3;
  const evs = (d.events || []).filter(e => e.status?.type?.state === 'pre' && Date.parse(e.date) < soon);
  const games = await Promise.all(evs.map(async e => {
    const comps = e.competitions?.[0]?.competitors || [];
    const A = comps.find(c => c.homeAway === 'away')?.team, H = comps.find(c => c.homeAway === 'home')?.team; if (!A || !H) return null;
    const s = await getJSON(ESPN + LEAGUES[lg].path + '/summary?event=' + e.id).catch(() => null); if (!s) return null;
    const pc = (s.pickcenter || []).find(p => p.homeTeamOdds?.moneyLine != null && p.awayTeamOdds?.moneyLine != null); if (!pc) return null;
    const pr = s.predictor; const pct = v => { const n = parseFloat(v); return isNaN(n) ? null : n / 100; };
    const g = { id: e.id, league: lg, name: e.shortName, date: e.date, away: A.displayName, home: H.displayName, awayAbbr: A.abbreviation, homeAbbr: H.abbreviation,
      awayT: { name: A.displayName, nick: A.name }, homeT: { name: H.displayName, nick: H.name },
      mlA: pc.awayTeamOdds.moneyLine, mlH: pc.homeTeamOdds.moneyLine, espnA: pct(pr?.awayTeam?.gameProjection), espnH: pct(pr?.homeTeam?.gameProjection), polyA: null, polyH: null };
    const pm = await polyMoneyline(lg, g); if (pm) { g.polyA = pm.pa; g.polyH = pm.ph; }
    return g;
  }));
  return games.filter(Boolean);
}
export async function findTeamValue(onStatus = () => {}) {
  const all = [];
  for (const lg of PICK_LEAGUES) { onStatus(`Checking ${LEAGUES[lg].label}…`); all.push(...await scanLeagueOdds(lg)); }
  const spots = all.flatMap(valueSides).filter(s => s.edge > 0).sort((a, b) => b.ev - a.ev);
  return { day: etDay(), at: Date.now(), games: all.length, spots, parlays: buildParlays(spots, { minDec: 3.5, max: 3 }) };
}
