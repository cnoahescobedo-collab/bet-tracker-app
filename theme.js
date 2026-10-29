// One place for colors, spacing and type so the whole app stays consistent.
export const C = {
  bg: '#0B0E13',
  surface: '#141922',
  raised: '#1B212C',
  sunk: '#10141B',
  line: '#262E3B',
  track: '#232B38',
  ink: '#EEF1F6',
  muted: '#8B95A6',
  faint: '#5B6576',
  accent: '#F07A3A',
  accentInk: '#1A0D05',
  win: '#3FBF74',
  loss: '#EF6A5F',
  live: '#F5A524',
  push: '#8B95A6',
  warnBg: '#2B2112',
  warnInk: '#F2C07A',
};
export const R = { sm: 8, md: 14, lg: 18, pill: 999 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const T = {
  hero: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3, color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink },
  h3: { fontSize: 15, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  small: { fontSize: 13, color: C.muted, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted },
  num: { fontVariant: ['tabular-nums'] },
};
export const statusColor = r =>
  r === 'won' || r === 'up' ? C.win : r === 'lost' || r === 'down' ? C.loss : r === 'live' ? C.live : r === 'push' ? C.push : r === 'accent' ? C.accent : C.faint;
export const money = n => (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(Math.abs(n) % 1 ? 2 : 0);
export const signed = n => (n > 0 ? '+' : '') + money(n);
export const pct = x => (x == null ? '–' : Math.round(x * 100) + '%');
export const toneOf = n => (n > 0.004 ? 'won' : n < -0.004 ? 'lost' : null);
