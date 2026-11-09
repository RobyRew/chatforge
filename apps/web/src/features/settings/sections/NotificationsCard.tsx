import { useState, type ReactNode } from 'react';
import { disableNotifications, enableNotifications, notificationsPref } from '../../../lib/notifications';
import { Switch } from '../../../ui/controls';
import { Card } from '../../../ui/kit';

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
    <Card
      icon="bell"
      title="Browser notifications"
      description="Get notified of new messages when ChatForge isn’t focused."
      actions={<Switch label="Browser notifications" checked={on} disabled={busy} onChange={() => void toggle()} />}
    />
  );
}
