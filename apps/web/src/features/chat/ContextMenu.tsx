import { useEffect, useRef, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Right-click (desktop) + long-press (touch) handlers to spread on an element; calls `onTrigger`
 *  with the pointer position. (The web has no force/3D-touch API — long-press is the equivalent.) */
export function useLongPress(onTrigger: (x: number, y: number) => void): {
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      onTrigger(e.clientX, e.clientY);
    },
    onTouchStart: (e) => {
      const t = e.touches[0];
      if (!t) return;
      const { clientX, clientY } = t;
      timer.current = setTimeout(() => onTrigger(clientX, clientY), 500);
    },
    onTouchEnd: clear,
    onTouchMove: clear,
  };
}

/** A small popover menu anchored at viewport coords; closes on outside-click or Escape. */
export function ContextMenu({ x, y, items, header, onClose }: { x: number; y: number; items: MenuItem[]; header?: ReactNode; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-40 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm shadow-xl"
      style={{ top: Math.min(y, window.innerHeight - 160), left: Math.min(x, window.innerWidth - 180) }}
    >
      {header}
      <div className="py-1">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={() => {
              it.onClick();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left hover:bg-zinc-800 ${it.danger ? 'text-rose-300' : 'text-zinc-200'}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
