import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateToken, hashToken, resolveCookieOptions } from '../src/lib/session.js';

describe('generateToken / hashToken', () => {
  it('generates different tokens each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('hashToken is deterministic for the same input', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('hashToken never returns the raw token back', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it('different tokens hash to different values', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});

describe('resolveCookieOptions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECURE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to non-secure/lax for local dev (no NODE_ENV set)', () => {
    expect(resolveCookieOptions()).toEqual({ secure: false, sameSite: 'lax' });
  });

  it('switches to secure/none when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveCookieOptions()).toEqual({ secure: true, sameSite: 'none' });
  });

  it('COOKIE_SECURE=true forces secure/none even outside production', () => {
    process.env.COOKIE_SECURE = 'true';
    expect(resolveCookieOptions()).toEqual({ secure: true, sameSite: 'none' });
  });

  it('COOKIE_SECURE=false forces non-secure/lax even in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'false';
    expect(resolveCookieOptions()).toEqual({ secure: false, sameSite: 'lax' });
  });
});
