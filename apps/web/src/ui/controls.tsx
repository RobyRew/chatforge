import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** A count shown after the label. */
  count?: number;
}

/**
 * The house segmented control (`.rw-seg` from @robyrew/ui): a recessed well with a thumb that slides to the
 * selection. `role="tab"` for switching views, `role="radio"` (the default) for choosing a value.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  role = 'radio',
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  role?: 'radio' | 'tab';
  className?: string;
}): ReactNode {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const style = { '--n': options.length, '--i': index } as CSSProperties;
  return (
    <div className={`rw-seg${className ? ` ${className}` : ''}`} role={role === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} style={style}>
      <span className="rw-seg__thumb" aria-hidden="true" />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role}
            className="rw-seg__item"
            {...(role === 'tab' ? { 'aria-selected': on } : { 'aria-checked': on })}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            <span className="cf-seg__label">{o.label}</span>
            {o.count !== undefined && o.count > 0 && <span className="cf-seg__count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The house switch (`.rw-switch`) on a real checkbox, announced as a switch. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }): ReactNode {
  return <input type="checkbox" role="switch" className="rw-switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

/** A square icon button (36 px), for toolbars and headers. */
export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  tone,
  filled,
  className,
  buttonRef,
}: {
  icon: IconName;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'ok' | 'warn' | 'accent';
  filled?: boolean;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}): ReactNode {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`cf-iconbtn${tone ? ` is-${tone}` : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} filled={filled} />
    </button>
  );
}

/** A page's heading: an eyebrow with an icon, the title, an optional lead and actions on the right. */
export function PageHead({ eyebrow, icon, title, lead, actions }: { eyebrow?: string; icon?: IconName; title: ReactNode; lead?: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <header className="cf-page-head">
      <div className="cf-page-head__text">
        {eyebrow && (
          <p className="cf-eyebrow">
            {icon && <Icon name={icon} size={15} />}
            {eyebrow}
          </p>
        )}
        <h1 className="cf-page-head__title">{title}</h1>
        {lead && <p className="cf-lead">{lead}</p>}
      </div>
      {actions && <div className="cf-page-head__actions">{actions}</div>}
    </header>
  );
}

/** A centred card for empty, signed-out and no-access states. */
export function Notice({ icon = 'info', title, children, actions }: { icon?: IconName; title: string; children?: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <section className="rw-card cf-notice">
      <span className="cf-tile cf-tile--lg" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="cf-notice__title">{title}</h2>
      {children && <div className="cf-notice__text">{children}</div>}
      {actions && <div className="cf-notice__actions">{actions}</div>}
    </section>
  );
}

/** A one-line status message: `ok`, `warn`, `error` or `info`. */
export function Banner({ tone = 'info', children, icon }: { tone?: 'ok' | 'warn' | 'error' | 'info'; children: ReactNode; icon?: IconName }): ReactNode {
  const glyph: IconName = icon ?? (tone === 'ok' ? 'checkCircle' : tone === 'info' ? 'info' : 'alert');
  return (
    <div className={`cf-banner is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={glyph} size={16} />
      <div className="cf-banner__text">{children}</div>
    </div>
  );
}

/** A quiet loading line with a spinner. */
export function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <p className="cf-loading" role="status">
      <span className="cf-spinner" aria-hidden="true" />
      {label}
    </p>
  );
}
