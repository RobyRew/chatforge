import type { ContactDTO, ConversationPeer } from '@chatforge/types';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { peerLabel } from './displayPref';

/**
 * Saved contacts, shared by the sidebar list, the conversation list and the thread header so a
 * save or rename shows up everywhere at once. One-sided: saving someone tells them nothing.
 */
interface ContactsState {
  loaded: boolean;
  contacts: ContactDTO[];
  error?: string | undefined;
}

let state: ContactsState = { loaded: false, contacts: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<ContactsState>): void {
  state = { ...state, ...next };
  for (const cb of listeners) cb();
}

function upsert(contact: ContactDTO): void {
  const rest = state.contacts.filter((c) => c.id !== contact.id);
  set({ contacts: [...rest, contact].sort((a, b) => a.createdAt - b.createdAt), error: undefined });
}

/** How to name someone you can save or message: `@username` when they have one, otherwise email. */
export function handleFor(peer: Pick<ConversationPeer, 'email' | 'username'>): string {
  return peer.username ? `@${peer.username}` : peer.email;
}

/** Your nickname for them if you saved one, otherwise the usual display preference. */
export function contactLabel(peer: Pick<ConversationPeer, 'id' | 'email' | 'name' | 'username'>, contacts: ContactDTO[]): string {
  return contacts.find((c) => c.id === peer.id)?.nickname || peerLabel(peer);
}

export const contactsStore = {
  load(): Promise<void> {
    loading ??= api.chat
      .listContacts()
      .then((contacts) => set({ loaded: true, contacts, error: undefined }))
      .catch((e: unknown) => set({ loaded: true, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  },
  async save(handle: string, nickname?: string | null): Promise<ContactDTO> {
    const contact = await api.chat.saveContact(handle, nickname);
    upsert(contact);
    return contact;
  },
  async remove(userId: string): Promise<void> {
    await api.chat.removeContact(userId);
    set({ contacts: state.contacts.filter((c) => c.id !== userId) });
  },
};

export function useContacts(): ContactsState {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.loaded) void contactsStore.load();
  }, []);
  return snapshot;
}
