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
// SameSite=Lax works in both environments now. Production frontend (Vercel)
// and backend (Render) are on different registrable domains, but the
// frontend never calls Render directly -- vercel.json rewrites /api/* and
// /uploads/* through the frontend's own origin (see frontend/src/api/
// client.js), so the browser only ever talks to whispers-app.vercel.app
// and this cookie is same-site from its point of view either way. (An
// earlier version of this comment described a genuinely cross-site setup
// needing SameSite=None -- that was true before the same-origin proxy fix,
// and is deliberately not the case anymore: None is broader than this app
// needs, and a stricter SameSite is one less thing a hostile origin could
// ever lean on.) Secure still needs its own flag: local dev is plain http
// and can't set it at all, production is https and should always have it.
export function resolveCookieOptions() {
  const secureProd =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

  return secureProd ? { secure: true, sameSite: 'lax' } : { secure: false, sameSite: 'lax' };
}
