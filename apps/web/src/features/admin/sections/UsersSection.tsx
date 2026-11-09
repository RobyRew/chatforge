import { useEffect, useState, type ReactNode } from 'react';
import { api, type AdminUser, type Me, type RoleDef, type UserDetail } from '../../../lib/api';
import { Loading } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText, ui, useAction } from '../../../ui/kit';
import { Avatar } from '../../chat/Avatar';
import type { AdminSectionProps } from '../types';

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
      icon="users"
      title="Users"
      description={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`}
      flush
      actions={
        canWrite ? (
          <button type="button" className={`${ui.btn} ${creating ? '' : ui.primary} ${ui.sm}`} disabled={busy} onClick={() => setCreating((v) => !v)}>
            <Icon name={creating ? 'x' : 'userPlus'} size={14} />
            {creating ? 'Cancel' : 'New user'}
          </button>
        ) : undefined
      }
    >
      <div className="cf-card__pad cf-stack">
        {creating && canWrite && (
          <CreateUserForm
            roles={roles}
            form={form}
            setForm={setForm}
            busy={busy}
            onCreate={() =>
              run(
                () => api.admin.createUser(form),
                () => {
                  setCreating(false);
                  setForm(emptyUser);
                  load();
                },
              )
            }
          />
        )}

        <form
          className="cf-inline-form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <span className="rw-field-wrap cf-grow">
            <span className="rw-field-icon" aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <input className={ui.field} placeholder="Search email or name…" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
          <button type="submit" className={ui.btn} disabled={busy}>
            Search
          </button>
        </form>
      </div>

      <ul className="cf-list">
        {users.map((u) => (
          <UserRow key={u.id} u={u} roles={roles} perms={perms} me={me} canAssign={canAssign} canWrite={canWrite} canGrant={canGrant} onChanged={load} />
        ))}
        {!users.length && <li className="cf-list-empty">{busy ? <Loading /> : 'No users.'}</li>}
      </ul>
      <div className="cf-card__pad">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

function CreateUserForm({ roles, form, setForm, busy, onCreate }: { roles: RoleDef[]; form: NewUser; setForm: (v: NewUser) => void; busy: boolean; onCreate: () => void }): ReactNode {
  return (
    <form
      className="cf-subcard cf-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.email && form.password.length >= 8) onCreate();
      }}
    >
      <div className="cf-form__grid">
        <label className="cf-form__field">
          <span className={ui.label}>Email</span>
          <input className={ui.field} type="email" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="cf-form__field">
          <span className={ui.label}>Name</span>
          <input className={ui.field} placeholder="Optional" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="cf-form__field">
          <span className={ui.label}>Initial password</span>
          <input className={ui.field} type="password" autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <label className="cf-form__field">
          <span className={ui.label}>Role</span>
          <select className={ui.field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="cf-check">
        <input type="checkbox" checked={form.mustChangePassword} onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })} />
        Require a password change on first sign-in
      </label>
      <div className="cf-actions-row">
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy || !form.email || form.password.length < 8}>
          Create user
        </button>
      </div>
    </form>
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
    <li className="cf-user">
      <div className="cf-user__row">
        <Avatar label={u.name || u.email} size={36} />
        <div className="cf-user__main">
          <p className="cf-user__email">
            {u.email}
            {isSelf && <span className={ui.accentPill}>you</span>}
            {u.status === 'suspended' && <span className="rw-badge cf-badge--danger">suspended</span>}
            {u.mustChangePassword && <span className="rw-badge cf-badge--warn">must change password</span>}
          </p>
          <p className="cf-user__meta">
            {u.name ? `${u.name} · ` : ''}joined {new Date(u.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="cf-user__tools">
          {canAssign ? (
            <select className={`${ui.field} cf-select-sm`} aria-label={`Role of ${u.email}`} value={u.role} disabled={busy} onChange={(e) => run(() => api.admin.setRole(u.id, e.target.value), onChanged)}>
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
              <button type="button" className={`${ui.btn} ${ui.sm} ${ui.danger}`} disabled={busy} onClick={() => run(() => api.admin.setStatus(u.id, 'suspended'), onChanged)}>
                Suspend
              </button>
            ) : (
              <button type="button" className={`${ui.btn} ${ui.sm}`} disabled={busy} onClick={() => run(() => api.admin.setStatus(u.id, 'active'), onChanged)}>
                Activate
              </button>
            ))}
          {canGrant && (
            <button type="button" className={`${ui.btn} ${ui.sm}`} aria-expanded={open} onClick={toggle}>
              <Icon name="key" size={14} />
              {open ? 'Hide' : 'Permissions'}
            </button>
          )}
        </div>
      </div>

      {open && canGrant && (
        <div className="cf-subcard">
          {!detail ? (
            <Loading />
          ) : (
            <>
              <p className="cf-muted">
                Effective: <span className="cf-mono">{detail.effectivePermissions.join(', ') || '—'}</span>
              </p>
              <div className="cf-grants">
                {detail.grants.map((g) => (
                  <span key={g.permission} className={`cf-grant is-${g.effect}`}>
                    {g.effect === 'allow' ? '+' : '−'}
                    {g.permission}
                    <button type="button" aria-label={`Remove grant ${g.permission}`} disabled={busy} onClick={() => run(() => api.admin.removeGrant(u.id, g.permission), loadDetail)}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
                {!detail.grants.length && <span className="cf-muted">No grants.</span>}
              </div>
              <div className="cf-inline-form cf-wrap">
                <select className={`${ui.field} cf-select-sm`} aria-label="Permission" value={perm} onChange={(e) => setPerm(e.target.value)}>
                  <option value="">Select permission…</option>
                  {perms.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select className={`${ui.field} cf-select-sm`} aria-label="Effect" value={effect} onChange={(e) => setEffect(e.target.value === 'deny' ? 'deny' : 'allow')}>
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.sm} ${ui.primary}`}
                  disabled={busy || !perm}
                  onClick={() =>
                    run(
                      () => api.admin.setGrant(u.id, perm, effect),
                      () => {
                        setPerm('');
                        loadDetail();
                      },
                    )
                  }
                >
                  Add grant
                </button>
              </div>
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  );
}
