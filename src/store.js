'use strict';
/**
 * JSON data store.
 *
 *  data/defaults.json   – default content (Budget Suites). Committed to git.
 *  data/blank.json      – empty template. Committed to git.
 *  data/samples/*.json  – alternative sample datasets. Committed to git.
 *  data/site.json       – LIVE content edited from /admin. Git-ignored.
 *  data/inquiries.json  – contact-form submissions. Git-ignored.
 *  data/admin.json      – admin settings (changed passphrase). Git-ignored.
 *  data/.secret         – random cookie-signing secret. Git-ignored.
 *  data/backups/        – automatic snapshot of site.json before every save.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DEFAULTS_FILE = path.join(ROOT, 'data', 'defaults.json');
const BLANK_FILE = path.join(ROOT, 'data', 'blank.json');
const SAMPLES_DIR = path.join(ROOT, 'data', 'samples');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const INQ_FILE = path.join(DATA_DIR, 'inquiries.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- low-level helpers ----------
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[store] could not read ${file}:`, err.message);
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `over` onto `base`. Arrays are taken from `over` when present. */
function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? clone(over) : clone(base);
  if (isPlainObject(base)) {
    const out = {};
    for (const k of Object.keys(base)) {
      out[k] = over && Object.prototype.hasOwnProperty.call(over, k) ? merge(base[k], over[k]) : clone(base[k]);
    }
    if (isPlainObject(over)) {
      for (const k of Object.keys(over)) if (!(k in out)) out[k] = clone(over[k]);
    }
    return out;
  }
  return over === undefined || over === null ? clone(base) : clone(over);
}

