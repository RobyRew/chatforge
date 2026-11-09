import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Me, type Profile } from '../../../lib/api';
import { Banner } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText } from '../../../ui/kit';
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
    <>
      <section className="rw-card cf-card cf-profile">
        <div className="cf-profile__who">
          <Avatar image={p.image} label={p.name || me.email} size={72} />
          <div className="cf-profile__names">
            <p className="cf-profile__name">{p.name || me.email}</p>
            <p className="cf-profile__email">
              {p.username ? `@${p.username} · ` : ''}
              {me.email}
            </p>
            {(p.statusEmoji || p.statusText) && (
              <p className="cf-profile__status">
                {p.statusEmoji} {p.statusText}
              </p>
            )}
          </div>
          <div className="cf-profile__photo">
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadAvatar(file);
              }}
            />
            <button type="button" className="rw-btn rw-btn--sm" disabled={busy} onClick={() => avatarInput.current?.click()}>
              <Icon name="image" size={15} />
              Upload photo
            </button>
            {p.image && (
              <button type="button" className="rw-btn rw-btn--sm rw-btn--danger" disabled={busy} onClick={() => void uploadAvatar(null)}>
                Remove
              </button>
            )}
          </div>
        </div>
      </section>

      <Card icon="contact" title="Details" description="Shown to the people you chat with.">
        <form
          className="cf-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="cf-form__grid">
            <label className="cf-form__field">
              <span className="rw-label">Display name</span>
              <input className="rw-field" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
            </label>
            <label className="cf-form__field">
              <span className="rw-label">Username</span>
              <span className="rw-field-wrap">
                <span className="rw-field-icon" aria-hidden="true">
                  @
                </span>
                <input className="rw-field" value={p.username ?? ''} onChange={(e) => set({ username: e.target.value.toLowerCase() })} placeholder="a–z, 0–9, _" />
              </span>
            </label>
          </div>
          <div className="cf-form__grid cf-form__grid--status">
            <label className="cf-form__field">
              <span className="rw-label">Status</span>
              <input className="rw-field cf-center" value={p.statusEmoji ?? ''} onChange={(e) => set({ statusEmoji: e.target.value || null })} placeholder="🎵" aria-label="Status emoji" />
            </label>
            <label className="cf-form__field">
              <span className="rw-label cf-invisible">Status text</span>
              <input className="rw-field" value={p.statusText ?? ''} onChange={(e) => set({ statusText: e.target.value || null })} placeholder="What you’re up to" aria-label="Status text" />
            </label>
          </div>
          <label className="cf-form__field">
            <span className="rw-label">Bio</span>
            <input className="rw-field" value={p.bio ?? ''} onChange={(e) => set({ bio: e.target.value || null })} placeholder="A line about you" />
          </label>
          <label className="cf-form__field">
            <span className="rw-label">About</span>
            <textarea className="rw-field" value={p.about ?? ''} onChange={(e) => set({ about: e.target.value || null })} placeholder="More about you" />
          </label>
          <label className="cf-form__field">
            <span className="rw-label">Avatar URL</span>
            <input className="rw-field" value={p.image ?? ''} onChange={(e) => set({ image: e.target.value || null })} placeholder="https://…" />
            <span className="rw-hint">Set by Upload photo, or point at an external image.</span>
          </label>
          <div className="cf-actions-row">
            <button type="submit" className="rw-btn rw-btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Card>
      {msg && <Banner tone="ok">{msg}</Banner>}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
