import crypto from 'crypto';

// httpOnly session cookie -- client-side js literally cannot read this one
export const SESSION_COOKIE_NAME = 'whispers_session';

// NOT httpOnly -- frontend js reads this cookie's value and echoes it back
// in the X-CSRF-Token request header (see CSRF_HEADER_NAME below) on every
// state-changing request. this is the "double-submit" half of csrf
// protection; backend/src/middleware/csrf.js checks header === cookie ===
// the value stored on the session row in the db.
export const CSRF_COOKIE_NAME = 'whispers_csrf';

// *** frontend must send the csrf cookie's value back as this exact header
// name on every non-GET request to /api/people, /api/relationships,
// /api/clips, and /api/auth/logout ***
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// raw token: this is what goes in the cookie and what the client holds.
// never stored server-side in this form.
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// what actually gets stored in the sessions table -- same principle as
// hashing a password, a copy of the database alone shouldn't be enough to
// forge a valid session
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// mirrors db/pool.js's resolveSsl(): explicit env override, else guess from
// NODE_ENV, so existing setups keep working without extra config.
//
// why this needs to be conditional at all: local dev is the frontend and
// backend both on localhost (different ports), which browsers treat as
// same-site regardless of port -- SameSite=Lax works fine there, and
// Secure can't be set at all since local dev is plain http.
// production is vercel (frontend) <-> render (backend), two different
// registrable domains -- genuinely cross-site. a cookie set with the
// default SameSite=Lax/Strict simply will not be attached to those
// cross-site fetch() calls at all, so auth would silently appear broken in
// prod while working fine locally. SameSite=None; Secure is required for
// the cookie to be sent cross-site, and Secure requires https (which both
// vercel and render provide in production).
export function resolveCookieOptions() {
  const crossSiteProd =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

  return crossSiteProd ? { secure: true, sameSite: 'none' } : { secure: false, sameSite: 'lax' };
}
