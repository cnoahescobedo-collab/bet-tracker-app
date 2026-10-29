// Firebase over its REST endpoints: same project, accounts and data as the web app,
// no Firebase library needed (it can't be bundled in Expo Snack).
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_KEY = 'AIzaSyD6WSZTYNAhcajlOG4geIOm64-W00WTCQ0';
const PROJECT = 'live-bet-tracker-b4f3f';
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY;
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const DOCS = 'https://firestore.googleapis.com/v1/' + ROOT;
const KEY = 'lbt.session';

let session = null; // { uid, email, emailVerified, providers, idToken, refreshToken, expiresAt }
const listeners = new Set();
const publicUser = () => session ? { uid: session.uid, email: session.email, emailVerified: session.emailVerified, providers: session.providers || [] } : null;
const emit = () => listeners.forEach(f => f(publicUser()));

export class FbError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

const CODE = m =>
  /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(m) ? 'auth/invalid-credential'
    : /EMAIL_EXISTS/.test(m) ? 'auth/email-already-in-use'
      : /INVALID_EMAIL/.test(m) ? 'auth/invalid-email'
        : /WEAK_PASSWORD|PASSWORD_DOES_NOT_MEET/.test(m) ? 'auth/weak-password'
          : /TOO_MANY_ATTEMPTS/.test(m) ? 'auth/too-many-requests'
            : /CREDENTIAL_TOO_OLD|TOKEN_EXPIRED/.test(m) ? 'auth/requires-recent-login'
              : 'auth/other';

async function post(url, body) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw new FbError('auth/network-request-failed', 'No connection'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const m = j?.error?.message || 'HTTP ' + r.status; throw new FbError(CODE(m), m); }
  return j;
}

async function save() { try { session ? await AsyncStorage.setItem(KEY, JSON.stringify(session)) : await AsyncStorage.removeItem(KEY); } catch (e) {} }
async function lookup(idToken) { const j = await post(AUTH + 'lookup?key=' + API_KEY, { idToken }); return j.users?.[0] || {}; }
const providersOf = u => (u.providerUserInfo || []).map(p => p.providerId);

async function refresh() {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken) });
  const j = await r.json();
  if (!r.ok) throw new FbError('auth/session-expired', j?.error?.message);
  session = { ...session, idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) - 120) * 1000 };
  await save();
}
async function token() {
  if (!session) throw new FbError('auth/no-user');
  if (Date.now() > session.expiresAt) await refresh();
  return session.idToken;
}
async function setSession(j) {
  const u = await lookup(j.idToken);
  session = { uid: j.localId, email: j.email || u.email, emailVerified: !!u.emailVerified, providers: providersOf(u), idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + (Number(j.expiresIn) - 120) * 1000 };
  await save(); emit();
}

/* ---------- Auth ---------- */
export function onAuth(cb) {
  listeners.add(cb);
  (async () => {
    if (!onAuth.loaded) {
      onAuth.loaded = true;
      try { const s = await AsyncStorage.getItem(KEY); if (s) { session = JSON.parse(s); await refresh(); } }
      catch (e) { session = null; await save(); }
    }
    cb(publicUser());
  })();
  return () => listeners.delete(cb);
}
export const currentUser = publicUser;
export async function signIn(email, password) { await setSession(await post(AUTH + 'signInWithPassword?key=' + API_KEY, { email, password, returnSecureToken: true })); }
export async function signUp(email, password) {
  const j = await post(AUTH + 'signUp?key=' + API_KEY, { email, password, returnSecureToken: true });
  await post(AUTH + 'sendOobCode?key=' + API_KEY, { requestType: 'VERIFY_EMAIL', idToken: j.idToken }).catch(() => {});
  await setSession(j);
}
export async function sendVerify() { await post(AUTH + 'sendOobCode?key=' + API_KEY, { requestType: 'VERIFY_EMAIL', idToken: await token() }); }
export async function reloadUser() {
  if (!session) return null;
  await refresh();
  const u = await lookup(session.idToken);
  session = { ...session, emailVerified: !!u.emailVerified, providers: providersOf(u) }; await save(); emit();
  return publicUser();
}
export async function signOut() { session = null; await save(); emit(); }
export async function sendReset(email) { await post(AUTH + 'sendOobCode?key=' + API_KEY, { requestType: 'PASSWORD_RESET', email }); }
export async function changePassword(oldPw, newPw) {
  // Re-check the current password first, like the web app does
  const j = await post(AUTH + 'signInWithPassword?key=' + API_KEY, { email: session.email, password: oldPw, returnSecureToken: true });
  const u = await post(AUTH + 'update?key=' + API_KEY, { idToken: j.idToken, password: newPw, returnSecureToken: true });
  session = { ...session, idToken: u.idToken, refreshToken: u.refreshToken, expiresAt: Date.now() + (Number(u.expiresIn) - 120) * 1000 };
  await save();
}

