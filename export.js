// CSV export: builds the same spreadsheet as the web app and opens the phone's share sheet.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { slipCategory, profitOf } from './core';
import { legTitle } from './cards';

export function toCsv(list, showMoney) {
  const q = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['Date', 'Name', 'Status', 'Sport', 'Legs', 'Stake', 'Payout', 'Profit', 'Source', 'Details'];
  const rows = list.map(s => {
    const d = (s.settledAt || s.createdAt)?.toDate?.();
    const sm = showMoney(s.name);
    return [d ? d.toISOString().slice(0, 10) : '', s.name, s.status, slipCategory(s), (s.legs || []).length,
      sm ? s.stake : '', sm ? s.payout : '', s.status === 'open' ? '' : (sm ? profitOf(s).toFixed(2) : ''), s.source || 'manual',
      (s.legs || []).map(l => (l.result ? l.result.toUpperCase() + ' ' : '') + legTitle(l)).join(' | ')];
  });
  return [head, ...rows].map(r => r.map(q).join(',')).join('\n');
}
export async function shareCsv(name, text) {
  try {
    const path = FileSystem.cacheDirectory + name;
    await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) { await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export bets', UTI: 'public.comma-separated-values-text' }); return; }
  } catch (e) {}
  await Share.share({ message: text, title: name });
}
