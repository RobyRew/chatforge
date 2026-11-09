import { useEffect, useState, type ReactNode } from 'react';
import { api, type AuditEntry } from '../../../lib/api';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText, ui, useAction } from '../../../ui/kit';

export function AuditSection(): ReactNode {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const { busy, error, run } = useAction();
  const load = (): void => run(async () => setEntries(await api.admin.listAudit(200)));
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      icon="list"
      title="Audit log"
      description="Every admin action, newest first."
      flush
      actions={
        <button type="button" className={`${ui.btn} ${ui.sm}`} disabled={busy} onClick={load}>
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      }
    >
      <div className="cf-table-wrap">
        <table className="cf-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="cf-table__muted cf-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td>
                  <code className="cf-code cf-code--accent">{e.action}</code>
                </td>
                <td className="cf-table__muted cf-mono">{e.actorId ?? '—'}</td>
                <td>{e.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="cf-list-empty">No audit entries yet.</p>}
      </div>
      <div className="cf-card__pad">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
