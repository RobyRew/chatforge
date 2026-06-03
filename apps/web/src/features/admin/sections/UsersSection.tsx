import { useEffect, useState, type ReactNode } from 'react';
import { api, type AdminUser, type Me, type RoleDef, type UserDetail } from '../../../lib/api';
import type { AdminSectionProps } from '../types';
import { Card, ErrorText, ui, useAction } from '../ui';

interface NewUser {
  email: string;
  password: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}
const emptyUser: NewUser = { email: '', password: '', name: '', role: 'user', mustChangePassword: true };

export function UsersSection({ me }: AdminSectionProps): ReactNode {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [perms, setPerms] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewUser>(emptyUser);
  const { busy, error, run } = useAction();

  const load = (): void =>
    run(async () => {
      const [u, r, p] = await Promise.all([api.admin.listUsers(search || undefined), api.admin.listRoles(), api.admin.listPermissions()]);
      setUsers(u);
      setRoles(r);
      setPerms(p);
    });
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const canAssign = me.permissions.includes('roles:assign');
  const canWrite = me.permissions.includes('users:write');
  const canGrant = me.permissions.includes('permissions:grant');

  return (
    <Card
      title="Users"
      actions={
        canWrite ? (
          <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New user'}
          </button>
        ) : undefined
      }
    >
      {creating && canWrite && (
        <CreateUserForm
          roles={roles}
          form={form}
          setForm={setForm}
          busy={busy}
          onCreate={() => run(() => api.admin.createUser(form), () => { setCreating(false); setForm(emptyUser); load(); })}
        />
      )}

      <div className="mb-3 flex gap-2">
        <input
          className={ui.field}
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={load}>
          Search
        </button>
      </div>

      <div className="flex flex-col divide-y divide-zinc-800">
        {users.map((u) => (
          <UserRow key={u.id} u={u} roles={roles} perms={perms} me={me} canAssign={canAssign} canWrite={canWrite} canGrant={canGrant} onChanged={load} />
        ))}
        {!users.length && <p className="py-2 text-sm text-zinc-500">No users.</p>}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function CreateUserForm({ roles, form, setForm, busy, onCreate }: { roles: RoleDef[]; form: NewUser; setForm: (v: NewUser) => void; busy: boolean; onCreate: () => void }): ReactNode {
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={ui.field} type="email" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className={ui.field} placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={ui.field} type="password" placeholder="Initial password (min 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className={ui.field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {roles.map((r) => (
            <option key={r.name} value={r.name}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" className="accent-sky-500" checked={form.mustChangePassword} onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })} />
        Require password change on first login
      </label>
      <button className={`${ui.btn} ${ui.primary} self-start`} disabled={busy || !form.email || form.password.length < 8} onClick={onCreate}>
        Create user
      </button>
    </div>
  );
}

function UserRow(props: {
  u: AdminUser;
  roles: RoleDef[];
  perms: string[];
  me: Me;
  canAssign: boolean;
  canWrite: boolean;
  canGrant: boolean;
  onChanged: () => void;
}): ReactNode {
  const { u, roles, perms, me, canAssign, canWrite, canGrant, onChanged } = props;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [perm, setPerm] = useState('');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const { busy, error, run } = useAction();
  const isSelf = u.id === me.id;

  const loadDetail = (): void => run(async () => setDetail(await api.admin.getUser(u.id)));
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !detail) loadDetail();
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-zinc-100">{u.email}</span>
          {isSelf && <span className={`ml-2 ${ui.pill}`}>you</span>}
          {u.status === 'suspended' && <span className="ml-2 inline-block rounded-full bg-rose-900/60 px-2 py-0.5 text-xs text-rose-200">suspended</span>}
          {u.mustChangePassword && <span className="ml-2 inline-block rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-200">must change pw</span>}
          <p className="truncate text-xs text-zinc-500">
            {u.name} · joined {new Date(u.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canAssign ? (
            <select className={`${ui.field} w-auto py-1`} value={u.role} disabled={busy} onChange={(e) => run(() => api.admin.setRole(u.id, e.target.value), onChanged)}>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.label}
                </option>
              ))}
              {!roles.some((r) => r.name === u.role) && <option value={u.role}>{u.role}</option>}
            </select>
          ) : (
            <span className={ui.pill}>{u.role}</span>
          )}
          {canWrite &&
            !isSelf &&
            (u.status === 'active' ? (
              <button className={`${ui.btn} ${ui.danger}`} disabled={busy} onClick={() => run(() => api.admin.setStatus(u.id, 'suspended'), onChanged)}>
                Suspend
              </button>
            ) : (
              <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={() => run(() => api.admin.setStatus(u.id, 'active'), onChanged)}>
                Activate
              </button>
            ))}
          {canGrant && (
            <button className={`${ui.btn} ${ui.ghost}`} onClick={toggle}>
              {open ? 'Hide' : 'Permissions'}
            </button>
          )}
        </div>
      </div>

      {open && canGrant && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          {!detail ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-zinc-400">
                Effective: <span className="font-mono text-zinc-300">{detail.effectivePermissions.join(', ') || '—'}</span>
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {detail.grants.map((g) => (
                  <span
                    key={g.permission}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${g.effect === 'allow' ? 'bg-emerald-900/50 text-emerald-200' : 'bg-rose-900/50 text-rose-200'}`}
                  >
                    {g.effect === 'allow' ? '+' : '−'}
                    {g.permission}
                    <button className="text-zinc-400 hover:text-white" disabled={busy} onClick={() => run(() => api.admin.removeGrant(u.id, g.permission), loadDetail)}>
                      ×
                    </button>
                  </span>
                ))}
                {!detail.grants.length && <span className="text-xs text-zinc-500">No grants.</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <select className={`${ui.field} w-auto py-1`} value={perm} onChange={(e) => setPerm(e.target.value)}>
                  <option value="">Select permission…</option>
                  {perms.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select className={`${ui.field} w-auto py-1`} value={effect} onChange={(e) => setEffect(e.target.value === 'deny' ? 'deny' : 'allow')}>
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
                <button className={`${ui.btn} ${ui.primary}`} disabled={busy || !perm} onClick={() => run(() => api.admin.setGrant(u.id, perm, effect), () => { setPerm(''); loadDetail(); })}>
                  Add grant
                </button>
              </div>
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}
