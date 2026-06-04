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
