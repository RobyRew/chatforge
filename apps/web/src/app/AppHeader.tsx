import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ADMIN_SECTIONS } from '../features/admin/registry';
import { Avatar } from '../features/chat/Avatar';
import { ACCOUNT_URL, signIn, signOut, useSession } from '../lib/authClient';
import { useThemePreference, type ThemePreference } from '../lib/theme';
import { useMe } from '../lib/useMe';
import { Icon, type IconName } from '../ui/Icon';
import { Menu, Sheet } from '../ui/Sheet';

interface NavItem {
  to: '/' | '/chat' | '/dashboard' | '/admin' | '/settings';
  label: string;
  icon: IconName;
}

const THEMES: Array<{ id: ThemePreference; label: string; short: string; icon: IconName }> = [
  { id: 'system', label: 'Match the system', short: 'Auto', icon: 'monitor' },
  { id: 'light', label: 'Light', short: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', short: 'Dark', icon: 'moon' },
];

/**
 * The floating header: the one glass surface in the app (the house rule: glass for the functional layer, opaque
 * content). Brand, the sections this person can open, the theme switch and the account menu; below 760 px a menu
 * button opens the same links. The bar measures itself into `--site-head`, which full-height pages (the
 * converter, chat) subtract from the viewport.
 */
export function AppHeader(): ReactNode {
  const { data } = useSession();
  const { me } = useMe();
  // Server-computed permissions decide which links show; the API still enforces every action regardless.
  const canAdmin = !!me && ADMIN_SECTIONS.some((s) => me.permissions.includes(s.permission));
  const links: NavItem[] = [
    { to: '/', label: 'Convert', icon: 'swap' },
    { to: '/chat', label: 'Chat', icon: 'message' },
    ...(data ? [{ to: '/dashboard', label: 'Dashboard', icon: 'grid' } as const] : []),
    ...(canAdmin ? [{ to: '/admin', label: 'Admin', icon: 'shield' } as const] : []),
    ...(data ? [{ to: '/settings', label: 'Settings', icon: 'sliders' } as const] : []),
  ];

  const head = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useLayoutEffect(() => {
    const el = bar.current;
    const wrap = head.current;
    if (!el || !wrap) return;
    const measure = (): void => {
      const top = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
      document.documentElement.style.setProperty('--site-head', `${Math.ceil(el.offsetHeight + top)}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // The phone menu closes on navigation, Escape, a click outside and when the window grows past the breakpoint.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (head.current && !head.current.contains(e.target as Node)) setOpen(false);
    };
    const wide = window.matchMedia('(min-width: 760px)');
    const onWide = (e: MediaQueryListEvent): void => {
      if (e.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <header ref={head} className={`cf-head${open ? ' is-open' : ''}`}>
      <nav ref={bar} className="cf-bar rw-glass" aria-label="Primary">
        <Link to="/" className="cf-brand" aria-label="ChatForge, home">
          <span className="cf-brand__mark" aria-hidden="true">
            <Icon name="message" size={17} />
          </span>
          <span className="cf-brand__name">ChatForge</span>
        </Link>

        <ul className="cf-links">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="cf-link" activeOptions={{ exact: l.to === '/' }}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="cf-head-actions">
          <ThemeSwitch />
          {data ? (
            <AccountButton email={data.user.email} name={me?.name || data.user.name} />
          ) : (
            <button type="button" className="cf-signin" onClick={() => signIn()}>
              <Icon name="contact" size={16} />
              <span>Sign in</span>
            </button>
          )}
          <button
            type="button"
            className="cf-menu-btn"
            aria-expanded={open}
            aria-controls="cf-head-menu"
            aria-label={open ? 'Close menu' : 'Menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'x' : 'menu'} size={20} />
          </button>
        </div>
      </nav>

      {open && (
        <div id="cf-head-menu" className="cf-drop rw-glass">
          <ul>
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="cf-drop__link" activeOptions={{ exact: l.to === '/' }}>
                  <Icon name={l.icon} size={19} />
                  {l.label}
                </Link>
              </li>
            ))}
            {data ? (
              <>
                <li>
                  <Link to="/account" className="cf-drop__link">
                    <Icon name="contact" size={19} />
                    Account
                  </Link>
                </li>
                <li>
                  <button type="button" className="cf-drop__link" onClick={() => signOut()}>
                    <Icon name="logOut" size={19} />
                    Sign out
                  </button>
                </li>
              </>
            ) : (
              <li>
                <button type="button" className="cf-drop__link" onClick={() => signIn()}>
                  <Icon name="contact" size={19} />
                  Sign in
                </button>
              </li>
            )}
          </ul>
          <div className="cf-drop__theme">
            <span>Theme</span>
            <ThemeSwitch wide />
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Auto · Light · Dark, as on chat-converter.robyrew.com; the choice is shared with the converter element. Clicks are
 * handled by @robyrew/ui's initThemeControls() through `data-rw-theme-set` (see lib/theme.ts).
 */
function ThemeSwitch({ wide = false }: { wide?: boolean }): ReactNode {
  const pref = useThemePreference();
  return (
    <div className={`cf-theme${wide ? ' cf-theme--wide' : ''}`} role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={pref === t.id} data-rw-theme-set={t.id} title={t.label} aria-label={wide ? undefined : t.label}>
          <Icon name={t.icon} size={16} />
          {wide && <span>{t.short}</span>}
        </button>
      ))}
    </div>
  );
}

/** The signed-in person: their initials (or photo) and name, opening Account, Settings and Sign out. */
function AccountButton({ email, name }: { email: string; name?: string }): ReactNode {
  const navigate = useNavigate();
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const label = name?.trim() || email;
  return (
    <>
      <button ref={button} type="button" className="cf-account" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(true)} title={email}>
        <Avatar label={label} size={26} />
        <span className="cf-account__name">{label}</span>
        <Icon name="chevronDown" size={15} />
      </button>
      {menu && (
        <Sheet label="Account" anchor={button.current} width={264} onClose={() => setMenu(false)}>
          <Menu
            label="Account"
            onClose={() => setMenu(false)}
            header={
              <div className="cf-menu__who">
                <Avatar label={label} size={34} />
                <span>
                  <strong>{label}</strong>
                  {label !== email && <small>{email}</small>}
                </span>
              </div>
            }
            entries={[
              { label: 'Account', icon: 'contact', onSelect: () => void navigate({ to: '/account' }) },
              { label: 'Settings', icon: 'sliders', onSelect: () => void navigate({ to: '/settings' }) },
              { label: 'Manage account security', icon: 'external', hint: 'Password, passkeys, 2FA', onSelect: () => window.open(ACCOUNT_URL, '_blank', 'noopener') },
              'separator',
              { label: 'Sign out', icon: 'logOut', danger: true, onSelect: () => signOut() },
            ]}
          />
        </Sheet>
      )}
    </>
  );
}
