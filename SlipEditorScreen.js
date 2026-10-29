// Full-screen slip editor: new slip, edit slip, tail a pick, or read a screenshot.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, KeyboardAvoidingView, Platform, Image, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LEAGUES, KIND_LABEL, sportOf, marketFor, oddsToPayout, parseMoney, parseSlip } from './core';
import { rosterNames } from './espn';
import { useApp } from './store';
import { kindsFor } from './LiveScreen';
import { C, S, T } from './theme';
import { Button, Field, Select, Banner, Row, Spacer, Bar, Ionicons, Fine } from './ui';

const LEAGUE_OPTS = Object.entries(LEAGUES).map(([k, v]) => [k, v.label]);
const blank = lg => ({ league: lg, kind: kindsFor(lg)[0], side: 'over' });

// Screenshot reader: Tesseract running inside a hidden web view, entirely on the phone
const OCR_HTML = `<!doctype html><html><body><script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script><script>
function post(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
window.run=async function(d){ try{ const r=await Tesseract.recognize(d,'eng',{logger:function(m){ if(m.status==='recognizing text') post({p:m.progress}); }}); post({text:r.data.text}); }catch(e){ post({err:String(e&&e.message||e)}); } };
post({ready: !!window.Tesseract});
</script></body></html>`;

function Ocr({ image, onProgress, onText, onError }) {
  const ref = useRef(null); const started = useRef(false);
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
      <WebView ref={ref} originWhitelist={['*']} source={{ html: OCR_HTML, baseUrl: 'https://localhost/' }} javaScriptEnabled
        onMessage={e => {
          let m; try { m = JSON.parse(e.nativeEvent.data); } catch (x) { return; }
          if (m.ready !== undefined) {
            if (!m.ready) { onError('Slip reader didn\'t load. Check your connection, or type the legs.'); return; }
            if (started.current) return; started.current = true;
            ref.current.injectJavaScript(`window.run(${JSON.stringify('data:' + image.mime + ';base64,' + image.base64)}); true;`);
          } else if (m.p != null) onProgress(m.p);
          else if (m.text != null) onText(m.text);
          else if (m.err) onError("Couldn't read that image. Type the legs in.");
        }}
        onError={() => onError("Slip reader didn't load. Check your connection, or type the legs.")} />
    </View>
  );
}

