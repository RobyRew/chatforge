import type { ConversationPeer } from '@chatforge/types';

/** How chats label other people. A per-device preference (localStorage). */
const KEY = 'chatforge:displayAs';
export type DisplayAs = 'name' | 'username' | 'email';

export function getDisplayAs(): DisplayAs {
  const v = localStorage.getItem(KEY);
  return v === 'name' || v === 'username' ? v : 'email';
}
export function setDisplayAs(v: DisplayAs): void {
  localStorage.setItem(KEY, v);
}

/** Label a peer per the chosen preference, with sensible fallbacks. */
export function peerLabel(peer: Pick<ConversationPeer, 'email' | 'name' | 'username'>, as: DisplayAs = getDisplayAs()): string {
  if (as === 'name' && peer.name) return peer.name;
  if (as === 'username' && peer.username) return `@${peer.username}`;
  if (as === 'email') return peer.email;
  return peer.name || (peer.username ? `@${peer.username}` : peer.email);
}

/** Label a conversation: a group by its title, a DM by the peer's chosen label. */
export function conversationLabel(c: { kind?: 'dm' | 'group'; title?: string | null; peers: Array<Pick<ConversationPeer, 'email' | 'name' | 'username'>> }, as?: DisplayAs): string {
  if (c.kind === 'group') return c.title?.trim() || 'Untitled group';
  const peer = c.peers[0];
  return peer ? peerLabel(peer, as) : 'Unknown';
}
