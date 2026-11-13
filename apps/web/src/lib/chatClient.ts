import type { ChatMessageDTO, ClientFrame, ConversationPeer, ConversationSummary, PresenceState, ServerFrame } from '@chatforge/types';
import { ApiError, api } from './api';
import { encryptAndUpload, type AttachmentRef } from './attachments';
import {
  allOutbox,
  deleteChatDb,
  deleteMessage as dbDeleteMessage,
  deleteOutbox,
  getCursor,
  getMessages,
  migrateLegacyChatDb,
  purgeLegacyChatDb,
  putMessage,
  putOutbox,
  setChatDbUser,
  setCursor,
  type OutboxEntry,
  type StoredMessage,
} from './chatDb';
import { encodeFile, encodeMsg, encodeReaction, parsePayload, type ReplyRef } from './chatPayload';
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
  attachment?: AttachmentRef;
  /** Set on an outgoing message while its file is still encrypting/uploading. */
  uploading?: boolean;
  /** Deleted for everyone — rendered as a tombstone; the plaintext is gone from this device. */
  deleted?: boolean;
  /** An outgoing message the server never accepted; the bubble offers Retry and Delete. */
  failed?: boolean;
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
/** Messages per history request when catching up (the API allows up to 200). */
const PAGE = 100;
/** No `delivered` for the frame on the wire by then: look for it on the server, then send it again. */
const SEND_TIMEOUT_MS = 15_000;
/** A message (or reaction) that has not gone through after this many sends is given up on. Commits never are. */
const MAX_SEND_ATTEMPTS = 5;
/** How long removing a group member waits for the server to store its commit before the roster changes. */
const COMMIT_WAIT_MS = 20_000;

/** The newest message a catch-up decrypted, so it notifies once instead of once per message. */
interface Latest {
  title: string;
  body: string;
}

/**
 * Orchestrates E2E chat on the main thread: drives the MLS worker, the WebSocket, and the REST
 * endpoints, and exposes a subscribable snapshot for React. Plaintext only ever exists here and in
 * the worker — the server sees opaque ciphertext. Replies/reactions ride inside the encrypted payload
 * and reference messages by `seq` (the stable per-conversation id both peers share).
 *
 * Delivery (ADR-0034):
 *  - Inbound, each conversation is processed strictly in `seq` order on its own promise chain. On start,
 *    on every (re)connect and whenever a live frame skips a `seq`, the client pages forward from its cursor
 *    (`afterSeq`) until it has everything — not just the newest page.
 *  - Outbound, every encrypted frame goes through a persistent outbox and stays there until the server
 *    answers `delivered`. One frame is on the wire at a time: the gateway handles frames concurrently, so
 *    two in flight could be stored out of order, and a commit must precede the messages encrypted after it.
 *    Before anything is sent again, the client reads the server's history and settles frames found there
 *    by their ciphertext instead of resending them. A frame stored after that read, or one a second tab
 *    sent too, can still be stored twice; receivers pass over the second copy (it cannot decrypt again).
 */
