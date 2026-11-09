import type { ReactNode } from 'react';
import { Icon } from '../../../ui/Icon';
import { Card } from '../../../ui/kit';

const ROWS: Array<{ what: string; how: string; e2e: boolean }> = [
  { what: 'Messages, replies, reactions', how: 'End-to-end encrypted', e2e: true },
  { what: 'File attachments', how: 'End-to-end encrypted', e2e: true },
  { what: 'Saved (vault) conversations', how: 'End-to-end encrypted', e2e: true },
  { what: 'Profile picture, name, bio, status', how: 'Visible to the server', e2e: false },
  { what: 'Who you talk to, and when', how: 'Visible to the server', e2e: false },
];

/** Explains the guarantees — and the limits — in plain language, where people will look for them. */
export function PrivacyCard(): ReactNode {
  return (
    <Card icon="shield" title="Privacy & encryption" description="What this server can and cannot see." flush>
      <dl className="cf-facts">
        {ROWS.map(({ what, how, e2e }) => (
          <div key={what} className="cf-facts__row">
            <dt>{what}</dt>
            <dd className={e2e ? 'is-ok' : 'is-warn'}>
              <Icon name={e2e ? 'lock' : 'eye'} size={14} />
              {how}
            </dd>
          </div>
        ))}
      </dl>
      <div className="cf-card__foot">
        <p>
          End-to-end encrypted means the key never leaves your devices — the server stores data it cannot read. <strong>Metadata is not protected:</strong> the
          server can still see who you message and when.
        </p>
        <p>
          To be sure nobody is intercepting a chat, open it and choose <strong>Verify</strong> in its header to compare safety numbers with the other person.
          Verification is stored only on this device.
        </p>
      </div>
    </Card>
  );
}
