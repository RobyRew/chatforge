import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { Switch } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText, ui, useAction } from '../../../ui/kit';

export function FlagsSection(): ReactNode {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [newFlag, setNewFlag] = useState('');
  const { busy, error, run } = useAction();

  const load = (): void => run(async () => setFlags(await api.admin.listFlags()));
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (flag: string, enabled: boolean): void => run(async () => void (await api.admin.setFlag(flag, enabled)), load);

  return (
    <Card icon="zap" title="Feature flags" description="Switch features on or off for everyone." flush>
      <ul className="cf-list">
        {Object.entries(flags).map(([flag, enabled]) => (
          <li key={flag} className="cf-list__row">
            <code className="cf-code">{flag}</code>
            <Switch label={flag} checked={enabled} disabled={busy} onChange={(on) => set(flag, on)} />
          </li>
        ))}
        {!Object.keys(flags).length && <li className="cf-list-empty">No flags yet.</li>}
      </ul>
      <div className="cf-card__pad">
        <form
          className="cf-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFlag) set(newFlag, false);
          }}
        >
          <input
            className={ui.field}
            placeholder="new-flag-name"
            aria-label="New flag name"
            value={newFlag}
            onChange={(e) => setNewFlag(e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          />
          <button type="submit" className={ui.btn} disabled={busy || !newFlag}>
            <Icon name="plusCircle" size={15} />
            Add flag
          </button>
        </form>
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
