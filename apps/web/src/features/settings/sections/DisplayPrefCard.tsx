import { useState, type ReactNode } from 'react';
import { getDisplayAs, setDisplayAs, type DisplayAs } from '../../../lib/displayPref';
import { ui } from '../../admin/ui';

export function DisplayPrefCard(): ReactNode {
  const [as, setAs] = useState<DisplayAs>(getDisplayAs());
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Show people as</h3>
      <p className="text-xs text-zinc-500">How other people are labelled in your chats (applies as you navigate).</p>
      <div className="flex gap-2">
        {(['name', 'username', 'email'] as DisplayAs[]).map((opt) => (
          <button
            key={opt}
            onClick={() => {
              setDisplayAs(opt);
              setAs(opt);
            }}
            className={`${ui.btn} ${as === opt ? ui.primary : ui.ghost} capitalize`}
          >
            {opt}
          </button>
        ))}
      </div>
    </section>
  );
}
