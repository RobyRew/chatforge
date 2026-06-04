import type { ReactNode } from 'react';

/** Round avatar: the user's image if set, otherwise initials on a tinted circle. */
export function Avatar({ image, label, size = 32 }: { image?: string | null; label: string; size?: number }): ReactNode {
  if (image) {
    return <img src={image} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initials = label.replace(/^@/, '').slice(0, 2).toUpperCase() || '?';
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-zinc-700 font-medium text-zinc-200"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}
