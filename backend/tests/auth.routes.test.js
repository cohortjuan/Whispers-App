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
    };

    // a tiny in-memory "database" so lockout state actually persists
    // across the sequence of queries a single login attempt makes
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM users')) {
        return { rows: [{ ...userRow }] };
      }
      if (sql.includes('locked_until = NULL')) {
        userRow.failed_login_attempts = 0;
        userRow.locked_until = null;
        return { rows: [] };
      }
      if (sql.includes('locked_until = $2')) {
        userRow.failed_login_attempts = 0;
        userRow.locked_until = params[1];
        return { rows: [] };
      }
      if (sql.includes('failed_login_attempts = $2')) {
        userRow.failed_login_attempts = params[1];
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
    expect(res.body).toEqual({ id: 1, email: 'nana@example.com', display_name: 'Nana' });

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

  it('rejects a password shorter than the minimum length before ever touching the db', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@example.com', password: 'short', display_name: 'New Person' });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
