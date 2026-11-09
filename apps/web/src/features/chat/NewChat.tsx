import { useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';
import { Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ErrorText } from '../../ui/kit';
import { Sheet } from '../../ui/Sheet';

/** Start a direct chat or a group, in a sheet opened from the conversation list. */
export function NewChat({ onCreated, onClose }: { onCreated: (conversationId: string) => void; onClose: () => void }): ReactNode {
  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [handle, setHandle] = useState('');
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<string | null>, reset: () => void): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const id = await fn();
      if (id) {
        reset();
        onCreated(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startDm = (): Promise<void> => run(() => chatClient.newChat(handle), () => setHandle(''));
  // One per line or comma-separated — whichever the user reaches for.
  const memberList = (): string[] => members.split(/[\n,]/).map((m) => m.trim()).filter(Boolean);
  const startGroup = (): Promise<void> =>
    run(
      () => chatClient.newGroup(title, memberList()),
      () => {
        setTitle('');
        setMembers('');
      },
    );

  return (
    <Sheet label="New conversation" title="New conversation" onClose={onClose}>
      <Segmented<'dm' | 'group'>
        label="Conversation type"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(undefined);
        }}
        options={[
          { value: 'dm', label: 'Direct', icon: 'contact' },
          { value: 'group', label: 'Group', icon: 'users' },
        ]}
      />

      {mode === 'dm' ? (
        <form
          className="cf-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle.trim()) void startDm();
          }}
        >
          <label className="cf-form__field">
            <span className="rw-label">Who</span>
            <input className="rw-field" type="text" placeholder="email or @username" value={handle} disabled={busy} onChange={(e) => setHandle(e.target.value)} data-autofocus />
          </label>
          <button type="submit" className="rw-btn rw-btn--primary rw-btn--block" disabled={busy || !handle.trim()}>
            <Icon name="message" size={16} />
            {busy ? 'Starting…' : 'Start chat'}
          </button>
        </form>
      ) : (
        <form
          className="cf-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && memberList().length) void startGroup();
          }}
        >
          <label className="cf-form__field">
            <span className="rw-label">Group name</span>
            <input className="rw-field" type="text" placeholder="Weekend plans" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} data-autofocus />
          </label>
          <label className="cf-form__field">
            <span className="rw-label">Members</span>
            <textarea className="rw-field" placeholder={'One per line\nemail or @username'} value={members} disabled={busy} onChange={(e) => setMembers(e.target.value)} />
            <span className="rw-hint">Everyone must have opened Chat at least once, so their encryption keys exist.</span>
          </label>
          <button type="submit" className="rw-btn rw-btn--primary rw-btn--block" disabled={busy || !title.trim() || memberList().length === 0}>
            <Icon name="users" size={16} />
            {busy ? 'Creating…' : `Create group${memberList().length ? ` (${memberList().length})` : ''}`}
          </button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Sheet>
  );
}
