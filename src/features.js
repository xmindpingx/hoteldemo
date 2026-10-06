'use strict';
/**
 * Feature entitlements ("plan" switches) controlled by the SUPERADMIN, not by the hotel's admin.
 *
 * Every sellable feature has an id here. The superadmin turns ids on/off (and sets numeric limits)
 * at /superadmin; the result is stored in data/features.json — deliberately a separate file from
 * data/site.json so the hotel admin's export/import/reset/backups can never change entitlements.
 *
 * Enforcement happens in ONE place: apply(site) returns the site data with every disabled feature
 * switched off *in the data* (section.enabled = false, lists trimmed to their limits, analytics IDs
 * blanked, ...). Public routes, views, sitemap and SEO already honour those data switches, so they
 * need no feature-specific code. The admin UI additionally hides/locks what is not enabled and shows
 * the upgrade message instead — that is the "micro sale" moment.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const FILE = path.join(store.DATA_DIR, 'features.json');

// id, group, label, what the hotel gets, and what switching it OFF does.
const FEATURES = [
  // ---- pages
  { id: 'page.suites', group: 'Pages', label: 'Suites & Rooms page', desc: 'The /suites listing and every /suites/<room> detail page, plus the rooms block on the home page.' },
  { id: 'page.amenities', group: 'Pages', label: 'Amenities page', desc: '/amenities and the amenities block on the home page.' },
  { id: 'page.dining', group: 'Pages', label: 'Dining page', desc: '/dining and the dining block on the home page.' },
  { id: 'page.area', group: 'Pages', label: 'Local Area page', desc: '/area (attractions, airports, transport) and the area block on the home page.' },
  { id: 'page.gallery', group: 'Pages', label: 'Photo Gallery page', desc: '/gallery with filters and lightbox, plus the gallery block on the home page.' },
  { id: 'page.reviews', group: 'Pages', label: 'Guest Reviews page', desc: '/reviews and the reviews block on the home page.' },
  { id: 'page.faq', group: 'Pages', label: 'FAQ section', desc: 'The question/answer accordion on the home page and its FAQ structured data.' },
  { id: 'page.contact', group: 'Pages', label: 'Contact page', desc: '/contact (details, hours, map, inquiry form). Off = "Check Rates" buttons point at the external booking link only.' },
  // ---- home page & visuals
  { id: 'hero.slideshow', group: 'Home page', label: 'Hero slideshow', desc: 'Multiple rotating hero images. Off = the first hero image only, static.' },
  { id: 'hero.bookingBar', group: 'Home page', label: 'Hero booking bar', desc: 'Check-in / check-out / guests bar under the hero heading.' },
  { id: 'promotions', group: 'Home page', label: 'Offers & promotions', desc: 'Promo cards with codes and buttons on the home page.' },
  { id: 'overview.stats', group: 'Home page', label: 'Stat boxes', desc: 'The number call-outs in the overview block (e.g. suite count, year opened).' },
  { id: 'announcement', group: 'Home page', label: 'Announcement bar', desc: 'The one-line banner above the header.' },
  { id: 'customSections', group: 'Home page', label: 'Custom HTML sections', desc: 'Owner-written HTML blocks anywhere on the home page or sub-pages (embeds, widgets). Also hides the admin editor.' },
  { id: 'maps', group: 'Home page', label: 'Google Maps embeds', desc: 'The map on the Local Area block and the Contact page.' },
  { id: 'ratingBadge', group: 'Home page', label: 'Rating badge', desc: 'The score/review-count badge in the hero.' },
  // ---- booking
  { id: 'booking.inquiryForm', group: 'Booking', label: 'Booking inquiry form', desc: 'The form on /contact that stores inquiries for the admin. Off = contact details only.' },
  { id: 'booking.externalLink', group: 'Booking', label: 'External booking link', desc: 'Lets "Check Rates" open an outside booking engine. Off = buttons go to the contact page.' },
  // ---- admin tools
  { id: 'admin.inquiries', group: 'Admin tools', label: 'Inquiries inbox', desc: 'Read, mark and delete contact-form submissions in the admin.' },
  { id: 'admin.media', group: 'Admin tools', label: 'Photo uploads & media library', desc: 'Upload images from the admin and pick them from the library. Off = image fields accept URLs only.' },
  { id: 'admin.theme', group: 'Admin tools', label: 'Theme & fonts editor', desc: 'Colors, fonts, header style, button shape, hero darkness.' },
  { id: 'admin.customCss', group: 'Admin tools', label: 'Custom CSS', desc: 'Free-form CSS injected into every page (also stops rendering existing custom CSS).' },
  { id: 'admin.navigation', group: 'Admin tools', label: 'Menu editor', desc: 'Edit the header navigation labels/links.' },
  { id: 'admin.layout', group: 'Admin tools', label: 'Home page layout', desc: 'Reorder / remove home page sections.' },
  { id: 'admin.exportImport', group: 'Admin tools', label: 'Export / import site.json', desc: 'Download and upload the whole content file.' },
  { id: 'admin.backups', group: 'Admin tools', label: 'Backup restore', desc: 'Restore any of the last 30 automatic saves.' },
  { id: 'admin.datasets', group: 'Admin tools', label: 'Datasets & resets', desc: 'Load the default/blank/sample datasets or replace a single section from one.' },
  { id: 'admin.passphrase', group: 'Admin tools', label: 'Change admin passphrase', desc: 'Let the hotel change its own admin passphrase.' },
  // ---- SEO & marketing
  { id: 'seo.pages', group: 'SEO & marketing', label: 'Per-page SEO titles & previews', desc: 'Per-page title/description/image overrides with the live search-result preview. Off = template titles only.' },
  { id: 'seo.social', group: 'SEO & marketing', label: 'Social share cards', desc: 'Open Graph / Twitter card settings and preview.' },
  { id: 'seo.schema', group: 'SEO & marketing', label: 'Structured data (JSON-LD)', desc: 'Hotel/room/FAQ/breadcrumb schema for rich results. Off = no JSON-LD is output.' },
  { id: 'seo.local', group: 'SEO & marketing', label: 'Local SEO', desc: 'Geo meta tags and service areas.' },
  { id: 'seo.search', group: 'SEO & marketing', label: 'Search engine controls', desc: 'Index/follow switches, sitemap settings, Search Console / Bing verification codes.' },
  { id: 'seo.analytics', group: 'SEO & marketing', label: 'Analytics & pixels', desc: 'Google Analytics 4, Tag Manager, Meta Pixel, Microsoft Clarity. Off = nothing is injected.' },
  { id: 'seo.customHead', group: 'SEO & marketing', label: 'Custom <head> / <body> HTML', desc: 'Raw HTML injection (verification tags, chat widgets).' },
  { id: 'seo.hosting', group: 'SEO & marketing', label: 'Redirects & hosting rules', desc: '301/302 redirect rules, force-HTTPS and canonical-host enforcement.' },
  { id: 'seo.audit', group: 'SEO & marketing', label: 'SEO audit & score', desc: 'The live audit of every page with a 0–100 score and fix links.' },
];

// numeric caps; 0 = unlimited
const LIMITS = [
  { id: 'maxRooms', label: 'Max suites/rooms shown', desc: 'Extra rooms stay in the admin but are not published.' },
  { id: 'maxGalleryItems', label: 'Max gallery photos shown', desc: '' },
  { id: 'maxPromotions', label: 'Max promotions shown', desc: '' },
  { id: 'maxFaq', label: 'Max FAQ items shown', desc: '' },
  { id: 'maxCustomSections', label: 'Max custom HTML sections', desc: '' },
  { id: 'maxUploadMb', label: 'Max upload size (MB)', desc: 'Per image; the hard ceiling is 12 MB.' },
];

const DEFAULTS = {
  planName: '',
  upgrade: { message: 'This feature is not included in your current plan.', contact: '' },
  flags: Object.fromEntries(FEATURES.map((f) => [f.id, true])),
  limits: Object.fromEntries(LIMITS.map((l) => [l.id, 0])),
  meta: {}, // per feature: { price: '', note: '' } — free text set by the superadmin, shown on the locked panel
  updatedAt: '',
};

let cache = null;

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    planName: String(r.planName || ''),
    upgrade: { message: String((r.upgrade && r.upgrade.message) || DEFAULTS.upgrade.message), contact: String((r.upgrade && r.upgrade.contact) || '') },
    flags: {}, limits: {}, meta: {},
    updatedAt: String(r.updatedAt || ''),
  };
  for (const f of FEATURES) out.flags[f.id] = !(r.flags && r.flags[f.id] === false);
  for (const l of LIMITS) { const n = Number(r.limits && r.limits[l.id]); out.limits[l.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  for (const f of FEATURES) { const m = (r.meta && r.meta[f.id]) || {}; if (m.price || m.note) out.meta[f.id] = { price: String(m.price || ''), note: String(m.note || '') }; }
  return out;
}

function get() {
  if (cache) return cache;
  try { cache = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (_) { cache = normalize({}); }
  return cache;
}

function save(next) {
  const data = normalize(next);
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
  cache = data;
  return data;
}

function enabled(id, f = get()) { return f.flags[id] !== false; }
function limit(id, f = get()) { return f.limits[id] || 0; }

/** Trim a list to the first N enabled items (keeps disabled ones out entirely when a limit applies). */
function cap(list, n) {
  if (!Array.isArray(list)) return [];
  if (!n) return list;
  const out = []; let kept = 0;
  for (const it of list) { if (!it || it.enabled === false) continue; if (kept >= n) break; out.push(it); kept++; }
  return out;
}

