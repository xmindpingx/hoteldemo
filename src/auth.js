'use strict';
/**
 * Admin authentication: a single passphrase ("hoteldemo" by default) and an
 * HMAC-signed, httpOnly session cookie. No database, no user accounts.
 *
 * Passphrase resolution order:
 *   1. ADMIN_PASSPHRASE environment variable (if set, always wins)
 *   2. data/admin.json { passphraseHash } (set from the admin panel)
 *   3. the default: "hoteldemo"
 */
const crypto = require('crypto');
const store = require('./store');

const DEFAULT_PASSPHRASE = 'hoteldemo';
const COOKIE_NAME = 'hd_admin';
// Superadmin = the site vendor. Separate passphrase and cookie; a superadmin session also passes
// every admin check. Resolution: SUPERADMIN_PASSPHRASE env → data/admin.json superPassphraseHash → default.
const DEFAULT_SUPER_PASSPHRASE = 'hotelsuper';
const SUPER_COOKIE_NAME = 'hd_super';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---------- passphrase ----------
function hashPassphrase(pass, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyHash(pass, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(pass), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function checkPassphrase(input) {
  if (typeof input !== 'string' || !input) return false;
  if (process.env.ADMIN_PASSPHRASE) return safeEqual(input, process.env.ADMIN_PASSPHRASE);
  const cfg = store.getAdminConfig();
  if (cfg.passphraseHash) return verifyHash(input, cfg.passphraseHash);
  return safeEqual(input, DEFAULT_PASSPHRASE);
}

function setPassphrase(next) {
  const cfg = store.getAdminConfig();
  cfg.passphraseHash = hashPassphrase(next);
  cfg.passphraseUpdatedAt = new Date().toISOString();
  store.saveAdminConfig(cfg);
}

function checkSuperPassphrase(input) {
  if (typeof input !== 'string' || !input) return false;
  if (process.env.SUPERADMIN_PASSPHRASE) return safeEqual(input, process.env.SUPERADMIN_PASSPHRASE);
  const cfg = store.getAdminConfig();
  if (cfg.superPassphraseHash) return verifyHash(input, cfg.superPassphraseHash);
  return safeEqual(input, DEFAULT_SUPER_PASSPHRASE);
}

function setSuperPassphrase(next) {
  const cfg = store.getAdminConfig();
  cfg.superPassphraseHash = hashPassphrase(next);
  cfg.superPassphraseUpdatedAt = new Date().toISOString();
  store.saveAdminConfig(cfg);
}

function superPassphraseSource() {
  if (process.env.SUPERADMIN_PASSPHRASE) return 'environment (SUPERADMIN_PASSPHRASE)';
  if (store.getAdminConfig().superPassphraseHash) return 'custom (set in superadmin panel)';
  return 'default';
}

function passphraseSource() {
  if (process.env.ADMIN_PASSPHRASE) return 'environment (ADMIN_PASSPHRASE)';
  if (store.getAdminConfig().passphraseHash) return 'custom (set in admin panel)';
  return 'default';
}

// ---------- session cookie ----------
/**
 * HMAC key = server secret + the time that role's passphrase was last changed. Changing or resetting
 * a passphrase therefore invalidates every existing session of that role at once (there is no
 * server-side session list to purge). Env-var passphrases never change, so their key is stable.
 */
function signingKey(role) {
  const cfg = store.getAdminConfig();
  const stamp = role === 'super' ? cfg.superPassphraseUpdatedAt : cfg.passphraseUpdatedAt;
  return `${store.getSecret()}|${role}|${stamp || ''}`;
}

function sign(payload, role) {
  return crypto.createHmac('sha256', signingKey(role)).update(payload).digest('hex');
}

function issueToken(role = 'admin') {
  const exp = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${exp}.${nonce}.${role}`;
  return `${payload}.${sign(payload, role)}`;
}

/** Returns the role ('admin' | 'super') carried by a valid token, or false. */
function verifyToken(token, role = 'admin') {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [exp, nonce, r, sig] = parts;
  if (r !== role) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(`${exp}.${nonce}.${r}`, r);
  return safeEqual(sig, expected) ? r : false;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure),
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

function login(req, res) {
  res.cookie(COOKIE_NAME, issueToken(), cookieOptions(req));
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function isSuper(req) {
  return Boolean(verifyToken(req.cookies && req.cookies[SUPER_COOKIE_NAME], 'super'));
}

/** Admin access: the admin cookie, or a superadmin session (the vendor can always open the admin). */
function isAuthed(req) {
  return Boolean(verifyToken(req.cookies && req.cookies[COOKIE_NAME], 'admin')) || isSuper(req);
}

function loginSuper(req, res) {
  res.cookie(SUPER_COOKIE_NAME, issueToken('super'), cookieOptions(req));
}

function logoutSuper(req, res) {
  res.clearCookie(SUPER_COOKIE_NAME, { path: '/' });
}

function requireSuper(req, res, next) {
  if (isSuper(req)) return next();
  if ((req.originalUrl || '').startsWith('/superadmin/api') || req.xhr || (req.get('accept') || '').includes('application/json')) {
    return res.status(401).json({ error: 'Not signed in as superadmin' });
  }
  return res.redirect('/superadmin/login');
}

function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next();
  if ((req.originalUrl || '').startsWith('/admin/api') || req.xhr || (req.get('accept') || '').includes('application/json')) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  return res.redirect('/admin/login');
}

// ---------- login rate limiting (in-memory) ----------
const attempts = new Map(); // ip -> { count, first }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip, success) {
  const now = Date.now();
  if (success) return attempts.delete(ip);
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else rec.count += 1;
}

/** Mutating admin API calls must carry this header (cheap CSRF guard). */
function requireFetchHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const h = req.get('x-requested-with');
  if (h === 'fetch' || h === 'XMLHttpRequest') return next();
  return res.status(403).json({ error: 'Missing X-Requested-With header' });
}

module.exports = {
  DEFAULT_PASSPHRASE,
  DEFAULT_SUPER_PASSPHRASE,
  COOKIE_NAME,
  SUPER_COOKIE_NAME,
  checkSuperPassphrase,
  setSuperPassphrase,
  superPassphraseSource,
  isSuper,
  loginSuper,
  logoutSuper,
  requireSuper,
  checkPassphrase,
  setPassphrase,
  passphraseSource,
  login,
  logout,
  isAuthed,
  requireAdmin,
  rateLimited,
  recordAttempt,
  requireFetchHeader,
};
