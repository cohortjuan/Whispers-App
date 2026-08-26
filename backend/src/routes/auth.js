import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import {
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
  isPasswordBreached,
  MIN_PASSWORD_LENGTH,
} from '../lib/password.js';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_TTL_MS,
  generateToken,
  hashToken,
  resolveCookieOptions,
} from '../lib/session.js';

export const authRouter = Router();

const LOCK_THRESHOLD = 5; // consecutive failed attempts before locking
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// a real bcrypt hash of a random string that is not, and was never, anyone's
// actual password. used so a login attempt against a nonexistent email
// still runs a bcrypt compare -- keeps the response time for "no such user"
// close to "wrong password", instead of returning fast and giving a timing
// signal for which emails have accounts
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8xoUpG5UJRVLuHYd8sVj9ju8YbXqZO';

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// ip-keyed (express-rate-limit's default). fine as in-memory/per-instance
// at this app's scale -- a multi-instance deployment would need a shared
// store (e.g. redis) for these limits to be accurate across instances,
// not worth the complexity here. this is on top of, not instead of, the
// per-account lockout below (that one isn't ip-based at all)
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many signup attempts, please try again later' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts, please try again later' },
});

// join-family is authenticated (unlike signup/login), so it doesn't get the
// same protection from a stranger being rate-limited by IP alone -- one
// logged-in account could otherwise just try every code in a loop. same
// window/limit as login since it's the same kind of "guess a secret" risk.
const joinFamilyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, please try again later' },
});

// excludes visually-ambiguous characters (0/O, 1/I/L) since these get typed
// by hand off a phone screen or read aloud, not just pasted
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 10; // ~49 bits of entropy, plenty for a one-time, expiring, rate-limited secret
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[crypto.randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeInviteCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase().replace(/\s+/g, '') : '';
}

async function createFamily(name) {
  const result = await pool.query('INSERT INTO families (name) VALUES ($1) RETURNING id', [name]);
  return result.rows[0].id;
}

// Shared by signup (joining a family at account-creation time) and
// join-family (an existing account redeeming a code after the fact). Checks
// every rule that makes a code single-use and hard to abuse: it has to
// exist, not already be used, not be expired, and -- if the person who
// created it locked it to a specific email -- match that email exactly.
// Returns { invite } on success or { error } with a user-facing message.
async function findRedeemableInvite(code, email) {
  const result = await pool.query('SELECT * FROM invites WHERE code = $1', [code]);
  const invite = result.rows[0];

  if (!invite) return { error: "that invite code doesn't match any family" };
  if (invite.used_at) return { error: 'that invite code has already been used' };
  if (new Date(invite.expires_at) < new Date()) return { error: 'that invite code has expired' };
  if (invite.email && invite.email !== email) {
    return { error: 'that invite code was issued for a different email address' };
  }

  return { invite };
}

async function redeemInvite(inviteId, userId) {
  await pool.query('UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1', [inviteId, userId]);
}

function setAuthCookies(res, { token, csrfToken }) {
  const { secure, sameSite } = resolveCookieOptions();
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // frontend js needs to read this one, see lib/session.js
    secure,
    sameSite,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function clearAuthCookies(res) {
  const { secure, sameSite } = resolveCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/', secure, sameSite });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/', secure, sameSite });
}

async function createSessionForUser(userId) {
  const token = generateToken();
  const csrfToken = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), csrfToken, expiresAt]
  );

  return { token, csrfToken };
}