function newId(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

// ---------- datasets ----------
function loadDefaults() {
  return readJson(DEFAULTS_FILE, null);
}

function loadBlank() {
  return readJson(BLANK_FILE, null);
}

function listSamples() {
  let files = [];
  try {
    files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'));
  } catch (_) {
    files = [];
  }
  return files.map((f) => {
    const data = readJson(path.join(SAMPLES_DIR, f), {});
    return { id: f.replace(/\.json$/, ''), note: (data.meta && data.meta.note) || '', hotelName: (data.general && data.general.hotelName) || '' };
  });
}

function loadSample(id) {
  const safe = String(id || '').replace(/[^a-z0-9-_]/gi, '');
  if (!safe) return null;
  return readJson(path.join(SAMPLES_DIR, `${safe}.json`), null);
}

// ---------- normalisation ----------
const LIST_PATHS = [
  ['nav'], ['hero', 'images'], ['promotions', 'items'], ['overview', 'highlights'], ['overview', 'stats'], ['overview', 'paragraphs'],
  ['rooms', 'items'], ['amenities', 'featured'], ['amenities', 'categories'], ['amenities', 'policies'], ['dining', 'items'], ['dining', 'nearby'],
  ['area', 'attractions'], ['area', 'airports'], ['area', 'transport'], ['gallery', 'items'], ['reviews', 'items'], ['faq', 'items'],
  ['customSections'], ['footer', 'links'], ['footer', 'social'],
];

/** Make sure every section/field exists, every list item has an id, every room has a unique slug. */
function normalize(site) {
  const blank = loadBlank() || {};
  const out = merge(blank, isPlainObject(site) ? site : {});

  for (const p of LIST_PATHS) {
    let node = out;
    for (let i = 0; i < p.length - 1; i++) node = node[p[i]] = isPlainObject(node[p[i]]) ? node[p[i]] : {};
    const key = p[p.length - 1];
    if (!Array.isArray(node[key])) node[key] = [];
    node[key] = node[key].map((item) => {
      if (isPlainObject(item) && !item.id) item.id = newId(key.replace(/s$/, ''));
      return item;
    });
  }

  const seen = new Set();
  out.rooms.items.forEach((room) => {
    let slug = slugify(room.slug || room.name);
    let n = 2;
    while (seen.has(slug)) slug = `${slugify(room.slug || room.name)}-${n++}`;
    seen.add(slug);
    room.slug = slug;
    if (!Array.isArray(room.images)) room.images = [];
    if (!Array.isArray(room.features)) room.features = [];
    room.priceFrom = Number(room.priceFrom) || 0;
    room.sqft = Number(room.sqft) || 0;
  });

  out.amenities.categories.forEach((c) => { if (!Array.isArray(c.items)) c.items = []; });
  if (!Array.isArray(out.layout.homeOrder)) out.layout.homeOrder = clone(blank.layout.homeOrder);
  if (!Array.isArray(out.area.categories)) out.area.categories = clone(blank.area.categories);
  out.meta = out.meta || {};
  return out;
}

// ---------- live site ----------
let cache = null;

function getSite() {
  if (cache) return cache;
  let data = readJson(SITE_FILE, null);
  if (!data) {
    data = loadDefaults() || loadBlank();
    writeJsonAtomic(SITE_FILE, data);
    console.log('[store] created data/site.json from defaults');
  }
  cache = normalize(data);
  return cache;
}

function backupSite() {
  try {
    if (!fs.existsSync(SITE_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(SITE_FILE, path.join(BACKUP_DIR, `site-${stamp}.json`));
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('site-')).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (err) {
    console.error('[store] backup failed:', err.message);
  }
}

function saveSite(site) {
  const normalized = normalize(site);
  normalized.meta.updatedAt = new Date().toISOString();
  backupSite();
  writeJsonAtomic(SITE_FILE, normalized);
  cache = normalized;
  return normalized;
}

/** mode: 'default' | 'blank' | 'sample:<id>' */
function resetSite(mode = 'default') {
  let data;
  if (mode === 'blank') data = loadBlank();
  else if (mode === 'mock' || mode === 'default') data = loadDefaults();
  else if (mode.startsWith('sample:')) data = loadSample(mode.slice(7));
  if (!data) throw new Error(`Unknown dataset: ${mode}`);
  return saveSite(data);
}

/** Replace a single top-level section from a dataset. */
function resetSection(section, mode = 'default') {
  let src;
  if (mode === 'blank') src = loadBlank();
  else if (mode.startsWith('sample:')) src = loadSample(mode.slice(7));
  else src = loadDefaults();
  if (!src || !(section in src)) throw new Error(`Unknown section: ${section}`);
  const site = clone(getSite());
  site[section] = clone(src[section]);
  return saveSite(site);
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('site-') && f.endsWith('.json')).sort().reverse();
  } catch (_) {
    return [];
  }
}

function restoreBackup(name) {
  const safe = path.basename(String(name));
  const file = path.join(BACKUP_DIR, safe);
  const data = readJson(file, null);
  if (!data) throw new Error('Backup not found');
  return saveSite(data);
}

// ---------- inquiries ----------
function getInquiries() {
  const list = readJson(INQ_FILE, []);
  return Array.isArray(list) ? list : [];
}

function addInquiry(entry) {
  const list = getInquiries();
  const item = { id: newId('inq'), receivedAt: new Date().toISOString(), read: false, ...entry };
  list.unshift(item);
  writeJsonAtomic(INQ_FILE, list.slice(0, 2000));
  return item;
}

function updateInquiry(id, patch) {
  const list = getInquiries();
  const idx = list.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  writeJsonAtomic(INQ_FILE, list);
  return list[idx];
}

function deleteInquiry(id) {
  const list = getInquiries();
  const next = list.filter((i) => i.id !== id);
  writeJsonAtomic(INQ_FILE, next);
  return list.length !== next.length;
}

function clearInquiries() {
  writeJsonAtomic(INQ_FILE, []);
}

// ---------- admin config & secret ----------
function getAdminConfig() {
  return readJson(ADMIN_FILE, {});
}

function saveAdminConfig(cfg) {
  writeJsonAtomic(ADMIN_FILE, cfg);
}

function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (_) { /* generate below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}

module.exports = {
  DATA_DIR,
  SITE_FILE,
  getSite,
  saveSite,
  resetSite,
  resetSection,
  normalize,
  loadDefaults,
  loadBlank,
  listSamples,
  loadSample,
  listBackups,
  restoreBackup,
  getInquiries,
  addInquiry,
  updateInquiry,
  deleteInquiry,
  clearInquiries,
  getAdminConfig,
  saveAdminConfig,
  getSecret,
  newId,
  slugify,
  clone,
};
