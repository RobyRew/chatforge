import { useEffect, useState, type ReactNode } from 'react';
import { api, type AuditEntry } from '../../../lib/api';
import { Card, ErrorText, ui, useAction } from '../ui';

export function AuditSection(): ReactNode {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const { busy, error, run } = useAction();
  const load = (): void => run(async () => setEntries(await api.admin.listAudit(200)));
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      title="Audit log"
      actions={
        <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={load}>
          Refresh
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">When</th>
              <th className="py-1.5 pr-3 font-medium">Action</th>
              <th className="py-1.5 pr-3 font-medium">Actor</th>
              <th className="py-1.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 text-zinc-300">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap py-1.5 pr-3 text-zinc-500">{new Date(e.ts).toLocaleString()}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-sky-300">{e.action}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-zinc-500">{e.actorId ?? '—'}</td>
                <td className="py-1.5 text-zinc-400">{e.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="py-2 text-sm text-zinc-500">No audit entries yet.</p>}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
