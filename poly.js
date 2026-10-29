// Polymarket US (signed API, key kept in the phone's secure storage) and Polymarket.com (public wallet).
// Same sync, history backfill and leg-building rules as the web app.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import nacl from './nacl';
import { LEAGUES, norm, marketFor, catOf, polyCategory, decToAm } from './core';
import { useApp, isPM, ls } from './store';
import { getJSON, pool } from './espn';
import { timestamp, SERVER_TIME } from './fb';

const Ctx = createContext({ polyLive: {} });
export const usePoly = () => useContext(Ctx);
const SECRET_KEY = 'lbt_pmus_key';

/* ---------- Signing ---------- */
const b64d = b => Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64e = u => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const utf8 = s => new TextEncoder().encode(s);
export function pmSeed(secret) {
  let t = String(secret || '').replace(/[\s"'`]/g, '').replace(/^(secret(key)?[:=])/i, '');
  let bytes = null;
  if (/^(0x)?[0-9a-f]{64,128}$/i.test(t)) { t = t.replace(/^0x/i, ''); bytes = Uint8Array.from(t.match(/../g).map(h => parseInt(h, 16))); }
  else { try { bytes = b64d(t.padEnd(Math.ceil(t.length / 4) * 4, '=')); } catch (e) { bytes = null; } }
  if (!bytes || bytes.length < 32) throw new Error('The secret key looks cut off or mistyped. Copy the whole secret key again.');
  return bytes.slice(0, 32);
}
async function signedGet(signPath, fetchPath, key) {
  const ts = String(Date.now());
  const kp = nacl.sign.keyPair.fromSeed(pmSeed(key.secret));
  const sig = b64e(nacl.sign.detached(utf8(ts + 'GET' + signPath), kp.secretKey));
  const r = await fetch('https://api.polymarket.us' + fetchPath, { headers: { 'X-PM-Access-Key': String(key.keyId || '').replace(/[\s"'`]/g, ''), 'X-PM-Timestamp': ts, 'X-PM-Signature': sig } });
  if (!r.ok) { const t = (await r.text().catch(() => '')).trim().slice(0, 160); const e = new Error(r.status === 401 || r.status === 403 ? '401' : 'HTTP ' + r.status); e.detail = t; throw e; }
  return r.json();
}
export const pmusGet = (path, key) => signedGet(path, path, key);
let signMode = 'bare';
async function pmusQ(base, query, key) {
  const full = base + (query ? '?' + query : '');
  if (!query) return pmusGet(base, key);
  const order = signMode === 'bare' ? ['bare', 'full'] : ['full', 'bare']; let last;
  for (const m of order) {
    try { const r = m === 'full' ? await pmusGet(full, key) : await signedGet(base, full, key); if (m !== signMode) { signMode = m; ls.set('pmSign', m); } return r; }
    catch (e) { last = e; if (e.message !== '401') throw e; }
  }
  throw last;
}

/* ---------- Markets -> tracker legs ---------- */
const PM_LEAGUE = { nba: 'nba', wnba: 'wnba', nfl: 'nfl', cfb: 'ncaafb', ncaaf: 'ncaafb', cbb: 'ncaamb', ncaab: 'ncaamb', mlb: 'mlb', nhl: 'nhl', epl: 'epl', ucl: 'ucl', mls: 'mls', lal: 'laliga', laliga: 'laliga', sea: 'seriea', bun: 'bund', fl1: 'ligue1', mex: 'ligamx', atp: 'atp', wta: 'wta' };
export function pmSlugInfo(slug) {
  const m = String(slug || '').toLowerCase().match(/^(?:[a-z0-9]{2,8}-)?(nba|wnba|nfl|cfb|ncaaf|cbb|ncaab|mlb|nhl|epl|ucl|mls|lal|laliga|sea|bun|fl1|mex|atp|wta)-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})/);
  return m ? { league: PM_LEAGUE[m[1]], a: m[2], h: m[3], date: m[4] } : null;
}
const mktCache = new Map(), comboCache = new Map();
async function pmMarket(sym) {
  if (mktCache.has(sym)) return mktCache.get(sym);
  const r = await getJSON('https://gateway.polymarket.us/v1/market/slug/' + encodeURIComponent(sym)).catch(() => null);
  const m = r?.market || r; if (!m || !m.slug) return null;
  const out = { slug: m.slug, q: m.question || '', short: m.titleShort || m.title || '', title: m.title || '', line: m.line != null ? Number(m.line) : null, type: String(m.sportsMarketType || m.sportsMarketTypeV2 || m.marketType || '').toLowerCase(),
    sides: (m.marketSides || []).map(x => ({ d: x.description || '', long: !!x.long, team: (x.team?.abbreviation || '').toLowerCase(), teamName: x.team?.safeName || x.team?.name || '' })) };
  mktCache.set(sym, out); return out;
}
async function pmComboLegs(sym, key) {
  if (comboCache.has(sym)) return comboCache.get(sym);
  let r = null;
  for (const path of ['/v1/combos?symbol=' + encodeURIComponent(sym), '/v1/combos']) {
    try { r = path === '/v1/combos' ? await signedGet('/v1/combos', '/v1/combos?symbol=' + encodeURIComponent(sym), key) : await pmusGet(path, key); break; }
    catch (e) { if (e.message !== '401') break; }
  }
  const legs = r?.combos?.[0]?.legs?.map(l => ({ symbol: l.symbol, side: l.side })) || null;
  if (legs) comboCache.set(sym, legs); return legs;
}
export function pmToLeg(mkt, side, fallbackTitle) {
  const info = pmSlugInfo(mkt?.slug);
  const sides = mkt?.sides || []; const buy = side !== 'SIDE_SELL';
  const yes = sides.find(x => x.long) || sides[0]; const no = sides.find(x => !x.long) || sides[1];
  const picked = buy ? yes : (no || { d: 'No' });
  const title = (mkt?.short || mkt?.title || mkt?.q || fallbackTitle || '').trim();
  const raw = title + (picked?.d && !/^(yes)$/i.test(picked.d) ? ` · ${picked.d}` : '');
  const type = mkt?.type || ''; const q = mkt?.q || ''; const slug = String(mkt?.slug || '').toLowerCase();
  const base = { league: 'other', kind: 'pmus', cat: polyCategory(mkt?.slug) || 'Other', team: picked?.d || (buy ? 'Yes' : 'No'), market: title, slug: mkt?.slug || null, raw, result: null };
  if (!info || !LEAGUES[info.league]) return base;
  const g = { league: info.league, abbrA: info.a, abbrH: info.h, date: info.date, raw, result: null, gameId: null };
  const fullGame = !/(first|second|third|fourth)_(half|quarter)|_half|quarter|team_total|race|margin|overtime/.test(type);
  const L = mkt?.line != null ? Number(mkt.line) : null;
  if (/winner|moneyline/.test(type) && fullGame) return { ...g, kind: 'moneyline', team: buy ? (yes?.teamName || yes?.d) : (no?.teamName || no?.d) };
  if (/player/.test(type) || /-(pts|reb|ast|pra|pr|pa|ra|3pm|threes|stl|blk|sb)-[a-z]+-gte\d/.test(slug)) {
    const statText = type.replace(/^[a-z]+_player_/, '').replace(/_/g, ' + ') + ' ' + title;
    const mk = marketFor(info.league, statText.toLowerCase());
    const nm = (title.match(/^(.+?)\s+\d+(?:\.\d+)?\s*\+/) || [])[1] || (q.match(/Will (.+?) record/) || [])[1] || '';
    const thr = L ?? Number((title.match(/(\d+(?:\.\d+)?)\s*\+/) || [])[1]);
    if (mk && nm && !isNaN(thr)) return { ...g, kind: 'prop', player: nm.trim(), market: mk.label, line: Number.isInteger(thr) ? thr - 0.5 : thr, side: buy ? 'over' : 'under' };
    return { ...base, league: info.league, cat: catOf(info.league) };
  }
  if (/spread/.test(type) && fullGame) {
    const m = q.match(/Will the\s+([A-Z]{2,4})\s+(.+?)\s+cover\s+([\d.]+)\s+vs\.?\s+the\s+([A-Z]{2,4})\s+(.+?)\s+in\b/i);
    const n = L ?? (m ? Number(m[3]) : null);
    if (m && n != null) { const sign = /-neg-/.test(slug) ? -1 : 1; return buy ? { ...g, kind: 'spread', team: m[2].trim(), line: sign * n, side: 'over' } : { ...g, kind: 'spread', team: m[5].trim(), line: -sign * n, side: 'over' }; }
    return { ...base, league: info.league, cat: catOf(info.league) };
  }
  if (/total/.test(type) && fullGame && !/team_total/.test(type)) {
    const n = L ?? Number((q.match(/more than\s+([\d.]+)/i) || [])[1]);
    if (!isNaN(n)) return { ...g, kind: 'total', team: null, line: n, side: buy ? 'over' : 'under' };
  }
  return { ...base, league: info.league, cat: catOf(info.league) };
}
async function pmBuildLegs(slug, key, title, short) {
  let legs = null;
  if (/^(crossd|caoc)-/i.test(slug)) {
    const cl = await pmComboLegs(slug, key);
    if (cl) legs = await Promise.all(cl.map(async l => pmToLeg(await pmMarket(l.symbol), short ? (l.side === 'SIDE_BUY' ? 'SIDE_SELL' : 'SIDE_BUY') : l.side, l.symbol)));
  } else {
    const mk = await pmMarket(slug);
    legs = [pmToLeg(mk || { slug, short: title, q: title, sides: [{ d: 'Yes', long: true }] }, short ? 'SIDE_SELL' : 'SIDE_BUY', title)];
  }
  return legs || [{ league: 'other', kind: 'pmus', cat: polyCategory(slug) || 'Other', team: 'Yes', market: title || 'Combo', slug, result: null }];
}
async function pmPositionsAll(key) {
  const out = {}; let cursor = '';
  for (let i = 0; i < 30; i++) {
    const r = await pmusQ('/v1/portfolio/positions', 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), key).catch(e => { if (i === 0) return pmusGet('/v1/portfolio/positions', key); throw e; });
    Object.assign(out, r.positions || {});
    if (r.eof || !r.nextCursor || r.nextCursor === cursor) break; cursor = r.nextCursor;
  }
  return out;
}
const amt = a => Number(a?.value ?? a ?? 0) || 0;
const polyKey = (cid, idx) => String(cid).slice(2, 14) + '_' + idx;

/* ---------- Provider ---------- */
export function PolyProvider({ children }) {
  const app = useApp();
  const { uid, me, members, slips, actions, toast } = app;
  const [key, setKeyState] = useState(undefined);       // {keyId, secret} | null
  const [hist, setHist] = useState(null); const [histAt, setHistAt] = useState(0); const [flow, setFlow] = useState(null);
  const [histStatus, setHistStatus] = useState('');
  const [polyLive, setPolyLive] = useState({});
  const busy = useRef({}); const lastRun = useRef({});
  const ctx = useRef(app); ctx.current = app;
  const myKey = () => (me?.key) || norm(me?.name || '').replace(/ /g, '');
  const pmSlipId = slug => ('pu_' + myKey() + '_' + slug).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 140);
  const sfx = slug => '_' + String(slug).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 120);

  useEffect(() => {
    (async () => {
      try { const s = await SecureStore.getItemAsync(SECRET_KEY); setKeyState(s ? JSON.parse(s) : null); } catch (e) { setKeyState(null); }
      setHist(await ls.get('pmhist', null)); setHistAt(await ls.get('pmhistAt', 0)); setFlow(await ls.get('pmflow', null)); signMode = await ls.get('pmSign', 'bare');
    })();
  }, []);

  const saveKey = async (keyId, secret, all) => {
    keyId = keyId.trim(); secret = secret.trim();
    if (!keyId || !secret) throw new Error('Add both the Key ID and the secret key from polymarket.us/developer.');
    try { await pmusGet('/v1/portfolio/positions', { keyId, secret }); }
    catch (e) {
      const d = (e.detail || '').toLowerCase();
      throw new Error(e.message !== '401' ? e.message
        : d.includes('not found') ? "Polymarket US says that Key ID doesn't exist. Make sure you copied the Key ID (not the secret) into the first box, from the same account you use in the app."
          : d.includes('signature') ? "The Key ID was found but the secret key doesn't match it. Create a new key and copy the secret right away. It's only shown once."
            : d.includes('timestamp') ? "This phone's clock is off. Turn on automatic date and time in your phone settings, then try again."
              : "Polymarket US didn't accept the key" + (e.detail ? ` (${e.detail})` : '') + ". If your account isn't identity-verified yet, finish that in the app first.");
    }
    await SecureStore.setItemAsync(SECRET_KEY, JSON.stringify({ keyId, secret }));
    setKeyState({ keyId, secret });
    await actions.setMemberFields({ pmus: true, polyAll: !!all });
    setTimeout(() => { syncPmus(true); backfill(true); }, 300);
  };
  const saveWallet = async (addr, all) => {
    const m = String(addr || '').match(/0x[a-fA-F0-9]{40}/);
    if (!m) throw new Error("That doesn't look like a Polymarket wallet address. It starts with 0x and has 42 characters.");
    const test = await getJSON('https://data-api.polymarket.com/positions?user=' + m[0] + '&limit=1').catch(() => null);
    if (!Array.isArray(test)) throw new Error("Couldn't reach Polymarket with that address. Check it and try again.");
    await actions.setMemberFields({ polyAddress: m[0].toLowerCase(), polyAll: !!all });
    setTimeout(() => syncPoly(true), 300);
  };
  const disconnect = async () => {
    await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => {}); setKeyState(null);
    ['pmhist', 'pmhistAt', 'pmflow'].forEach(k => ls.set(k, null)); setHist(null); setFlow(null); setHistAt(0);
    await actions.setMemberFields({ polyAddress: null, pmus: false });
  };

  /* ---- Live positions -> slips (every 20s) ---- */
  async function syncPmus(force) {
    const { slips, members, actions } = ctx.current;
    if (!key || busy.current.pmus || (!force && Date.now() - (lastRun.current.pmus || 0) < 60000)) return;
    busy.current.pmus = true; lastRun.current.pmus = Date.now();
    try {
      const positions = await pmPositionsAll(key); let changed = 0;
      const all = !!members[uid]?.polyAll;
      const have = new Map(slips.filter(s => s.source === 'pmus').map(s => [s.id, s]));
      const mineOld = slips.filter(s => s.source === 'pmus' && norm(s.name) === norm(me.name));
      for (const [slug, p] of Object.entries(positions || {})) {
        const md = p.marketMetadata || {};
        const net = Number(p.netPositionDecimal ?? p.netPosition ?? 0), sold = Number(p.qtySoldDecimal ?? p.qtySold ?? 0);
        const cost = Math.abs(Number(p.cost?.value || 0)), realized = Number(p.realized?.value || 0), upnl = Number(p.cashValue?.value || 0);
        const id = pmSlipId(slug);
        let settled = p.expired || (net === 0 && sold > 0);
        const pnl = Math.round((realized + (p.expired && net !== 0 ? upnl : 0)) * 100) / 100;
        if (settled && p.expired && net !== 0 && Math.abs(pnl) < 0.005 && cost > 0.01) settled = false;
        const status = settled ? (pnl > 0.004 ? 'won' : pnl < -0.004 ? 'lost' : 'push') : 'open';
        const live = { liveValue: Math.round((cost + upnl) * 100) / 100, livePnl: Math.round(upnl * 100) / 100 };
        const ex = have.get(id) || mineOld.find(x => x.id.endsWith(sfx(slug)));
        const goodLegs = l => l.length > 1 || l[0]?.kind !== 'pmus' || !/^(crossd|caoc)-/i.test(slug);
        if (ex && (ex.legsV || 0) < 4) {
          let legs = await pmBuildLegs(slug, key, md.title, net < 0); if (ex.status === 'won') legs = legs.map(l => ({ ...l, result: 'won' }));
          await actions.updateSlip(ex.id, { legs, legsV: goodLegs(legs) ? 4 : 1 }).catch(() => {}); continue;
        }
        if (!ex) {
          if (net === 0 && !settled) continue;
          let legs = await pmBuildLegs(slug, key, md.title, net < 0);
          if (!legs.some(l => l.kind !== 'pmus' || l.cat !== 'Other') && !all) continue;
          if (status !== 'open') legs = legs.map(l => ({ ...l, result: l.result || status }));
          changed++;
          await actions.setSlip(id, { uid, name: me.name, source: 'pmus', createdAt: SERVER_TIME, stake: Math.round(cost * 100) / 100,
            payout: Math.round(Math.abs(net || Number(p.qtyBoughtDecimal || 0)) * 100) / 100, odds: null, short: net < 0, status, pnl: status === 'open' ? null : pnl, legs, legsV: goodLegs(legs) ? 4 : 1, ...live,
            ...(status !== 'open' ? { settledAt: SERVER_TIME } : {}) }).catch(() => {});
        } else if (status !== 'open' && (ex.status === 'open' || ex.pnl !== pnl)) {
          await actions.updateSlip(ex.id, { status, pnl, settledAt: SERVER_TIME, ...live }).catch(() => {}); changed++;
        } else if (ex.status === 'open' && Math.abs((ex.liveValue || 0) - live.liveValue) >= 0.5) {
          await actions.updateSlip(ex.id, live).catch(() => {});
        }
      }
      if (changed) actions.reload();
    } catch (e) { if (e.message === '401') toast('Polymarket US stopped accepting your key. Reconnect it under Polymarket.', 'error'); }
    finally { busy.current.pmus = false; }
  }

  /* ---- Full account history (every 10 min) ---- */
  async function backfill(force) {
    const { slips, members, actions } = ctx.current;
    if (!key || busy.current.hist) return;
    if (!force && Date.now() - (histAt || 0) < 10 * 60000) return;
    busy.current.hist = true; setHistStatus('Reading your Polymarket history…');
    try {
      const acts = []; let cursor = '';
      for (let i = 0; i < 60; i++) {
        const q = 'limit=100&types=ACTIVITY_TYPE_TRADE&types=ACTIVITY_TYPE_POSITION_RESOLUTION&sortOrder=SORT_ORDER_DESCENDING' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
        const r = await pmusQ('/v1/portfolio/activities', q, key);
        acts.push(...(r.activities || [])); setHistStatus(`Reading your Polymarket history… ${acts.length} activities`);
        if (r.eof || !r.nextCursor || r.nextCursor === cursor) break; cursor = r.nextCursor;
        await new Promise(res => setTimeout(res, 250));
      }
      const pos = await pmPositionsAll(key).catch(() => ({}));
      const by = {}; const get = slug => by[slug] || (by[slug] = { slug, stake: 0, pnl: 0, t: 0, resolved: false, short: false, title: '' });
      for (const a of acts) {
        if (a.trade && a.trade.state !== 'TRADE_STATE_BUSTED' && a.trade.state !== 'TRADE_STATE_REJECTED') {
          const x = get(a.trade.marketSlug); const rp = amt(a.trade.realizedPnl);
          if (!rp) x.stake += Math.abs(amt(a.trade.costBasis)); x.pnl += rp;
          x.t = Math.max(x.t, Date.parse(a.trade.updateTime || a.trade.createTime) || 0);
        } else if (a.positionResolution) {
          const r = a.positionResolution, x = get(r.marketSlug);
          x.pnl += amt(r.afterPosition?.realized) - amt(r.beforePosition?.realized); x.resolved = true;
          if (r.side === 'POSITION_RESOLUTION_SIDE_SHORT') x.short = true;
          const c = Math.abs(amt(r.beforePosition?.cost)); if (c > x.stake) x.stake = c;
          x.title = r.beforePosition?.marketMetadata?.title || x.title;
          x.t = Math.max(x.t, Date.parse(r.updateTime) || 0);
        }
      }
      const h = {};
      for (const x of Object.values(by)) {
        const p = pos[x.slug]; const net = p ? Number(p.netPositionDecimal ?? p.netPosition ?? 0) : 0;
        x.settled = x.resolved || !p || net === 0 || !!p?.expired;
        if (p && !x.settled) x.stake = Math.max(x.stake, Math.abs(amt(p.cost)));
        x.title = x.title || p?.marketMetadata?.title || '';
        x.cat = /^(crossd|caoc)-/i.test(x.slug) ? 'Parlays' : (polyCategory(x.slug) || 'Other');
        x.pnl = Math.round(x.pnl * 100) / 100; x.stake = Math.round(x.stake * 100) / 100;
        h[x.slug] = { stake: x.stake, pnl: x.pnl, t: x.t, settled: x.settled, cat: x.cat, title: x.title };
      }
      setHist(h); ls.set('pmhist', h); const now = Date.now(); setHistAt(now); ls.set('pmhistAt', now);
      // Money in vs. money now
      try {
        const f = { dep: 0, wd: 0, bonus: 0, xfer: 0, pendingDep: 0, cash: null, open: 0, at: Date.now() }; let c2 = '';
        for (let i = 0; i < 20; i++) {
          const q = 'limit=100&types=ACTIVITY_TYPE_ACCOUNT_DEPOSIT&types=ACTIVITY_TYPE_ACCOUNT_ADVANCED_DEPOSIT&types=ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL&types=ACTIVITY_TYPE_REFERRAL_BONUS&types=ACTIVITY_TYPE_TRANSFER' + (c2 ? '&cursor=' + encodeURIComponent(c2) : '');
          const r = await pmusQ('/v1/portfolio/activities', q, key);
          for (const a of r.activities || []) {
            const ch = a.accountBalanceChange || {}; const txs = ch.transactions || (ch.amount ? [ch] : []);
            for (const t of txs) {
              const st = String(t.status || ''); if (/REJECTED/.test(st)) continue; const v = amt(t.amount);
              if (a.type === 'ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL') f.wd += Math.abs(v);
              else if (a.type === 'ACTIVITY_TYPE_REFERRAL_BONUS') f.bonus += Math.abs(v);
              else if (a.type === 'ACTIVITY_TYPE_TRANSFER') f.xfer += v;
              else if (/PENDING/.test(st)) f.pendingDep += Math.abs(v); else f.dep += Math.abs(v);
            }
          }
          if (r.eof || !r.nextCursor || r.nextCursor === c2) break; c2 = r.nextCursor;
        }
        const b = await pmusGet('/v1/account/balances', key).catch(() => null);
        const bal = (b?.balances || []).find(x => !x.currency || /USD/i.test(x.currency)) || b?.balances?.[0];
        if (bal) f.cash = Number(bal.currentBalance) || 0;
        for (const p of Object.values(pos)) { const net = Number(p.netPositionDecimal ?? p.netPosition ?? 0); if (!net || p.expired) continue; f.open += Math.abs(amt(p.cost)) + amt(p.cashValue); }
        setFlow(f); ls.set('pmflow', f);
      } catch (e) {}
      // Settled markets the group hasn't seen yet become slips; wrong results get corrected
      const all = !!members[uid]?.polyAll;
      const known = new Set(slips.filter(s => s.source === 'pmus').map(s => s.id));
      const mineOld = slips.filter(s => s.source === 'pmus' && norm(s.name) === norm(me.name));
      let added = 0; const fast = [], legJobs = [], handled = new Set();
      for (const x of Object.values(by).filter(x => x.settled && x.t).sort((a, b) => b.t - a.t)) {
        const id = pmSlipId(x.slug);
        const ex = known.has(id) ? slips.find(s => s.id === id) : mineOld.find(s => s.id.endsWith(sfx(x.slug)));
        const status = x.pnl > 0.004 ? 'won' : x.pnl < -0.004 ? 'lost' : 'push';
        if (ex) {
          handled.add(ex.id);
          if (ex.status === 'open' || ex.pnl == null || Math.abs((ex.pnl ?? 0) - x.pnl) > 0.009)
            fast.push(['update', ex.id, { status, pnl: x.pnl, settledAt: timestamp(x.t), ...(status === 'won' ? { legs: ex.legs.map(l => ({ ...l, result: 'won' })) } : {}) }]);
          if ((ex.legsV || 0) < 4) legJobs.push({ id: ex.id, slug: x.slug, title: x.title, short: x.short, status });
          continue;
        }
        if (!all && !pmSlugInfo(x.slug) && x.cat === 'Other') continue;
        let legs = await pmBuildLegs(x.slug, key, x.title, x.short).catch(() => null); if (!legs) continue;
        if (!legs.some(l => l.kind !== 'pmus' || l.cat !== 'Other') && !all) continue;
        legs = legs.map(l => ({ ...l, result: status === 'won' ? 'won' : null }));
        const ts = timestamp(x.t);
        await actions.setSlip(id, { uid, name: me.name, source: 'pmus', createdAt: ts, settledAt: ts, stake: x.stake, payout: x.stake ? Math.round((x.stake + Math.max(0, x.pnl)) * 100) / 100 : null, odds: null, status, pnl: x.pnl, legs, legsV: 4, backfill: true }).catch(() => {});
        added++;
      }
      if (fast.length) await actions.commitSlips(fast).catch(() => {});
      // Safety net: my Polymarket slips still open with no position -> ask Polymarket how that market settled
      const stale = slips.filter(s => s.source === 'pmus' && (s.uid === uid || members[s.uid]?.linkedTo === uid || norm(s.name) === norm(me.name)))
        .filter(s => !handled.has(s.id) && s.status === 'open' && !pos[(String(s.id).match(/^pu_[^_]+_(.+)$/) || [])[1]] && (Date.now() - (s.createdAt?.toMillis?.() || 0)) > 3 * 3600e3).slice(0, 80);
      let fixedBySettle = 0;
      await pool(stale, 4, async s => {
        const slug = (String(s.id).match(/^pu_[^_]+_(.+)$/) || [])[1]; if (!slug) return;
        const r = await getJSON('https://gateway.polymarket.us/v1/markets/' + encodeURIComponent(slug) + '/settlement').catch(() => null);
        const raw = r?.settlement; const sp = Number(typeof raw === 'object' && raw ? (raw.settlementPrice?.value ?? raw.value) : (raw ?? r?.settlementPrice?.value));
        if ((raw == null && r?.settlementPrice == null) || isNaN(sp)) return;
        const longWon = sp >= 0.99, longLost = sp <= 0.01; if (!longWon && !longLost) return;
        const won = s.short ? longLost : longWon; const stake = Number(s.stake) || 0, pay = Number(s.payout) || 0;
        const pnl = Math.round((won ? pay - stake : -stake) * 100) / 100; const st = pnl > 0.004 ? 'won' : pnl < -0.004 ? 'lost' : 'push';
        const t = Date.parse(r?.settledAt || raw?.settledAt || '') || s.createdAt?.toMillis?.() || Date.now();
        await actions.updateSlip(s.id, { status: st, pnl, pnlSource: 'settlement', settledAt: timestamp(t), ...(won ? { legs: s.legs.map(l => ({ ...l, result: 'won' })) } : {}) }).catch(() => {});
        fixedBySettle++;
      });
      const fixed = fast.length + fixedBySettle;
      if (added || fixed) { toast(`Polymarket check: ${fixed} result${fixed === 1 ? '' : 's'} corrected${added ? `, ${added} past bet${added === 1 ? '' : 's'} added` : ''}.`); actions.reload(); }
      pool(legJobs.slice(0, 120), 3, async j => {
        const nl = await pmBuildLegs(j.slug, key, j.title, j.short).catch(() => null); if (!nl) return;
        await actions.updateSlip(j.id, { legs: nl.map(l => ({ ...l, result: j.status === 'won' ? 'won' : null })), legsV: 4 }).catch(() => {});
      });
      setHistStatus('');
    } catch (e) { setHistStatus(e.message === '401' ? 'Polymarket US didn\'t accept your key for history. Reconnect it under Polymarket.' : "Couldn't read Polymarket history: " + (e.message || e)); }
    finally { busy.current.hist = false; }
  }

  /* ---- Polymarket.com wallets (public) ---- */
  async function syncPoly(force) {
    const { slips, members, actions } = ctx.current;
    if (busy.current.poly || (!force && Date.now() - (lastRun.current.poly || 0) < 55000)) return;
    busy.current.poly = true; lastRun.current.poly = Date.now();
    try {
      const liveMap = {};
      for (const [mid, m] of Object.entries(members)) {
        if (!m.polyAddress) continue;
        const pos = await getJSON('https://data-api.polymarket.com/positions?user=' + m.polyAddress + '&limit=200&sizeThreshold=1').catch(() => null);
        if (!pos) continue;
        pos.forEach(p => (liveMap[polyKey(p.conditionId, p.outcomeIndex) + '_' + mid] = p));
        if (mid !== uid) continue;
        const closed = await getJSON('https://data-api.polymarket.com/closed-positions?user=' + m.polyAddress + '&limit=50').catch(() => []);
        const keep = p => m.polyAll || polyCategory(p.eventSlug || p.slug);
        const have = new Map(slips.filter(s => s.source === 'polymarket').map(s => [s.id, s]));
        const leg = (p, result) => ({ league: 'other', kind: 'poly', cat: polyCategory(p.eventSlug || p.slug) || 'Other', team: p.outcome, market: p.title, slug: p.eventSlug || p.slug || null, key: polyKey(p.conditionId, p.outcomeIndex), result });
        for (const p of pos.filter(keep)) {
          const id = 'pm_' + myKey() + '_' + polyKey(p.conditionId, p.outcomeIndex); const ex = have.get(id);
          const resolved = p.redeemable && (p.curPrice >= 0.99 || p.curPrice <= 0.01);
          const status = resolved ? (p.curPrice >= 0.5 ? 'won' : 'lost') : 'open';
          const pnl = resolved ? Math.round(((status === 'won' ? p.size : 0) - p.initialValue) * 100) / 100 : null;
          if (!ex) await actions.setSlip(id, { uid, name: me.name, source: 'polymarket', createdAt: SERVER_TIME, stake: Math.round(p.initialValue * 100) / 100, payout: Math.round(p.size * 100) / 100,
            odds: p.avgPrice > 0 && p.avgPrice < 1 ? decToAm(1 / p.avgPrice) : null, status, pnl, legs: [leg(p, status === 'open' ? null : status)], ...(status !== 'open' ? { settledAt: SERVER_TIME } : {}) }).catch(() => {});
          else if (ex.status === 'open' && status !== 'open') await actions.updateSlip(id, { status, pnl, legs: [leg(p, status)], settledAt: SERVER_TIME }).catch(() => {});
        }
        for (const p of (closed || []).filter(keep)) {
          const id = 'pm_' + myKey() + '_' + polyKey(p.conditionId, p.outcomeIndex); const ex = have.get(id);
          if (ex && ex.status !== 'open') continue;
          const pnl = Math.round((p.realizedPnl || 0) * 100) / 100; const status = pnl > 0 ? 'won' : pnl < 0 ? 'lost' : 'push';
          const data = { status, pnl, legs: [leg(p, status)], settledAt: SERVER_TIME };
          if (ex) await actions.updateSlip(id, data).catch(() => {});
          else await actions.setSlip(id, { uid, name: me.name, source: 'polymarket', createdAt: SERVER_TIME, stake: Math.round((p.totalBought || 0) * (p.avgPrice || 0) * 100) / 100, payout: Math.round((p.totalBought || 0) * 100) / 100, odds: p.avgPrice > 0 && p.avgPrice < 1 ? decToAm(1 / p.avgPrice) : null, ...data }).catch(() => {});
        }
      }
      setPolyLive(liveMap);
    } finally { busy.current.poly = false; }
  }

  const fns = useRef({}); fns.current = { syncPmus, backfill, syncPoly };
  useEffect(() => {
    if (key === undefined) return;
    fns.current.syncPoly(false); if (key) { fns.current.syncPmus(false); fns.current.backfill(false); }
    const t = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      fns.current.syncPoly(false);
      if (key) { fns.current.syncPmus(false); fns.current.backfill(false); }
    }, 20000);
    return () => clearInterval(t);
  }, [key, Object.keys(members).length]);

  const value = { key, hist, histAt, flow, histStatus, polyLive, saveKey, saveWallet, disconnect,
    refreshHistory: async () => { await fns.current.backfill(true); await fns.current.syncPmus(true); },
    member: members[uid] || {} };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