// POST /api/auth/signup  { email, password, display_name, family_name } to
// start a brand-new family, or { ..., invite_code } to join an existing one
// -> 201 { id, email, display_name, created_at }
// does NOT log the new user in -- call POST /api/auth/login afterward
authRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, display_name } = req.body;
    const familyName = typeof req.body.family_name === 'string' ? req.body.family_name.trim() : '';
    const inviteCode = normalizeInviteCode(req.body.invite_code);

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'a valid email is required' });
    }
    if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
      return res.status(400).json({ error: 'display_name is required' });
    }
    if (!isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (!familyName && !inviteCode) {
      return res.status(400).json({
        error: 'enter a family name to start a new family tree, or an invite code to join an existing one',
      });
    }
    if (familyName && inviteCode) {
      return res.status(400).json({ error: 'enter either a new family name or an invite code, not both' });
    }

    // resolved before the breach check / hashing below so a bad invite code
    // fails fast without spending time on those
    let invite = null;
    if (inviteCode) {
      const lookup = await findRedeemableInvite(inviteCode, email);
      if (lookup.error) return res.status(400).json({ error: lookup.error });
      invite = lookup.invite;
    }

    // best-effort, fail-open -- see lib/password.js. only a confirmed
    // breach match rejects the signup; any error/timeout lets it through
    if (await isPasswordBreached(password)) {
      return res
        .status(400)
        .json({ error: 'that password has appeared in a known data breach, please choose a different one' });
    }

    const passwordHash = await hashPassword(password);
    const familyId = invite ? invite.family_id : await createFamily(familyName);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, family_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, created_at`,
      [email, passwordHash, display_name.trim(), familyId]
    );

    // only burn the invite once the account it's tied to actually exists --
    // if the insert above fails (duplicate email), the code is still good
    if (invite) {
      await redeemInvite(invite.id, result.rows[0].id);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'an account with that email already exists' });
    }
    next(err);
  }
});

// POST /api/auth/login  { email, password }
// -> 200 { id, email, display_name, family: { id, name } } + sets session/csrf cookies
// -> 401 { error: "incorrect email or password" } for: no such account,
//    wrong password, OR a locked account -- deliberately the same message
//    and status in all three cases so a failed login never reveals
//    whether the email exists or the account happens to be locked
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    const reject = () => res.status(401).json({ error: 'incorrect email or password' });

    if (!email || typeof password !== 'string') {
      return reject();
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    const isLocked = !!(user && user.locked_until && new Date(user.locked_until) > new Date());

    // always run a real bcrypt compare (real hash or dummy), so a
    // nonexistent email, a locked account, and a genuinely wrong password
    // all take about the same amount of time
    const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || isLocked || !passwordMatches) {
      // only track failures against a real, currently-unlocked account --
      // this is the account-level lockout, independent of the ip-based
      // rate limiter above, so it catches slow/distributed attempts
      // against one target account
      if (user && !isLocked && !passwordMatches) {
        const attempts = user.failed_login_attempts + 1;
        if (attempts >= LOCK_THRESHOLD) {
          await pool.query(
            `UPDATE users SET failed_login_attempts = 0, locked_until = $2, updated_at = now() WHERE id = $1`,
            [user.id, new Date(Date.now() + LOCK_DURATION_MS)]
          );
        } else {
          await pool.query(
            `UPDATE users SET failed_login_attempts = $2, updated_at = now() WHERE id = $1`,
            [user.id, attempts]
          );
        }
      }
      return reject();
    }

    // successful login resets the failure counter
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [user.id]
    );

    const { token, csrfToken } = await createSessionForUser(user.id);
    setAuthCookies(res, { token, csrfToken });

    const familyResult = await pool.query('SELECT id, name FROM families WHERE id = $1', [user.family_id]);

    res.json({
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      family: familyResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/join-family  { invite_code }
// -> 200 { id, email, display_name, family: { id, name } }
// Lets an already-logged-in user redeem a code after the fact -- someone
// who signed up before getting invited, or who wants to switch into a
// different family's tree. Same redemption rules as signup: the code has
// to exist, be unused, unexpired, and (if it's email-locked) match this
// account's own email.
authRouter.post('/join-family', requireAuth, csrfProtection, joinFamilyLimiter, async (req, res, next) => {
  try {
    const inviteCode = normalizeInviteCode(req.body.invite_code);
    if (!inviteCode) {
      return res.status(400).json({ error: 'invite_code is required' });
    }

    const lookup = await findRedeemableInvite(inviteCode, req.user.email);
    if (lookup.error) return res.status(400).json({ error: lookup.error });
    const { invite } = lookup;

    if (invite.family_id === req.user.family.id) {
      return res.status(400).json({ error: "you're already in that family" });
    }

    await pool.query('UPDATE users SET family_id = $2, updated_at = now() WHERE id = $1', [
      req.user.id,
      invite.family_id,
    ]);
    await redeemInvite(invite.id, req.user.id);

    const familyResult = await pool.query('SELECT id, name FROM families WHERE id = $1', [invite.family_id]);

    res.json({
      id: req.user.id,
      email: req.user.email,
      display_name: req.user.display_name,
      family: familyResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/invites  { email? }
// -> 201 { code, email, expires_at }
// Generates a fresh one-time invite for the caller's own family so they can
// share it with whoever they want to add. Passing email locks the code to
// that one address (matched case-insensitively at redemption); omitting it
// makes the code redeemable by whoever gets it first, still exactly once.
authRouter.post('/invites', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const email = req.body.email ? normalizeEmail(req.body.email) : null;
    if (email && !email.includes('@')) {
      return res.status(400).json({ error: 'that email address looks invalid' });
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // collisions are astronomically unlikely at this alphabet/length, but
    // retry a couple of times rather than 500ing on the one-in-a-billion hit
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await pool.query(
          `INSERT INTO invites (family_id, code, email, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING code, email, expires_at`,
          [req.user.family.id, generateInviteCode(), email, req.user.id, expiresAt]
        );
        return res.status(201).json(result.rows[0]);
      } catch (err) {
        if (err.code === '23505' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout -- requires a valid session (there's nothing to log
// out of otherwise) and a valid csrf token. deletes the session row
// server-side so a copy of the cookie stops working immediately, not just
// whenever it naturally expires.
// -> 204 no content, clears both cookies
authRouter.post('/logout', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
    clearAuthCookies(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me -> 200 { id, email, display_name, family: { id, name } } or 401 { error }
authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});