/* ---------- Firestore values ---------- */
export const SERVER_TIME = { __fb: 'serverTime' };
export const arrayUnion = (...values) => ({ __fb: 'arrayUnion', values });
export const timestamp = ms => ({ toMillis: () => ms, toDate: () => new Date(ms) });

function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return timestamp(Date.parse(v.timestampValue));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
function decFields(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) o[k] = dec(v); return o; }
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v.toMillis === 'function') return { timestampValue: new Date(v.toMillis()).toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
function encFields(o) { const f = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && !v?.__fb) f[k] = enc(v); return f; }
const idOf = name => name.split('/').pop();
const fieldPath = k => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k.replace(/`/g, '\\`') + '`';

async function api(url, opts = {}) {
  let r;
  try { r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) } }); }
  catch (e) { throw new Error('No connection'); }
  if (r.status === 404 && (!opts.method || opts.method === 'GET')) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || 'HTTP ' + r.status);
  return j;
}

/* ---------- Reads ---------- */
export async function getDoc(path) {
  const j = await api(`${DOCS}/${path}`).catch(() => null);
  return j?.fields ? decFields(j.fields) : null;
}
export async function exists(path) { const j = await api(`${DOCS}/${path}`).catch(() => null); return !!j?.name; }
export async function listDocs(path, max = 5000) {
  const out = []; let page = '';
  do {
    const j = await api(`${DOCS}/${path}?pageSize=300${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    (j?.documents || []).forEach(d => out.push({ id: idOf(d.name), ...decFields(d.fields) }));
    page = j?.nextPageToken || '';
  } while (page && out.length < max);
  return out;
}
// where: [[field, op, value]] with op one of == in   ; orderBy: [field, 'desc'|'asc']
export async function query(parent, collection, { where = [], orderBy, limit } = {}) {
  const OP = { '==': 'EQUAL', in: 'IN', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN' };
  const filters = where.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: OP[op], value: enc(v) } }));
  const sq = { from: [{ collectionId: collection }] };
  if (filters.length === 1) sq.where = filters[0];
  if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters } };
  if (orderBy) sq.orderBy = [{ field: { fieldPath: orderBy[0] }, direction: orderBy[1] === 'asc' ? 'ASCENDING' : 'DESCENDING' }];
  if (limit) sq.limit = limit;
  const j = await api(`${DOCS}${parent ? '/' + parent : ''}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
  return (j || []).filter(r => r.document).map(r => ({ id: idOf(r.document.name), ...decFields(r.document.fields) }));
}

/* ---------- Writes (batched through :commit, like the SDK) ---------- */
function transformsOf(data) {
  const t = [];
  for (const [k, v] of Object.entries(data)) {
    if (v?.__fb === 'serverTime') t.push({ fieldPath: fieldPath(k), setToServerValue: 'REQUEST_TIME' });
    if (v?.__fb === 'arrayUnion') t.push({ fieldPath: fieldPath(k), appendMissingElements: { values: v.values.map(enc) } });
  }
  return t;
}
export const W = {
  set: (path, data, { merge } = {}) => {
    const w = { update: { name: `${ROOT}/${path}`, fields: encFields(data) } };
    if (merge) w.updateMask = { fieldPaths: Object.keys(data).filter(k => !data[k]?.__fb).map(fieldPath) };
    const t = transformsOf(data); if (t.length) w.updateTransforms = t;
    return w;
  },
  update: (path, data) => {
    const w = W.set(path, data, { merge: true }); w.currentDocument = { exists: true }; return w;
  },
  create: (path, data) => { const w = W.set(path, data); w.currentDocument = { exists: false }; return w; },
  del: path => ({ delete: `${ROOT}/${path}` }),
};
export async function commit(writes) {
  if (!writes.length) return;
  for (let i = 0; i < writes.length; i += 400)
    await api(`${DOCS}:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
}
export const setDoc = (path, data, opts) => commit([W.set(path, data, opts)]);
export const updateDoc = (path, data) => commit([W.update(path, data)]);
export const deleteDoc = path => commit([W.del(path)]);
export function newId() {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
  for (let i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
export async function addDoc(colPath, data) { const id = newId(); await commit([W.set(`${colPath}/${id}`, data)]); return id; }
