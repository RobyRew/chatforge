import { useState, type ReactNode } from 'react';
import { disableNotifications, enableNotifications, notificationsPref } from '../../../lib/notifications';
import { ui } from '../../admin/ui';

export function NotificationsCard(): ReactNode {
  const [on, setOn] = useState(notificationsPref());
  const [busy, setBusy] = useState(false);
  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (on) {
        disableNotifications();
        setOn(false);
      } else {
        setOn(await enableNotifications());
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">Browser notifications</h3>
        <p className="text-xs text-zinc-500">Get notified of new messages when ChatForge isn’t focused.</p>
      </div>
      <button className={`${ui.btn} ${on ? ui.ghost : ui.primary}`} disabled={busy} onClick={() => void toggle()}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </section>
  );
}
