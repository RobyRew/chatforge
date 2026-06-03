import { useEffect, useState, type ReactNode } from 'react';
import { api, type RoleDef } from '../../../lib/api';
import { Card, ErrorText, ui, useAction } from '../ui';

function PermGrid({ all, selected, onToggle, disabled }: { all: string[]; selected: string[]; onToggle: (p: string) => void; disabled?: boolean }): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {all.map((p) => (
        <label key={p} className="flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" className="accent-sky-500" checked={selected.includes(p)} disabled={disabled} onChange={() => onToggle(p)} />
          <span className="font-mono">{p}</span>
        </label>
      ))}
    </div>
  );
}

const blank = { name: '', label: '', description: '', permissions: [] as string[] };

export function RolesSection(): ReactNode {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [allPerms, setAllPerms] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [form, setForm] = useState(blank);
  const [creating, setCreating] = useState(false);
  const { busy, error, run } = useAction();

  const load = (): void =>
    run(async () => {
      const [r, p] = await Promise.all([api.admin.listRoles(), api.admin.listPermissions()]);
      setRoles(r);
      setAllPerms(p);
    });
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleIn = (list: string[], set: (v: string[]) => void, perm: string): void =>
    set(list.includes(perm) ? list.filter((x) => x !== perm) : [...list, perm]);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Roles"
        actions={
          <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New role'}
          </button>
        }
      >
        {creating && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={ui.field} placeholder="name (a-z0-9-_)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={ui.field} placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <input className={ui.field} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <PermGrid all={allPerms} selected={form.permissions} disabled={busy} onToggle={(p) => toggleIn(form.permissions, (v) => setForm({ ...form, permissions: v }), p)} />
            <button
              className={`${ui.btn} ${ui.primary} self-start`}
              disabled={busy || !form.name}
              onClick={() => run(() => api.admin.createRole(form), () => { setCreating(false); setForm(blank); load(); })}
            >
              Create role
            </button>
          </div>
        )}

        <div className="flex flex-col divide-y divide-zinc-800">
          {roles.map((role) => (
            <div key={role.name} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-zinc-100">{role.label}</span>{' '}
                  <span className="font-mono text-xs text-zinc-500">{role.name}</span>
                  {role.isSystem && <span className={`ml-2 ${ui.pill}`}>system</span>}
                  <p className="text-xs text-zinc-500">{role.description}</p>
                </div>
                {!role.isSystem && (
                  <div className="flex shrink-0 gap-2">
                    <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={() => { setEditing(editing === role.name ? null : role.name); setDraft(role.permissions); }}>
                      {editing === role.name ? 'Close' : 'Edit'}
                    </button>
                    <button className={`${ui.btn} ${ui.danger}`} disabled={busy} onClick={() => run(() => api.admin.deleteRole(role.name), load)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {editing === role.name ? (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <PermGrid all={allPerms} selected={draft} disabled={busy} onToggle={(p) => toggleIn(draft, setDraft, p)} />
                  <button className={`${ui.btn} ${ui.primary} self-start`} disabled={busy} onClick={() => run(() => api.admin.updateRole(role.name, { permissions: draft }), () => { setEditing(null); load(); })}>
                    Save permissions
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">{role.permissions.length} permission(s): {role.permissions.join(', ') || '—'}</p>
              )}
            </div>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
      </Card>
    </div>
  );
}
