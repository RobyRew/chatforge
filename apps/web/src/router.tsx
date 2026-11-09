import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { AppHeader } from './app/AppHeader';
import { AdminPage } from './features/admin/AdminPage';
import { AccountPage } from './features/auth/AccountPage';
import { ChatPage } from './features/chat/ChatPage';
import { Converter } from './features/converter/Converter';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { Icon } from './ui/Icon';

const SOURCE_URL = 'https://github.com/RobyRew/chatforge';

function Shell() {
  return (
    <>
      <a className="cf-skip" href="#main">
        Skip to content
      </a>
      <AppHeader />
      <main id="main" className="cf-main">
        <Outlet />
      </main>
      <footer className="cf-foot">
        <div className="cf-foot__inner">
          <p className="cf-foot__privacy">
            <Icon name="shield" size={16} />
            Conversions run in your browser. Chats and saved conversations are end-to-end encrypted.
          </p>
          <nav className="cf-foot__links" aria-label="Footer">
            <Link to="/">Convert</Link>
            <Link to="/chat">Chat</Link>
            <a href={SOURCE_URL} rel="noopener">
              Source · Apache-2.0
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Converter });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: ChatPage });
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account', component: AccountPage });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: DashboardPage });
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([indexRoute, chatRoute, accountRoute, dashboardRoute, adminRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
