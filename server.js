'use strict';
/**
 * Hotel demo site + admin CMS.
 *   node server.js            → http://localhost:8097
 *   /admin                    → passphrase "hoteldemo" (see README)
 */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const store = require('./src/store');
const helpers = require('./src/helpers');
const { icon } = require('./src/icons');
const publicRouter = require('./src/public');
const adminRouter = require('./src/admin');

const PORT = Number(process.env.PORT) || 8097;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.set('trust proxy', 1); // behind Cloudflare tunnel / nginx
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('view cache', true);

app.locals.h = helpers;
app.locals.icon = icon;

app.use(compression());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '15mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true, redirect: false }));

app.use('/admin', adminRouter);
app.use('/', publicRouter);

// 404
app.use((req, res) => {
  res.status(404).render('404', { site: store.getSite(), page: '404', title: 'Page not found', path: req.path, siteUrl: process.env.SITE_URL || '' });
});

// errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  if (req.path.startsWith('/admin/api')) return res.status(500).json({ error: err.message || 'Server error' });
  res.status(500).send('<h1>Something went wrong</h1><p>Please try again.</p>');
});

store.getSite(); // creates data/site.json on first run
app.listen(PORT, HOST, () => {
  console.log(`Hotel site listening on http://${HOST}:${PORT}  (admin: http://${HOST}:${PORT}/admin)`);
});
