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

function passphraseSource() {
  if (process.env.ADMIN_PASSPHRASE) return 'environment (ADMIN_PASSPHRASE)';
  if (store.getAdminConfig().passphraseHash) return 'custom (set in admin panel)';
  return 'default';
}

// ---------- session cookie ----------
function sign(payload) {
  return crypto.createHmac('sha256', store.getSecret()).update(payload).digest('hex');
}

function issueToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(`${exp}.${nonce}`);
  return safeEqual(sig, expected);
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

function isAuthed(req) {
  return verifyToken(req.cookies && req.cookies[COOKIE_NAME]);
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
  COOKIE_NAME,
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