export default function SlipEditor({ title: title0, drafts: d0, stake: s0, odds: o0, payout: p0, editingId, image, league, onClose }) {
  const { actions, toast } = useApp();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(title0 || 'New slip');
  const [drafts, setDrafts] = useState(d0 && d0.length ? d0.map(d => ({ ...d, line: d.line == null ? '' : String(d.line) })) : image ? [] : [blank(league || 'nba')]);
  const [stake, setStake] = useState(s0 != null ? String(s0) : '');
  const [odds, setOdds] = useState(o0 || '');
  const [payout, setPayout] = useState(p0 != null ? String(p0) : '');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(image ? 0.05 : null);
  const [reading, setReading] = useState(!!image);
  const namesP = useRef(image ? rosterNames(league).catch(() => []) : null);

  const syncPayout = (st, od) => { const p = oddsToPayout(st, od); if (p) setPayout(String(p)); };
  const set = (i, k, v) => setDrafts(ds => ds.map((d, j) => {
    if (j !== i) return d;
    const n = { ...d, [k]: v };
    if (k === 'league' && !kindsFor(v).includes(n.kind)) n.kind = kindsFor(v)[0];
    return n;
  }));
  const gotText = async text => {
    const names = await namesP.current;
    const m = parseMoney(text);
    if (m.stake) setStake(String(m.stake)); if (m.odds) setOdds(m.odds);
    if (m.payout) setPayout(String(m.payout)); else if (m.stake && m.odds) syncPayout(m.stake, m.odds);
    const legs = parseSlip(text, league, names).map(d => ({ ...d, line: d.line == null ? '' : String(d.line) }));
    if (!legs.length) { setDrafts([blank(league)]); setTitle(`No ${LEAGUES[league].label} names found. Check the sport, or type the legs`); }
    else { setDrafts(legs); setTitle(`Found ${legs.length} leg${legs.length > 1 ? 's' : ''}. Check them, then post`); }
    setProg(1); setReading(false);
  };

  const save = async () => {
    const problems = [];
    drafts.forEach((d, i) => {
      const n = `Leg ${i + 1}: `;
      if (d.kind === 'prop') { if (!d.player) problems.push(n + 'add the player.'); if (!marketFor(d.league, d.market)) problems.push(n + `“${d.market || 'stat'}” isn't a stat I can track. Try points, rebounds, rec yds, shots on goal…`); }
      if (['prop', 'total', 'spread'].includes(d.kind) && (d.line === '' || isNaN(Number(d.line)))) problems.push(n + 'add the line.');
      if (d.kind !== 'prop' && d.kind !== 'manual' && !d.team) problems.push(n + (sportOf(d.league) === 'ten' ? 'add the player.' : 'add a team so I can find the game.'));
      if (d.kind === 'manual' && !d.market) problems.push(n + 'describe the bet.');
    });
    const st = Number(stake) || 0, po = Number(payout) || 0;
    if (!drafts.length) problems.push('Add at least one leg.');
    if (!st) problems.push('Add your stake.');
    if (st && po && po < st) problems.push("Payout should be the total you'd get back, including your stake.");
    if (problems.length) { setMsg(problems.join(' ')); return; }
    setMsg(''); setBusy(true);
    const legs = drafts.map(d => ({ league: d.league, kind: d.kind, side: d.side || 'over', player: d.player || null, team: d.team || null, market: d.market || null, line: d.line === '' || d.line == null ? null : Number(d.line), gameId: null, result: null }));
    try { await actions.postSlip({ stake: st, payout: po, odds: odds.trim(), legs }, editingId); toast(editingId ? 'Slip updated.' : 'Slip posted. Your group can see it now.'); onClose(); }
    catch (e) { setMsg((editingId ? "Couldn't save: " : "Couldn't post the slip: ") + e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: S.lg, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={26} color={C.ink} /></Pressable>
          <Text style={[T.h2, { flex: 1 }]} numberOfLines={2}>{title}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {image ? <Image source={{ uri: image.uri }} style={{ width: '100%', height: 220, borderRadius: 14, backgroundColor: C.surface }} resizeMode="contain" /> : null}
          {prog != null && prog < 1 ? <View><Text style={T.small}>Reading the screenshot on your phone…</Text><Bar pct={prog} /></View> : null}
          {image && reading ? <Ocr image={image} onProgress={p => setProg(0.1 + 0.85 * p)} onText={gotText} onError={m => { setReading(false); setProg(null); setDrafts([blank(league)]); setTitle(m); }} /> : null}
          <Row gap={S.md}>
            <Field flex={1} label="Stake $" keyboardType="decimal-pad" placeholder="10" value={stake} onChangeText={v => { setStake(v); syncPayout(v, odds); }} />
            <Field flex={1} label="Odds" placeholder="+450" value={odds} onChangeText={v => { setOdds(v); syncPayout(stake, v); }} />
            <Field flex={1} label="Payout $" keyboardType="decimal-pad" placeholder="55" value={payout} onChangeText={setPayout} />
          </Row>
          {drafts.map((d, i) => <LegEdit key={i} d={d} i={i} set={set} onRemove={() => setDrafts(ds => { const n = ds.filter((_, j) => j !== i); return n.length ? n : [blank(d.league)]; })} />)}
          {!reading && <Button kind="ghost" icon="add" label="Add a leg" onPress={() => setDrafts(ds => [...ds, blank(ds[ds.length - 1]?.league || league || 'nba')])} />}
          <Banner text={msg} kind="error" />
          <Button label={editingId ? 'Save changes' : 'Post slip'} onPress={save} busy={busy} disabled={reading} />
          <Fine>Payout is the total you'd get back, including your stake. Enter odds and stake and it fills in.</Fine>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LegEdit({ d, i, set, onRemove }) {
  const sp = sportOf(d.league);
  const kinds = kindsFor(d.league);
  const prop = d.kind === 'prop';
  const teamLabel = sp === 'ten' ? 'Player to win' : (d.kind === 'total' || d.kind === 'draw') ? 'Team (either side)' : 'Team';
  return (
    <View style={{ backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: S.md, gap: S.md }}>
      <Row><Text style={T.tiny}>Leg {i + 1}</Text><Spacer /><Pressable onPress={onRemove} hitSlop={8}><Text style={{ color: C.loss, fontWeight: '700', fontSize: 13 }}>Remove</Text></Pressable></Row>
      <Row gap={S.md}>
        <Select style={{ flex: 1 }} label="League" value={d.league} options={LEAGUE_OPTS} onChange={v => set(i, 'league', v)} />
        <Select style={{ flex: 1 }} label="Bet type" value={d.kind} options={kinds.map(k => [k, KIND_LABEL[k]])} onChange={v => set(i, 'kind', v)} />
      </Row>
      {(prop || d.kind === 'total') && <Select label="Side" value={d.side || 'over'} options={[['over', 'Over'], ['under', 'Under']]} onChange={v => set(i, 'side', v)} />}
      {prop && <Field label="Player" placeholder="e.g. Stephen Curry" autoCapitalize="words" value={d.player || ''} onChangeText={v => set(i, 'player', v)} />}
      {d.kind === 'manual'
        ? <Field label="Description" placeholder="e.g. Fight goes the distance" autoCapitalize="sentences" value={d.market || ''} onChangeText={v => set(i, 'market', v)} />
        : <Field label={prop ? 'Team (optional)' : teamLabel} placeholder={sp === 'ten' ? 'e.g. Jannik Sinner' : 'e.g. Warriors'} autoCapitalize="words" value={d.team || ''} onChangeText={v => set(i, 'team', v)} />}
      <Row gap={S.md}>
        {prop && <Field flex={1} label="Stat" placeholder="points, rec yds, SOG…" value={d.market || ''} onChangeText={v => set(i, 'market', v)} />}
        {['prop', 'total', 'spread'].includes(d.kind) && <Field flex={1} label="Line" keyboardType="numbers-and-punctuation" placeholder={d.kind === 'spread' ? '-3.5' : '24.5'} value={String(d.line ?? '')} onChangeText={v => set(i, 'line', v)} />}
      </Row>
    </View>
  );
}
