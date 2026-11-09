import { useState, type ReactNode } from 'react';
import { signIn } from '../../lib/authClient';
import { useMe } from '../../lib/useMe';
import { Loading, Notice, PageHead, Segmented } from '../../ui/controls';
import { ADMIN_SECTIONS } from './registry';

export function AdminPage(): ReactNode {
  const { me, loading } = useMe();
  const [active, setActive] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="cf-page">
        <Loading />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="cf-page cf-page--narrow">
        <Notice
          icon="shield"
          title="Sign in to open the admin console"
          actions={
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => signIn()}>
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  const sections = ADMIN_SECTIONS.filter((s) => me.permissions.includes(s.permission));
  if (!sections.length) {
    return (
      <div className="cf-page cf-page--narrow">
        <Notice icon="shield" title="No access">
          Your account doesn’t have access to the admin console.
        </Notice>
      </div>
    );
  }

  const current = sections.find((s) => s.id === active) ?? sections[0]!;
  const Active = current.Component;

  return (
    <div className="cf-page cf-page--wide">
      <PageHead
        eyebrow="Admin"
        icon="shield"
        title="Admin console"
        lead={
          <>
            {me.email} · role <code className="cf-code">{me.role}</code>
          </>
        }
      />
      <div className="cf-admin-tabs">
        <Segmented role="tab" label="Admin sections" value={current.id} onChange={setActive} options={sections.map((s) => ({ value: s.id, label: s.label }))} />
      </div>
      <Active me={me} />
    </div>
  );
}
