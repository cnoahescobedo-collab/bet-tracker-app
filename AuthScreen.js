// Sign in / create account / verify email / join or start a group / waiting for approval.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Pressable, AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as fb from './fb';
import { useApp } from './store';
import { C, S, T } from './theme';
import { Button, Field, Banner, Fine, Row, Bar, Ionicons, Toggle } from './ui';

export const authMsg = e => {
  const c = e?.code || '';
  return c === 'auth/invalid-credential' ? "That email and password don't match. Check them, or tap “Forgot password?”."
    : c === 'auth/email-already-in-use' ? "There's already an account with that email. Tap Sign in instead."
      : c === 'auth/weak-password' ? 'Pick a longer password (at least 8 characters).'
        : c === 'auth/requires-recent-login' ? 'For security, sign out and back in, then try again.'
          : c === 'auth/invalid-email' ? "That email address doesn't look right."
            : c === 'auth/too-many-requests' ? 'Too many tries. Wait a few minutes and try again.'
              : c === 'auth/network-request-failed' ? 'No connection. Check your internet and try again.'
                : (e?.message || String(e));
};
export function pwCheck(pw, pw2) {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  const r = { len: pw.length >= 8, mix: kinds >= 3 || pw.length >= 14, match: !!pw && pw === pw2 };
  const score = Math.min(4, (pw.length >= 8) + (pw.length >= 12) + (kinds >= 3) + (kinds >= 4 || pw.length >= 16));
  return { ...r, ok: r.len && r.mix && r.match, score };
}
// Same leaked-password check as the web app: only the first 5 characters of a scrambled hash leave the phone
export async function pwLeaked(pw) {
  try {
    const h = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, pw)).toUpperCase();
    const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { headers: { 'Add-Padding': 'true' } });
    if (!r.ok) return 0;
    const line = (await r.text()).split('\n').find(l => l.startsWith(h.slice(5)));
    return line ? Number(line.split(':')[1]) || 0 : 0;
  } catch (e) { return 0; }
}
export function PwRules({ pw, pw2 }) {
  const c = pwCheck(pw, pw2);
  const rule = (ok, t) => <Row key={t}><Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={ok ? C.win : C.faint} /><Text style={[T.small, ok && { color: C.ink }]}>{t}</Text></Row>;
  return (
    <View style={{ gap: 6 }}>
      <Bar pct={c.score / 4} tone={c.score >= 3 ? 'won' : c.score >= 2 ? 'live' : 'lost'} height={6} />
      {rule(c.len, 'At least 8 characters')}
      {rule(c.mix, 'At least 3 of: lowercase, uppercase, number, symbol (or 14+ characters)')}
      {rule(c.match, 'Both passwords match')}
    </View>
  );
}

const Wrap = ({ children }) => (
  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: S.xl, gap: S.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  </KeyboardAvoidingView>
);
const Brand = () => <Text style={{ color: C.ink, fontWeight: '900', letterSpacing: 2, fontSize: 13, marginBottom: S.lg }}>LIVE BET <Text style={{ color: C.accent }}>TRACKER</Text></Text>;

export function SignIn() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const up = mode === 'signup';
  const go = async () => {
    setMsg(''); setOk('');
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { setMsg('Enter a valid email address.'); return; }
    if (!pw) { setMsg('Enter your password.'); return; }
    setBusy(true);
    try {
      if (up) {
        const c = pwCheck(pw, pw2);
        if (!c.len || !c.mix) { setMsg('Your password needs at least 8 characters and 3 of: lowercase, uppercase, number, symbol (or 14+ characters).'); return; }
        if (!c.match) { setMsg("The two passwords don't match."); return; }
        const seen = await pwLeaked(pw);
        if (seen) { setMsg(`That password has shown up in ${seen.toLocaleString()} data leaks, so it isn't safe. Pick one you don't use anywhere else.`); return; }
        await fb.signUp(e, pw);
      } else await fb.signIn(e, pw);
    } catch (err) { setMsg(authMsg(err)); } finally { setBusy(false); }
  };
  const forgot = async () => {
    setMsg(''); if (!email.trim()) { setMsg('Type your email above first, then tap “Forgot password?”.'); return; }
    try { await fb.sendReset(email.trim()); setOk(`If there's an account for ${email.trim()}, a reset link is on its way. Check spam too.`); } catch (e) { setMsg(authMsg(e)); }
  };
  return (
    <Wrap>
      <Brand />
      <Text style={T.hero}>{up ? 'Create your\naccount' : 'Every leg.\nLive.'}</Text>
      <Text style={[T.body, { color: C.muted, marginBottom: S.sm }]}>{up ? 'One account works on the web app and this app.' : 'Sign in with the same account you use on the web app. Your group and slips come with you.'}</Text>
      <Field placeholder="Email" keyboardType="email-address" textContentType="emailAddress" autoComplete="email" value={email} onChangeText={setEmail} />
      <Field placeholder={up ? 'Create a password' : 'Password'} secureTextEntry={!show} textContentType={up ? 'newPassword' : 'password'} value={pw} onChangeText={setPw} onSubmitEditing={up ? undefined : go} />
      {up && <Field placeholder="Type it again" secureTextEntry={!show} textContentType="newPassword" value={pw2} onChangeText={setPw2} />}
      {up && <PwRules pw={pw} pw2={pw2} />}
      {up && <Fine>Use a password you don't use anywhere else. We check it against known leaked passwords. Only a scrambled fragment is sent, never your password.</Fine>}
      <Toggle label="Show password" value={show} onChange={setShow} />
      <Banner text={msg} kind="error" /><Banner text={ok} kind="ok" />
      <Button label={up ? 'Create account' : 'Sign in'} onPress={go} busy={busy} />
      <Row style={{ justifyContent: 'center', marginTop: 4 }} gap={S.lg}>
        {!up && <Pressable onPress={forgot} hitSlop={8}><Text style={{ color: C.muted, fontWeight: '600' }}>Forgot password?</Text></Pressable>}
        <Pressable onPress={() => { setMode(up ? 'signin' : 'signup'); setMsg(''); setOk(''); }} hitSlop={8}>
          <Text style={{ color: C.accent, fontWeight: '700' }}>{up ? 'I have an account' : 'Create an account'}</Text>
        </Pressable>
      </Row>
      <Fine style={{ textAlign: 'center', marginTop: S.md }}>Signed up with Google on the web? Use “Forgot password?” with that email to set a password for the app.</Fine>
    </Wrap>
  );
}

