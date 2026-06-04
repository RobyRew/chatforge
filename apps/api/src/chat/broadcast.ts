import type { ServerFrame } from '@chatforge/types';

/**
 * Seam for fanning a frame out to all of a user's conversation peers (e.g. a live profile/status
 * change from the account module). The chat gateway registers the implementation on startup; if no
 * gateway is running (tests), this is a no-op.
 */
type Broadcaster = (userId: string, frame: ServerFrame) => void;

let current: Broadcaster | null = null;

export function setBroadcaster(b: Broadcaster | null): void {
  current = b;
}

export function broadcastToPeers(userId: string, frame: ServerFrame): void {
  current?.(userId, frame);
}
