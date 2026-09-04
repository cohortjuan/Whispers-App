import { pool } from '../db/pool.js';
import { SESSION_COOKIE_NAME, hashToken } from '../lib/session.js';

// validates the session cookie against the sessions table (existence +
// not expired), attaches req.user and req.session, or 401s. applied to
// every existing /api/people, /api/relationships, and /api/clips route in
// app.js -- those routes then filter everything by req.user.family.id, so
// this is where that scope comes from on every request.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'not logged in' });
    }

    // u.deleted_at IS NULL: a soft-deleted account (see routes/auth.js's
    // DELETE /me) has its sessions revoked immediately, so this is really a
    // backstop -- but it's what actually closes the gap if some future code
    // path ever mints or reuses a session without checking deletion status
    // first (e.g. a bug in the restore flow)
    const result = await pool.query(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id AS user_id, u.email, u.display_name,
              f.id AS family_id, f.name AS family_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN families f ON f.id = u.family_id
       WHERE s.token_hash = $1 AND u.deleted_at IS NULL`,
      [hashToken(token)]
    );

    const row = result.rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session expired or invalid' });
    }

    req.user = {
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      family: { id: row.family_id, name: row.family_name },
    };
    // csrf.js reads req.session.csrfToken; must run requireAuth before it
    req.session = { id: row.session_id, csrfToken: row.csrf_token };
    next();
  } catch (err) {
    next(err);
  }
}
