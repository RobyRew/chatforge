/**
 * Minimal browser notifications. Off until the user opts in (Settings), and only fired while the tab
 * is hidden. The decrypted message text lives only on this device — the notification is local.
 */
const PREF = 'chatforge:notifications';

export function notificationsPref(): boolean {
  return localStorage.getItem(PREF) === 'on';
}

export function notificationsActive(): boolean {
  return notificationsPref() && 'Notification' in window && Notification.permission === 'granted';
}

export async function enableNotifications(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return false;
  localStorage.setItem(PREF, 'on');
  return true;
}

export function disableNotifications(): void {
  localStorage.setItem(PREF, 'off');
}

export function notify(title: string, body: string): void {
  if (!notificationsActive() || !document.hidden) return;
  try {
    new Notification(title, { body: body.slice(0, 200), tag: 'chatforge' });
  } catch {
    /* ignore */
  }
}
