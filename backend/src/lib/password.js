import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// pure-js bcrypt, same choice the team made on Gather -- no native
// compilation step to worry about on render
const SALT_ROUNDS = 12;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// NIST 800-63B: length is what actually matters for password strength.
// composition rules ("must contain a symbol") are actively discouraged now --
// they push people toward predictable substitutions instead of longer,
// genuinely harder-to-guess passwords -- so length is the only check here
export function isPasswordStrongEnough(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

// have i been pwned "range" api, k-anonymity style: we send only the first
// 5 hex chars of the password's sha1 hash, never the password or its full
// hash, and HIBP replies with every suffix that shares that prefix so we
// can check for a match locally. no api key needed.
//
// best-effort and fail-open on purpose: signup should never be blocked by a
// third-party service being slow or down. any error here just logs a
// warning and lets the signup proceed -- only a genuine confirmed match in
// a successful response causes a rejection.
export async function isPasswordBreached(password) {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let response;
    try {
      response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn(`hibp breach check returned status ${response.status}, proceeding without it`);
      return false;
    }

    const body = await response.text();
    return body.split('\n').some((line) => line.split(':')[0].trim() === suffix);
  } catch (err) {
    console.warn('hibp breach check failed, proceeding without it:', err.message);
    return false;
  }
}