class ChatClient {
  private me: { id: string; email: string } | null = null;
  private started = false;
  /** Set by forgetDevice: no reconnects and no sends after this account's data is deleted. */
  private stopped = false;
  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private awaySent = false;
  /** Per conversation, the tail of a promise chain: ingest and catch-up never interleave. */
  private chains = new Map<string, Promise<void>>();
  /** The IndexedDB outbox mirrored in memory, oldest first. */
  private outbox: OutboxEntry[] = [];
  /** The one outbox frame on the wire (also held while a timed-out frame is looked for on the server). */
  private inFlight: { clientId: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  /** True once a catch-up ran on the current socket; nothing is sent before that. */
  private synced = false;
  /** Callers waiting for a frame to be stored (removing a group member waits for its commit). */
  private waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  /** The last outbox `createdAt` handed out (see stamp). */
  private lastStamp = 0;

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
    setChatDbUser(me.id);
    try {
      const conversations = await api.chat.listConversations();
      this.emit({ conversations });
      // Before ADR-0034 every account in this browser shared one database. This account's records move out
      // of it before the worker reads bundles or groups; a failure leaves them there for the next start.
      await migrateLegacyChatDb(
        me.id,
        conversations.map((c) => c.id),
      ).catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('chat: moving local chat data to this account failed', e);
      });
      await chatWorker.init(me.id);
      let serverCount = await api.chat.keyPackageCount();
      // KeyPackages on the server whose private halves this browser does not hold cannot be joined: a peer
      // claiming one would start a DM nobody can open. That happens after "remove my chats" when the
      // withdrawal failed, or when the shared pre-ADR-0034 database went with another account's bundles.
      // With none here at all, withdraw them and publish a fresh set.
      if (serverCount > 0 && (await chatWorker.bundleCount()).count === 0) {
        await api.chat.withdrawKeyPackages();
        serverCount = 0;
      }
      const need = Math.max(0, KEY_PACKAGE_TARGET - serverCount);
      if (need > 0) {
        const { published } = await chatWorker.generateKeyPackages(need);
        if (published.length) await api.chat.publishKeyPackages('web', published);
      }
      await this.processWelcomes();
      await this.refreshConversations();
      for (const c of this.state.conversations) await this.showCached(c.id);
      await this.restoreOutbox();
      this.connectWs();
      this.installAway();
      await this.syncAll();
      this.emit({ ready: true });
    } catch (e) {
      this.emit({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Delete this account's chat data from this browser: MLS group state, KeyPackage private halves,
   * cached messages and frames not sent yet. Group state exists only on this device, so its existing
   * conversations cannot be decrypted here afterwards. The vault's device key is left alone; Vault items
   * saved with it would otherwise be lost. Resolves to whether the browser confirmed the deletion.
   */
  async forgetDevice(userId: string): Promise<boolean> {
    this.stopped = true;
    if (this.wsTimer) clearTimeout(this.wsTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    chatWorker.terminate();
    setChatDbUser(userId);
    // The private halves of my published KeyPackages are about to go, so withdraw the public halves: a peer
    // who claimed one would start a DM nobody can join. If this fails, the next start anywhere withdraws
    // and republishes them (it finds no bundles to match).
    await api.chat.withdrawKeyPackages().catch(() => 0);
    // This account's records still in the shared pre-ADR-0034 database go too, with every bundle there.
    const conversations = await api.chat.listConversations().catch(() => [] as ConversationSummary[]);
    await purgeLegacyChatDb(
      userId,
      conversations.map((c) => c.id),
    ).catch(() => undefined);
    return deleteChatDb(userId);
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
      ...(m.attachment ? { attachment: m.attachment } : {}),
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
      ...(m.attachment ? { attachment: m.attachment } : {}),
    };
  }

  /** Render what this device already decrypted. */
  private async showCached(conversationId: string): Promise<void> {
    const stored = await getMessages(conversationId);
    this.setMessages(
      conversationId,
      stored.map((m) => this.toUi(conversationId, m)),
    );
  }

  /** Messages still queued from an earlier visit come back as pending (or not sent) bubbles. */
  private async restoreOutbox(): Promise<void> {
    this.outbox = await allOutbox().catch(() => [] as OutboxEntry[]);
    for (const e of this.outbox) this.lastStamp = Math.max(this.lastStamp, e.createdAt);
    const me = this.me;
    if (!me) return;
    for (const e of this.outbox) {
      if (e.kind !== 'message' || !e.ui) continue;
      this.addMessage(e.conversationId, {
        id: e.clientId,
        conversationId: e.conversationId,
        senderId: me.id,
        text: e.ui.text,
        ts: e.ui.ts,
        seq: null,
        pending: !e.failed,
        mine: true,
        ...(e.failed ? { failed: true } : {}),
        ...(e.ui.replyTo ? { replyTo: e.ui.replyTo } : {}),
        ...(e.ui.attachment ? { attachment: e.ui.attachment } : {}),
      });
    }
  }

  // ── inbound: strictly in seq order per conversation ──

  /** Run `task` after everything already queued for this conversation. Failures are logged, never thrown. */
  private serial(conversationId: string, task: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(conversationId) ?? Promise.resolve()).then(task).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('chat: sync failed', e);
    });
    this.chains.set(conversationId, next);
    return next;
  }

  /**
   * Catch up every conversation — and any conversation an outbox frame is waiting on, so a frame that
   * reached the server before the socket dropped is settled rather than sent twice.
   */
  private async syncAll(): Promise<void> {
    const ids = new Set([...this.state.conversations.map((c) => c.id), ...this.outbox.map((e) => e.conversationId)]);
    await Promise.all([...ids].map((id) => this.serial(id, () => this.catchUp(id))));
  }

  /**
   * Fetch and process everything after this device's cursor, oldest first, a page at a time. Only ever
   * called on the conversation's chain.
   *
   * A message that fails to decrypt does not stop the run. If a later one decrypts, the failed one was
   * not needed for it — a commit from before this device joined the group, or a frame its sender stored
   * twice — and the cursor moves past it with that later message. If nothing after it decrypts (a commit
   * this device could not apply yet), the cursor stays before it and the next catch-up tries again.
   */
  private async catchUp(conversationId: string): Promise<void> {
    let after = (await getCursor(conversationId)) ?? 0;
    let retry = true;
    // After a failure, only a peer message that decrypts may move the cursor past it: my own messages and
    // deleted rows are not decrypted, so they prove nothing about whether the failed one was needed.
    let holding = false;
    const latest: { value?: Latest } = {};
    for (;;) {
      const from = after;
      const page = await api.chat.listMessages(conversationId, { afterSeq: after, limit: PAGE });
      for (const m of page) {
        if (m.seq <= after) continue;
        const result = await this.ingest(conversationId, m, retry, latest, holding);
        if (result === 'failed') {
          // Pending Welcomes were just processed for this failure; later failures in this run skip that.
          retry = false;
          holding = true;
        } else if (result === 'decrypted') {
          holding = false;
        }
        after = m.seq;
      }
      // A short page is the end. A full page that moved nothing forward means the server ignored afterSeq
      // (an API older than ADR-0034): stop instead of asking for the same page forever.
      if (page.length < PAGE || after === from) break;
    }
    if (latest.value) notify(latest.value.title, latest.value.body);
  }

  /**
   * Decrypt + dispatch one inbound server message and move the cursor to it, unless `holding` (an earlier
   * message in this run failed and nothing has decrypted since). With `latest`, the notification is left
   * to the caller (one per catch-up, not one per message).
   */
  private async ingest(
    conversationId: string,
    m: ChatMessageDTO,
    retry: boolean,
    latest?: { value?: Latest },
    holding = false,
  ): Promise<'decrypted' | 'own' | 'skipped' | 'failed'> {
    if (m.senderId === this.me?.id) {
      // My own send. Still in the outbox means its `delivered` never arrived (the socket dropped first):
      // this copy on the server is the confirmation, so settle it instead of sending it again.
      const entry = m.ciphertext ? this.outbox.find((e) => e.conversationId === conversationId && e.ciphertext === m.ciphertext) : undefined;
      if (entry) await this.settle(entry, m.seq);
      if (!holding) await setCursor(conversationId, m.seq);
      return 'own';
    }
    if (!m.ciphertext || m.deletedAt) {
      // Deleted for everyone before this device ever fetched it — nothing to decrypt.
      if (!holding) await setCursor(conversationId, m.seq);
      return 'skipped';
    }
    try {
      const res = await chatWorker.decrypt(conversationId, m.ciphertext);
      if (res.kind === 'application') {
        const payload = parsePayload(res.plaintext);
        if (payload.t === 'reaction') {
          this.applyReaction(conversationId, payload.targetSeq, payload.emoji, m.senderId, payload.remove ?? false);
        } else {
          const extra = {
            ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
            ...(payload.t === 'file' ? { attachment: payload.file } : {}),
          };
          await putMessage({ key: `${conversationId}:${m.seq}`, conversationId, seq: m.seq, senderId: m.senderId, text: payload.text, ts: payload.ts, ...extra });
          this.addMessage(conversationId, { id: m.id, conversationId, senderId: m.senderId, text: payload.text, ts: payload.ts, seq: m.seq, pending: false, mine: false, ...extra });
          const peer = this.state.conversations.find((c) => c.id === conversationId)?.peers.find((p) => p.id === m.senderId);
          const note = { title: peer?.email ?? 'New message', body: payload.t === 'file' ? payload.text || `📎 ${payload.file.name}` : payload.text };
          if (latest) latest.value = note;
          else notify(note.title, note.body);
        }
      }
      await setCursor(conversationId, m.seq);
      return 'decrypted';
    } catch (e) {
      if (retry) {
        await this.processWelcomes();
        return this.ingest(conversationId, m, false, latest, holding);
      }
      // eslint-disable-next-line no-console
      console.warn('chat: decrypt failed', e);
      return 'failed';
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
    await this.showCached(conversationId);
    await this.serial(conversationId, () => this.catchUp(conversationId));
    return conversationId;
  }

  /**
   * Create a group and bring every member into the MLS group.
   *
   * Order matters: each add produces a Welcome for the new member **and** a commit that everyone
   * already in the group must apply. The commit is relayed as a normal message so it lands in the
   * same ordered `seq` stream as everything else — a member who processed message N has, by
   * construction, already processed every commit before it.
   */
  async newGroup(title: string, handles: string[]): Promise<string | null> {
    const cleaned = handles.map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
    if (!title.trim() || !cleaned.length) return null;
    const { conversationId, memberIds } = await api.chat.createGroup(title.trim(), cleaned);
    await chatWorker.createGroup(conversationId);
    for (const userId of memberIds) {
      await this.mlsAddMember(conversationId, userId);
    }
    await this.refreshConversations();
    return conversationId;
  }

  /** Claim the peer's KeyPackage, add them to the MLS group, relay the Welcome + commit. */
  private async mlsAddMember(conversationId: string, userId: string): Promise<void> {
    let claim: { userId: string; keyPackage: string };
    try {
      claim = await api.chat.claimKeyPackage({ userId });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error(`That person hasn't opened Chat yet (no encryption keys published). Ask them to open the Chat page once, then try again.`);
      }
      throw e;
    }
    const { welcome, commit } = await chatWorker.addMember(conversationId, claim.keyPackage);
    // The worker has already stored the new epoch. Existing members need the commit (the new member gets
    // the state from the Welcome instead), so it is queued before anything else can run: a message
    // encrypted after it queues behind it, and it reaches the existing members even if relaying the
    // Welcome fails below — then only the new member is left out, and removing and re-adding them recovers.
    this.sendCommit(conversationId, commit).catch(() => undefined); // nobody waits on an add commit
    for (let attempt = 1; ; attempt++) {
      try {
        await api.chat.relayWelcome(conversationId, claim.userId, welcome);
        return;
      } catch (e) {
        if (attempt === 3) {
          throw new Error(
            `The invitation couldn't be delivered to that person (${e instanceof Error ? e.message : String(e)}). Remove them from the group and add them again.`,
          );
        }
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }

  /** Add someone to an existing group (owner only — the server enforces it). */
  async addGroupMember(conversationId: string, handle: string): Promise<void> {
    const { userId } = await api.chat.addMember(conversationId, handle);
    await this.mlsAddMember(conversationId, userId);
    await this.refreshConversations();
  }

  /**
   * Remove someone from a group. The MLS commit goes first: it rotates the group secrets, which is
   * what actually revokes their access. Dropping them from the server roster alone would only stop
   * new messages being *delivered* to them. So the roster changes only once the server has stored the
   * commit; if that does not happen in time, the commit stays queued and this throws.
   */
  async removeGroupMember(conversationId: string, userId: string): Promise<void> {
    const { commit } = await chatWorker.removeMember(conversationId, userId).catch(() => ({ commit: null }));
    if (!commit && this.outbox.some((e) => e.conversationId === conversationId && e.kind === 'commit')) {
      // No new commit (they are already out of the MLS group) while an earlier one is still queued, most
      // likely the removal that timed out: changing the roster now would put it ahead of that commit.
      throw new Error("An earlier change to this group hasn't reached the server yet. Try again once you're back online.");
    }
    if (commit) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The server hasn't confirmed the removal yet. It's queued and goes out when the connection is back; remove them again then to update the member list.")),
          COMMIT_WAIT_MS,
        );
      });
      try {
        await Promise.race([this.sendCommit(conversationId, commit), timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
    await api.chat.removeMember(conversationId, userId);
    await this.refreshConversations();
  }

  /** Leave a group (anyone but the owner). */
  async leaveGroup(conversationId: string): Promise<void> {
    if (!this.me) return;
    await api.chat.removeMember(conversationId, this.me.id);
    // Nothing still queued for it can be delivered any more.
    for (const e of this.outbox.filter((x) => x.conversationId === conversationId)) await this.dropQueued(e.clientId);
    await this.refreshConversations();
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
    const ts = Date.now();
    this.addMessage(conversationId, { id: clientId, conversationId, senderId: this.me.id, text: body, ts, seq: null, pending: true, mine: true, ...(replyTo ? { replyTo } : {}) });
    try {
      const { ciphertext } = await chatWorker.encrypt(conversationId, encodeMsg(body, replyTo));
      await this.enqueue({ clientId, conversationId, ciphertext, kind: 'message', createdAt: ts, attempts: 0, ui: { text: body, ts, ...(replyTo ? { replyTo } : {}) } });
    } catch (e) {
      this.updateById(conversationId, clientId, (m) => ({ ...m, pending: false, failed: true }));
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Send a file. It is encrypted and uploaded first (the bubble shows as "uploading"), then the
   * reference — including the key the server never sees — goes out inside the E2E payload.
   */
  async sendAttachment(conversationId: string, file: File, caption = '', replyTo?: ReplyRef): Promise<void> {
    if (!this.me) return;
    const clientId = crypto.randomUUID();
    const ts = Date.now();
    this.addMessage(conversationId, { id: clientId, conversationId, senderId: this.me.id, text: caption, ts, seq: null, pending: true, mine: true, uploading: true, ...(replyTo ? { replyTo } : {}) });
    let ref: AttachmentRef;
    try {
      ref = await encryptAndUpload(file, conversationId);
    } catch (e) {
      this.removeById(conversationId, clientId); // nothing was sent — drop the optimistic bubble
      this.emit({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.updateById(conversationId, clientId, (m) => ({ ...m, attachment: ref, uploading: false }));
    try {
      const { ciphertext } = await chatWorker.encrypt(conversationId, encodeFile(ref, caption, replyTo));
      // `blobIds` tells the server which blob this message carries, so deleting it reclaims the file.
      await this.enqueue({
        clientId,
        conversationId,
        ciphertext,
        blobIds: [ref.blobId],
        kind: 'message',
        createdAt: ts,
        attempts: 0,
        ui: { text: caption, ts, attachment: ref, ...(replyTo ? { replyTo } : {}) },
      });
    } catch (e) {
      this.updateById(conversationId, clientId, (m) => ({ ...m, pending: false, failed: true }));
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Send a not-sent message again, encrypted afresh (the group may have moved on since), under a new id. */
  async retrySend(conversationId: string, id: string): Promise<void> {
    const msg = this.state.messages[conversationId]?.find((m) => m.id === id);
    if (!msg?.failed) return;
    await this.dropQueued(id);
    const clientId = crypto.randomUUID();
    const ts = Date.now();
    // It goes out now, after whatever was sent meanwhile, so it moves to the end of the thread.
    this.removeById(conversationId, id);
    this.addMessage(conversationId, { ...msg, id: clientId, ts, pending: true, failed: false });
    try {
      const payload = msg.attachment ? encodeFile(msg.attachment, msg.text, msg.replyTo) : encodeMsg(msg.text, msg.replyTo);
      const { ciphertext } = await chatWorker.encrypt(conversationId, payload);
      await this.enqueue({
        clientId,
        conversationId,
        ciphertext,
        ...(msg.attachment ? { blobIds: [msg.attachment.blobId] } : {}),
        kind: 'message',
        createdAt: ts,
        attempts: 0,
        ui: { text: msg.text, ts, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), ...(msg.attachment ? { attachment: msg.attachment } : {}) },
      });
    } catch (e) {
      this.updateById(conversationId, clientId, (m) => ({ ...m, pending: false, failed: true }));
      this.emit({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Delete a not-sent message from this device; it never reached anyone. */
  async discardUnsent(conversationId: string, id: string): Promise<void> {
    await this.dropQueued(id);
    this.removeById(conversationId, id);
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
      await this.enqueue({ clientId: crypto.randomUUID(), conversationId, ciphertext, kind: 'reaction', createdAt: Date.now(), attempts: 0 });
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

  /** Update a not-yet-confirmed local message by its client id (it has no `seq` yet). */
  private updateById(conversationId: string, id: string, updater: (m: UiMessage) => UiMessage): void {
    const list = this.state.messages[conversationId];
    if (!list) return;
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const next = [...list];
    next[idx] = updater(list[idx]!);
    this.setMessages(conversationId, next);
  }

  private removeById(conversationId: string, id: string): void {
    const list = this.state.messages[conversationId];
    if (!list) return;
    this.setMessages(
      conversationId,
      list.filter((m) => m.id !== id),
    );
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
    // A deleted message must never be written back to the cache we just purged.
    if (updated.seq !== null && !updated.deleted) void putMessage(this.toStored(updated));
  }

  /** Delete one of my own messages for everyone. The server refuses if it isn't mine. */
  deleteMessage(conversationId: string, seq: number): void {
    this.wsSend({ t: 'delete', conversationId, seq });
  }

  /** Remove a message from this device only, leaving the peer's copy alone. */
  async hideMessage(conversationId: string, seq: number): Promise<void> {
    await dbDeleteMessage(conversationId, seq).catch(() => undefined);
    const list = this.state.messages[conversationId];
    if (list) this.setMessages(conversationId, list.filter((m) => m.seq !== seq));
  }

  sendTyping(conversationId: string): void {
    this.wsSend({ t: 'typing', conversationId });
  }
  markRead(conversationId: string, seq: number): void {
    if (seq > 0) this.wsSend({ t: 'read', conversationId, seq });
  }

  // ── outbound: the outbox, one frame on the wire at a time ──

  /** Strictly increasing enqueue times: the outbox is replayed in this order after a reload. */
  private stamp(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  private async enqueue(entry: OutboxEntry): Promise<void> {
    // The order frames are queued in is the order they were encrypted in; a caller's own timestamp (taken
    // before an upload, say) is not, so `createdAt` is set here and `ui.ts` stays the displayed time.
    entry.createdAt = this.stamp();
    this.outbox.push(entry);
    try {
      await putOutbox(entry);
    } catch (e) {
      // Still sent from memory this visit; it just would not survive a reload.
      // eslint-disable-next-line no-console
      console.warn('chat: could not store an outgoing frame', e);
    }
    this.pump();
  }

  /** Queue a commit; resolves once the server has stored it. Commits are retried without a limit. */
  private sendCommit(conversationId: string, commit: string): Promise<void> {
    const clientId = crypto.randomUUID();
    const stored = new Promise<void>((resolve, reject) => this.waiters.set(clientId, { resolve, reject }));
    void this.enqueue({ clientId, conversationId, ciphertext: commit, kind: 'commit', createdAt: Date.now(), attempts: 0 });
    return stored;
  }

  /** Put the oldest queued frame on the wire, if the socket is up, caught up, and not already busy. */
  private pump(): void {
    const ws = this.ws;
    if (this.stopped || this.inFlight || !this.synced || !ws || ws.readyState !== WebSocket.OPEN) return;
    const entry = this.outbox.find((e) => !e.failed);
    if (!entry) return;
    entry.attempts += 1;
    void putOutbox(entry).catch(() => undefined);
    this.inFlight = { clientId: entry.clientId, timer: setTimeout(() => this.onSendTimeout(entry.clientId), SEND_TIMEOUT_MS) };
    const frame: ClientFrame = {
      t: 'send',
      conversationId: entry.conversationId,
      ciphertext: entry.ciphertext,
      clientId: entry.clientId,
      ...(entry.blobIds?.length ? { blobIds: entry.blobIds } : {}),
    };
    ws.send(JSON.stringify(frame));
  }

  /**
   * No `delivered` in time. The frame may have been stored with its answer lost, or refused (rate limit,
   * membership); only the server's history can tell. Look for it there before sending it again, keeping
   * the slot taken meanwhile so nothing overtakes it.
   */
  private onSendTimeout(clientId: string): void {
    if (this.inFlight?.clientId !== clientId) return;
    this.inFlight.timer = null;
    const entry = this.outbox.find((e) => e.clientId === clientId);
    if (!entry) {
      this.inFlight = null;
      this.pump();
      return;
    }
    let checked = false;
    let gone = false;
    void this.serial(entry.conversationId, async () => {
      try {
        await this.catchUp(entry.conversationId);
        checked = true;
      } catch (e) {
        // 403/404: this account is no longer in the conversation (it left, or was removed), so no send to
        // it can succeed — the gateway answers "not a member" with no clientId every time.
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) gone = true;
        else throw e;
      }
    }).then(() => {
      if (this.inFlight?.clientId === clientId) this.inFlight = null;
      if (!this.outbox.includes(entry)) {
        this.pump(); // the catch-up found it on the server and settled it
        return;
      }
      if (gone) {
        void this.giveUp(entry, true);
        return;
      }
      const limit = entry.kind === 'commit' ? Number.POSITIVE_INFINITY : MAX_SEND_ATTEMPTS;
      // Resends whose check failed (the history request errored) count as well, at twice the limit, so a
      // check that keeps failing cannot keep one frame at the head of the queue forever.
      if ((checked && entry.attempts >= limit) || entry.attempts >= limit * 2) void this.giveUp(entry);
      else this.pump();
    });
  }

  private async onDelivered(conversationId: string, clientId: string, seq: number): Promise<void> {
    const entry = this.outbox.find((e) => e.clientId === clientId);
    if (entry) await this.settle(entry, seq);
    // Keep the cursor contiguous through my own messages, so the next message from a peer arrives in order
    // (seq = cursor + 1) and needs no catch-up fetch.
    const cursor = (await getCursor(conversationId)) ?? 0;
    if (seq === cursor + 1) await setCursor(conversationId, seq);
  }

  /** The server stored this frame as `seq`: drop it from the outbox and confirm what it carried. */
  private async settle(entry: OutboxEntry, seq: number): Promise<void> {
    const i = this.outbox.indexOf(entry);
    if (i !== -1) this.outbox.splice(i, 1);
    if (this.inFlight?.clientId === entry.clientId) {
      if (this.inFlight.timer) clearTimeout(this.inFlight.timer);
      this.inFlight = null;
    }
    await deleteOutbox(entry.clientId).catch(() => undefined);
    if (entry.kind === 'message') this.finalizeSent(entry.conversationId, entry.clientId, seq);
    this.waiters.get(entry.clientId)?.resolve();
    this.waiters.delete(entry.clientId);
    this.pump();
  }

  /**
   * Out of attempts: a message stays as "not sent" (Retry / Delete) and a reaction is dropped. With `gone`
   * (the account is no longer in the conversation) everything for it is dropped, commits included.
   */
  private async giveUp(entry: OutboxEntry, gone = false): Promise<void> {
    if (entry.kind === 'message' && !gone) {
      entry.failed = true;
      await putOutbox(entry).catch(() => undefined);
      this.updateById(entry.conversationId, entry.clientId, (m) => ({ ...m, pending: false, failed: true }));
    } else {
      const i = this.outbox.indexOf(entry);
      if (i !== -1) this.outbox.splice(i, 1);
      await deleteOutbox(entry.clientId).catch(() => undefined);
      if (entry.kind === 'message') this.removeById(entry.conversationId, entry.clientId);
    }
    this.waiters.get(entry.clientId)?.reject(new Error(gone ? "You're no longer in this conversation." : 'The server did not accept it.'));
    this.waiters.delete(entry.clientId);
    this.pump();
  }

  private async dropQueued(clientId: string): Promise<void> {
    const i = this.outbox.findIndex((e) => e.clientId === clientId);
    if (i !== -1) this.outbox.splice(i, 1);
    if (this.inFlight?.clientId === clientId) {
      if (this.inFlight.timer) clearTimeout(this.inFlight.timer);
      this.inFlight = null;
    }
    this.waiters.get(clientId)?.reject(new Error('Dropped before the server stored it.'));
    this.waiters.delete(clientId);
    await deleteOutbox(clientId).catch(() => undefined);
    this.pump();
  }

  // ── WebSocket ──
  private connectWs(): void {
    if (this.stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      for (const c of this.state.conversations) this.wsSend({ t: 'sub', conversationId: c.id });
      this.awaySent = false;
      this.reportActive(document.hidden);
      // What arrived while the socket was down — and whether my last frames got through — is only in the
      // server's history: catch up first, then send what is still queued.
      void this.syncAll().then(() => {
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
        this.synced = true;
        this.pump();
      });
    };
    ws.onmessage = (e) => {
      try {
        this.handleFrame(JSON.parse(typeof e.data === 'string' ? e.data : '') as ServerFrame);
      } catch {
        // ignore non-JSON frames
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // an old socket, or forgetDevice closed it
      this.synced = false;
      if (this.inFlight) {
        // Its fate is unknown; the catch-up after reconnecting settles or resends it.
        if (this.inFlight.timer) clearTimeout(this.inFlight.timer);
        this.inFlight = null;
      }
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
      case 'message': {
        // A conversation someone else just started: creating a DM sends no 'conversation' frame, so the
        // list would show it only after a reload.
        if (!this.state.conversations.some((c) => c.id === f.conversationId)) void this.refreshConversations().catch(() => undefined);
        const m: ChatMessageDTO = { id: f.id, conversationId: f.conversationId, senderId: f.senderId, seq: f.seq, ciphertext: f.ciphertext, createdAt: f.createdAt };
        void this.serial(f.conversationId, async () => {
          const cursor = (await getCursor(f.conversationId)) ?? 0;
          if (m.seq <= cursor) return; // a catch-up already processed it
          // Next in line: process it. After a gap (frames missed while away or reconnecting), fetch
          // everything after the cursor instead — this message included.
          if (m.seq === cursor + 1) await this.ingest(f.conversationId, m, true);
          else await this.catchUp(f.conversationId);
        });
        break;
      }
      case 'delivered':
        void this.serial(f.conversationId, () => this.onDelivered(f.conversationId, f.clientId, f.seq));
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
      case 'conversation':
        // Membership or title changed — refetch rather than trying to patch state from the wire.
        void this.refreshConversations();
        break;
      case 'deleted':
        // Drop the cached plaintext too — otherwise "delete for everyone" would only hide it.
        void dbDeleteMessage(f.conversationId, f.seq);
        this.updateMessage(f.conversationId, f.seq, (m) => ({ ...m, text: '', deleted: true, replyTo: undefined, attachment: undefined, reactions: [] }));
        break;
      case 'read':
        this.emit({ peerRead: { ...this.state.peerRead, [f.conversationId]: f.seq } });
        break;
      case 'error':
        // Errors carry no clientId. A refused send shows up as a missing `delivered` (onSendTimeout).
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
    const updated = { ...list[idx]!, seq, pending: false, failed: false };
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
