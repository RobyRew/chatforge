import { useRef, useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';
import type { ReplyRef } from '../../lib/chatPayload';

const MAX_FILES_PER_DROP = 10;

export function Composer({ conversationId, replyTo, onClearReply }: { conversationId: string; replyTo: ReplyRef | null; onClearReply: () => void }): ReactNode {
  const [text, setText] = useState('');
  const lastTyping = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    void chatClient.sendMessage(conversationId, body, replyTo ?? undefined);
    setText('');
    onClearReply();
  };

  /** Send files; whatever is typed becomes the caption on the first one. */
  const sendFiles = (files: FileList | File[]): void => {
    const list = Array.from(files).slice(0, MAX_FILES_PER_DROP);
    if (!list.length) return;
    const caption = text.trim();
    list.forEach((file, i) => void chatClient.sendAttachment(conversationId, file, i === 0 ? caption : '', replyTo ?? undefined));
    setText('');
    onClearReply();
  };

  const onChange = (value: string): void => {
    setText(value);
    const now = Date.now();
    if (now - lastTyping.current > 1500) {
      lastTyping.current = now;
      chatClient.sendTyping(conversationId);
    }
  };

  return (
    <div className="border-t border-zinc-800">
      {replyTo && (
        <div className="flex items-center gap-2 px-3 pt-2 text-xs text-zinc-400">
          <span className="min-w-0 truncate border-l-2 border-sky-500 pl-2">Replying: {replyTo.text.slice(0, 60)}</span>
          <button onClick={onClearReply} className="ml-auto shrink-0 text-zinc-500 hover:text-white">
            ✕
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) sendFiles(e.target.files);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
        <button
          type="button"
          title="Attach a file (encrypted before it leaves your browser)"
          aria-label="Attach a file"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
        <textarea
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
          rows={1}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              sendFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40" disabled={!text.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
