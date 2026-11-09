import { useRef, type ReactNode } from 'react';
import { Menu, Sheet, type MenuEntry } from '../../ui/Sheet';

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

/**
 * A menu opened at a pointer position: a popover there on wide screens, a sheet from the bottom edge on narrow
 * ones (chat-converter's menus behave the same). `header` sits above the items, e.g. quick reactions.
 */
export function ContextMenu({
  x,
  y,
  label,
  entries,
  header,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  entries: MenuEntry[];
  header?: ReactNode;
  onClose: () => void;
}): ReactNode {
  return (
    <Sheet label={label} at={{ x, y }} width={256} onClose={onClose}>
      <Menu label={label} entries={entries} header={header} onClose={onClose} />
    </Sheet>
  );
}
