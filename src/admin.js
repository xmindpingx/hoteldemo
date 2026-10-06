'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const auth = require('./auth');
const { AMENITY_ICON_NAMES, ICONS } = require('./icons');
const { FONT_OPTIONS } = require('./helpers');

const seoLib = require('./seo');
const features = require('./features');
const needs = features.requireFeature;

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Same resolution server.js uses — needed so the SEO audit can fetch its own pages over loopback.
const SELF_PORT = Number(process.env.PORT) || 8097;

// ---------- uploads ----------
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.bin';
      const base = path.basename(file.originalname, path.extname(file.originalname)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
      // Timestamp alone collides: two files with the same sanitized name (e.g. "Room.JPG" vs "room.jpg")
      // uploaded in the same millisecond — easy in one multi-file admin upload — would overwrite each other.
      const unique = crypto.randomBytes(4).toString('hex');
      cb(null, `${Date.now().toString(36)}-${unique}-${base}${ext}`);
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
    // plan entitlements set by the superadmin: what to lock/hide and what to tell the hotel
    features: features.forAdmin(),
    isSuper: auth.isSuper(req),
  });
});

api.get('/datasets/:id', needs('admin.datasets'), (req, res) => {
  const id = req.params.id;
  let data = null;
  if (id === 'default') data = store.loadDefaults();
  else if (id === 'blank') data = store.loadBlank();
  else data = store.loadSample(id);
  if (!data) return res.status(404).json({ error: 'Dataset not found' });
  res.json(store.normalize(data));
});

api.post('/reset', needs('admin.datasets'), (req, res) => {
  const mode = String((req.body && req.body.mode) || 'default');
  try {
    const site = store.resetSite(mode);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/reset-section', needs('admin.datasets'), (req, res) => {
  const { section, mode } = req.body || {};
  try {
    const site = store.resetSection(String(section || ''), String(mode || 'default'));
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/export', needs('admin.exportImport'), (req, res) => {
  const site = store.getSite();
  res.setHeader('Content-Disposition', `attachment; filename="site-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(site);
});

api.post('/import', needs('admin.exportImport'), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.general) return res.status(400).json({ error: 'That file does not look like a site export (missing "general").' });
  try {
    const site = store.saveSite(body);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/backups', needs('admin.backups'), (req, res) => res.json({ backups: store.listBackups() }));
api.post('/backups/restore', needs('admin.backups'), (req, res) => {
  try {
    const site = store.restoreBackup(req.body && req.body.name);
    res.json({ ok: true, site });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/upload', needs('admin.media'), (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    // plan limit on upload size (multer's 12 MB is the hard ceiling)
    const maxMb = features.limit('maxUploadMb');
    const tooBig = maxMb ? (req.files || []).filter((f) => f.size > maxMb * 1024 * 1024) : [];
    for (const f of tooBig) { try { fs.unlinkSync(f.path); } catch (_) { /* ignore */ } }
    const kept = (req.files || []).filter((f) => !tooBig.includes(f));
    const files = kept.map((f) => ({ url: `/uploads/${f.filename}`, name: f.filename, size: f.size }));
    if (tooBig.length && !kept.length) return res.status(400).json({ error: `Image is larger than the ${maxMb} MB allowed on this plan.` });
    res.json({ ok: true, files, rejected: tooBig.map((f) => ({ name: f.originalname, reason: `over ${maxMb} MB` })) });
  });
});

api.get('/uploads', needs('admin.media'), (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const st = fs.statSync(path.join(UPLOAD_DIR, f));
      return { name: f, url: `/uploads/${f}`, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

api.delete('/uploads/:name', needs('admin.media'), (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

api.get('/inquiries', needs('admin.inquiries'), (req, res) => res.json({ inquiries: store.getInquiries() }));
api.patch('/inquiries/:id', needs('admin.inquiries'), (req, res) => {
  const item = store.updateInquiry(req.params.id, { read: Boolean(req.body && req.body.read) });
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, item });
});
api.delete('/inquiries/:id', needs('admin.inquiries'), (req, res) => {
  if (!store.deleteInquiry(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
api.delete('/inquiries', needs('admin.inquiries'), (req, res) => {
  store.clearInquiries();
  res.json({ ok: true });
});

// ---------- SEO wizard ----------
// Preview: render title/description/JSON-LD/suggestions for the in-progress (unsaved) editor
// state, exactly as it would look live — without touching disk.
api.post('/seo/preview', (req, res) => {
  try {
    const draft = features.apply(store.normalize((req.body && req.body.site) || {}));
    const pageKey = seoLib.PAGE_KEYS.includes(req.body && req.body.page) ? req.body.page : 'home';
    const base = seoLib.baseUrl(draft, req);
    const ctx = { path: seoLib.PAGE_PATHS[pageKey], page: pageKey, title: seoLib.PAGE_LABELS[pageKey], req, base };
    if (pageKey === 'suites' && draft.rooms.items[0]) ctx.room = draft.rooms.items[0];
    const meta = seoLib.pageMeta(draft, ctx);
    res.json({
      meta,
      jsonLd: seoLib.jsonLd(draft, ctx),
      suggestions: seoLib.suggestions(draft),
      robotsTxt: seoLib.robotsTxt(draft, req),
      sitemapCount: seoLib.sitemapEntries(draft, req).length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Audit: grade the LIVE published site (fetches this server's own pages over loopback).
api.get('/seo/audit', needs('seo.audit'), async (req, res) => {
  try {
    const site = features.apply(store.getSite());
    const result = await seoLib.audit(site, { port: SELF_PORT, base: seoLib.baseUrl(site, req) });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/passphrase', needs('admin.passphrase'), (req, res) => {
  const { current, next } = req.body || {};
  if (process.env.ADMIN_PASSPHRASE) return res.status(400).json({ error: 'The passphrase is fixed by the ADMIN_PASSPHRASE environment variable on the server.' });
  if (!auth.checkPassphrase(current)) return res.status(400).json({ error: 'Current passphrase is incorrect.' });
  if (typeof next !== 'string' || next.length < 6) return res.status(400).json({ error: 'New passphrase must be at least 6 characters.' });
  auth.setPassphrase(next);
  // changing the passphrase signs out every other admin session; keep THIS one alive
  if (!auth.isSuper(req)) auth.login(req, res);
  res.json({ ok: true });
});

router.use('/api', api);

module.exports = router;