export function Verify({ user }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(0);
  const check = async quiet => {
    if (!quiet) setBusy(true);
    try { const u = await fb.reloadUser(); if (!u?.emailVerified && !quiet) setMsg('Not confirmed yet. Tap the link in the email first (check spam), then try again.'); }
    catch (e) { if (!quiet) setMsg(authMsg(e)); } finally { setBusy(false); }
  };
  useEffect(() => { const sub = AppState.addEventListener('change', s => { if (s === 'active') check(true); }); return () => sub.remove(); }, []);
  return (
    <Wrap>
      <Brand />
      <Text style={T.h1}>Check your email</Text>
      <Text style={[T.body, { color: C.muted }]}>We sent a link to {user.email}. Tap it to confirm it's you, then come back and tap Continue.</Text>
      <Fine>Don't see it? Check spam or promotions. The email comes from noreply@live-bet-tracker-b4f3f.firebaseapp.com.</Fine>
      <Banner text={msg} />
      <Button label="I've confirmed. Continue" onPress={() => check(false)} busy={busy} />
      <Button kind="ghost" label="Resend email" onPress={async () => {
        if (Date.now() - last < 60000) { setMsg('Give it a minute before sending another email.'); return; }
        try { await fb.sendVerify(); setLast(Date.now()); setMsg('Sent. Check your inbox and spam.'); } catch (e) { setMsg(authMsg(e)); }
      }} />
      <Button kind="ghost" label="Sign out" onPress={() => fb.signOut()} />
    </Wrap>
  );
}

export function Join() {
  const { enterGroup, me, signOutAll } = useApp();
  const [name, setName] = useState(me?.name || ''); const [code, setCode] = useState(me?.group || '');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const go = async create => {
    setMsg(''); setBusy(create ? 'create' : 'join');
    try { await enterGroup(name, code, create); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  return (
    <Wrap>
      <Brand />
      <Text style={T.h1}>Join your group</Text>
      <Text style={[T.body, { color: C.muted }]}>Everyone in a group sees each other's slips live. Pick the name your friends know you by. Joining an existing group needs the owner's approval.</Text>
      <Field label="Your name" maxLength={24} autoCapitalize="words" placeholder="e.g. Noah" value={name} onChangeText={setName} />
      <Field label="Group code" maxLength={12} autoCapitalize="characters" placeholder="Have a code? Enter it here" value={code} onChangeText={setCode} />
      <Banner text={msg} kind="error" />
      <Button label="Join group" onPress={() => go(false)} busy={busy === 'join'} />
      <Button kind="ghost" label="Start a new group" onPress={() => go(true)} busy={busy === 'create'} />
      <Button kind="ghost" label="Sign out" onPress={signOutAll} />
    </Wrap>
  );
}

export function Pending() {
  const { me, leaveGroup, signOutAll } = useApp();
  return (
    <Wrap>
      <Brand />
      <Text style={T.h1}>Waiting for approval</Text>
      <Text style={[T.body, { color: C.muted }]}>You asked to join group {me?.group} as {me?.name}. The group owner needs to approve you. This screen updates on its own as soon as they do.</Text>
      <Button kind="ghost" label="Use a different group" onPress={leaveGroup} />
      <Button kind="ghost" label="Sign out" onPress={signOutAll} />
    </Wrap>
  );
}
