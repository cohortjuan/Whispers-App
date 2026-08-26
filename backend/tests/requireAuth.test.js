import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock the db pool before importing anything that touches it -- the real
// db/pool.js calls process.exit(1) at import time if DATABASE_URL isn't
// set, which would kill the test runner. vi.mock is hoisted above imports
// by vitest, so the real module body never runs.
vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

const { pool } = await import('../src/db/pool.js');
const { requireAuth } = await import('../src/middleware/requireAuth.js');
const { SESSION_COOKIE_NAME, hashToken } = await import('../src/lib/session.js');

function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('401s when there is no session cookie at all', async () => {
    const req = { cookies: {} };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when the session token has no matching row', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'some-raw-token' } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when the matching session row is expired', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          session_id: 1,
          csrf_token: 'csrf-abc',
          expires_at: new Date(Date.now() - 1000).toISOString(), // 1s in the past
          user_id: 42,
          email: 'nana@example.com',
          display_name: 'Nana',
          family_id: 7,
          family_name: 'Reyes Family',
        },
      ],
    });
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'some-raw-token' } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.user (including family) and req.session and calls next() for a valid, unexpired session', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          session_id: 7,
          csrf_token: 'csrf-abc',
          expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1h from now
          user_id: 42,
          email: 'nana@example.com',
          display_name: 'Nana',
          family_id: 7,
          family_name: 'Reyes Family',
        },
      ],
    });
    const rawToken = 'some-raw-token';
    const req = { cookies: { [SESSION_COOKIE_NAME]: rawToken } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    // looked up by the hash of the raw token, never the raw token itself
    expect(pool.query.mock.calls[0][1]).toEqual([hashToken(rawToken)]);
    expect(req.user).toEqual({
      id: 42,
      email: 'nana@example.com',
      display_name: 'Nana',
      family: { id: 7, name: 'Reyes Family' },
    });
    expect(req.session).toEqual({ id: 7, csrfToken: 'csrf-abc' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes db errors to next(err) instead of throwing', async () => {
    const dbError = new Error('connection lost');
    pool.query.mockRejectedValue(dbError);
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'some-raw-token' } };
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
