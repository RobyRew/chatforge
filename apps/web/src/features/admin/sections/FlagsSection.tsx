import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { Card, ErrorText, ui, useAction } from '../ui';

export function FlagsSection(): ReactNode {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [newFlag, setNewFlag] = useState('');
  const { busy, error, run } = useAction();

  const load = (): void => run(async () => setFlags(await api.admin.listFlags()));
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (flag: string, enabled: boolean): void => run(async () => void (await api.admin.setFlag(flag, enabled)), load);

  return (
    <Card title="Feature flags">
      <div className="flex flex-col divide-y divide-zinc-800">
        {Object.entries(flags).map(([flag, enabled]) => (
          <label key={flag} className="flex cursor-pointer items-center justify-between py-2.5">
            <span className="font-mono text-sm text-zinc-200">{flag}</span>
            <input type="checkbox" className="h-4 w-4 accent-sky-500" checked={enabled} disabled={busy} onChange={(e) => set(flag, e.target.checked)} />
          </label>
        ))}
        {!Object.keys(flags).length && <p className="py-2 text-sm text-zinc-500">No flags yet.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className={ui.field}
          placeholder="new-flag-name"
          value={newFlag}
          onChange={(e) => setNewFlag(e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        />
        <button
          className={`${ui.btn} ${ui.ghost} whitespace-nowrap`}
          disabled={busy || !newFlag}
          onClick={() => set(newFlag, false)}
        >
          Add flag
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
