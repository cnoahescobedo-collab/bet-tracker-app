// ESPN + shared HTTP helpers and caches (used by Live grading and Picks).
import { LEAGUES, ESPN, gamesFromBoard, boxPlayers, norm, sameName } from './core';

export async function getJSON(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...(opts || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => null); }
  }));
  return out;
}
export const etDay = d => new Date(d || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const ago = t => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
};

/* ---------- Scoreboards and box scores ---------- */
export const boards = {};   // league -> games
export const boxes = {};    // gameId -> players by team
export async function loadBoard(lg, date) {
  if (!LEAGUES[lg]?.path) return [];
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/scoreboard' + (date ? '?dates=' + String(date).replace(/-/g, '') : ''));
  const fresh = gamesFromBoard(lg, d);
  const ids = new Set(fresh.map(g => g.id));
  boards[lg] = [...fresh, ...(boards[lg] || []).filter(g => !ids.has(g.id))];
  return boards[lg];
}
export async function loadBox(lg, id) {
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/summary?event=' + id);
  boxes[id] = boxPlayers(d);
  return boxes[id];
}
export const gameById = (lg, id) => (boards[lg] || []).find(g => g.id === id) || null;

/* ---------- Rosters ---------- */
const rosterCache = new Map();
export async function teamRoster(lg, teamId) {
  const ck = lg + ':' + teamId; if (rosterCache.has(ck)) return rosterCache.get(ck);
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/teams/' + teamId + '/roster').catch(() => ({}));
  const list = (d.athletes || []).flatMap(a => a.items ? a.items : [a]).filter(a => a.id && a.displayName).map(a => ({ id: a.id, name: a.displayName, pos: a.position?.abbreviation || '' }));
  rosterCache.set(ck, list); return list;
}
const namesCache = new Map();
// Every player (or team, for soccer/tennis) in today's games: used to read slip screenshots
export async function rosterNames(lg) {
  const day = new Date().toDateString(); const c = namesCache.get(lg);
  if (c && c.day === day) return c.names;
  if (!LEAGUES[lg]?.path) return [];
  const games = await loadBoard(lg).catch(() => []);
  const names = new Set();
  if (['soc', 'ten'].includes(LEAGUES[lg].sport)) games.forEach(g => g.teams.forEach(t => t.name && names.add(t.name)));
  else {
    const teamIds = [...new Set(games.flatMap(g => g.teams.map(t => t.id)))];
    await Promise.all(teamIds.map(async id => (await teamRoster(lg, id)).forEach(a => names.add(a.name))));
  }
  const out = [...names]; namesCache.set(lg, { day, names: out }); return out;
}

/* ---------- Injuries and news ---------- */
export const injCache = new Map(), newsCache = new Map();
const INJ_WORDS = /injur|out for|ruled out|questionable|doubtful|day-to-day|game-time|sidelined|minutes (restriction|limit)|load management|\brest(ing|ed)?\b|ankle|knee|hamstring|groin|calf|concussion|illness|surgery|strain|sprain|return(s|ing)? from|activated|placed on|\bIL\b|\bIR\b|out (indefinitely|for the season)|limited|did not practice|DNP/i;
export function injClass(st) {
  const s = String(st || '').toLowerCase();
  return /out|injured reserve|\bir\b|suspend|season/.test(s) ? 'out' : /question|doubt|day|game|probable|limited/.test(s) ? 'gtd' : 'ok';
}
export async function leagueInjuries(lg, force) {
  const c = injCache.get(lg); if (!force && c && Date.now() - c.at < 15 * 60000) return c.data;
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/injuries').catch(() => null);
  const byTeam = new Map(), byPlayer = new Map();
  for (const t of d?.injuries || d?.teams || []) {
    const teamId = String(t.id || t.team?.id || ''); const teamName = t.displayName || t.team?.displayName || '';
    const list = (t.injuries || []).map(x => {
      const a = x.athlete || {};
      const o = { id: String(a.id || ''), name: a.displayName || a.fullName || '', pos: a.position?.abbreviation || '', status: x.status || x.type?.description || x.details?.fantasyStatus?.description || '',
        detail: [x.details?.type, x.details?.location, x.details?.side].filter(Boolean).join(' '), comment: x.shortComment || x.longComment || '', date: x.date || '', team: teamName, teamId };
      o.cls = injClass(o.status); return o;
    }).filter(o => o.name);
    byTeam.set(teamId, { name: teamName, list }); list.forEach(o => byPlayer.set(norm(o.name), o));
  }
  const data = { byTeam, byPlayer, ok: !!d && byTeam.size > 0 }; injCache.set(lg, { at: Date.now(), data }); return data;
}
export async function leagueNews(lg, force) {
  const c = newsCache.get(lg); if (!force && c && Date.now() - c.at < 15 * 60000) return c.data;
  const d = await getJSON(ESPN + LEAGUES[lg].path + '/news?limit=100').catch(() => null);
  const arts = (d?.articles || []).map(a => ({
    head: a.headline || a.title || '', desc: a.description || '', at: Date.parse(a.published || a.lastModified) || 0, url: a.links?.web?.href || a.links?.mobile?.href || '',
    teams: (a.categories || []).filter(c => c.type === 'team' || c.teamId).map(c => String(c.teamId || c.team?.id || c.id || '')),
  })).filter(a => a.head);
  arts.forEach(a => (a.flag = INJ_WORDS.test(a.head + ' ' + a.desc)));
  newsCache.set(lg, { at: Date.now(), data: arts }); return arts;
}
export function injFor(lg, name) {
  const c = injCache.get(lg); if (!c) return null;
  return c.data.byPlayer.get(norm(name)) || [...c.data.byPlayer.values()].find(o => sameName(o.name, name)) || null;
}
