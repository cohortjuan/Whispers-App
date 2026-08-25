import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashPassword, verifyPassword, isPasswordStrongEnough, isPasswordBreached } from '../src/lib/password.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies against the original', async () => {
    const hash = await hashPassword('a genuinely long passphrase');
    expect(hash).not.toBe('a genuinely long passphrase');
    await expect(verifyPassword('a genuinely long passphrase', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong horse battery staple', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same password same password');
    const b = await hashPassword('same password same password');
    expect(a).not.toBe(b);
  });
});

describe('isPasswordStrongEnough', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(isPasswordStrongEnough('short')).toBe(false);
    expect(isPasswordStrongEnough('12345678901')).toBe(false); // 11 chars, one short of the minimum
  });

  it('accepts passwords at or above the minimum length regardless of composition', () => {
    expect(isPasswordStrongEnough('123456789012')).toBe(true); // 12 chars, no symbols/mixed case required
    expect(isPasswordStrongEnough('a'.repeat(12))).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isPasswordStrongEnough(undefined)).toBe(false);
    expect(isPasswordStrongEnough(12345678901234)).toBe(false);
  });
});

describe('isPasswordBreached', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns true when the suffix is present in the HIBP range response', async () => {
    // sha1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\nOTHERSUFFIX:5',
    });

    await expect(isPasswordBreached('password')).resolves.toBe(true);
  });

  it('returns false when the suffix is not present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'SOMEOTHERSUFFIX000000000000000000:1',
    });

    await expect(isPasswordBreached('a totally different passphrase')).resolves.toBe(false);
  });

  it('fails open (returns false) when the request errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(isPasswordBreached('anything')).resolves.toBe(false);
  });

  it('fails open (returns false) when the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(isPasswordBreached('anything')).resolves.toBe(false);
  });
});
