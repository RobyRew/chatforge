import type { ChatMessageDTO, ClientFrame, ConversationPeer, ConversationSummary, PresenceState, ServerFrame } from '@chatforge/types';
import { ApiError, api } from './api';
import { getCursor, getMessages, putMessage, setCursor, type StoredMessage } from './chatDb';
import { encodeMsg, encodeReaction, parsePayload, type ReplyRef } from './chatPayload';
import { chatWorker } from './chatWorkerClient';
import { notify } from './notifications';

export interface Reaction {
  emoji: string;
  by: string[];
}

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
  replyTo?: ReplyRef;
  reactions?: Reaction[];
}

export interface ChatState {
  ready: boolean;
  error?: string;
  conversations: ConversationSummary[];
  messages: Record<string, UiMessage[]>;
  presence: Record<string, { online: boolean; state?: PresenceState; lastSeenAt?: number }>;
  profiles: Record<string, Partial<ConversationPeer>>; // live overlay over conversation.peers
  typing: Record<string, boolean>;
  peerRead: Record<string, number>;
}

const KEY_PACKAGE_TARGET = 5;

/**
 * Orchestrates E2E chat on the main thread: drives the MLS worker, the WebSocket, and the REST
 * endpoints, and exposes a subscribable snapshot for React. Plaintext only ever exists here and in
 * the worker — the server sees opaque ciphertext. Replies/reactions ride inside the encrypted payload
 * and reference messages by `seq` (the stable per-conversation id both peers share).
 */
class ChatClient {
  private me: { id: string; email: string } | null = null;
  private started = false;
  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private awaySent = false;

  private state: ChatState = { ready: false, conversations: [], messages: {}, presence: {}, profiles: {}, typing: {}, peerRead: {} };

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
      const serverCount = await api.chat.keyPackageCount();
      const need = Math.max(0, KEY_PACKAGE_TARGET - serverCount);
      if (need > 0) {
        const { published } = await chatWorker.generateKeyPackages(need);
        if (published.length) await api.chat.publishKeyPackages('web', published);
      }
      await this.processWelcomes();
      await this.refreshConversations();
      this.connectWs();
      this.installAway();
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

  private toUi(conversationId: string, m: StoredMessage): UiMessage {
    return {
      id: m.key,
      conversationId,
      senderId: m.senderId,
      text: m.text,
      ts: m.ts,
      seq: m.seq,
      pending: false,
      mine: m.senderId === this.me?.id,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      ...(m.reactions ? { reactions: m.reactions } : {}),
    };
  }
  private toStored(m: UiMessage): StoredMessage {
    return {
      key: `${m.conversationId}:${m.seq}`,
      conversationId: m.conversationId,
      seq: m.seq ?? 0,
      senderId: m.senderId,
      text: m.text,
      ts: m.ts,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      ...(m.reactions ? { reactions: m.reactions } : {}),
    };
  }

  private async loadHistory(conversationId: string): Promise<void> {
    const stored = await getMessages(conversationId);
    this.setMessages(conversationId, stored.map((m) => this.toUi(conversationId, m)));
    const cursor = (await getCursor(conversationId)) ?? 0;
    let server: ChatMessageDTO[] = [];
    try {
      server = await api.chat.listMessages(conversationId, 100);
    } catch {
      return;
    }
    for (const m of server) {
      if (m.seq <= cursor) continue;
      const ok = await this.ingest(conversationId, m, true);
      if (!ok) break; // a gap → later messages can't decrypt either (preserve ratchet order)
    }
  }

