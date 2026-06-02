import { useMemo } from 'react';
import { applyEdits, type Edits } from '@chatforge/core/transforms';
import type { Conversation, Message } from '@chatforge/types';
import { RichText } from './RichText';

function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function side(m: Message, rightId: string | null): 'left' | 'right' | 'center' {
  if (m.kind === 'system' || m.kind === 'service') return 'center';
  return m.senderId && m.senderId === rightId ? 'right' : 'left';
}

interface BubbleProps {
  msg: Message;
  who: string;
  place: 'left' | 'right' | 'center';
  removed: boolean;
  onToggle: () => void;
}

function Bubble({ msg, who, place, removed, onToggle }: BubbleProps) {
  const dim = removed ? 'opacity-40 line-through' : '';
  const RemoveBtn = (
    <button
      onClick={onToggle}
      title={removed ? 'Restore message' : 'Remove from output'}
      className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full bg-zinc-700 text-xs text-zinc-200 hover:bg-zinc-600 group-hover:grid"
    >
      {removed ? '↺' : '✕'}
    </button>
  );

  if (place === 'center') {
    return (
      <div className={`group relative mx-auto max-w-[80%] py-1 text-center text-xs text-zinc-500 ${dim}`}>
        <RichText value={msg.content} />
        <span className="ml-2 text-[10px] text-zinc-600">{fmt(msg.ts)}</span>
        {RemoveBtn}
      </div>
    );
  }

  return (
    <div
      className={`group relative max-w-[78%] rounded-2xl px-3 py-1.5 text-sm ${
        place === 'right' ? 'self-end bg-emerald-800/40' : 'self-start bg-zinc-800'
      } ${dim}`}
    >
      <div className="text-xs font-semibold text-sky-300">{who}</div>
      <div className="whitespace-pre-wrap break-words text-zinc-100">
        <RichText value={msg.content} />
      </div>
      {(msg.attachments ?? []).map((a, i) => (
        <div key={i} className="mt-1 text-xs text-zinc-400">
          📎 {a.kind}: <span className="italic">{a.fileName ?? a.ref ?? 'media'}</span>
        </div>
      ))}
      {msg.reactions?.length ? (
        <div className="mt-0.5 text-xs">{msg.reactions.map((r) => r.emoji).join(' ')}</div>
      ) : null}
      <div className="mt-0.5 text-[10px] text-zinc-500">
        {fmt(msg.ts)}
        {msg.editedAt ? ' · edited' : ''}
      </div>
      {RemoveBtn}
    </div>
  );
}

interface Props {
  imported: Conversation;
  edits: Edits;
  includedCount: number;
  onToggleRemove: (id: string) => void;
}

export function ChatPreview({ imported, edits, includedCount, onToggleRemove }: Props) {
  // Render everything that passes the date filter (with renames/title/kind applied), but keep
  // individually-removed messages visible (greyed + restorable) so removal stays reversible.
  const visible = useMemo(() => applyEdits(imported, { ...edits, removedIds: [] }), [imported, edits]);
  const removed = useMemo(() => new Set(edits.removedIds ?? []), [edits.removedIds]);
  const nameOf = useMemo(() => {
    const m = new Map(visible.participants.map((p) => [p.id, p.displayName ?? p.id]));
    return (id?: string): string => (id ? m.get(id) ?? 'Unknown' : '');
  }, [visible]);
  const rightId = visible.kind === 'dm' && visible.participants[1] ? visible.participants[1].id : null;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/85 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
        Preview — {includedCount} of {imported.messages.length} messages included
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        {visible.messages.map((m) => (
          <Bubble
            key={m.id}
            msg={m}
            who={nameOf(m.senderId)}
            place={side(m, rightId)}
            removed={removed.has(m.id)}
            onToggle={() => onToggleRemove(m.id)}
          />
        ))}
        {visible.messages.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">No messages match the current date range.</p>
        )}
      </div>
    </div>
  );
}
