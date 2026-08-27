/**
 * Chat attachments — end-to-end encrypted, exactly like message text.
 *
 * A file gets a **fresh AES-256-GCM key** that never leaves the browser except inside the MLS
 * payload (which is itself encrypted to the conversation). We upload only the ciphertext; the
 * server stores opaque bytes with no filename and no MIME type — those live in the payload too.
 * So a blob id alone is useless to anyone who isn't in the conversation, and useless to the server
 * even with database access.
 */
import { API_BASE } from './api';

export interface AttachmentRef {
  blobId: string;
  /** base64 raw AES-256 key — travels only inside the E2E payload. */
  key: string;
  /** base64 12-byte GCM IV. */
  iv: string;
  name: string;
  mime: string;
  /** Plaintext byte length (the stored ciphertext is 16 bytes longer — the GCM tag). */
  size: number;
}

/** Matches the server-side cap in apps/api/src/modules/blobs.ts (25 MB of ciphertext). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 - 16;

function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] ?? 0);
  return btoa(s);
}
function fromB64(b: string): Uint8Array {
  const bin = atob(b);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function isAttachmentRef(v: unknown): v is AttachmentRef {
  const r = v as AttachmentRef | undefined;
  return !!r && typeof r.blobId === 'string' && typeof r.key === 'string' && typeof r.iv === 'string' && typeof r.name === 'string' && typeof r.mime === 'string' && typeof r.size === 'number';
}

/** Encrypt a file locally, upload the ciphertext, and return the reference to put in the payload. */
export async function encryptAndUpload(file: File, conversationId: string): Promise<AttachmentRef> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`"${file.name}" is too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)`);

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  const res = await fetch(`${API_BASE}/api/blobs/attachments/${encodeURIComponent(conversationId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
  const { id } = (await res.json()) as { id: string };

  return {
    blobId: id,
    key: toB64(raw),
    iv: toB64(iv),
    // Filenames come from an untrusted peer on the receiving side; keep them short and strip path
    // separators so nothing downstream can be talked into treating one as a path.
    name: file.name.replace(/[/\\]/g, '_').slice(0, 200) || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
}

// Decrypted object URLs, cached per blob so re-renders don't re-download or re-decrypt.
const objectUrls = new Map<string, Promise<string>>();

/** Fetch + decrypt an attachment, returning a blob: URL usable in <img>/<a download>. */
export function attachmentUrl(ref: AttachmentRef): Promise<string> {
  const cached = objectUrls.get(ref.blobId);
  if (cached) return cached;
  const pending = download(ref).catch((err: unknown) => {
    objectUrls.delete(ref.blobId); // let a later view retry
    throw err;
  });
  objectUrls.set(ref.blobId, pending);
  return pending;
}

async function download(ref: AttachmentRef): Promise<string> {
  const res = await fetch(`${API_BASE}/api/blobs/${encodeURIComponent(ref.blobId)}`, { credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 404 ? 'attachment is no longer available' : `download failed (${res.status})`);
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const key = await crypto.subtle.importKey('raw', new Uint8Array(fromB64(ref.key)), 'AES-GCM', false, ['decrypt']);
  const iv = new Uint8Array(fromB64(ref.iv));
  // Throws if the ciphertext was tampered with — GCM authenticates, so a hostile server can't
  // swap the bytes for something else without us noticing.
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  // Never hand the browser a peer-supplied MIME type verbatim: a blob: URL with text/html would be
  // same-origin scriptable. Images/video/audio/pdf render inline; everything else downloads.
  return URL.createObjectURL(new Blob([plaintext], { type: safeMime(ref.mime) }));
}

const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4)|application\/pdf)$/;

/** The type we're willing to tag a blob: URL with. Anything else becomes a plain download. */
export function safeMime(mime: string): string {
  return INLINE_MIME.test(mime) ? mime : 'application/octet-stream';
}

export function isRenderableImage(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
