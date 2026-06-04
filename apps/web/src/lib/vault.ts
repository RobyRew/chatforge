import type { Conversation } from '@chatforge/types';
import { api } from './api';
import { isVaultUnlocked, vaultDecrypt, vaultEncrypt, vaultPassphraseEnabled, type VaultMode } from './vaultCrypto';

/** Encrypt a canonical conversation (device or passphrase mode) and save ciphertext to the server. */
export async function saveConversationToVault(conversation: Conversation, mode: VaultMode): Promise<string> {
  const ciphertext = await vaultEncrypt(conversation, mode);
  const { id } = await api.vault.save({
    label: conversation.title ?? 'Imported chat',
    sourcePlatform: conversation.originPlatform ?? null,
    messageCount: conversation.messages.length,
    ciphertext,
  });
  return id;
}

/** Fetch a saved item and decrypt it (throws if it's a passphrase item and the vault is locked). */
export async function openVaultConversation(id: string): Promise<Conversation> {
  const item = await api.vault.get(id);
  return vaultDecrypt<Conversation>(item.ciphertext);
}

/** Which mode a new save should use, and whether the user must unlock the passphrase first. */
export async function resolveSaveMode(): Promise<{ mode: VaultMode; locked: boolean }> {
  if (!(await vaultPassphraseEnabled())) return { mode: 'device', locked: false };
  return { mode: 'passphrase', locked: !isVaultUnlocked() };
}
