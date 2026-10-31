// Reusable building blocks for every screen.
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Modal, ScrollView, Switch as RNSwitch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, R, S, T, statusColor } from './theme';

export { Ionicons };

export function Pill({ label, tone, small }) {
  const col = statusColor(tone);
  return (
    <View style={[st.pill, { backgroundColor: col + '22', borderColor: col + '55' }, small && { paddingVertical: 1, paddingHorizontal: 7 }]}>
      {tone === 'live' && <View style={[st.dot, { backgroundColor: col }]} />}
      <Text style={[st.pillText, { color: col }, small && { fontSize: 11 }]}>{label}</Text>
    </View>
  );
}
export function Tag({ label, color }) {
  return <Text style={[st.tag, color && { color, borderColor: color + '66' }]}>{label}</Text>;
}
export function Bar({ pct, tick, tone, height = 8 }) {
  const w = Math.max(0, Math.min(1, pct || 0));
  return (
    <View style={[st.track, { height }]}>
      <View style={[st.fill, { width: `${w * 100}%`, backgroundColor: tone ? statusColor(tone) : C.accent }]} />
      {tick ? <View style={[st.tick, { left: `${tick * 100}%` }]} /> : null}
    </View>
  );
}
export function Chip({ label, on, onPress, icon }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { opacity: 0.7 }]}>
      {icon ? <Ionicons name={icon} size={14} color={on ? C.bg : C.muted} style={{ marginRight: 5 }} /> : null}
      <Text style={[st.chipText, on && st.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}
// Horizontal row of chips; items = [[key, label]]
export function Chips({ items, value, onChange, scroll = true }) {
  const body = items.map(([k, l]) => <Chip key={k} label={l} on={k === value} onPress={() => onChange(k)} />);
  return scroll
    ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingRight: S.lg }} style={{ flexGrow: 0 }}>{body}</ScrollView>
    : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>{body}</View>;
}
export function Button({ label, onPress, kind = 'primary', busy, disabled, icon, small, style }) {
  const primary = kind === 'primary', danger = kind === 'danger';
  const fg = primary ? C.accentInk : danger ? C.loss : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [st.btn, small && st.btnSmall, primary ? st.btnPrimary : st.btnGhost, danger && { borderColor: C.loss + '66' }, (pressed || disabled) && { opacity: 0.7 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
          <Text style={[st.btnText, small && { fontSize: 14 }, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
export function Field({ label, style, ...props }) {
  const input = <TextInput placeholderTextColor={C.faint} style={[st.field, style]} autoCapitalize="none" autoCorrect={false} {...props} />;
  if (!label) return input;
  return <View style={{ gap: 6, flex: props.flex }}><Text style={T.tiny}>{label}</Text>{input}</View>;
}
// Dropdown replacement: tap to open a sheet of options. options = [[value, label]]
export function Select({ label, value, options, onChange, style }) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o[0] === value)?.[1] ?? 'Choose';
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={T.tiny}>{label}</Text> : null}
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [st.select, pressed && { opacity: 0.8 }]}>
        <Text style={{ color: C.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{cur}</Text>
        <Ionicons name="chevron-down" size={16} color={C.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        {options.map(([v, l]) => (
          <Pressable key={String(v)} onPress={() => { onChange(v); setOpen(false); }} style={({ pressed }) => [st.opt, pressed && { backgroundColor: C.raised }]}>
            <Text style={{ color: v === value ? C.accent : C.ink, fontSize: 16, fontWeight: v === value ? '700' : '400', flex: 1 }}>{l}</Text>
            {v === value ? <Ionicons name="checkmark" size={18} color={C.accent} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
export function Sheet({ visible, onClose, title, children, full }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose} />
      <View style={[st.sheet, full && { maxHeight: '92%', height: '92%' }]}>
        <View style={st.grab} />
        {title ? <View style={st.sheetHead}><Text style={T.h2}>{title}</Text><Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={C.muted} /></Pressable></View> : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}
export function Toggle({ label, value, onChange, sub }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <View style={{ flex: 1 }}><Text style={T.body}>{label}</Text>{sub ? <Text style={T.small}>{sub}</Text> : null}</View>
      <RNSwitch value={!!value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.track }} thumbColor="#fff" />
    </View>
  );
}
export function Stat({ label, value, sub, tone, wide }) {
  return (
    <View style={[st.stat, wide && { minWidth: '100%' }]}>
      <Text style={T.tiny}>{label}</Text>
      <Text style={[st.statVal, T.num, tone && { color: statusColor(tone) }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={T.small} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}
export const Grid = ({ children }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>{children}</View>;
export function Card({ children, style, onPress }) {
  const Comp = onPress ? Pressable : View;
  return <Comp onPress={onPress} style={[st.card, style]}>{children}</Comp>;
}
export function Section({ title, right, children, sub }) {
  return (
    <View style={{ gap: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md }}>
        <View style={{ flex: 1 }}><Text style={T.tiny}>{title}</Text>{sub ? <Text style={[T.small, { marginTop: 2 }]}>{sub}</Text> : null}</View>
        {right}
      </View>
      {children}
    </View>
  );
}
export function Empty({ title, body, icon = 'albums-outline' }) {
  return (
    <View style={st.empty}>
      <Ionicons name={icon} size={28} color={C.faint} />
      <Text style={[T.h2, { marginTop: 8, textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[T.small, { textAlign: 'center', marginTop: 6 }]}>{body}</Text> : null}
    </View>
  );
}
export function Banner({ text, kind = 'warn', onClose }) {
  if (!text) return null;
  const col = kind === 'error' ? C.loss : kind === 'ok' ? C.win : C.warnInk;
  return (
    <View style={[st.banner, { borderColor: col + '55', backgroundColor: col + '18' }]}>
      <Text style={{ color: col, flex: 1, fontSize: 14, lineHeight: 19 }}>{text}</Text>
      {onClose ? <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={18} color={col} /></Pressable> : null}
    </View>
  );
}
export const Fine = ({ children, style }) => <Text style={[T.small, { color: C.faint }, style]}>{children}</Text>;
export const Row = ({ children, style, gap = S.sm }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
export const Spacer = () => <View style={{ flex: 1 }} />;
// Tap twice to confirm (same pattern as the web app)
export function ConfirmButton({ label, confirmLabel = 'Tap again to confirm', onConfirm, ...rest }) {
  const [armed, setArmed] = useState(false);
  return <Button {...rest} label={armed ? confirmLabel : label} onPress={() => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
    setArmed(false); onConfirm();
  }} />;
}

const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: C.muted, borderWidth: 1, borderColor: C.line, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  track: { borderRadius: 4, backgroundColor: C.track, overflow: 'hidden', marginTop: S.sm },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.ink, opacity: 0.5 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: C.bg },
  btn: { height: 50, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.lg },
  btnSmall: { height: 38, paddingHorizontal: S.md, borderRadius: R.sm + 2 },
  btnPrimary: { backgroundColor: C.accent },
  btnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnText: { fontSize: 16, fontWeight: '800' },
  field: { minHeight: 48, borderRadius: R.md, backgroundColor: C.sunk, borderWidth: 1, borderColor: C.line, color: C.ink, paddingHorizontal: S.md + 2, fontSize: 16 },
  select: { minHeight: 46, borderRadius: R.md, backgroundColor: C.sunk, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md + 2, flexDirection: 'row', alignItems: 'center', gap: S.sm },
  scrim: { flex: 1, backgroundColor: '#000a' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '75%', paddingHorizontal: S.lg, borderTopWidth: 1, borderColor: C.line },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginVertical: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: S.md },
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: C.surface, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.line },
  statVal: { fontSize: 22, fontWeight: '800', color: C.ink, marginTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg, gap: S.md },
  empty: { alignItems: 'center', padding: S.xl, backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.line },
  banner: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: R.md, borderWidth: 1 },
});
