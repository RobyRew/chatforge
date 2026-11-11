import { getThemePreference, initThemeControls, type ThemePreference } from '@robyrew/ui/theme.js';
import { useEffect, useState } from 'react';

/**
 * Light / dark / follow the system, on the house theme runtime (@robyrew/ui/theme.js). The pre-paint bootstrap
 * (served as a file by vite.config.ts) stamps `data-theme` on <html> from `localStorage.theme`; buttons marked
 * `data-rw-theme-set="system|light|dark"` are bound by `initThemeControls()` (delegated click, stores the choice,
 * follows the OS while "system", reflects `aria-checked` on role=radio). `<chat-converter-app>` turns light under
 * `data-theme="light"` only, so it follows the same stamp.
 *
 * React keeps its own copy of the preference from the `rw:themechange` event, so a switch that mounts later (the
 * phone menu) renders the current choice instead of waiting for the runtime to reflect it.
 */
export type { ThemePreference };

export function useThemePreference(): ThemePreference {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);
  useEffect(() => {
    initThemeControls();
    const onChange = (e: DocumentEventMap['rw:themechange']): void => setPref(e.detail.preference);
    document.addEventListener('rw:themechange', onChange);
    return () => document.removeEventListener('rw:themechange', onChange);
  }, []);
  return pref;
}
