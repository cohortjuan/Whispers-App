import { describe, it, expect, vi } from 'vitest';
import { csrfProtection } from '../src/middleware/csrf.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../src/lib/session.js';

function makeReq({ method = 'POST', headerToken, cookieToken, sessionToken } = {}) {
  return {
    method,
    cookies: cookieToken === undefined ? {} : { [CSRF_COOKIE_NAME]: cookieToken },
    session: sessionToken === undefined ? undefined : { csrfToken: sessionToken },
    get(name) {
      if (name === CSRF_HEADER_NAME) return headerToken;
      return undefined;
    },
  };
}

function makeRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('csrfProtection', () => {
  it('lets GET/HEAD/OPTIONS through without checking anything', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const req = makeReq({ method });
      const res = makeRes();
      const next = vi.fn();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('passes a mutating request when header, cookie, and session token all match', () => {
    const req = makeReq({ headerToken: 'tok-123', cookieToken: 'tok-123', sessionToken: 'tok-123' });
    const res = makeRes();
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when the header is missing', () => {
    const req = makeReq({ cookieToken: 'tok-123', sessionToken: 'tok-123' });
    const res = makeRes();
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid or missing csrf token' });
  });

  it('rejects when the header does not match the cookie', () => {
    const req = makeReq({ headerToken: 'attacker-guess', cookieToken: 'tok-123', sessionToken: 'tok-123' });
    const res = makeRes();
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects when the header/cookie match each other but not the session-stored token', () => {
    // catches a forged cookie pair that doesn't correspond to a real session
    const req = makeReq({ headerToken: 'tok-123', cookieToken: 'tok-123', sessionToken: 'tok-456' });
    const res = makeRes();
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects when there is no session at all (requireAuth did not run)', () => {
    const req = makeReq({ headerToken: 'tok-123', cookieToken: 'tok-123' });
    const res = makeRes();
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
