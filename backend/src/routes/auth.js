import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { TRASH_RETENTION_MS } from '../lib/retention.js';
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
import { sendMail } from '../lib/mailer.js';

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

// same shape as loginLimiter -- restoring a deleted account is still
// fundamentally "guess a password against a known email", the same risk
// login already guards against. NOTE this is only the ip-keyed half of
// that guard: POST /restore also runs the same per-account lockout login
// does (see the LOCK_THRESHOLD update in its handler), because an ip
// limiter alone doesn't stop a slow/distributed attack on one account.
const restoreLimiter = rateLimit({
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

// accepts an explicit client so signup can run this inside the same
// transaction as claiming an invite and creating the account -- see there
// for why that matters
async function createFamily(name, executor = pool) {
  const result = await executor.query('INSERT INTO families (name) VALUES ($1) RETURNING id', [name]);
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

// Atomically claims the invite -- conditioning the UPDATE on used_at IS
// NULL, not just trusting findRedeemableInvite's earlier SELECT, is what
// actually makes this single-use under concurrency. That SELECT and this
// UPDATE used to be two separate round trips with a real window between
// them: two requests redeeming the same code at close enough to the same
// time could both see "not yet used" and both go on to succeed, letting a
// single-use code add two people instead of one. Returns whether this call
// actually won the claim -- false means someone else's request got there
// first, and the caller should treat that exactly like an already-used code.
async function redeemInvite(inviteId, userId, executor = pool) {
  const result = await executor.query(
    'UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1 AND used_at IS NULL RETURNING id',
    [inviteId, userId]
  );
  return result.rows.length > 0;
}

// Fire-and-forget: called from both signup (joining via invite) and
// join-family below, always AFTER the family switch/account creation has
// already succeeded, and never awaited before the http response -- an email
// provider being slow or down should never delay or fail the actual request
// that triggered it. Notifies every OTHER current member of the family, not
// just whoever generated the invite code -- deliberately broader than "the
// inviter" so nobody in the family is surprised by a new face in their tree.
async function notifyFamilyOfNewMember({ familyId, newMemberName, joiningUserId }) {
  try {
    const result = await pool.query(
      `SELECT u.email, f.name AS family_name
       FROM users u JOIN families f ON f.id = u.family_id
       WHERE u.family_id = $1 AND u.deleted_at IS NULL AND u.id <> $2`,
      [familyId, joiningUserId]
    );
    await Promise.all(
      result.rows.map((row) =>
        sendMail({
          to: row.email,
          subject: `${newMemberName} just joined ${row.family_name} on Whispers`,
          text: `${newMemberName} used an invite code to join your family's tree on Whispers App.`,
        })
      )
    );
  } catch (err) {
    console.error('failed to notify family of new member:', err.message);
  }
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

    // Everything from here on runs in one transaction: claiming the invite,
    // creating the account, and (for a new family) creating the family
    // itself all succeed together or all roll back together. That's what
    // still lets a duplicate-email failure leave the invite code good for
    // someone else to use (the original goal), while also making sure a
    // successful claim always has a real account behind it -- the two
    // outcomes used to be handled with separate, non-transactional queries,
    // which is exactly the gap the redeemInvite race lived in.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let familyId;
      if (invite) {
        const claimed = await redeemInvite(invite.id, null, client);
        if (!claimed) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'that invite code has already been used' });
        }
        familyId = invite.family_id;
      } else {
        familyId = await createFamily(familyName, client);
      }

      const result = await client.query(
        `INSERT INTO users (email, password_hash, display_name, family_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, display_name, created_at`,
        [email, passwordHash, display_name.trim(), familyId]
      );

      // used_by couldn't be set until the account existed to reference --
      // fill it in now that it does, still inside the same transaction
      if (invite) {
        await client.query('UPDATE invites SET used_by = $2 WHERE id = $1', [invite.id, result.rows[0].id]);
      }

      await client.query('COMMIT');

      // only when joining an existing family via invite -- a brand-new
      // family has nobody else in it yet to notify. Not awaited: email
      // sending must never delay this response.
      if (invite) {
        notifyFamilyOfNewMember({
          familyId,
          newMemberName: display_name.trim(),
          joiningUserId: result.rows[0].id,
        }).catch(() => {});
      }

      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
    // a soft-deleted account (see DELETE /me below) can't log in normally --
    // POST /restore is the dedicated way back in, since sessions were
    // revoked at delete time and there's no live session left to just
    // "un-delete" through. Rejected with the exact same generic message as
    // every other reason below, deliberately -- a distinct "this account
    // was deleted" response would leak deletion state to anyone who tries
    // an email, the same oracle this file already works to avoid for
    // locked/nonexistent accounts.
    const isDeleted = !!(user && user.deleted_at);

    // always run a real bcrypt compare (real hash or dummy), so a
    // nonexistent email, a locked account, and a genuinely wrong password
    // all take about the same amount of time
    const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || isLocked || isDeleted || !passwordMatches) {
      // only track failures against a real, currently-unlocked, non-deleted
      // account -- this is the account-level lockout, independent of the
      // ip-based rate limiter above, so it catches slow/distributed
      // attempts against one target account
      if (user && !isLocked && !isDeleted && !passwordMatches) {
        // Incrementing and (conditionally) locking in one atomic UPDATE,
        // rather than reading failed_login_attempts, computing +1 in JS,
        // then writing it back -- that read-then-write let concurrent
        // failed attempts against the same account race each other: every
        // request reads the same stale count, so N simultaneous guesses
        // only ever move the counter to 1, never to N, and the lockout
        // threshold is never reached no matter how many attempts land at
        // once. A single UPDATE is one indivisible read-and-write against
        // that row, so concurrent attempts serialize correctly instead.
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
               locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN $3 ELSE locked_until END,
               updated_at = now()
           WHERE id = $1`,
          [user.id, LOCK_THRESHOLD, new Date(Date.now() + LOCK_DURATION_MS)]
        );
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

    // claim before switching -- if someone else's request claims this code
    // first, bail out here rather than moving the user's family and only
    // then discovering the code was already spent
    const claimed = await redeemInvite(invite.id, req.user.id);
    if (!claimed) {
      return res.status(400).json({ error: 'that invite code has already been used' });
    }

    await pool.query('UPDATE users SET family_id = $2, updated_at = now() WHERE id = $1', [
      req.user.id,
      invite.family_id,
    ]);

    // not awaited -- same reasoning as the signup call site above
    notifyFamilyOfNewMember({
      familyId: invite.family_id,
      newMemberName: req.user.display_name,
      joiningUserId: req.user.id,
    }).catch(() => {});

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

// GET /api/auth/family-member-count -> 200 { count }
// how many active (non-deleted) logins share the caller's family -- powers
// the frontend's "you're the only one here" warning before deleting an
// account. its own route rather than folding onto GET /me so that hot path
// doesn't gain an extra query most callers never need.
authRouter.get('/family-member-count', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE family_id = $1 AND deleted_at IS NULL',
      [req.user.family.id]
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/family  { name }
// -> 200 { id, name }
// Renames the caller's own family. Any member can do this (no roles/owner
// concept exists in this app), symmetric with any member already being able
// to generate an invite. Added directly because of a real incident: a
// legacy pre-families-table backfill (see the DO $$ ... legacy_family_id
// block in database/schema.sql) can leave someone's account in a family
// literally named "My Family" -- previously the only fix was a developer
// running raw SQL by hand. This makes that self-service.
authRouter.patch('/family', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'a family name is required' });
    if (name.length > 200) return res.status(400).json({ error: 'family name is too long' });

    const result = await pool.query('UPDATE families SET name = $1 WHERE id = $2 RETURNING id, name', [
      name,
      req.user.family.id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/me -- deletes the caller's own LOGIN, not their family's
// tree. Deliberately separate from deleting a person (DELETE /api/people/:id)
// -- see the users table's own comment in schema.sql: a login is "who's
// authenticated and which family they're in," not a tree member, so this
// never touches people/clips/relationships/families. Soft-deleted (30-day
// grace, see jobs/purge.js), and every session is revoked immediately so
// this account is logged out everywhere right away, not just in this tab.
// -> 204, clears cookies
authRouter.delete('/me', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    // sessions revoked first: if this crashes between the two writes, the
    // worst case is "sessions gone, account still shows active" (self-
    // healing -- they can just log in again normally), rather than the
    // reverse order's "marked deleted, but some session is still alive"
    // (requireAuth's own u.deleted_at guard closes that gap either way --
    // this ordering is just belt-and-suspenders on top of it)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    await pool.query('UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1', [req.user.id]);
    clearAuthCookies(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/restore  { email, password }
// -> 200 { id, email, display_name, family: { id, name } } + sets session/csrf cookies
// Undoes DELETE /me, within the 30-day grace window. Deliberately public (no
// requireAuth) -- the whole point is the account has no live session left to
// use, this IS the way back in. Re-verifies the password (same as a fresh
// login) since a dead session can't prove anything on its own.
authRouter.post('/restore', restoreLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    const reject = () => res.status(401).json({ error: 'no deleted account matches that email and password' });

    if (!email || typeof password !== 'string') return reject();

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    // the per-account lockout applies here exactly as it does on login.
    // Without it this route was the one password-guessing path in the app
    // with no account-level limit at all -- only the ip-keyed limiter above,
    // which is precisely the thing login's lockout exists to backstop for
    // slow/distributed attempts. Narrow (the target has to be soft-deleted
    // and inside the grace window) but it undercut the guarantee login makes.
    const isLocked = !!(user && user.locked_until && new Date(user.locked_until) > new Date());

    // always run a real bcrypt compare, same timing-safety reasoning as login
    const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

    const withinGrace = user?.deleted_at && new Date(user.deleted_at) > new Date(Date.now() - TRASH_RETENTION_MS);

    if (!user || isLocked || !passwordMatches || !withinGrace) {
      // count the failure only against a real, unlocked, actually-restorable
      // account -- and with the same single atomic UPDATE login uses, so
      // concurrent guesses serialize instead of racing the counter
      if (user && !isLocked && withinGrace && !passwordMatches) {
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
               locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN $3 ELSE locked_until END,
               updated_at = now()
           WHERE id = $1`,
          [user.id, LOCK_THRESHOLD, new Date(Date.now() + LOCK_DURATION_MS)]
        );
      }
      return reject();
    }

    await pool.query(
      `UPDATE users SET deleted_at = NULL, failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
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
