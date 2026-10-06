#!/usr/bin/env node
/**
 * Show or change the site's canonical public URL (Admin → SEO Wizard → Basics → "Site URL") from the
 * command line — the one field every canonical link, og:url, sitemap entry and JSON-LD @id is built
 * from. Used during a domain cutover when you want to flip the whole site to the new domain in one step.
 * Goes through src/store.js (normalizes, keeps a backup in data/backups/) exactly like saving in /admin.
 *
 *   node scripts/site-url.mjs                                  # print the current value and what is actually in effect
 *   node scripts/site-url.mjs https://www.example.com          # set it (https:// is added if missing, trailing / removed)
 *   node scripts/site-url.mjs --clear                          # unset → falls back to SITE_URL env, then the request host
 *
 * After changing it:  pm2 restart hoteldemo   (the server caches site.json in memory)
 * then:               node scripts/cutover-check.mjs example.com
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./lib.cjs').loadPm2Env(); // PORT / SITE_URL / DATA_DIR exactly as pm2 gives them to the server
const store = require('../src/store');
const seo = require('../src/seo');

const arg = process.argv[2];
const site = store.getSite();
const current = site.seo.siteUrl || '';

if (!arg) {
  console.log(`Site URL setting : ${current || '(not set)'}`);
  console.log(`SITE_URL env     : ${process.env.SITE_URL || '(not set in this shell; pm2 may set it from ecosystem.config.cjs)'}`);
  console.log(`In effect        : ${seo.baseUrl(site) || '(none — falls back to each request\'s Host header)'}`);
  console.log(`Canonical host   : ${seo.baseUrl(site) ? new URL(seo.baseUrl(site)).host : '-'}`);
  console.log(`Force HTTPS      : ${site.seo.hosting.forceHttps ? 'on' : 'off'}   Enforce canonical host: ${site.seo.hosting.enforceCanonicalHost ? 'on' : 'off'}`);
  process.exit(0);
}

let next = arg === '--clear' ? '' : String(arg).trim();
if (next && !/^https?:\/\//i.test(next)) next = 'https://' + next;
next = next.replace(/\/+$/, '');
if (next) { try { new URL(next); } catch (_) { console.error(`not a valid URL: ${next}`); process.exit(1); } }

site.seo.siteUrl = next;
const saved = store.saveSite(site);
console.log(`Site URL: "${current || '(not set)'}" → "${saved.seo.siteUrl || '(not set)'}"   (backup written to data/backups/)`);
console.log('Now run:  pm2 restart hoteldemo');
