import type { ComponentType } from 'react';
import type { Me } from '../../lib/api';
import { DisplayPrefCard } from './sections/DisplayPrefCard';
import { IntegrationsCard } from './sections/IntegrationsCard';
import { NotificationsCard } from './sections/NotificationsCard';
import { PrivacyCard } from './sections/PrivacyCard';
import { ProfileCard } from './sections/ProfileCard';
import { SecurityCard } from './sections/SecurityCard';
import { VaultPassphraseCard } from './sections/VaultPassphraseCard';

/**
 * The settings hub is assembled from this registry — the same pattern as the admin console.
 * Adding a setting = write a card and append one entry. Cards that need the session user or a
 * refresh after saving receive them as props; the rest ignore them.
 */
export interface SettingsSectionProps {
  me: Me;
  onSaved: () => Promise<void>;
}

export interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  description: string;
  Cards: ComponentType<SettingsSectionProps>[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'profile', label: 'Profile', icon: '👤', description: 'How you appear to other people.', Cards: [ProfileCard] },
  { id: 'chat', label: 'Chat', icon: '💬', description: 'Appearance and alerts.', Cards: [DisplayPrefCard, NotificationsCard] },
  { id: 'privacy', label: 'Privacy', icon: '🔒', description: 'Encryption, verification and your account security.', Cards: [PrivacyCard, SecurityCard] },
  { id: 'vault', label: 'Vault', icon: '🗄️', description: 'Saved conversations and their passphrase.', Cards: [VaultPassphraseCard] },
  { id: 'integrations', label: 'Integrations', icon: '🔌', description: 'Connect other services.', Cards: [IntegrationsCard] },
];
