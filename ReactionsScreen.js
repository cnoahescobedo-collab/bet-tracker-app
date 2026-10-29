// Reactions friends left on your slips. Opening this screen marks them read.
import React, { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useApp } from './store';
import { C, S, T } from './theme';
import { Empty } from './ui';

export default function ReactionsScreen() {
  const { notifs, actions } = useApp();
  useEffect(() => { if (notifs.some(n => !n.read)) actions.markNotifsRead(); }, [notifs.length]);
  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.sm, paddingBottom: 60 }}>
      {!notifs.length ? <Empty icon="notifications-outline" title="No reactions yet" body="When a friend reacts to one of your slips, it shows up here." />
        : notifs.slice(0, 60).map(n => (
          <View key={n.id} style={{ flexDirection: 'row', gap: S.md, alignItems: 'center', backgroundColor: n.read ? C.surface : C.raised, borderRadius: 14, borderWidth: 1, borderColor: n.read ? C.line : C.accent + '55', padding: S.md }}>
            <Text style={{ fontSize: 26 }}>{n.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={T.body}><Text style={{ fontWeight: '800' }}>{n.fromName}</Text> reacted to your {n.label || 'slip'}</Text>
              <Text style={T.small}>{n.at?.toDate ? n.at.toDate().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</Text>
            </View>
          </View>
        ))}
    </ScrollView>
  );
}
