import { useRef, useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';

export function Composer({ conversationId }: { conversationId: string }): ReactNode {
  const [text, setText] = useState('');
  const lastTyping = useRef(0);

  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    void chatClient.sendMessage(conversationId, body);
    setText('');
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
    <div className="flex items-end gap-2 border-t border-zinc-800 p-3">
      <textarea
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
        rows={1}
        placeholder="Type a message…"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        disabled={!text.trim()}
        onClick={send}
      >
        Send
      </button>
    </div>
  );
}
