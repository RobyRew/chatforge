import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../ui/Icon';

/** A stable hue per label, so a person keeps the same colour everywhere (avatars, names in group bubbles). */
export function hueOf(label: string): number {
  let h = 0;
  for (const ch of label) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

function initialsOf(label: string): string {
  const clean = label.replace(/^@/, '').trim();
  const words = clean.includes('@') ? [] : clean.split(/[\s._-]+/).filter(Boolean);
  const first = words[0]?.[0];
  const second = words[1]?.[0];
  if (first && second) return (first + second).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || '?';
}

/** Round avatar: the person's image if set, otherwise their initials on a circle tinted by their name. */
export function Avatar({ image, label, size = 32 }: { image?: string | null; label: string; size?: number }): ReactNode {
  if (image) {
    return <img src={image} alt="" className="cf-avatar" style={{ width: size, height: size }} />;
  }
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38), '--hue': hueOf(label) } as CSSProperties;
  return (
    <span className="cf-avatar cf-avatar--initials" style={style} aria-hidden="true">
      {initialsOf(label)}
    </span>
  );
}

/** The mark of a group conversation. */
export function GroupMark({ size = 32 }: { size?: number }): ReactNode {
  return (
    <span className="cf-avatar cf-avatar--group" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="users" size={Math.round(size * 0.52)} />
    </span>
  );
}

export type PresenceKind = 'online' | 'away' | 'offline';

export function presenceKind(p?: { online: boolean; state?: string }): PresenceKind {
  return p?.state === 'away' ? 'away' : p?.online ? 'online' : 'offline';
}

/** The small online / away / offline dot on an avatar's corner. */
export function PresenceDot({ kind }: { kind: PresenceKind }): ReactNode {
  return <span className={`cf-presence is-${kind}`} aria-hidden="true" />;
}
