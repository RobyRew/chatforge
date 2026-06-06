import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  dropSession,
  ensureAppUser,
  type LogtoIdClaims,
  makeLogtoClient,
  publicOrigin,
  pruneExpiredSessions,
  SID_COOKIE,
} from '../auth/logto';

/**
 * Logto auth endpoints (mounted at /api/auth) — **Traditional Web** flow. The browser never sees a
 * token; it only carries the opaque `cf_sid` cookie. Logto's hosted UI owns email/password, social
 * logins, passkeys and MFA. See auth/logto.ts + docs/auth-logto.md.
 */
export const authModule = new Hono();

const RT_COOKIE = 'cf_rt';

/** Only allow local-path returnTo values — blocks open-redirect via ?returnTo=. */
function sanitizeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function isSecure(): boolean {
  return publicOrigin('http://localhost').startsWith('https');
}

authModule.get('/sign-in', async (c) => {
  const secure = isSecure();

  // Opaque server-session id must exist before the redirect so the callback can find the PKCE/state
  // Logto stores under it.
  let sid = getCookie(c, SID_COOKIE);
  if (!sid) {
    sid = randomBytes(18).toString('base64url');
    setCookie(c, SID_COOKIE, sid, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 14 });
  }
  setCookie(c, RT_COOKIE, sanitizeReturnTo(c.req.query('returnTo')), { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 600 });

  await pruneExpiredSessions();

  let target = '/';
  const client = await makeLogtoClient(sid, (u) => {
    target = u;
  });
  await client.signIn({ redirectUri: `${publicOrigin(new URL(c.req.url).origin)}/api/auth/callback` });
  return c.redirect(target, 302);
});

authModule.get('/callback', async (c) => {
  const sid = getCookie(c, SID_COOKIE);
  if (!sid) return c.redirect('/api/auth/sign-in', 302);

  // Rebuild the callback URL from the public origin (Traefik terminates TLS, so the internal origin
  // may be http://…). Keep the ?code&state query.
  const url = new URL(c.req.url);
  const callbackUrl = `${publicOrigin(url.origin)}${url.pathname}${url.search}`;

  try {
    const client = await makeLogtoClient(sid, () => {});
    await client.handleSignInCallback(callbackUrl);
    const { claims } = await client.getContext();
    if (claims) await ensureAppUser(claims as LogtoIdClaims); // create the local user row now
  } catch {
    return c.redirect('/api/auth/sign-in', 302);
  }

  const rt = getCookie(c, RT_COOKIE) || '/';
  deleteCookie(c, RT_COOKIE, { path: '/' });
  return c.redirect(rt, 302);
});

// Always sign out AT Logto (end-session), not just locally — otherwise the SSO session survives and
// "sign out" wouldn't actually log the user out.
authModule.all('/sign-out', async (c) => {
  const sid = getCookie(c, SID_COOKIE);
  const url = new URL(c.req.url);
  let target = `${publicOrigin(url.origin)}/`;
  if (sid) {
    try {
      const client = await makeLogtoClient(sid, (u) => {
        target = u;
      });
      await client.signOut(`${publicOrigin(url.origin)}/`);
    } catch {
      /* fall through to local cleanup even if Logto is unreachable */
    }
    await dropSession(sid);
    deleteCookie(c, SID_COOKIE, { path: '/' });
  }
  return c.redirect(target, 302);
});