/**
 * The site as the PUBLIC sees it under the current entitlements. Returns a new object; never mutates
 * the stored site. Cheap enough to run per request (shallow copies of the touched branches only).
 */
function apply(site, f = get()) {
  const on = (id) => enabled(id, f);
  const s = { ...site };
  // Shallow-copy a branch exactly once; later calls return the SAME copy so earlier edits survive
  // (re-copying from `site` would silently undo e.g. rooms.enabled=false when maxRooms also applies).
  const copy = (k) => { if (s[k] === site[k]) s[k] = { ...(site[k] || {}) }; return s[k]; };

  // pages / sections → the existing `enabled` switches that routes, views and the sitemap already honour
  if (!on('page.suites')) copy('rooms').enabled = false;
  if (!on('page.amenities')) copy('amenities').enabled = false;
  if (!on('page.dining')) copy('dining').enabled = false;
  if (!on('page.area')) copy('area').enabled = false;
  if (!on('page.gallery')) copy('gallery').enabled = false;
  if (!on('page.reviews')) copy('reviews').enabled = false;
  if (!on('page.faq')) copy('faq').enabled = false;
  if (!on('page.contact')) copy('contact').enabled = false;
  if (!on('promotions')) copy('promotions').enabled = false;

  // home page & visuals
  const hero = copy('hero');
  if (!on('hero.slideshow')) hero.images = (hero.images || []).filter((i) => i && i.url).slice(0, 1);
  if (!on('hero.bookingBar')) hero.showBookingBar = false;
  if (!on('overview.stats')) copy('overview').stats = [];
  const general = copy('general');
  if (!on('announcement')) general.announcement = { ...(general.announcement || {}), enabled: false };
  if (!on('ratingBadge')) general.showRating = false;
  if (!on('maps')) { copy('area').showMap = false; copy('contact').showMap = false; }
  if (!on('customSections')) s.customSections = [];
  else if (limit('maxCustomSections', f)) s.customSections = cap(site.customSections, limit('maxCustomSections', f));

  // booking
  if (!on('booking.inquiryForm')) copy('contact').formEnabled = false;
  if (!on('booking.externalLink') && general.bookingMode === 'external') general.bookingMode = 'inquiry';
  // (no contact page + no external link → helpers.bookingHref() sends "Check Rates" to tel:phone, see src/helpers.js)

  // nav: drop links to pages that no longer exist
  const gone = [];
  if (!on('page.suites')) gone.push('/suites');
  if (!on('page.amenities')) gone.push('/amenities');
  if (!on('page.dining')) gone.push('/dining');
  if (!on('page.area')) gone.push('/area');
  if (!on('page.gallery')) gone.push('/gallery');
  if (!on('page.reviews')) gone.push('/reviews');
  if (!on('page.contact')) gone.push('/contact');
  if (gone.length) {
    const isGone = (href) => gone.some((g) => String(href || '').startsWith(g));
    s.nav = (site.nav || []).filter((n) => !isGone(n.href));
    s.footer = { ...(site.footer || {}), links: ((site.footer || {}).links || []).filter((l) => !isGone(l.href)) };
    // admin-entered call-to-action buttons: blank the href so the view hides the button (or falls back to the booking link)
    if (isGone(hero.ctaHref)) hero.ctaHref = '';
    if (isGone(hero.secondaryCtaHref)) hero.secondaryCtaHref = '';
    const promos = copy('promotions');
    promos.items = (promos.items || []).map((p) => (p && isGone(p.ctaHref) ? { ...p, ctaHref: '' } : p));
  }

  // limits (cap the copies, so edits made above survive)
  if (limit('maxRooms', f)) copy('rooms').items = cap(copy('rooms').items, limit('maxRooms', f));
  if (limit('maxGalleryItems', f)) copy('gallery').items = cap(copy('gallery').items, limit('maxGalleryItems', f));
  if (limit('maxPromotions', f)) copy('promotions').items = cap(copy('promotions').items, limit('maxPromotions', f));
  if (limit('maxFaq', f)) copy('faq').items = cap(copy('faq').items, limit('maxFaq', f));

  // theme
  if (!on('admin.customCss')) copy('theme').customCss = '';

  // SEO
  const seo = { ...(site.seo || {}) }; s.seo = seo;
  if (!on('seo.pages')) seo.pages = {};
  if (!on('seo.social')) seo.social = {};
  if (!on('seo.schema')) seo.schema = { ...(seo.schema || {}), enabled: false };
  if (!on('seo.local')) seo.local = { geoRegion: '', geoPlacename: '', serviceAreas: [] };
  if (!on('seo.search')) { seo.robots = { index: true, follow: true, custom: '' }; seo.sitemap = { ...(seo.sitemap || {}), enabled: true }; seo.verification = {}; seo.metaKeywords = false; }
  if (!on('seo.analytics')) seo.analytics = { ...(seo.analytics || {}), ga4: '', gtm: '', metaPixel: '', clarity: '' };
  if (!on('seo.customHead')) { seo.customHeadHtml = ''; seo.analytics = { ...(seo.analytics || {}), bodyEndHtml: '' }; }
  if (!on('seo.hosting')) { seo.redirects = []; seo.hosting = { forceHttps: false, enforceCanonicalHost: false, trailingSlashRedirect: true }; }

  return s;
}

/** What the hotel admin UI needs to lock/hide things. */
function forAdmin(f = get()) {
  return {
    planName: f.planName,
    upgrade: f.upgrade,
    flags: f.flags,
    limits: f.limits,
    locked: FEATURES.filter((x) => !enabled(x.id, f)).map((x) => ({ id: x.id, label: x.label, desc: x.desc, ...(f.meta[x.id] || {}) })),
  };
}

/** Express guard for admin API routes that belong to a feature. */
function requireFeature(id) {
  return (req, res, next) => {
    if (enabled(id)) return next();
    const f = get();
    res.status(403).json({ error: `${(FEATURES.find((x) => x.id === id) || {}).label || id} is not enabled on this plan. ${f.upgrade.message}`, feature: id, locked: true });
  };
}

module.exports = { FEATURES, LIMITS, DEFAULTS, FILE, get, save, normalize, enabled, limit, apply, forAdmin, requireFeature };
