import type { ReactNode } from 'react';
import { ICON_PATHS } from '@robyrew/chat-converter/ui/icons';

/**
 * Icons ChatForge needs that chat-converter's set (`@robyrew/chat-converter/ui/icons`) does not have, drawn on
 * the same grid: 24×24, `currentColor`, 1.8 stroke, round caps and joins.
 */
const CHATFORGE_PATHS = {
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
  bell: '<path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2.2h-14z"/><path d="M10 20.5a2.3 2.3 0 0 0 4 0"/>',
  key: '<circle cx="8.5" cy="15.5" r="4"/><path d="m11.4 12.6 8.1-8.1"/><path d="m16.5 7.5 2.5 2.5M14 10l1.8 1.8"/>',
  logOut: '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12H15"/>',
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M19 8.5v6M16 11.5h6"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  checks: '<path d="m2 12.5 4.5 4.5L16 7.5"/><path d="m11 16 1 1 9.5-9.5"/>',
} as const;

const PATHS: Record<IconName, string> = { ...ICON_PATHS, ...CHATFORGE_PATHS };

export type IconName = keyof typeof ICON_PATHS | keyof typeof CHATFORGE_PATHS;

/** An inline SVG icon; decorative (aria-hidden), so the control holding it carries the label. */
export function Icon({ name, size = 18, filled = false, className }: { name: IconName; size?: number; filled?: boolean; className?: string }): ReactNode {
  return (
    <svg
      className={className ? `cf-icon ${className}` : 'cf-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // The paths are constants from this file and from @robyrew/chat-converter; nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
