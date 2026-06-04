import type { ChatMessageDTO, ClientFrame, ConversationSummary, ServerFrame } from '@chatforge/types';
import { ApiError, api } from './api';
import { getMessages, putMessage } from './chatDb';
import { chatWorker } from './chatWorkerClient';

/** A message as shown in the UI (decrypted plaintext; `seq` is null until the server confirms). */
export interface UiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  ts: number;
  seq: number | null;
  pending: boolean;
  mine: boolean;
}

export interface ChatState {
  ready: boolean;
  error?: string;
  conversations: ConversationSummary[];
  messages: Record<string, UiMessage[]>;
  presence: Record<string, { online: boolean; lastSeenAt?: number }>;
  typing: Record<string, boolean>;
  peerRead: Record<string, number>;
}

const KEY_PACKAGE_TARGET = 5;

/**
 * Orchestrates E2E chat on the main thread: drives the MLS worker, the WebSocket, and the REST
 * endpoints, and exposes a subscribable snapshot for React. Plaintext only ever exists here and in
 * the worker — the server sees opaque ciphertext.
 */
class ChatClient {
  private me: { id: string; email: string } | null = null;
  private started = false;
  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();

  private state: ChatState = { ready: false, conversations: [], messages: {}, presence: {}, typing: {}, peerRead: {} };

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  getState(): ChatState {
    return this.state;
  }
  private emit(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb();
  }

