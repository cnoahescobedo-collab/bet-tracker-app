// Connect Polymarket US (API key) or Polymarket.com (wallet address).
import React, { useState } from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { usePoly } from './poly';
import { useApp } from './store';
import { C, S, T } from './theme';
import { Button, Field, Chips, Toggle, Banner, Card, Fine, Row, Pill, ConfirmButton } from './ui';

export default function PolymarketScreen() {
  const { toast } = useApp();
  const { key, member, saveKey, saveWallet, disconnect, refreshHistory, histStatus } = usePoly();
  const [kind, setKind] = useState(member.polyAddress && !key ? 'global' : 'us');
  const [keyId, setKeyId] = useState(key?.keyId || ''); const [secret, setSecret] = useState('');
  const [addr, setAddr] = useState(member.polyAddress || ''); const [all, setAll] = useState(!!member.polyAll);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const connected = !!key || !!member.polyAddress;
  const save = async () => {
    setMsg(''); setBusy(true);
    try {
      if (kind === 'us') await saveKey(keyId, secret || key?.secret || '', all);
      else await saveWallet(addr, all);
      setSecret(''); toast('Polymarket connected. Your bets sync automatically.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Row><Text style={T.h2}>Status</Text><Pill small tone={connected ? 'won' : 'push'} label={connected ? 'Connected' : 'Not connected'} /></Row>
        <Text style={T.small}>{key ? `Polymarket US key ${key.keyId.slice(0, 8)}… is saved in this phone's secure storage.` : member.polyAddress ? `Wallet ${member.polyAddress.slice(0, 6)}…${member.polyAddress.slice(-4)} is connected.` : 'Connect to import your Polymarket bets as slips automatically.'}</Text>
        {histStatus ? <Fine>{histStatus}</Fine> : null}
      </Card>
      <Text style={T.tiny}>Which Polymarket do you use?</Text>
      <Chips scroll={false} items={[['us', 'Polymarket US'], ['global', 'Polymarket.com']]} value={kind} onChange={setKind} />
      {kind === 'us' ? (
        <View style={{ gap: S.md }}>
          <Text style={T.body}>Create a key at <Text style={{ color: C.accent, fontWeight: '700' }} onPress={() => Linking.openURL('https://polymarket.us/developer')}>polymarket.us/developer</Text>. Sign in the same way you do in the app, tap create key, and copy both values. The secret key is only shown once.</Text>
          <Banner kind="ok" text="Your key stays on this phone, in its secure storage. It isn't sent to your friends or the group database. The app only reads your positions and never places trades. To cut off access anytime, delete the key on polymarket.us/developer." />
          <Field label="Key ID" placeholder="xxxxxxxx-xxxx-…" value={keyId} onChangeText={setKeyId} />
          <Field label="Secret key" placeholder={key ? 'Saved. Paste again only to replace it' : 'Paste the secret key'} secureTextEntry value={secret} onChangeText={setSecret} />
          <Fine>A key saved in the web app stays in that browser, so connect it again here once.</Fine>
        </View>
      ) : (
        <View style={{ gap: S.md }}>
          <Text style={T.body}>Paste your wallet address from your Polymarket.com profile. It starts with 0x. It's public and read-only.</Text>
          <Field label="Wallet address" placeholder="0x…" value={addr} onChangeText={setAddr} />
        </View>
      )}
      <Toggle label="Also import non-sports markets" value={all} onChange={setAll} />
      <Banner text={msg} kind="error" />
      <Button label="Save" onPress={save} busy={busy} />
      {key ? <Button kind="ghost" icon="refresh" label="Re-check Polymarket history" onPress={() => { toast('Checking your Polymarket history…'); refreshHistory().then(() => toast('Polymarket history is up to date.')); }} /> : null}
      {connected ? <ConfirmButton kind="danger" label="Disconnect" confirmLabel="Tap again to disconnect" onConfirm={() => disconnect().then(() => { setSecret(''); setKeyId(''); setAddr(''); toast('Polymarket disconnected.'); })} /> : null}
    </ScrollView>
  );
}
