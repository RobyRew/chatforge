import { useEffect, useState } from 'react';

/**
 * Light / dark / follow the system. The house theme bootstrap (@robyrew/web-config/theme-bootstrap, loaded before
 * the first paint) reads `localStorage.theme` and stamps `data-theme` on <html>; this keeps that stamp and the
 * stored choice in step when the person switches. "auto" stores nothing, so the bootstrap follows the system.
 * `<chat-converter-app>` turns light under `data-theme="light"` only, so it follows the same stamp.
 */
export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'theme';
const media = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)');

function stored(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function stamp(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'auto' && media().matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

const listeners = new Set<(mode: ThemeMode) => void>();

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  stamp(mode);
  for (const cb of listeners) cb(mode);
}

/** The current mode, shared by every switch on the page; "auto" follows a system change while the page is open. */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(stored);
  useEffect(() => {
    listeners.add(setMode);
    const mq = media();
    const onSystem = (): void => {
      if (stored() === 'auto') stamp('auto');
    };
    mq.addEventListener('change', onSystem);
    return () => {
      listeners.delete(setMode);
      mq.removeEventListener('change', onSystem);
    };
  }, []);
  return mode;
}
