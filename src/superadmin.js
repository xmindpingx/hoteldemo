'use strict';
/**
 * Superadmin (site vendor) area: /superadmin
 *   - separate passphrase and cookie (src/auth.js: SUPERADMIN_PASSPHRASE env → data/admin.json → "hotelsuper")
 *   - switches every sellable feature on/off and sets numeric limits (src/features.js → data/features.json)
 *   - sets the plan name, upgrade message and per-feature price/notes the hotel admin sees on locked panels
 *   - a superadmin session also opens /admin, so the vendor never needs the hotel's passphrase
 */
const express = require('express');
const store = require('./store');
const auth = require('./auth');
const features = require('./features');

const router = express.Router();

router.get('/login', (req, res) => {
  if (auth.isSuper(req)) return res.redirect('/superadmin');
  res.render('admin/super-login', { error: '', site: store.getSite() });
});

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (auth.rateLimited(ip)) return res.status(429).render('admin/super-login', { error: 'Too many attempts. Wait 15 minutes and try again.', site: store.getSite() });
  const ok = auth.checkSuperPassphrase(req.body && req.body.passphrase);
  auth.recordAttempt(ip, ok);
  if (!ok) return res.status(401).render('admin/super-login', { error: 'Incorrect superadmin passphrase.', site: store.getSite() });
  auth.loginSuper(req, res);
  res.redirect('/superadmin');
});

router.post('/logout', (req, res) => {
  auth.logoutSuper(req, res);
  res.redirect('/superadmin/login');
});

router.get('/', auth.requireSuper, (req, res) => {
  res.render('admin/super', {
    site: store.getSite(),
    features: features.get(),
    catalog: features.FEATURES,
    limits: features.LIMITS,
    passphraseSource: auth.superPassphraseSource(),
    adminPassphraseSource: auth.passphraseSource(),
  });
});

// ---------- JSON API ----------
const api = express.Router();
api.use(auth.requireSuper, auth.requireFetchHeader);

api.get('/features', (req, res) => res.json({ features: features.get(), catalog: features.FEATURES, limits: features.LIMITS }));

api.put('/features', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Expected a JSON object' });
  try {
    const saved = features.save(body);
    res.json({ ok: true, features: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// enable or disable everything at once
api.post('/features/all', (req, res) => {
  const enabled = Boolean(req.body && req.body.enabled);
  const cur = features.get();
  for (const f of features.FEATURES) cur.flags[f.id] = enabled;
  res.json({ ok: true, features: features.save(cur) });
});

api.post('/passphrase', (req, res) => {
  const { current, next } = req.body || {};
  if (process.env.SUPERADMIN_PASSPHRASE) return res.status(400).json({ error: 'The superadmin passphrase is fixed by the SUPERADMIN_PASSPHRASE environment variable.' });
  if (!auth.checkSuperPassphrase(current)) return res.status(400).json({ error: 'Current passphrase is incorrect.' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New passphrase must be at least 8 characters.' });
  if (auth.checkPassphrase(next)) return res.status(400).json({ error: 'Use a passphrase different from the hotel admin passphrase.' });
  auth.setSuperPassphrase(next);
  res.json({ ok: true });
});

// the vendor may reset the HOTEL admin passphrase (e.g. the client forgot it) without knowing it
api.post('/admin-passphrase', (req, res) => {
  const { next } = req.body || {};
  if (process.env.ADMIN_PASSPHRASE) return res.status(400).json({ error: 'The admin passphrase is fixed by the ADMIN_PASSPHRASE environment variable on the server.' });
  if (typeof next !== 'string' || next.length < 6) return res.status(400).json({ error: 'New passphrase must be at least 6 characters.' });
  auth.setPassphrase(next);
  res.json({ ok: true });
});

router.use('/api', api);

module.exports = router;