  /** Decrypt + dispatch one inbound server message; advances the cursor. Returns false on failure. */
  private async ingest(conversationId: string, m: ChatMessageDTO, retry: boolean): Promise<boolean> {
    if (m.senderId === this.me?.id) {
      await setCursor(conversationId, m.seq); // our own send — already applied locally
      return true;
    }
    try {
      const res = await chatWorker.decrypt(conversationId, m.ciphertext);
      if (res.kind === 'application') {
        const payload = parsePayload(res.plaintext);
        if (payload.t === 'reaction') {
          this.applyReaction(conversationId, payload.targetSeq, payload.emoji, m.senderId, payload.remove ?? false);
        } else {
          await putMessage({ key: `${conversationId}:${m.seq}`, conversationId, seq: m.seq, senderId: m.senderId, text: payload.text, ts: payload.ts, ...(payload.replyTo ? { replyTo: payload.replyTo } : {}) });
          this.addMessage(conversationId, { id: m.id, conversationId, senderId: m.senderId, text: payload.text, ts: payload.ts, seq: m.seq, pending: false, mine: false, ...(payload.replyTo ? { replyTo: payload.replyTo } : {}) });
          const peer = this.state.conversations.find((c) => c.id === conversationId)?.peers.find((p) => p.id === m.senderId);
          notify(peer?.email ?? 'New message', payload.text);
        }
      }
      await setCursor(conversationId, m.seq);
      return true;
    } catch (e) {
      if (retry) {
        await this.processWelcomes();
        return this.ingest(conversationId, m, false);
      }
      // eslint-disable-next-line no-console
      console.warn('chat: decrypt failed', e);
      return false;
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

  async sendMessage(conversationId: string, text: string, replyTo?: ReplyRef): Promise<void> {
    const body = text.trim();
    if (!body || !this.me) return;
    const clientId = crypto.randomUUID();
    this.addMessage(conversationId, { id: clientId, conversationId, senderId: this.me.id, text: body, ts: Date.now(), seq: null, pending: true, mine: true, ...(replyTo ? { replyTo } : {}) });
    try {
      const { ciphertext } = await chatWorker.encrypt(conversationId, encodeMsg(body, replyTo));
      this.wsSend({ t: 'send', conversationId, ciphertext, clientId });
    } catch (e) {
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Toggle the current user's reaction on a message (referenced by its `seq`). */
  async sendReaction(conversationId: string, targetSeq: number, emoji: string): Promise<void> {
    if (!this.me) return;
    const target = (this.state.messages[conversationId] ?? []).find((m) => m.seq === targetSeq);
    if (!target) return;
    const remove = !!target.reactions?.find((r) => r.emoji === emoji)?.by.includes(this.me.id);
    this.applyReaction(conversationId, targetSeq, emoji, this.me.id, remove); // optimistic
    try {
      const { ciphertext } = await chatWorker.encrypt(conversationId, encodeReaction(targetSeq, emoji, remove));
      this.wsSend({ t: 'send', conversationId, ciphertext, clientId: crypto.randomUUID() });
    } catch (e) {
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  private applyReaction(conversationId: string, targetSeq: number, emoji: string, senderId: string, remove: boolean): void {
    this.updateMessage(conversationId, targetSeq, (m) => {
      const reactions = (m.reactions ?? []).map((r) => ({ emoji: r.emoji, by: [...r.by] }));
      let entry = reactions.find((r) => r.emoji === emoji);
      if (remove) {
        if (entry) entry.by = entry.by.filter((u) => u !== senderId);
      } else {
        if (!entry) {
          entry = { emoji, by: [] };
          reactions.push(entry);
        }
        if (!entry.by.includes(senderId)) entry.by.push(senderId);
      }
      return { ...m, reactions: reactions.filter((r) => r.by.length > 0) };
    });
  }

  private updateMessage(conversationId: string, seq: number, updater: (m: UiMessage) => UiMessage): void {
    const list = this.state.messages[conversationId];
    if (!list) return;
    const idx = list.findIndex((m) => m.seq === seq);
    if (idx === -1) return;
    const updated = updater(list[idx]!);
    const next = [...list];
    next[idx] = updated;
    this.setMessages(conversationId, next);
    if (updated.seq !== null) void putMessage(this.toStored(updated));
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
      this.awaySent = false;
      this.reportActive(document.hidden);
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

  /** Report online/away to peers when the tab is hidden/shown. */
  private installAway(): void {
    document.addEventListener('visibilitychange', () => this.reportActive(document.hidden));
  }
  private reportActive(away: boolean): void {
    if (away === this.awaySent) return;
    this.awaySent = away;
    this.wsSend({ t: 'active', away });
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
        this.emit({ presence: { ...this.state.presence, [f.userId]: { online: f.online, ...(f.state ? { state: f.state } : {}), ...(f.lastSeenAt ? { lastSeenAt: f.lastSeenAt } : {}) } } });
        break;
      case 'profile': {
        const next: Partial<ConversationPeer> = { ...(this.state.profiles[f.userId] ?? {}), id: f.userId };
        if (f.name !== undefined) next.name = f.name;
        if (f.username !== undefined) next.username = f.username;
        if (f.email !== undefined) next.email = f.email;
        if (f.image !== undefined) next.image = f.image;
        if (f.statusEmoji !== undefined) next.statusEmoji = f.statusEmoji;
        if (f.statusText !== undefined) next.statusText = f.statusText;
        this.emit({ profiles: { ...this.state.profiles, [f.userId]: next } });
        break;
      }
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
    if (idx === -1) return; // not a tracked message (e.g. a reaction send) — ignore
    const updated = { ...list[idx]!, seq, pending: false };
    const next = [...list];
    next[idx] = updated;
    this.setMessages(conversationId, next);
    void putMessage(this.toStored(updated));
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
