import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { AdminPage } from './features/admin/AdminPage';
import { ADMIN_SECTIONS } from './features/admin/registry';
import { AccountPage } from './features/auth/AccountPage';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { ChatPage } from './features/chat/ChatPage';
import { Converter } from './features/converter/Converter';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useSession } from './lib/authClient';
import { useMe } from './lib/useMe';

const navLink = 'text-zinc-300 transition hover:text-white [&.active]:text-sky-400';

function Shell() {
  const { data } = useSession();
  const { me } = useMe();
  // Server-computed permissions decide the shortcut; the API still enforces every action regardless.
  const canAdmin = !!me && ADMIN_SECTIONS.some((s) => me.permissions.includes(s.permission));
  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-950 to-zinc-900 text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-grid h-8 w-8 place-items-center rounded-xl bg-sky-500 text-sm font-bold">CF</span>
            <span className="text-lg font-semibold">ChatForge</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className={navLink}>
              Convert
            </Link>
            <Link to="/chat" className={navLink}>
              Chat
            </Link>
            {data && (
              <Link to="/dashboard" className={navLink}>
                Dashboard
              </Link>
            )}
            {canAdmin && (
              <Link to="/admin" className={navLink}>
                Admin
              </Link>
            )}
            {data && (
              <Link to="/settings" className={navLink}>
                Settings
              </Link>
            )}
            <Link to="/account" className={navLink}>
              {data ? data.user.email : 'Sign in'}
            </Link>
          </nav>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Converter });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: ChatPage });
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account', component: AccountPage });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: DashboardPage });
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage });
const changePasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/change-password', component: ChangePasswordPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([indexRoute, chatRoute, accountRoute, dashboardRoute, adminRoute, changePasswordRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
