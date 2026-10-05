'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const auth = require('./auth');
const { AMENITY_ICON_NAMES, ICONS } = require('./icons');
const { FONT_OPTIONS } = require('./helpers');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- uploads ----------
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.bin';
      const base = path.basename(file.originalname, path.extname(file.originalname)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
      cb(null, `${Date.now().toString(36)}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(ALLOWED[file.mimetype] ? null : new Error('Only image files (jpg, png, webp, gif, svg, avif) are allowed'), Boolean(ALLOWED[file.mimetype])),
});

// ---------- pages ----------
router.get('/login', (req, res) => {
  if (auth.isAuthed(req)) return res.redirect('/admin');
  res.render('admin/login', { error: '', site: store.getSite() });
});

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (auth.rateLimited(ip)) {
    return res.status(429).render('admin/login', { error: 'Too many attempts. Wait 15 minutes and try again.', site: store.getSite() });
  }
  const ok = auth.checkPassphrase(req.body && req.body.passphrase);
  auth.recordAttempt(ip, ok);
  if (!ok) return res.status(401).render('admin/login', { error: 'Incorrect passphrase.', site: store.getSite() });
  auth.login(req, res);
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  auth.logout(req, res);
  res.redirect('/admin/login');
});

router.get('/', auth.requireAdmin, (req, res) => {
  res.render('admin/index', { site: store.getSite(), passphraseSource: auth.passphraseSource() });
});

// ---------- JSON API ----------
const api = express.Router();
api.use(auth.requireAdmin, auth.requireFetchHeader);

api.get('/site', (req, res) => res.json(store.getSite()));

api.put('/site', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Expected a JSON object' });
  try {
    const saved = store.saveSite(body);
    res.json({ ok: true, site: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/meta', (req, res) => {
  res.json({
    icons: AMENITY_ICON_NAMES,
    iconSvgs: Object.fromEntries(AMENITY_ICON_NAMES.map((n) => [n, ICONS[n]])),
    fonts: FONT_OPTIONS,
    samples: store.listSamples(),
    backups: store.listBackups(),
    passphraseSource: auth.passphraseSource(),
    dataDir: store.DATA_DIR,
  });
});

api.get('/datasets/:id', (req, res) => {
  const id = req.params.id;
  let data = null;
  if (id === 'default') data = store.loadDefaults();
  else if (id === 'blank') data = store.loadBlank();
  else data = store.loadSample(id);
  if (!data) return res.status(404).json({ error: 'Dataset not found' });
  res.json(store.normalize(data));
});

api.post('/reset', (req, res) => {
  const mode = String((req.body && req.body.mode) || 'default');
  try {
    const site = store.resetSite(mode);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/reset-section', (req, res) => {
  const { section, mode } = req.body || {};
  try {
    const site = store.resetSection(String(section || ''), String(mode || 'default'));
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/export', (req, res) => {
  const site = store.getSite();
  res.setHeader('Content-Disposition', `attachment; filename="site-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(site);
});

api.post('/import', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.general) return res.status(400).json({ error: 'That file does not look like a site export (missing "general").' });
  try {
    const site = store.saveSite(body);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/backups', (req, res) => res.json({ backups: store.listBackups() }));
api.post('/backups/restore', (req, res) => {
  try {
    const site = store.restoreBackup(req.body && req.body.name);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/upload', (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = (req.files || []).map((f) => ({ url: `/uploads/${f.filename}`, name: f.filename, size: f.size }));
    res.json({ ok: true, files });
  });
});

api.get('/uploads', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const st = fs.statSync(path.join(UPLOAD_DIR, f));
      return { name: f, url: `/uploads/${f}`, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

api.delete('/uploads/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

api.get('/inquiries', (req, res) => res.json({ inquiries: store.getInquiries() }));
api.patch('/inquiries/:id', (req, res) => {
  const item = store.updateInquiry(req.params.id, { read: Boolean(req.body && req.body.read) });
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, item });
});
api.delete('/inquiries/:id', (req, res) => {
  if (!store.deleteInquiry(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
api.delete('/inquiries', (req, res) => {
  store.clearInquiries();
  res.json({ ok: true });
});

api.post('/passphrase', (req, res) => {
  const { current, next } = req.body || {};
  if (process.env.ADMIN_PASSPHRASE) return res.status(400).json({ error: 'The passphrase is fixed by the ADMIN_PASSPHRASE environment variable on the server.' });
  if (!auth.checkPassphrase(current)) return res.status(400).json({ error: 'Current passphrase is incorrect.' });
  if (typeof next !== 'string' || next.length < 6) return res.status(400).json({ error: 'New passphrase must be at least 6 characters.' });
  auth.setPassphrase(next);
  res.json({ ok: true });
});

router.use('/api', api);

module.exports = router;
