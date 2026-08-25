import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../lib/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// double-submit csrf check, tied to the session row (not a bare stateless
// double-submit): the frontend must send the X-CSRF-Token header (see
// CSRF_HEADER_NAME in lib/session.js) with the same value as the
// whispers_csrf cookie, AND that value has to match what's stored on the
// session row in the db (req.session.csrfToken, set by requireAuth).
//
// this matters specifically because the session cookie is SameSite=None in
// production (required for the vercel <-> render cross-site setup -- see
// lib/session.js) and SameSite=None cookies provide zero csrf protection
// on their own. this is the actual csrf defense for this app, not extra
// hardening.
//
// must run AFTER requireAuth (needs req.session.csrfToken already set).
// only applies to state-changing requests -- GET/HEAD/OPTIONS are exempt.
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const headerToken = req.get(CSRF_HEADER_NAME);
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const sessionToken = req.session?.csrfToken;

  if (!headerToken || !sessionToken || headerToken !== cookieToken || headerToken !== sessionToken) {
    return res.status(403).json({ error: 'invalid or missing csrf token' });
  }

  next();
}
