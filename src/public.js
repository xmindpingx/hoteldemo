'use strict';
const express = require('express');
const store = require('./store');
const h = require('./helpers');

const router = express.Router();

// Attach the live site to every request (cheap: cached in memory)
router.use((req, res, next) => {
  res.locals.site = store.getSite();
  res.locals.path = req.path;
  res.locals.siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  next();
});

function sectionGuard(key) {
  return (req, res, next) => {
    const sec = res.locals.site[key];
    if (sec && sec.enabled === false) return res.redirect('/');
    next();
  };
}

router.get('/', (req, res) => {
  res.render('home', { page: 'home', title: '' });
});

router.get('/suites', sectionGuard('rooms'), (req, res) => {
  res.render('suites', { page: 'suites', title: res.locals.site.rooms.heading || 'Suites & Rooms' });
});

router.get('/suites/:slug', sectionGuard('rooms'), (req, res, next) => {
  const room = res.locals.site.rooms.items.find((r) => r.slug === req.params.slug && r.enabled !== false);
  if (!room) return next();
  res.render('suite', { page: 'suites', title: room.name, room });
});

router.get('/amenities', sectionGuard('amenities'), (req, res) => {
  res.render('amenities', { page: 'amenities', title: res.locals.site.amenities.heading || 'Amenities' });
});

router.get('/dining', sectionGuard('dining'), (req, res) => {
  res.render('dining', { page: 'dining', title: res.locals.site.dining.heading || 'Dining' });
});

router.get('/area', sectionGuard('area'), (req, res) => {
  res.render('area', { page: 'area', title: res.locals.site.area.heading || 'Local Area' });
});

router.get('/gallery', sectionGuard('gallery'), (req, res) => {
  res.render('gallery', { page: 'gallery', title: res.locals.site.gallery.heading || 'Gallery' });
});

router.get('/reviews', sectionGuard('reviews'), (req, res) => {
  res.render('reviews', { page: 'reviews', title: res.locals.site.reviews.heading || 'Guest Reviews' });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    page: 'contact',
    title: res.locals.site.contact.heading || 'Contact',
    prefill: { checkin: req.query.checkin || '', checkout: req.query.checkout || '', guests: req.query.guests || '', rooms: req.query.rooms || '', room: req.query.room || '' },
    sent: req.query.sent === '1',
    error: '',
  });
});

// simple per-IP throttle for the contact form
const recent = new Map();
router.post('/contact', (req, res) => {
  const site = res.locals.site;
  const b = req.body || {};
  if (!site.contact.formEnabled) return res.redirect('/contact');
  if (b.website) return res.redirect('/contact?sent=1'); // honeypot filled → pretend success

  const ip = req.ip;
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) {
    return res.status(429).render('contact', { page: 'contact', title: site.contact.heading, prefill: b, sent: false, error: 'Too many requests — please try again in a few minutes or call us.' });
  }

  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().slice(0, 160);
  const message = String(b.message || '').trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\n${res.locals.siteUrl ? `Sitemap: ${res.locals.siteUrl}/sitemap.xml\n` : ''}`);
});

router.get('/sitemap.xml', (req, res) => {
  const site = res.locals.site;
  const base = res.locals.siteUrl || `${req.protocol}://${req.get('host')}`;
  const urls = ['/', '/suites', '/amenities', '/dining', '/area', '/gallery', '/contact'];
  if (site.reviews.enabled) urls.push('/reviews');
  site.rooms.items.filter((r) => r.enabled !== false).forEach((r) => urls.push(`/suites/${r.slug}`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${h.esc(base + u)}</loc></url>`).join('\n')}\n</urlset>`;
  res.type('application/xml').send(xml);
});

module.exports = router;
