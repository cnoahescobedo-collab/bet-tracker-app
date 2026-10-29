// Me: private stats (Polymarket US account + tracked slips), account and settings.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import * as fb from './fb';
import { tally, profitOf, slipCategory } from './core';
import { useApp, isPerson } from './store';
import { usePoly } from './poly';
import { useNav } from './nav';
import { C, S, T, money, signed, pct } from './theme';
import { Stat, Grid, Section, Card, Button, Field, Toggle, Banner, Row, Spacer, Pill, ConfirmButton, Fine } from './ui';
import { pwCheck, pwLeaked, PwRules, authMsg } from './AuthScreen';
import { toCsv, shareCsv } from './export';

export default function MeScreen() {
  const { user, me, visible, slips, isMine, members, uid, actions, toast, leaveGroup, signOutAll, showMoney } = useApp();
  const { key, hist, histAt, flow, histStatus, refreshHistory, disconnect } = usePoly();
  const nav = useNav();
  const mine = visible.filter(isMine).filter(isPerson);
  const t = tally(mine); const open = mine.filter(s => s.status === 'open');
  const best = mine.filter(s => s.status === 'won').sort((a, b) => profitOf(b) - profitOf(a))[0];
  const [name, setName] = useState(me.name); useEffect(() => setName(me.name), [me.name]);
  const [renaming, setRenaming] = useState(false);

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Fine>Only you can see this screen. Your Polymarket account totals are read on this phone and never sent to the group.</Fine>
      <Section title="Polymarket US account" sub={!key ? 'Connect Polymarket US to see your full account history.' : histStatus || (histAt ? 'Updated ' + new Date(histAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Loading your history…')}>
        {!key ? <Button kind="ghost" icon="link-outline" label="Connect Polymarket" onPress={() => nav.go('polymarket')} /> : <PmAccount hist={hist} flow={flow} />}
      </Section>
      <Section title="Your tracked slips">
        <Grid>
          <Stat label="Net" value={signed(t.profit)} tone={t.profit > 0 ? 'won' : t.profit < 0 ? 'lost' : null} sub="Bets in the group tracker" />
          <Stat label="Record" value={`${t.w}-${t.l}${t.p ? '-' + t.p : ''}`} sub={t.pct != null ? pct(t.pct) + ' won' : ''} />
          <Stat label="Staked" value={money(t.staked)} sub={t.roi != null ? 'ROI ' + pct(t.roi) : ''} />
          <Stat label="Legs hit" value={pct(t.legPct)} sub={`${t.legsW} of ${t.legsT}`} />
          <Stat label="Open" value={String(open.length)} sub={money(open.reduce((m, s) => m + (Number(s.stake) || 0), 0)) + ' riding'} />
          <Stat label="Biggest hit" value={best ? signed(profitOf(best)) : '–'} sub={best ? `${best.legs.length}-leg ${slipCategory(best)}` : ''} tone={best ? 'won' : null} />
        </Grid>
      </Section>
      <Section title="Settings">
        <Card>
          <Toggle label="Hide my dollar amounts" sub="Friends still see wins, losses and percentages." value={!!members[uid]?.hideMoney}
            onChange={v => actions.setHideMoney(v).then(() => toast(v ? 'Your dollar amounts are hidden from the group.' : 'Your dollar amounts are visible to the group.')).catch(e => toast("Couldn't save: " + e.message, 'error'))} />
          <Field label="Display name" maxLength={24} autoCapitalize="words" value={name} onChangeText={setName} />
          <Button small kind="ghost" label="Change name" busy={renaming} disabled={!name.trim() || name.trim() === me.name} onPress={async () => {
            setRenaming(true);
            try { await actions.rename(name); toast("You're now " + name.trim() + '.'); } catch (e) { toast("Couldn't rename: " + e.message, 'error'); } finally { setRenaming(false); }
          }} />
          <Button small kind="ghost" icon="download-outline" label="Export my history (CSV)" onPress={() => shareCsv('my-bets.csv', toCsv(slips.filter(isMine), showMoney))} />
        </Card>
      </Section>
      <Section title="Account">
        <Card>
          <Row><Text style={[T.body, { flex: 1 }]} numberOfLines={1}>Signed in as <Text style={{ fontWeight: '700' }}>{user.email}</Text></Text><Pill small tone={user.emailVerified ? 'won' : 'lost'} label={user.emailVerified ? 'Verified' : 'Not verified'} /></Row>
          <PasswordChange />
          <Button small kind="ghost" icon="swap-horizontal" label="Switch group" onPress={leaveGroup} />
          <Button small kind="ghost" icon="log-out-outline" label="Sign out" onPress={signOutAll} />
          {key ? <ConfirmButton small kind="danger" label="Sign out & forget my Polymarket key" confirmLabel="Tap again to sign out" onConfirm={async () => { await disconnect().catch(() => {}); signOutAll(); }} /> : null}
        </Card>
      </Section>
    </ScrollView>
  );
}

function PmAccount({ hist, flow }) {
  if (!hist || !Object.keys(hist).length) return <Fine>Reading your history… this takes a minute the first time.</Fine>;
  const rows = Object.values(hist).filter(x => x.settled); const open = Object.values(hist).filter(x => !x.settled);
  const net = rows.reduce((m, x) => m + x.pnl, 0), staked = rows.reduce((m, x) => m + x.stake, 0);
  const w = rows.filter(x => x.pnl > 0.004).length, l = rows.filter(x => x.pnl < -0.004).length;
  const won = rows.filter(x => x.pnl > 0).reduce((m, x) => m + x.pnl, 0), lost = rows.filter(x => x.pnl < 0).reduce((m, x) => m + x.pnl, 0);
  const byCat = new Map(); rows.forEach(x => { const c = x.cat || 'Other'; if (!byCat.has(c)) byCat.set(c, { w: 0, l: 0, pnl: 0, stake: 0 }); const t = byCat.get(c); if (x.pnl > 0.004) t.w++; else if (x.pnl < -0.004) t.l++; t.pnl += x.pnl; t.stake += x.stake; });
  const truth = flow && flow.cash != null ? (flow.cash + flow.open) - (flow.dep - flow.wd) - flow.bonus - flow.xfer : null;
  return (
    <View style={{ gap: S.md }}>
      <Grid>
        <Stat label="Net all-time" value={signed(net)} tone={net > 0 ? 'won' : net < 0 ? 'lost' : null} sub="Every settled market" />
        <Stat label="Record" value={`${w}-${l}`} sub={w + l ? Math.round(w / (w + l) * 100) + '% of markets won' : ''} />
        <Stat label="Total won" value={signed(won)} tone="won" sub="Profit from winners" />
        <Stat label="Total lost" value={money(lost)} tone="lost" sub="From losers" />
        <Stat label="Staked" value={money(staked)} sub={staked ? 'ROI ' + Math.round(net / staked * 100) + '%' : ''} />
        <Stat label="Open now" value={String(open.length)} sub={money(open.reduce((m, x) => m + x.stake, 0)) + ' in play'} />
      </Grid>
      {truth != null && (
        <Card style={{ gap: 6 }}>
          <Text style={T.tiny}>True result (money in vs. money now)</Text>
          <Text style={[T.h1, T.num, { color: truth > 0 ? C.win : truth < 0 ? C.loss : C.ink }]}>{signed(truth)}</Text>
          <Text style={T.small}>Deposited {money(flow.dep)}{flow.wd ? ` · withdrew ${money(flow.wd)}` : ''}{flow.bonus ? ` · bonuses ${money(flow.bonus)}` : ''} · cash now {money(flow.cash)} + open bets {money(flow.open)}{flow.pendingDep ? ` · ${money(flow.pendingDep)} deposit still pending` : ''}.</Text>
          <Text style={T.small}>{Math.abs(truth - net) >= 1 ? `The market-by-market total is ${money(Math.abs(truth - net))} ${truth > net ? 'lower' : 'higher'}. This line is the one that matches your bank.` : 'Matches the market-by-market total.'}</Text>
        </Card>
      )}
      <Card style={{ gap: 0, padding: 0 }}>
        <Row style={{ padding: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={[T.tiny, { flex: 1 }]}>Sport</Text><Text style={[T.tiny, { width: 60, textAlign: 'right' }]}>Record</Text><Text style={[T.tiny, { width: 70, textAlign: 'right' }]}>Staked</Text><Text style={[T.tiny, { width: 76, textAlign: 'right' }]}>Net</Text></Row>
        {[...byCat].sort((a, b) => b[1].pnl - a[1].pnl).map(([c, t]) => (
          <Row key={c} style={{ padding: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Text style={[T.body, { flex: 1 }]}>{c}</Text>
            <Text style={[T.small, T.num, { width: 60, textAlign: 'right' }]}>{t.w}-{t.l}</Text>
            <Text style={[T.small, T.num, { width: 70, textAlign: 'right' }]}>{money(t.stake)}</Text>
            <Text style={[T.num, { width: 76, textAlign: 'right', fontWeight: '700', color: t.pnl > 0 ? C.win : t.pnl < 0 ? C.loss : C.muted }]}>{signed(t.pnl)}</Text>
          </Row>
        ))}
      </Card>
    </View>
  );
}

function PasswordChange() {
  const { user, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [old, setOld] = useState(''); const [nw, setNw] = useState(''); const [nw2, setNw2] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  if (!(user.providers || []).includes('password')) return null;
  if (!open) return <Button small kind="ghost" icon="key-outline" label="Change password" onPress={() => setOpen(true)} />;
  const go = async () => {
    const c = pwCheck(nw, nw2); setMsg('');
    if (!old) { setMsg('Enter your current password.'); return; }
    if (!c.len || !c.mix) { setMsg('New password needs at least 8 characters and 3 of: lowercase, uppercase, number, symbol (or 14+ characters).'); return; }
    if (!c.match) { setMsg("The new passwords don't match."); return; }
    if (nw === old) { setMsg("Pick a new password that's different from the current one."); return; }
    setBusy(true);
    try {
      const seen = await pwLeaked(nw); if (seen) { setMsg(`That password has shown up in ${seen.toLocaleString()} data leaks. Pick a different one.`); return; }
      await fb.changePassword(old, nw); setOld(''); setNw(''); setNw2(''); setOpen(false); toast('Password changed.');
    } catch (e) { setMsg(e.code === 'auth/invalid-credential' ? "Your current password isn't right." : authMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: S.md }}>
      <Field label="Current password" secureTextEntry value={old} onChangeText={setOld} />
      <Field label="New password" secureTextEntry value={nw} onChangeText={setNw} />
      <Field label="Confirm new" secureTextEntry value={nw2} onChangeText={setNw2} />
      <PwRules pw={nw} pw2={nw2} />
      <Banner text={msg} kind="error" />
      <Row><Button small label="Change password" busy={busy} onPress={go} /><Button small kind="ghost" label="Cancel" onPress={() => setOpen(false)} /></Row>
    </View>
  );
}
