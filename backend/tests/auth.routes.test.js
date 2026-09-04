import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// same reasoning as tests/requireAuth.test.js: mock the db pool before
// anything imports it, so the real module's process.exit(1)-if-no-
// DATABASE_URL never runs
vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

const { pool } = await import('../src/db/pool.js');
const { authRouter } = await import('../src/routes/auth.js');
const { hashPassword } = await import('../src/lib/password.js');
const { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } = await import('../src/lib/session.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

const CORRECT_PASSWORD = 'a genuinely long correct password';

describe('POST /api/auth/login', () => {
  let app;
  let userRow;

  beforeEach(async () => {
    app = buildApp();
    pool.query.mockReset();

    userRow = {
      id: 1,
      email: 'nana@example.com',
      password_hash: await hashPassword(CORRECT_PASSWORD),
      display_name: 'Nana',
      failed_login_attempts: 0,
      locked_until: null,
      family_id: 7,
    };

    // a tiny in-memory "database" so lockout state actually persists
    // across the sequence of queries a single login attempt makes
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM users')) {
        return { rows: [{ ...userRow }] };
      }
      if (sql.includes('FROM families')) {
        return { rows: [{ id: 7, name: 'Reyes Family' }] };
      }
      if (sql.includes('locked_until = NULL')) {
        userRow.failed_login_attempts = 0;
        userRow.locked_until = null;
        return { rows: [] };
      }
      // the atomic increment-and-maybe-lock UPDATE (see routes/auth.js) --
      // params are [userId, LOCK_THRESHOLD, lockExpiryDate], mirroring the
      // CASE expressions in the real SQL so this mock actually exercises
      // the same logic instead of just recording whatever the app sends
      if (sql.includes('failed_login_attempts = CASE')) {
        const nextAttempts = userRow.failed_login_attempts + 1;
        if (nextAttempts >= params[1]) {
          userRow.failed_login_attempts = 0;
          userRow.locked_until = params[2];
        } else {
          userRow.failed_login_attempts = nextAttempts;
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sessions')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  }, 15000);

  it('rejects a wrong password with the generic error message and 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nana@example.com', password: 'totally wrong password' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'incorrect email or password' });
  });

  it('gives the exact same generic error for an email that does not exist at all', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM users')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever password here' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'incorrect email or password' });
  });

  it('logs in successfully with the correct password and sets both cookies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      email: 'nana@example.com',
      display_name: 'Nana',
      family: { id: 7, name: 'Reyes Family' },
    });

    const setCookieHeader = res.headers['set-cookie'].join(';');
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(setCookieHeader).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+; Max-Age=\\d+;.*HttpOnly`, 'i'));
  }, 15000);

  it('locks the account after 5 consecutive wrong-password attempts, then rejects even the correct password', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nana@example.com', password: 'wrong every time' });
      expect(res.status).toBe(401);
    }

    expect(userRow.locked_until).not.toBeNull();

    // now even the RIGHT password is rejected while locked, with the same
    // generic message (no separate "account locked" leak)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'incorrect email or password' });
  }, 20000);

  it('rejects a soft-deleted account with the exact same generic message as a wrong password, without touching the lockout counter', async () => {
    userRow.deleted_at = new Date().toISOString();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'incorrect email or password' });
    expect(userRow.failed_login_attempts).toBe(0);
  });

  it('resets the failure counter on a successful login', async () => {
    await request(app).post('/api/auth/login').send({ email: 'nana@example.com', password: 'nope' });
    await request(app).post('/api/auth/login').send({ email: 'nana@example.com', password: 'nope' });
    expect(userRow.failed_login_attempts).toBe(2);

    await request(app).post('/api/auth/login').send({ email: 'nana@example.com', password: CORRECT_PASSWORD });
    expect(userRow.failed_login_attempts).toBe(0);
    expect(userRow.locked_until).toBeNull();
  }, 15000);
});

describe('POST /api/auth/signup validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    pool.query.mockReset();
  });

  const VALID_PASSWORD = 'a genuinely long new-account password';

  it('rejects a password shorter than the minimum length before ever touching the db', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: 'short', display_name: 'New Person' });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('requires either a family_name or an invite_code', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: VALID_PASSWORD, display_name: 'New Person' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/family name|invite code/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects sending both a family_name and an invite_code', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@example.com',
      password: VALID_PASSWORD,
      display_name: 'New Person',
      family_name: 'The Reyes Family',
      invite_code: 'ABCDEFGHJK',
    });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects an invite_code that does not match any family, without creating an account', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM invites')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@example.com',
      password: VALID_PASSWORD,
      display_name: 'New Person',
      invite_code: 'nonexistent-code',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "that invite code doesn't match any family" });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects an invite_code that was already used', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM invites')) {
        return { rows: [{ id: 1, family_id: 7, email: null, used_at: new Date().toISOString(), expires_at: new Date(Date.now() + 100000).toISOString() }] };
      }
      return { rows: [] };
    });

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@example.com',
      password: VALID_PASSWORD,
      display_name: 'New Person',
      invite_code: 'already-used-code',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'that invite code has already been used' });
  });

  it('rejects an invite_code locked to a different email address', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM invites')) {
        return {
          rows: [
            {
              id: 1,
              family_id: 7,
              email: 'someone-else@example.com',
              used_at: null,
              expires_at: new Date(Date.now() + 100000).toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@example.com',
      password: VALID_PASSWORD,
      display_name: 'New Person',
      invite_code: 'email-locked-code',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'that invite code was issued for a different email address' });
  });
});

describe('POST /api/auth/restore', () => {
  let app;
  let userRow;

  beforeEach(async () => {
    app = buildApp();
    pool.query.mockReset();

    userRow = {
      id: 1,
      email: 'nana@example.com',
      password_hash: await hashPassword(CORRECT_PASSWORD),
      display_name: 'Nana',
      family_id: 7,
      deleted_at: new Date().toISOString(), // "deleted" just now -- well within the 30-day window
    };

    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM users')) return { rows: [{ ...userRow }] };
      if (sql.includes('FROM families')) return { rows: [{ id: 7, name: 'Reyes Family' }] };
      if (sql.includes('SET deleted_at = NULL')) {
        userRow.deleted_at = null;
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sessions')) return { rows: [] };
      return { rows: [] };
    });
  });

  it('restores a soft-deleted account within the grace window and logs it in', async () => {
    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      email: 'nana@example.com',
      display_name: 'Nana',
      family: { id: 7, name: 'Reyes Family' },
    });
    const setCookieHeader = res.headers['set-cookie'].join(';');
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).toContain(`${CSRF_COOKIE_NAME}=`);
  });

  it('rejects the wrong password with a generic message', async () => {
    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: 'totally wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'no deleted account matches that email and password' });
  });

  it('rejects an account that was never deleted, even with the right password', async () => {
    userRow.deleted_at = null;

    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(401);
  });

  // restore used to be the one password-guessing route with no account-level
  // limit at all -- only the ip-keyed limiter, which is exactly what login's
  // lockout exists to backstop for slow/distributed attempts
  it('counts a failed restore against the account lockout, like login does', async () => {
    const lockoutUpdates = [];
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM users')) return { rows: [{ ...userRow }] };
      if (sql.includes('failed_login_attempts = CASE WHEN')) {
        lockoutUpdates.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: 'totally wrong' });

    expect(res.status).toBe(401);
    expect(lockoutUpdates).toHaveLength(1);
  });

  it('refuses to restore a locked account even with the correct password', async () => {
    userRow.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'no deleted account matches that email and password' });
  });

  it('rejects an account deleted more than 30 days ago (past the grace window)', async () => {
    userRow.deleted_at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nana@example.com', password: CORRECT_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('rejects an email that has no account at all, with the same generic message', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM users')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/auth/restore')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'no deleted account matches that email and password' });
  });
});

describe('DELETE /api/auth/me', () => {
  it('revokes every session for the user and soft-deletes the account', async () => {
    // unlike /api/people etc. (which get requireAuth/csrfProtection from
    // app.js at the mount level), DELETE /me wires them directly onto the
    // route itself -- so this test has to actually satisfy both, via the
    // real middleware running against the mocked pool, same as the login
    // test above does for its own cookie assertions
    const app = buildApp();
    pool.query.mockReset();

    const rawToken = 'a-raw-session-token';
    const csrfToken = 'csrf-for-delete-me';

    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM sessions s')) {
        return {
          rows: [
            {
              session_id: 99,
              csrf_token: csrfToken,
              expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
              user_id: 1,
              email: 'nana@example.com',
              display_name: 'Nana',
              family_id: 7,
              family_name: 'Reyes Family',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .delete('/api/auth/me')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${rawToken}`, `${CSRF_COOKIE_NAME}=${csrfToken}`])
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(204);
    const calledSql = pool.query.mock.calls.map((call) => call[0]);
    expect(calledSql.some((sql) => sql.includes('DELETE FROM sessions WHERE user_id'))).toBe(true);
    expect(calledSql.some((sql) => sql.includes('UPDATE users SET deleted_at = now()'))).toBe(true);
  });
});
