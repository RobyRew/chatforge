import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';
import type { ReplyRef } from '../../lib/chatPayload';
import { IconButton } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

const MAX_FILES_PER_DROP = 10;
/** The field grows with its text up to this height, then scrolls. */
const MAX_FIELD_PX = 160;

export function Composer({
  conversationId,
  replyTo,
  replyName,
  onClearReply,
}: {
  conversationId: string;
  replyTo: ReplyRef | null;
  replyName?: string;
  onClearReply: () => void;
}): ReactNode {
  const [text, setText] = useState('');
  const lastTyping = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (replyTo) field.current?.focus();
  }, [replyTo]);

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
    <div className="cf-composer">
      {replyTo && (
        <div className="cf-composer__reply">
          <Icon name="reply" size={15} />
          <span className="cf-composer__replytext">
            <strong>Replying{replyName ? ` to ${replyName}` : ''}</strong>
            <span>{replyTo.text.slice(0, 80)}</span>
          </span>
          <IconButton icon="x" label="Cancel reply" onClick={onClearReply} />
        </div>
      )}
      <div className="cf-composer__row">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) sendFiles(e.target.files);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
        <IconButton icon="paperclip" label="Attach a file (encrypted before it leaves your browser)" onClick={() => fileInput.current?.click()} />
        <textarea
          ref={field}
          className="cf-composer__field"
          rows={1}
          placeholder="Message"
          aria-label="Message"
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
        <button type="button" className="cf-send" aria-label="Send" title="Send (Enter)" disabled={!text.trim()} onClick={send}>
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  );
}
