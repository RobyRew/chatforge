import { useEffect, useState } from 'react';
import { chatClient, type ChatState } from '../../lib/chatClient';

/** Subscribe to the chat client's snapshot and (once) bootstrap it for the signed-in user. */
export function useChat(me: { id: string; email: string } | null): ChatState {
  const [state, setState] = useState<ChatState>(chatClient.getState());

  useEffect(() => chatClient.subscribe(() => setState(chatClient.getState())), []);

  useEffect(() => {
    if (me) void chatClient.start(me);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
