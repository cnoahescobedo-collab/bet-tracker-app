// Shared app state: account, group, slips, members, reactions, notifications,
// live ESPN grading, and every action the web app can take.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fb from './fb';
import { LEAGUES, norm, evaluateLeg, slipStatus, teamMatch, findPlayer, slipCategory } from './core';
import { boards, boxes, loadBoard, loadBox, leagueInjuries, injCache, etDay } from './espn';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const isPM = s => s.source === 'pmus' || s.source === 'polymarket';
export const settledAt = s => s.settledAt?.toMillis?.() || s.createdAt?.toMillis?.() || 0;
export const createdAt = s => s.createdAt?.toMillis?.() || 0;
export const isPerson = s => s.source !== 'model';
export const cleanName = n => String(n || '').replace(/[\/\\#?\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
export const nameKey = n => String(n || '').trim().toLowerCase();
const pmKeyOf = s => { const m = String(s.id).match(/^(pu|pm)_[^_]+_(.+)$/); return m ? m[1] + '|' + norm(s.name) + '|' + m[2] : null; };

// Same de-duplication as the web app: one Polymarket slip per person + market
function cleanSlips(raw) {
  const out = [], best = new Map(), dups = [];
  const score = s => (s.pnl != null && s.status !== 'open' ? 100 : 0) + (s.status !== 'open' ? 10 : 0) + (s.legsV || 0) + settledAt(s) / 1e13;
  for (const s0 of raw) {
    const s = { ...s0, legs: s0.legs || [] };
    if (isPM(s) && s.status !== 'open' && s.pnl == null && !s.manual) { s.status = 'open'; s.unconfirmed = true; }
    const k = isPM(s) ? pmKeyOf(s) : null;
    if (!k) { out.push(s); continue; }
    const cur = best.get(k);
    if (!cur) { best.set(k, s); continue; }
    if (score(s) > score(cur)) { dups.push(cur); best.set(k, s); } else dups.push(s);
  }
  return { list: [...out, ...best.values()].sort((a, b) => createdAt(b) - createdAt(a)), dups };
}
function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)]; return c; }
const ls = {
  get: async (k, d) => { try { const v = await AsyncStorage.getItem('lbt.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: (k, v) => AsyncStorage.setItem('lbt.' + k, JSON.stringify(v)).catch(() => {}),
};
export { ls };

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined);       // undefined = loading, null = signed out
  const [me, setMe] = useState(null);                 // {name, group, key}
  const [phase, setPhase] = useState('loading');      // loading | join | pending | ready
  const [groupDoc, setGroupDoc] = useState(null);
  const [members, setMembers] = useState({});
  const [slipsRaw, setSlipsRaw] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [liveTick, setLiveTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [liveErr, setLiveErr] = useState('');
  const uid = user?.uid;

  const toast = useCallback((msg, kind) => { setToastMsg({ msg, kind, at: Date.now() }); }, []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(null), 4000); return () => clearTimeout(t); }, [toastMsg]);

  /* ---------- Auth ---------- */
  useEffect(() => fb.onAuth(u => setUser(u)), []);
  const gpath = me ? `groups/${me.group}` : null;

  const openGroup = useCallback(async (group) => {
    if (!uid) return;
    const m = await fb.getDoc(`groups/${group}/members/${uid}`);
    if (!m) { setMe(x => ({ ...(x || {}), group })); setPhase('join'); return false; }
    if (m.removed) { setMe(null); ls.set('me', null); setPhase('join'); toast(`You're no longer in group ${group}.`); return false; }
    const next = { name: m.name, group, key: norm(m.name).replace(/ /g, '') };
    setMe(next); ls.set('me', next);
    setPhase(m.status === 'pending' ? 'pending' : 'ready');
    fb.setDoc(`users/${uid}`, { lastGroup: group, groups: fb.arrayUnion(group) }, { merge: true }).catch(() => {});
    return true;
  }, [uid]);

  useEffect(() => {
    if (!user) { setPhase('loading'); setMe(null); return; }
    if (!user.emailVerified) return;
    (async () => {
      const saved = await ls.get('me', null);
      const udoc = await fb.getDoc(`users/${user.uid}`);
      const group = saved?.group || udoc?.lastGroup;
      if (!group || !(await openGroup(group))) setPhase(p => (p === 'pending' ? p : 'join'));
    })();
  }, [user?.uid, user?.emailVerified]);

  // While waiting for approval, check every 10 seconds
  useEffect(() => {
    if (phase !== 'pending' || !me?.group) return;
    const t = setInterval(() => openGroup(me.group), 10000);
    return () => clearInterval(t);
  }, [phase, me?.group]);

  const enterGroup = useCallback(async (name, code, create) => {
    name = cleanName(name); code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!name) throw new Error('Add your name first.');
    if (!create && code.length < 4) throw new Error('Enter the group code a friend sent you, or start a new group.');
    if (create) code = genCode();
    const g = `groups/${code}`;
    if (create) {
      await fb.commit([
        fb.W.set(g, { createdAt: fb.SERVER_TIME, createdBy: uid }),
        fb.W.set(`${g}/names/${nameKey(name)}`, { uid }),
        fb.W.set(`${g}/members/${uid}`, { name, status: 'approved', joinedAt: fb.SERVER_TIME }),
      ]);
    } else {
      if (!(await fb.exists(g))) throw new Error('No group with code ' + code + '. Check the code and try again.');
      if (!(await fb.getDoc(`${g}/members/${uid}`))) {
        const nd = await fb.getDoc(`${g}/names/${nameKey(name)}`);
        if (nd && nd.uid !== uid) throw new Error(`“${name}” is already taken in that group. Pick another name.`);
        await fb.commit([fb.W.set(`${g}/names/${nameKey(name)}`, { uid }), fb.W.set(`${g}/members/${uid}`, { name, status: 'pending', joinedAt: fb.SERVER_TIME })]);
      }
    }
    await openGroup(code);
  }, [uid, openGroup]);

  const leaveGroup = useCallback(() => { setMe(null); ls.set('me', null); setSlipsRaw([]); setMembers({}); setPhase('join'); }, []);
  const signOutAll = useCallback(async () => { leaveGroup(); await ls.set('me', null); await fb.signOut(); }, [leaveGroup]);

  /* ---------- Loading group data ---------- */
  const lastFull = useRef(0);
  const slipsRef = useRef([]); slipsRef.current = slipsRaw;
  const fullLoad = useCallback(async () => {
    if (!gpath || phase !== 'ready') return;
    try {
      const [ms, ss, rs, gd] = await Promise.all([
        fb.listDocs(`${gpath}/members`),
        fb.query(gpath, 'slips', { orderBy: ['createdAt', 'desc'], limit: 800 }),
        fb.listDocs(`${gpath}/reactions`, 2000).catch(() => []),
        fb.getDoc(gpath).catch(() => null),
      ]);
      const m = {}; ms.forEach(d => (m[d.id] = d)); setMembers(m);
      setSlipsRaw(ss); setReactions(rs); if (gd) setGroupDoc(gd);
      lastFull.current = Date.now(); setLoadErr('');
    } catch (e) { setLoadErr("Couldn't load your group: " + e.message); }
  }, [gpath, phase]);

  // Cheap refresh: only open slips (and anything that just settled), reactions on them, unread notifications
  const quickLoad = useCallback(async () => {
    if (!gpath || phase !== 'ready') return;
    try {
      const open = await fb.query(gpath, 'slips', { where: [['status', '==', 'open']], limit: 300 });
      const openIds = new Set(open.map(s => s.id));
      const before = slipsRef.current;
      const gone = before.filter(s => s.status === 'open' && !openIds.has(s.id)).slice(0, 40);
      const changed = await Promise.all(gone.map(async s => { const d = await fb.getDoc(`${gpath}/slips/${s.id}`); return d ? { id: s.id, ...d } : { id: s.id, __deleted: true }; }));
      setSlipsRaw(cur => {
        const map = new Map(cur.map(s => [s.id, s]));
        open.forEach(s => map.set(s.id, s));
        changed.forEach(s => (s.__deleted ? map.delete(s.id) : map.set(s.id, s)));
        return [...map.values()].sort((a, b) => createdAt(b) - createdAt(a));
      });
      const ids = [...openIds];
      for (let i = 0; i < ids.length; i += 30) {
        const rs = await fb.query(gpath, 'reactions', { where: [['slipId', 'in', ids.slice(i, i + 30)]] }).catch(() => null);
        if (rs) setReactions(cur => { const chunk = new Set(ids.slice(i, i + 30)); return [...cur.filter(r => !chunk.has(r.slipId)), ...rs]; });
      }
      setLoadErr('');
    } catch (e) { setLoadErr("Couldn't refresh: " + e.message); }
  }, [gpath, phase]);

  const loadNotifs = useCallback(async () => {
    if (!gpath || !me?.name) return;
    const n = await fb.query(gpath, 'notifs', { where: [['toName', '==', me.name]], limit: 100 }).catch(() => null);
    if (n) setNotifs(n.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0)));
  }, [gpath, me?.name]);

  const loadMembers = useCallback(async () => {
    if (!gpath) return;
    const ms = await fb.listDocs(`${gpath}/members`).catch(() => null);
    if (ms) { const m = {}; ms.forEach(d => (m[d.id] = d)); setMembers(m); }
  }, [gpath]);

  useEffect(() => {
    if (phase !== 'ready') return;
    fullLoad(); loadNotifs();
    let n = 0;
    const t = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      n++;
      if (Date.now() - lastFull.current > 10 * 60000) fullLoad(); else quickLoad();
      if (n % 2 === 0) loadNotifs();
      if (n % 4 === 0) loadMembers();
    }, 15000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { quickLoad(); loadNotifs(); } });
    return () => { clearInterval(t); sub.remove(); };
  }, [phase, gpath]);

  const refreshAll = useCallback(async () => { await fullLoad(); await loadNotifs(); await liveRefreshRef.current(); }, [fullLoad, loadNotifs]);

  /* ---------- Derived data ---------- */
  const { list: slips, dups } = useMemo(() => cleanSlips(slipsRaw), [slipsRaw]);
  const removedNames = useMemo(() => {
    const all = new Map();
    Object.values(members).forEach(m => { const k = norm(m.name); const v = all.get(k) || { n: 0, r: 0 }; v.n++; if (m.removed) v.r++; all.set(k, v); });
    return new Set([...all].filter(([, v]) => v.n && v.r === v.n).map(([k]) => k));
  }, [members]);
  const visible = useMemo(() => slips.filter(s => !removedNames.has(norm(s.name))), [slips, removedNames]);
  const hidden = useMemo(() => new Set(Object.values(members).filter(m => m.hideMoney).map(m => norm(m.name))), [members]);
  const showMoney = useCallback(name => norm(name) === norm(me?.name) || !hidden.has(norm(name)), [hidden, me?.name]);
  const isMine = useCallback(s => s.uid === uid || norm(s.name) === norm(me?.name), [uid, me?.name]);
  const people = useMemo(() => {
    const m = new Map();
    for (const s of slips) { const k = norm(s.name); if (!removedNames.has(k) && !m.has(k)) m.set(k, s.name); }
    for (const v of Object.values(members)) { const k = norm(v.name); if (!v.removed && v.status !== 'pending' && !removedNames.has(k) && !m.has(k)) m.set(k, v.name); }
    return [...m.entries()];
  }, [slips, members, removedNames]);
  const isOwner = !!groupDoc && (groupDoc.createdBy === uid || members[groupDoc.createdBy]?.linkedTo === uid);

  /* ---------- Writes ---------- */
  const slipPath = id => `${gpath}/slips/${id}`;
  const persistLegs = useCallback(async (s, legs) => {
    if (isPM(s)) { await fb.updateDoc(slipPath(s.id), { legs }).catch(() => {}); return; }
    const rs = legs.map(l => l.result || null);
    const status = rs.includes('lost') ? 'lost' : rs.every(Boolean) ? slipStatus(rs) : 'open';
    const upd = { legs };
    if (status !== 'open' && s.status === 'open') { upd.status = status; upd.settledAt = fb.SERVER_TIME; }
    await fb.updateDoc(slipPath(s.id), upd).catch(() => {});
    setSlipsRaw(cur => cur.map(x => x.id === s.id ? { ...x, legs, ...(upd.status ? { status: upd.status, settledAt: fb.timestamp(Date.now()) } : {}) } : x));
  }, [gpath]);

  const actions = useMemo(() => ({
    async postSlip({ stake, payout, odds, legs }, editingId) {
      if (editingId) {
        await fb.updateDoc(slipPath(editingId), { stake, payout: payout || null, odds: odds || null, status: 'open', legs, edited: true });
      } else {
        await fb.addDoc(`${gpath}/slips`, { uid, name: me.name, createdAt: fb.SERVER_TIME, stake, payout: payout || null, odds: odds || null, status: 'open', legs });
      }
      await fullLoad();
    },
    async deleteSlip(id) { await fb.deleteDoc(slipPath(id)); setSlipsRaw(cur => cur.filter(s => s.id !== id)); },
    async settleSlip(id, res) {
      await fb.updateDoc(slipPath(id), { status: res, manual: true, settledAt: fb.SERVER_TIME });
      setSlipsRaw(cur => cur.map(s => s.id === id ? { ...s, status: res, manual: true, settledAt: fb.timestamp(Date.now()) } : s));
    },
    async markLeg(id, i, res) {
      const s = slipsRef.current.find(x => x.id === id); if (!s) return;
      const legs = s.legs.map((l, k) => k === i ? { ...l, result: res } : l);
      await persistLegs(s, legs);
    },
    async react(slip, emoji) {
      const ref = `${gpath}/reactions/${uid}_${slip.id}`;
      const cur = reactions.find(r => r.slipId === slip.id && r.uid === uid);
      if (cur && cur.emoji === emoji) {
        await fb.deleteDoc(ref); setReactions(rs => rs.filter(r => !(r.slipId === slip.id && r.uid === uid))); return;
      }
      await fb.setDoc(ref, { slipId: slip.id, uid, name: me.name, emoji, at: fb.SERVER_TIME });
      setReactions(rs => [...rs.filter(r => !(r.slipId === slip.id && r.uid === uid)), { id: uid + '_' + slip.id, slipId: slip.id, uid, name: me.name, emoji }]);
      if (slip.uid !== uid && norm(slip.name) !== norm(me.name)) {
        await fb.addDoc(`${gpath}/notifs`, { to: slip.uid || null, toName: slip.name, from: uid, fromName: me.name, emoji, slipId: slip.id,
          label: `${slip.legs.length}-leg ${slipCategory(slip)}`, at: fb.SERVER_TIME, read: false }).catch(() => {});
      }
    },
    async markNotifsRead() {
      const unread = notifs.filter(n => !n.read);
      await fb.commit(unread.map(n => fb.W.update(`${gpath}/notifs/${n.id}`, { read: true }))).catch(() => {});
      setNotifs(ns => ns.map(n => ({ ...n, read: true })));
    },
    async setMemberRemoved(nameK, on) {
      const ids = Object.entries(members).filter(([, m]) => norm(m.name || '?') === nameK).map(([id]) => id);
      await fb.commit(ids.map(id => fb.W.update(`${gpath}/members/${id}`, { removed: on })));
      await loadMembers();
    },
    async approveMember(nameK) {
      const ids = Object.entries(members).filter(([, m]) => norm(m.name || '?') === nameK && m.status === 'pending').map(([id]) => id);
      await fb.commit(ids.map(id => fb.W.update(`${gpath}/members/${id}`, { status: 'approved' })));
      await loadMembers();
    },
    async setHideMoney(on) { await fb.setDoc(`${gpath}/members/${uid}`, { hideMoney: on }, { merge: true }); await loadMembers(); },
    async setMemberFields(fields) { await fb.setDoc(`${gpath}/members/${uid}`, fields, { merge: true }); await loadMembers(); },
    async rename(newName) {
      const nn = cleanName(newName); const old = me.name;
      if (!nn || nn === old) return;
      if (nameKey(nn) !== nameKey(old)) {
        if (people.some(([k]) => k === norm(nn))) throw new Error('Someone in the group already uses that name.');
        const nd = await fb.getDoc(`${gpath}/names/${nameKey(nn)}`);
        if (nd && nd.uid !== uid) throw new Error('That name is taken in this group.');
      }
      const w = [];
      if (nameKey(nn) !== nameKey(old)) { w.push(fb.W.set(`${gpath}/names/${nameKey(nn)}`, { uid })); w.push(fb.W.del(`${gpath}/names/${nameKey(old)}`)); }
      w.push(fb.W.update(`${gpath}/members/${uid}`, { name: nn }));
      slipsRef.current.filter(s => s.uid === uid || (norm(s.name) === norm(old) && s.source !== 'model')).forEach(s => w.push(fb.W.update(slipPath(s.id), { name: nn })));
      await fb.commit(w);
      const next = { ...me, name: nn }; setMe(next); ls.set('me', next);
      await fullLoad();
    },
    // Used by Picks (model slips) and Polymarket sync
    setSlip: (id, data, opts) => fb.setDoc(slipPath(id), data, opts),
    updateSlip: (id, data) => fb.updateDoc(slipPath(id), data),
    commitSlips: writes => fb.commit(writes.map(([kind, id, data]) => kind === 'set' ? fb.W.set(slipPath(id), data) : fb.W.update(slipPath(id), data))),
    reload: fullLoad,
  }), [gpath, uid, me, reactions, notifs, members, people, fullLoad, loadMembers, persistLegs]);

  // Quietly remove duplicate Polymarket copies this person owns (same as the web app)
  const tidyAt = useRef(0);
  useEffect(() => {
    if (!dups.length || Date.now() - tidyAt.current < 60000 || !gpath) return; tidyAt.current = Date.now();
    const mine = dups.filter(x => x.uid === uid || members[x.uid]?.linkedTo === uid).slice(0, 50);
    fb.commit(mine.map(x => fb.W.del(slipPath(x.id)))).catch(() => {});
  }, [dups]);

  /* ---------- Live grading from ESPN (same rules as the web app) ---------- */
  const gameIds = useRef({});
  const busy = useRef(false);
  const gameFor = useCallback((s, l, i) => {
    const id = l.gameId || gameIds.current[s.id + '|' + i];
    return id ? (boards[l.league] || []).find(g => g.id === id) || null : null;
  }, []);
  const legState = useCallback((s, l, i) => {
    if (l.kind === 'poly' || l.kind === 'pmus') return { poly: true, result: l.result || (s.status !== 'open' ? s.status : undefined), live: s.status === 'open' };
    const g = gameFor(s, l, i);
    const st = evaluateLeg(l, g, g ? boxes[g.id] : null);
    if (l.result) return { ...st, result: l.result, cur: st.cur ?? l.final ?? null };
    return st;
  }, [gameFor, liveTick]);

  async function liveRefresh() {
    if (busy.current) return;
    const open = slipsRef.current.filter(s => s.status === 'open' && !removedNames.has(norm(s.name)));
    if (!open.length) { setUpdatedAt(Date.now()); return; }
    busy.current = true;
    try {
      const pend = s => (s.legs || []).map((l, i) => ({ l, i })).filter(({ l }) => !l.result && l.kind !== 'poly' && l.kind !== 'pmus' && LEAGUES[l.league]?.path);
      const lgs = [...new Set(open.flatMap(s => pend(s).map(x => x.l.league)))];
      lgs.forEach(l => { const c = injCache.get(l); if (!c || Date.now() - c.at > 15 * 60000) leagueInjuries(l).catch(() => {}); });
      await Promise.all(lgs.map(l => loadBoard(l).catch(() => null)));
      const today = etDay();
      const dated = new Set(open.flatMap(s => pend(s).filter(x => x.l.date && x.l.date !== today).map(x => x.l.league + '|' + x.l.date)));
      await Promise.all([...dated].map(k => { const [lg, dt] = k.split('|'); return loadBoard(lg, dt).catch(() => null); }));
      const AL = { utah: 'uta', wsh: 'was', gs: 'gsw', ny: 'nyk', sa: 'sas', no: 'nop', la: 'lar' };
      const eq = (e, p) => { e = String(e || '').toLowerCase(); p = String(p || '').toLowerCase(); return e === p || AL[e] === p || AL[p] === e || (e.length > 2 && p.length > 2 && (e.startsWith(p) || p.startsWith(e))); };
      const attach = [];
      for (const s of open) {
        let legs = null;
        for (const { l, i } of pend(s)) {
          if (l.gameId || gameIds.current[s.id + '|' + i]) continue;
          const games = boards[l.league] || []; let g = null;
          if (l.abbrA && l.abbrH) { const has = (x, a) => x.teams.some(t => eq(t.abbr, a)); g = games.find(x => has(x, l.abbrA) && has(x, l.abbrH)) || null; }
          if (!g && l.kind === 'prop') {
            const hint = l.team ? games.find(x => teamMatch(x, l.team)) : null;
            for (const cand of (hint ? [hint, ...games.filter(x => x !== hint)] : games).filter(x => x.state !== 'pre')) {
              const p = boxes[cand.id] || await loadBox(l.league, cand.id).catch(() => null);
              if (p && findPlayer(p, l.player)) { g = cand; break; }
            }
            if (!g && hint && hint.state === 'pre') g = hint;
          } else if (!g) g = games.find(x => teamMatch(x, l.team || l.opponent));
          if (g) { gameIds.current[s.id + '|' + i] = g.id; legs = legs || s.legs.map(x => ({ ...x })); legs[i].gameId = g.id; }
        }
        if (legs) attach.push([s, legs]);
      }
      const need = new Map();
      for (const s of open) for (const { l, i } of pend(s)) if (l.kind === 'prop') { const g = gameFor(s, l, i); if (g && g.state !== 'pre') need.set(g.id, l.league); }
      await Promise.all([...need].map(([id, lg]) => loadBox(lg, id).catch(() => null)));
      // Save game matches and lock in finished legs, like the web app does
      const attachMap = new Map(attach.map(([s, legs]) => [s.id, legs]));
      for (const s of open) {
        let legs = attachMap.get(s.id) || null; let changed = !!legs;
        (legs || s.legs).forEach((l, i) => {
          if (l.result || l.kind === 'poly' || l.kind === 'pmus') return;
          const st = evaluateLeg(l, gameFor(s, l, i), boxes[gameFor(s, l, i)?.id]);
          if (st.locked && st.result) { legs = legs || s.legs.map(x => ({ ...x })); legs[i] = { ...legs[i], result: st.result, final: st.cur }; changed = true; }
        });
        if (changed && legs) await persistLegs(s, legs);
      }
      setLiveErr(''); setUpdatedAt(Date.now());
    } catch (e) { setLiveErr("Couldn't reach ESPN just now. Retrying shortly."); }
    finally { busy.current = false; setLiveTick(t => t + 1); }
  }
  const liveRefreshRef = useRef(liveRefresh); liveRefreshRef.current = liveRefresh;
  const openSig = visible.filter(s => s.status === 'open').map(s => s.id).join(',');
  useEffect(() => { if (phase === 'ready') liveRefreshRef.current(); }, [openSig, phase]);
  useEffect(() => {
    if (phase !== 'ready') return;
    const t = setInterval(() => { if (AppState.currentState === 'active') liveRefreshRef.current(); }, 20000);
    return () => clearInterval(t);
  }, [phase]);

  const value = {
    user, uid, me, phase, groupDoc, members, slips, visible, reactions, notifs, people, isOwner,
    showMoney, isMine, legState, gameFor, liveTick, updatedAt, liveErr, loadErr,
    toast, toastMsg, enterGroup, leaveGroup, signOutAll, openGroup, refreshAll,
    liveRefresh: () => liveRefreshRef.current(), actions, setPhase,
  };
  return React.createElement(Ctx.Provider, { value }, children);
}
