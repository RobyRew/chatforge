import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Below this width every sheet comes up from the bottom edge, as in chat-converter's menus. */
const NARROW = '(max-width: 639px)';

export interface SheetProps {
  /** Accessible name of the dialog. */
  label: string;
  /** Visible heading, shown with a close button. */
  title?: string;
  onClose: () => void;
  /** Wide screens: hang from this element (a menu button). */
  anchor?: HTMLElement | null;
  /** Wide screens: open at a pointer position (a context menu). */
  at?: { x: number; y: number };
  /** Width of a popover or panel on wide screens, in px. */
  width?: number;
  children: ReactNode;
}

/**
 * Menus, panels and sheets on a modal `<dialog>`: the top layer avoids clipping by scrolling panes, and the dialog
 * brings focus trapping, Escape and a backdrop. Wide screens get a popover at its anchor (or a centred panel);
 * narrow ones a sheet from the bottom edge. Render it to open it; `onClose` runs on Escape, a backdrop click or
 * the close button, and the parent then stops rendering it.
 */
export function Sheet({ label, title, onClose, anchor, at, width, children }: SheetProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mode] = useState<'popover' | 'panel' | 'sheet'>(() =>
    window.matchMedia(NARROW).matches ? 'sheet' : anchor || at ? 'popover' : 'panel',
  );

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (mode === 'popover') place(dialog, anchor, at);
    // A field marked data-autofocus takes focus (a form); otherwise the sheet itself does, so opening by pointer
    // does not ring the first button.
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? inner.current)?.focus({ preventScroll: true });
    // `close` is dispatched asynchronously; React's development double mount reopens the dialog in between, so
    // only a close that left the dialog shut counts.
    const closed = (): void => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
    };
    // Opened once per mount; the anchor and position are read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      className={`cf-sheet is-${mode}`}
      aria-label={label}
      style={width && mode !== 'sheet' ? { width } : undefined}
      // A click on the backdrop targets the dialog itself; clicks inside land on the inner container.
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div ref={inner} className="cf-sheet__inner" tabIndex={-1}>
        {mode === 'sheet' && <span className="cf-sheet__grab" aria-hidden="true" />}
        {title && (
          <div className="cf-sheet__head">
            <h2 className="cf-sheet__title">{title}</h2>
            <button type="button" className="cf-iconbtn" aria-label="Close" onClick={() => ref.current?.close()}>
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="cf-sheet__body">{children}</div>
      </div>
    </dialog>
  );
}

/** Puts a popover under its anchor (or above it, without room), or at a pointer position, inside the viewport. */
function place(dialog: HTMLDialogElement, anchor?: HTMLElement | null, at?: { x: number; y: number }): void {
  const w = dialog.offsetWidth;
  const h = dialog.offsetHeight;
  const gap = 6;
  let left: number;
  let top: number;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    left = r.right - w;
    top = r.bottom + gap + h <= window.innerHeight - 8 ? r.bottom + gap : r.top - gap - h;
  } else if (at) {
    left = at.x;
    top = at.y + h <= window.innerHeight - 8 ? at.y : at.y - h;
  } else {
    return;
  }
  dialog.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, left))}px`;
  dialog.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, top))}px`;
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator' | null | false | undefined;

/**
 * The items of a menu sheet: arrow keys, Home and End move between them; choosing one closes the menu first, then
 * runs it. Put it inside a `Sheet` (with `header` for content above the items, such as quick reactions).
 */
export function Menu({ label, entries, onClose, header }: { label: string; entries: MenuEntry[]; onClose: () => void; header?: ReactNode }): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('.cf-menu__item:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    const target = next >= 0 ? items[next] : undefined;
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };
  return (
    <div className="cf-menu" onKeyDown={onKey}>
      {header}
      <div ref={list} role="menu" aria-label={label} className="cf-menu__items">
        {entries.map((entry, i) => {
          if (!entry) return null;
          if (entry === 'separator') return <div key={`sep-${i}`} className="cf-menu__sep" role="separator" />;
          return (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className={`cf-menu__item${entry.danger ? ' is-danger' : ''}`}
              disabled={entry.disabled}
              onClick={() => {
                onClose();
                entry.onSelect();
              }}
            >
              <span className="cf-menu__icon">{entry.icon && <Icon name={entry.icon} />}</span>
              <span className="cf-menu__label">
                {entry.label}
                {entry.hint && <small>{entry.hint}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
