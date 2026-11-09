import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Class names for the house controls (@robyrew/ui's controls.css): fields are a recessed fill with an accent
 * focus ring, buttons a neutral fill, the primary one the accent. Combine `btn` with one modifier.
 */
export const ui = {
  field: 'rw-field',
  label: 'rw-label',
  hint: 'rw-hint',
  btn: 'rw-btn',
  primary: 'rw-btn--primary',
  ghost: '',
  plain: 'rw-btn--plain',
  danger: 'rw-btn--danger',
  sm: 'rw-btn--sm',
  block: 'rw-btn--block',
  pill: 'rw-badge',
  accentPill: 'rw-badge rw-badge--accent',
};

/**
 * A grouped content card (`.rw-card`): optional icon tile, title, description and actions over its body. Opaque,
 * as content is in the house language; glass is only for the floating header.
 */
export function Card({
  title,
  description,
  icon,
  actions,
  children,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children?: ReactNode;
  /** Rows that run to the card's edges (lists, tables) instead of padded content. */
  flush?: boolean;
}): ReactNode {
  return (
    <section className="rw-card cf-card">
      {(title || actions) && (
        <header className="cf-card__head">
          {icon && (
            <span className="cf-tile" aria-hidden="true">
              <Icon name={icon} size={17} />
            </span>
          )}
          <div className="cf-card__titles">
            {title && <h3 className="cf-card__title">{title}</h3>}
            {description && <p className="cf-card__desc">{description}</p>}
          </div>
          {actions && <div className="cf-card__actions">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={flush ? 'cf-card__rows' : 'cf-card__body'}>{children}</div>}
    </section>
  );
}

export function ErrorText({ children }: { children?: ReactNode }): ReactNode {
  return children ? (
    <p className="cf-error" role="alert">
      <Icon name="alert" size={15} />
      {children}
    </p>
  ) : null;
}

/** Async-action helper: tracks busy + error, runs `fn`, then an optional `onDone` (e.g. reload). */
export function useAction(): { busy: boolean; error?: string; run: (fn: () => Promise<unknown>, onDone?: () => void) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<unknown>, onDone?: () => void): void => {
    setBusy(true);
    setError(undefined);
    void fn()
      .then(() => onDone?.())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}
