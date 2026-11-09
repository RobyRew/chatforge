import { useEffect, useState, type ReactNode } from 'react';
import { api, type RoleDef } from '../../../lib/api';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText, ui, useAction } from '../../../ui/kit';

function PermGrid({ all, selected, onToggle, disabled }: { all: string[]; selected: string[]; onToggle: (p: string) => void; disabled?: boolean }): ReactNode {
  return (
    <div className="cf-permgrid">
      {all.map((p) => (
        <label key={p} className="cf-check">
          <input type="checkbox" checked={selected.includes(p)} disabled={disabled} onChange={() => onToggle(p)} />
          <span className="cf-mono">{p}</span>
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

  const toggleIn = (list: string[], set: (v: string[]) => void, perm: string): void => set(list.includes(perm) ? list.filter((x) => x !== perm) : [...list, perm]);

  return (
    <Card
      icon="layers"
      title="Roles"
      description="Built-in roles plus your own; a role is a set of permissions."
      flush
      actions={
        <button type="button" className={`${ui.btn} ${creating ? '' : ui.primary} ${ui.sm}`} disabled={busy} onClick={() => setCreating((v) => !v)}>
          <Icon name={creating ? 'x' : 'plusCircle'} size={14} />
          {creating ? 'Cancel' : 'New role'}
        </button>
      }
    >
      {creating && (
        <div className="cf-card__pad">
          <form
            className="cf-subcard cf-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name) return;
              run(
                () => api.admin.createRole(form),
                () => {
                  setCreating(false);
                  setForm(blank);
                  load();
                },
              );
            }}
          >
            <div className="cf-form__grid">
              <label className="cf-form__field">
                <span className={ui.label}>Name</span>
                <input className={ui.field} placeholder="a-z0-9-_" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="cf-form__field">
                <span className={ui.label}>Label</span>
                <input className={ui.field} placeholder="Shown in the role menu" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </label>
            </div>
            <label className="cf-form__field">
              <span className={ui.label}>Description</span>
              <input className={ui.field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <PermGrid all={allPerms} selected={form.permissions} disabled={busy} onToggle={(p) => toggleIn(form.permissions, (v) => setForm({ ...form, permissions: v }), p)} />
            <div className="cf-actions-row">
              <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy || !form.name}>
                Create role
              </button>
            </div>
          </form>
        </div>
      )}

      <ul className="cf-list">
        {roles.map((role) => (
          <li key={role.name} className="cf-role">
            <div className="cf-role__row">
              <div className="cf-role__main">
                <p className="cf-role__name">
                  {role.label} <code className="cf-code">{role.name}</code>
                  {role.isSystem && <span className={ui.pill}>system</span>}
                </p>
                {role.description && <p className="cf-role__desc">{role.description}</p>}
              </div>
              {!role.isSystem && (
                <div className="cf-role__tools">
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.sm}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(editing === role.name ? null : role.name);
                      setDraft(role.permissions);
                    }}
                  >
                    {editing === role.name ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" className={`${ui.btn} ${ui.sm} ${ui.danger}`} disabled={busy} onClick={() => run(() => api.admin.deleteRole(role.name), load)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
            {editing === role.name ? (
              <div className="cf-subcard cf-stack">
                <PermGrid all={allPerms} selected={draft} disabled={busy} onToggle={(p) => toggleIn(draft, setDraft, p)} />
                <div className="cf-actions-row">
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.primary}`}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.admin.updateRole(role.name, { permissions: draft }),
                        () => {
                          setEditing(null);
                          load();
                        },
                      )
                    }
                  >
                    Save permissions
                  </button>
                </div>
              </div>
            ) : (
              <div className="cf-perms">
                {role.permissions.length ? role.permissions.map((p) => <code key={p} className="cf-code">{p}</code>) : <span className="cf-muted">No permissions</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="cf-card__pad">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
