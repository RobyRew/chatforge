import type { Conversation } from '@chatforge/types';
import { api } from './api';
import { vaultDecrypt, vaultEncrypt } from './vaultCrypto';

/** Encrypt a canonical conversation with the device key and save it to the server (ciphertext only). */
export async function saveConversationToVault(conversation: Conversation): Promise<string> {
  const ciphertext = await vaultEncrypt(conversation);
  const { id } = await api.vault.save({
    label: conversation.title ?? 'Imported chat',
    sourcePlatform: conversation.originPlatform ?? null,
    messageCount: conversation.messages.length,
    ciphertext,
  });
  return id;
}

/** Fetch a saved item and decrypt it back into a canonical conversation (this device only). */
export async function openVaultConversation(id: string): Promise<Conversation> {
  const item = await api.vault.get(id);
  return vaultDecrypt<Conversation>(item.ciphertext);
}
