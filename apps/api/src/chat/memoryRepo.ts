import type { ChatMessageDTO, ConversationSummary } from '@chatforge/types';
import type { ChatRepo } from './repo';

/** In-memory ChatRepo for tests/dev — lets the WS transport run in-process without Postgres. */
export class MemoryChatRepo implements ChatRepo {
  private convs = new Map<string, { id: string; members: string[] }>();
  private lastRead = new Map<string, number>(); // `${conv}:${user}` -> seq
  private msgs = new Map<string, ChatMessageDTO[]>(); // conv -> messages
  private seq = new Map<string, number>(); // conv -> last seq
  private seen = new Map<string, number>(); // user -> lastSeen ms
  private counter = 0;

  private key(conversationId: string, userId: string): string {
    return `${conversationId}:${userId}`;
  }

  async createDm(a: string, b: string): Promise<{ id: string; created: boolean }> {
    for (const conv of this.convs.values()) {
      if (conv.members.length === 2 && conv.members.includes(a) && conv.members.includes(b)) {
        return { id: conv.id, created: false };
      }
    }
    const id = `conv_${++this.counter}`;
    this.convs.set(id, { id, members: [a, b] });
    this.lastRead.set(this.key(id, a), 0);
    this.lastRead.set(this.key(id, b), 0);
    this.msgs.set(id, []);
    this.seq.set(id, 0);
    return { id, created: true };
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const out: ConversationSummary[] = [];
    for (const conv of this.convs.values()) {
      if (conv.members.includes(userId)) {
        out.push({
          id: conv.id,
          peerIds: conv.members.filter((m) => m !== userId),
          lastReadSeq: this.lastRead.get(this.key(conv.id, userId)) ?? 0,
        });
      }
    }
    return out;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    return this.convs.get(conversationId)?.members ?? [];
  }

  async conversationPeers(userId: string): Promise<string[]> {
    const peers = new Set<string>();
    for (const conv of this.convs.values()) {
      if (conv.members.includes(userId)) for (const m of conv.members) if (m !== userId) peers.add(m);
    }
    return [...peers];
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    return this.convs.get(conversationId)?.members.includes(userId) ?? false;
  }

  async appendMessage(conversationId: string, senderId: string, ciphertext: string): Promise<ChatMessageDTO> {
    const seq = (this.seq.get(conversationId) ?? 0) + 1;
    this.seq.set(conversationId, seq);
    const msg: ChatMessageDTO = { id: `msg_${++this.counter}`, conversationId, senderId, seq, ciphertext, createdAt: Date.now() };
    const arr = this.msgs.get(conversationId) ?? [];
    arr.push(msg);
    this.msgs.set(conversationId, arr);
    return msg;
  }

  async listMessages(conversationId: string, opts: { beforeSeq?: number; limit?: number } = {}): Promise<ChatMessageDTO[]> {
    let arr = this.msgs.get(conversationId) ?? [];
    if (opts.beforeSeq != null) arr = arr.filter((m) => m.seq < opts.beforeSeq!);
    return arr.slice(-(opts.limit ?? 50));
  }

  async setLastRead(conversationId: string, userId: string, seq: number): Promise<void> {
    this.lastRead.set(this.key(conversationId, userId), seq);
  }

  async setLastSeen(userId: string): Promise<void> {
    this.seen.set(userId, Date.now());
  }

  async getLastSeen(userId: string): Promise<number | null> {
    return this.seen.get(userId) ?? null;
  }
}
