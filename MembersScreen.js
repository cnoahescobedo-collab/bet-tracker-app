// Members: owner approves new people or removes / restores someone.
import React, { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { norm } from './core';
import { useApp } from './store';
import { C, S, T } from './theme';
import { Button, Card, Row, Spacer, Tag, Empty, Fine, ConfirmButton } from './ui';

export default function MembersScreen() {
  const { members, me, isOwner, groupDoc, actions, toast } = useApp();
  const ownerKey = (() => { const c = groupDoc?.createdBy; if (!c) return ''; const m = members[c]; if (m?.linkedTo && members[m.linkedTo]) return norm(members[m.linkedTo].name); return norm(m?.name || ''); })();
  const byName = new Map();
  Object.entries(members).forEach(([id, m]) => {
    const k = norm(m.name || '?'); if (!byName.has(k)) byName.set(k, { name: m.name || '?', ids: [], removed: 0, pending: 0 });
    const g = byName.get(k); g.ids.push(id); if (m.removed) g.removed++; else if (m.status === 'pending') g.pending++;
  });
  const list = [...byName.entries()].sort((a, b) => (b[1].pending - a[1].pending) || a[1].name.localeCompare(b[1].name));
  const run = (p, ok) => p.then(() => ok && toast(ok)).catch(e => toast("Couldn't update member: " + e.message, 'error'));
  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, gap: S.md, paddingBottom: 60 }}>
      <Fine>{isOwner ? 'You own this group. Approve new people here, or remove someone (they and their slips disappear for everyone).' : 'Only the group owner can approve or remove members.'}</Fine>
      {!list.length ? <Empty icon="people-outline" title="No members yet" /> : list.map(([k, g]) => {
        const isMe = k === norm(me.name), rem = g.removed === g.ids.length, pend = !rem && g.pending === g.ids.length - g.removed;
        return (
          <Card key={k} style={{ opacity: rem ? 0.55 : 1, gap: S.sm }}>
            <Row style={{ flexWrap: 'wrap' }}>
              <Text style={T.h2}>{g.name}</Text>
              {isMe ? <Tag label="YOU" color={C.accent} /> : null}
              {k === ownerKey ? <Tag label="OWNER" /> : null}
              {rem ? <Tag label="REMOVED" color={C.loss} /> : null}
              {pend ? <Tag label="WANTS TO JOIN" color={C.live} /> : null}
            </Row>
            {isOwner && !isMe && (
              <Row>
                {pend ? <>
                  <Button small label="Approve" icon="checkmark" onPress={() => run(actions.approveMember(k), 'Approved.')} />
                  <Button small kind="ghost" label="Deny" onPress={() => run(actions.setMemberRemoved(k, true))} />
                </> : rem
                  ? <Button small kind="ghost" label="Restore" onPress={() => run(actions.setMemberRemoved(k, false), 'Restored.')} />
                  : <ConfirmButton small kind="danger" label="Remove" confirmLabel="Tap to remove" onConfirm={() => run(actions.setMemberRemoved(k, true), 'Removed.')} />}
              </Row>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
