// auth.js — password hashing, HMAC tokens, login rate limiting.
// Pure Node built-ins. No credential value is ever logged or returned
// by anything in this module; it only hashes, signs and verifies.
const crypto = require('crypto');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: JWT_SECRET is not set — using a random per-process secret. Tokens will not survive a restart. Set JWT_SECRET in production.');
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const hash = crypto.scryptSync(password, parts[1], 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(parts[2], 'hex'));
  } catch { return false; }
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub: user.id, email: user.email, role: user.role,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
function verifyToken(token) {
  try {
    const [header, payload, sig] = String(token).split('.');
    if (!header || !payload || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch { return null; }
}
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILED = 10;
const loginFailures = new Map();
function loginBlocked(ip) {
  const rec = loginFailures.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { loginFailures.delete(ip); return false; }
  return rec.count >= LOGIN_MAX_FAILED;
}
function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = loginFailures.get(ip);
  if (!rec || now > rec.resetAt) loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else rec.count += 1;
}
function clearLoginFailures(ip) { loginFailures.delete(ip); }
module.exports = { hashPassword, verifyPassword, signToken, verifyToken, loginBlocked, recordLoginFailure, clearLoginFailures, LOGIN_MAX_FAILED };
