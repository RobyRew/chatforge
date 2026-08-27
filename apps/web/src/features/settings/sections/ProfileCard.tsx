import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Me, type Profile } from '../../../lib/api';
import { ui } from '../../admin/ui';
import { Avatar } from '../../chat/Avatar';

export function ProfileCard({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }): ReactNode {
  const [p, setP] = useState<Profile>({ name: me.name ?? '', username: me.username, image: null, bio: null, about: null, statusEmoji: null, statusText: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .getProfile()
      .then((full) => full && setP(full))
      .catch(() => undefined);
  }, []);

  const set = (patch: Partial<Profile>): void => setP((prev) => ({ ...prev, ...patch }));

  /** Upload (or clear) the profile picture and persist it right away, so peers see it live. */
  const uploadAvatar = async (file: File | null): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      const image = file ? (await api.blobs.uploadAvatar(file)).url : null;
      await api.updateProfile({ image });
      set({ image });
      setMsg(file ? 'Photo updated.' : 'Photo removed.');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      await api.updateProfile({
        name: p.name.trim() || undefined,
        username: p.username?.trim() || undefined,
        image: p.image,
        bio: p.bio,
        about: p.about,
        statusEmoji: p.statusEmoji,
        statusText: p.statusText,
      });
      setMsg('Saved.');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-3">
        <Avatar image={p.image} label={p.name || me.email} size={48} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-200">Profile</h3>
          <p className="truncate text-xs text-zinc-500">{me.email}</p>
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void uploadAvatar(file);
            }}
          />
          <button className={ui.btn} disabled={busy} onClick={() => avatarInput.current?.click()}>
            Upload photo
          </button>
          {p.image && (
            <button className={ui.btn} disabled={busy} onClick={() => void uploadAvatar(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Display name
          <input className={ui.field} value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Username
          <input className={ui.field} value={p.username ?? ''} onChange={(e) => set({ username: e.target.value.toLowerCase() })} placeholder="a–z, 0–9, _" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Avatar URL <span className="text-zinc-600">— set by “Upload photo”, or point at an external image</span>
        <input className={ui.field} value={p.image ?? ''} onChange={(e) => set({ image: e.target.value || null })} placeholder="https://…" />
      </label>
      <div className="grid gap-2 sm:grid-cols-[88px_1fr]">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Status
          <input className={ui.field} value={p.statusEmoji ?? ''} onChange={(e) => set({ statusEmoji: e.target.value || null })} placeholder="🎵" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          <span className="invisible">x</span>
          <input className={ui.field} value={p.statusText ?? ''} onChange={(e) => set({ statusText: e.target.value || null })} placeholder="What you’re up to" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Bio
        <input className={ui.field} value={p.bio ?? ''} onChange={(e) => set({ bio: e.target.value || null })} placeholder="A line about you" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        About
        <textarea className={`${ui.field} min-h-[60px] resize-y`} value={p.about ?? ''} onChange={(e) => set({ about: e.target.value || null })} placeholder="More about you" />
      </label>
      <div className="flex items-center gap-3">
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => void save()}>
          Save
        </button>
        {msg && <span className="text-sm text-emerald-300">{msg}</span>}
        {error && <span className="text-sm text-rose-300">{error}</span>}
      </div>
    </section>
  );
}
