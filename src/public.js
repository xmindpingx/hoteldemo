'use strict';
const express = require('express');
const store = require('./store');
const seo = require('./seo');
const features = require('./features');

const router = express.Router();

// Attach the live site to every request (cheap: cached in memory)
router.use((req, res, next) => {
  // the site as entitled by the superadmin's feature switches (disabled features are switched off in the data)
  res.locals.site = features.apply(store.getSite());
  res.locals.path = req.path;
  res.locals.siteUrl = seo.baseUrl(res.locals.site, req);
  next();
});

/** Build res.locals.meta (title/description/canonical/OG/etc) for the current page and render head blocks. */
function setMeta(res, ctx) {
  const m = seo.pageMeta(res.locals.site, { ...ctx, path: res.locals.path, req: res.req || undefined });
  res.locals.meta = m;
  return m;
}

function sectionGuard(key) {
  return (req, res, next) => {
    const sec = res.locals.site[key];
    if (sec && sec.enabled === false) return res.redirect('/');
    next();
  };
}

router.get('/', (req, res) => {
  setMeta(res, { page: 'home', title: '' });
  res.render('home', { page: 'home', title: '' });
});

router.get('/suites', sectionGuard('rooms'), (req, res) => {
  const title = res.locals.site.rooms.heading || 'Suites & Rooms';
  setMeta(res, { page: 'suites', title });
  res.render('suites', { page: 'suites', title });
});

router.get('/suites/:slug', sectionGuard('rooms'), (req, res, next) => {
  const room = res.locals.site.rooms.items.find((r) => r.slug === req.params.slug && r.enabled !== false);
  if (!room) return next();
  setMeta(res, { page: 'suites', title: room.name, room });
  res.render('suite', { page: 'suites', title: room.name, room });
});

router.get('/amenities', sectionGuard('amenities'), (req, res) => {
  const title = res.locals.site.amenities.heading || 'Amenities';
  setMeta(res, { page: 'amenities', title, description: res.locals.site.amenities.intro });
  res.render('amenities', { page: 'amenities', title });
});

router.get('/dining', sectionGuard('dining'), (req, res) => {
  const title = res.locals.site.dining.heading || 'Dining';
  setMeta(res, { page: 'dining', title, description: res.locals.site.dining.intro });
  res.render('dining', { page: 'dining', title });
});

router.get('/area', sectionGuard('area'), (req, res) => {
  const title = res.locals.site.area.heading || 'Local Area';
  setMeta(res, { page: 'area', title, description: res.locals.site.area.intro });
  res.render('area', { page: 'area', title });
});

router.get('/gallery', sectionGuard('gallery'), (req, res) => {
  const title = res.locals.site.gallery.heading || 'Gallery';
  setMeta(res, { page: 'gallery', title, description: res.locals.site.gallery.intro });
  res.render('gallery', { page: 'gallery', title });
});

router.get('/reviews', sectionGuard('reviews'), (req, res) => {
  const title = res.locals.site.reviews.heading || 'Guest Reviews';
  setMeta(res, { page: 'reviews', title, description: res.locals.site.reviews.intro });
  res.render('reviews', { page: 'reviews', title });
});

router.get('/contact', sectionGuard('contact'), (req, res) => {
  const title = res.locals.site.contact.heading || 'Contact';
  setMeta(res, { page: 'contact', title });
  res.render('contact', {
    page: 'contact',
    title,
    prefill: { checkin: req.query.checkin || '', checkout: req.query.checkout || '', guests: req.query.guests || '', rooms: req.query.rooms || '', room: req.query.room || '' },
    sent: req.query.sent === '1',
    error: '',
  });
});

// simple per-IP throttle for the contact form
const recent = new Map();
router.post('/contact', sectionGuard('contact'), (req, res) => {
  const site = res.locals.site;
  const b = req.body || {};
  if (!site.contact.formEnabled) return res.redirect('/contact');
  if (b.website) return res.redirect('/contact?sent=1'); // honeypot filled → pretend success

  const ip = req.ip;
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) {
    setMeta(res, { page: 'contact', title: site.contact.heading });
    return res.status(429).render('contact', { page: 'contact', title: site.contact.heading, prefill: b, sent: false, error: 'Too many requests — please try again in a few minutes or call us.' });
  }

  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().slice(0, 160);
  const message = String(b.message || '').trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMeta(res, { page: 'contact', title: site.contact.heading });
    return res.status(400).render('contact', { page: 'contact', title: site.contact.heading, prefill: b, sent: false, error: 'Please enter your name and a valid email address.' });
  }

  hits.push(now);
  recent.set(ip, hits);
  store.addInquiry({
    name,
    email,
    phone: String(b.phone || '').trim().slice(0, 40),
    checkin: String(b.checkin || '').slice(0, 20),
    checkout: String(b.checkout || '').slice(0, 20),
    guests: String(b.guests || '').slice(0, 5),
    rooms: String(b.rooms || '').slice(0, 5),
    room: String(b.room || '').slice(0, 120),
    message,
    userAgent: String(req.get('user-agent') || '').slice(0, 200),
  });
  res.redirect('/contact?sent=1');
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(seo.robotsTxt(res.locals.site, req));
});

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(seo.sitemapXml(res.locals.site, req));
});

module.exports = router;