  async start(me: { id: string; email: string }): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.me = me;
    try {
      await chatWorker.init(me.id);
      // Top the server-side KeyPackage pool up to the target so peers can always start a DM with us.
      const serverCount = await api.chat.keyPackageCount();
      const need = Math.max(0, KEY_PACKAGE_TARGET - serverCount);
      if (need > 0) {
        const { published } = await chatWorker.generateKeyPackages(need);
        if (published.length) await api.chat.publishKeyPackages('web', published);
      }
      await this.processWelcomes();
      await this.refreshConversations();
      this.connectWs();
      for (const c of this.state.conversations) await this.loadHistory(c.id);
      this.emit({ ready: true });
    } catch (e) {
      this.emit({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async refreshConversations(): Promise<void> {
    const conversations = await api.chat.listConversations();
    this.emit({ conversations });
    if (this.ws?.readyState === WebSocket.OPEN) {
      for (const c of conversations) this.wsSend({ t: 'sub', conversationId: c.id });
    }
  }

  private async processWelcomes(): Promise<void> {
    let welcomes;
    try {
      welcomes = await api.chat.listWelcomes();
    } catch {
      return;
    }
    for (const w of welcomes) {
      try {
        const { joined } = await chatWorker.join(w.conversationId, w.welcome);
        if (joined) await api.chat.ackWelcome(w.id);
      } catch {
        // leave the welcome pending for a later retry
      }
    }
  }

  private async loadHistory(conversationId: string): Promise<void> {
    const stored = await getMessages(conversationId);
    this.setMessages(
      conversationId,
      stored.map((m) => ({ id: m.key, conversationId, senderId: m.senderId, text: m.text, ts: m.ts, seq: m.seq, pending: false, mine: m.senderId === this.me?.id })),
    );
    const maxSeq = stored.reduce((acc, m) => Math.max(acc, m.seq), 0);
    let server: ChatMessageDTO[] = [];
    try {
      server = await api.chat.listMessages(conversationId, 100);
    } catch {
      return;
    }
    for (const m of server) {
      if (m.seq > maxSeq) await this.ingest(conversationId, m, true);
    }
  }

  /** Decrypt + persist + surface an inbound server message. `retry` allows one join-then-retry. */
  private async ingest(conversationId: string, m: ChatMessageDTO, retry: boolean): Promise<void> {
    if (m.senderId === this.me?.id) return; // our own sends are confirmed via 'delivered'
    try {
      const res = await chatWorker.decrypt(conversationId, m.ciphertext);
      if (res.kind !== 'application') return;
      await putMessage({ key: `${conversationId}:${m.seq}`, conversationId, seq: m.seq, senderId: m.senderId, text: res.text, ts: res.ts });
      this.addMessage(conversationId, { id: m.id, conversationId, senderId: m.senderId, text: res.text, ts: res.ts, seq: m.seq, pending: false, mine: false });
    } catch (e) {
      if (retry) {
        await this.processWelcomes();
        await this.ingest(conversationId, m, false);
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('chat: decrypt failed', e);
    }
  }

  /** Start (or open) a DM by email or @username. */
  async newChat(handle: string): Promise<string | null> {
    const raw = handle.trim();
    if (!raw) return null;
    const value = raw.replace(/^@/, '').toLowerCase();
    const target = value.includes('@') ? { email: value } : { username: value };
    const { conversationId } = await api.chat.createDm(target);
    await this.ensureGroup(conversationId, target, value);
    await this.refreshConversations();
    await this.loadHistory(conversationId);
    return conversationId;
  }

  /** Ensure we hold MLS group state: join a pending Welcome if there is one, otherwise initiate. */
  private async ensureGroup(conversationId: string, target: { email?: string; username?: string }, label: string): Promise<void> {
    if ((await chatWorker.hasGroup(conversationId)).has) return;
    await this.processWelcomes();
    if ((await chatWorker.hasGroup(conversationId)).has) return;
    let claim: { userId: string; keyPackage: string };
    try {
      claim = await api.chat.claimKeyPackage(target);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error(`${label} hasn't opened Chat yet (no encryption keys published). Ask them to open the Chat page once, then try again.`);
      }
      throw e;
    }
    const { welcome } = await chatWorker.startDm(conversationId, claim.keyPackage);
    await api.chat.relayWelcome(conversationId, claim.userId, welcome);
  }

  async sendMessage(conversationId: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body || !this.me) return;
    const clientId = crypto.randomUUID();
    this.addMessage(conversationId, { id: clientId, conversationId, senderId: this.me.id, text: body, ts: Date.now(), seq: null, pending: true, mine: true });
    try {
      const { ciphertext } = await chatWorker.encrypt(conversationId, body);
      this.wsSend({ t: 'send', conversationId, ciphertext, clientId });
    } catch (e) {
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  sendTyping(conversationId: string): void {
    this.wsSend({ t: 'typing', conversationId });
  }
  markRead(conversationId: string, seq: number): void {
    if (seq > 0) this.wsSend({ t: 'read', conversationId, seq });
  }

  // ── WebSocket ──
  private connectWs(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      for (const c of this.state.conversations) this.wsSend({ t: 'sub', conversationId: c.id });
    };
    ws.onmessage = (e) => {
      try {
        this.handleFrame(JSON.parse(typeof e.data === 'string' ? e.data : '') as ServerFrame);
      } catch {
        // ignore non-JSON frames
      }
    };
    ws.onclose = () => {
      if (this.wsTimer) clearTimeout(this.wsTimer);
      this.wsTimer = setTimeout(() => this.connectWs(), 2000);
    };
    ws.onerror = () => ws.close();
  }
  private wsSend(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private handleFrame(f: ServerFrame): void {
    switch (f.t) {
      case 'message':
        void this.ingest(f.conversationId, { id: f.id, conversationId: f.conversationId, senderId: f.senderId, seq: f.seq, ciphertext: f.ciphertext, createdAt: f.createdAt }, true);
        break;
      case 'delivered':
        this.finalizeSent(f.conversationId, f.clientId, f.seq);
        break;
      case 'typing':
        this.setTyping(f.conversationId, true);
        break;
      case 'presence':
        this.emit({ presence: { ...this.state.presence, [f.userId]: { online: f.online, ...(f.lastSeenAt ? { lastSeenAt: f.lastSeenAt } : {}) } } });
        break;
      case 'read':
        this.emit({ peerRead: { ...this.state.peerRead, [f.conversationId]: f.seq } });
        break;
      case 'error':
        // eslint-disable-next-line no-console
        console.warn('chat: server error', f.message);
        break;
    }
  }

  private finalizeSent(conversationId: string, clientId: string, seq: number): void {
    const list = this.state.messages[conversationId];
    if (!list) return;
    const idx = list.findIndex((m) => m.id === clientId);
    if (idx === -1) return;
    const msg = list[idx]!;
    const next = [...list];
    next[idx] = { ...msg, seq, pending: false };
    this.setMessages(conversationId, next);
    void putMessage({ key: `${conversationId}:${seq}`, conversationId, seq, senderId: msg.senderId, text: msg.text, ts: msg.ts });
  }

  private setTyping(conversationId: string, on: boolean): void {
    this.emit({ typing: { ...this.state.typing, [conversationId]: on } });
    const prev = this.typingTimers.get(conversationId);
    if (prev) clearTimeout(prev);
    if (on) this.typingTimers.set(conversationId, setTimeout(() => this.setTyping(conversationId, false), 3000));
  }

  private setMessages(conversationId: string, list: UiMessage[]): void {
    this.emit({ messages: { ...this.state.messages, [conversationId]: list } });
  }
  private addMessage(conversationId: string, msg: UiMessage): void {
    const list = this.state.messages[conversationId] ?? [];
    if (msg.seq !== null && list.some((m) => m.seq === msg.seq)) return; // de-dupe by seq
    this.setMessages(conversationId, [...list, msg].sort((a, b) => a.ts - b.ts));
  }
}

export const chatClient = new ChatClient();
