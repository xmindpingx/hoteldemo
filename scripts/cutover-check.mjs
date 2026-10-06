#!/usr/bin/env node
/**
 * Domain cutover checker. Run it BEFORE, DURING and AFTER pointing a domain (e.g. one registered at
 * GoDaddy) at this site. It answers, for one hostname: who serves its DNS, where it resolves, whether
 * it reaches THIS site over https, and whether the site's own tags agree with the domain.
 * Read-only: only DNS lookups and HTTP GETs. Nothing is changed anywhere.
 *
 *   node scripts/cutover-check.mjs example.com            # checks example.com and www.example.com
 *   node scripts/cutover-check.mjs www.example.com --no-www
 *   node scripts/cutover-check.mjs example.com --json
 *
 * Exit code 0 = every check passed, 1 = at least one FAIL (so it can gate a deploy or cron alert).
 * See docs/GODADDY-CUTOVER.md for what each failure means and the fix.
 */
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./lib.cjs').loadPm2Env();
const seo = require('../src/seo');

const args = process.argv.slice(2);
const host = (args.find((a) => !a.startsWith('--')) || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (!host) { console.error('usage: node scripts/cutover-check.mjs <domain> [--no-www] [--json]'); process.exit(2); }
const JSON_OUT = args.includes('--json');
// Check www.<domain> too, but only for a bare 2-label domain (example.com) — a subdomain such as
// hoteldemo1.signaturediversified.com has no www. variant of its own.
const bare = host.split('.').length === 2;
const hosts = args.includes('--no-www') || host.startsWith('www.') || !bare ? [host] : [host, 'www.' + host];

const checks = [];
const add = (status, label, detail = '') => checks.push({ status, label, detail });

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http;
    const t0 = Date.now();
    const req = mod.get(url, { timeout: 10000, headers: { 'user-agent': 'hoteldemo-cutover-check' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 2e6) body += c; });
      res.on('end', () => resolve({ url, status: res.statusCode, location: res.headers.location || '', body, ms: Date.now() - t0, redirects }));
    });
    req.on('error', (e) => resolve({ url, status: 0, error: e.code || e.message, body: '', ms: Date.now() - t0, redirects }));
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, error: 'timeout', body: '', ms: Date.now() - t0, redirects }); });
  });
}

/** Follow up to 5 redirects, returning the chain. */
async function follow(url) {
  const chain = [];
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const r = await fetchUrl(cur, i);
    chain.push(r);
    if (r.status >= 300 && r.status < 400 && r.location) { cur = new URL(r.location, cur).toString(); continue; }
    break;
  }
  return chain;
}

const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch (_) { return ''; } };

(async () => {
  // ---- DNS ---------------------------------------------------------------------------------
  // NS records live at the zone apex (example.com), not on a subdomain — walk up the labels until one answers.
  const labels = host.replace(/^www\./, '').split('.');
  let apex = labels.join('.'), ns = [], nsErr = '';
  for (let i = 0; i <= labels.length - 2; i++) {
    apex = labels.slice(i).join('.');
    try { ns = (await dns.resolveNs(apex)).map((n) => n.toLowerCase()); break; } catch (e) { nsErr = e.code || e.message; }
  }
  if (!ns.length) add('fail', `Nameservers for ${apex}`, `lookup failed (${nsErr}) — domain not registered, not delegated, or no network`);
  if (ns.length) {
    const cf = ns.some((n) => n.endsWith('.ns.cloudflare.com'));
    const gd = ns.some((n) => /domaincontrol\.com$/.test(n));
    add(cf ? 'pass' : 'warn', `Nameservers for ${apex}`, `${ns.join(', ')}${cf ? ' (Cloudflare — the tunnel can serve this zone)' : gd ? ' (GoDaddy default nameservers — a Cloudflare Tunnel hostname cannot be served from here; see docs/GODADDY-CUTOVER.md path A)' : ''}`);
  }
  for (const hn of hosts) {
    let cname = [], a = [];
    try { cname = await dns.resolveCname(hn); } catch (_) { /* no CNAME */ }
    try { a = await dns.resolve4(hn); } catch (_) { /* no A */ }
    if (!cname.length && !a.length) add('fail', `DNS record for ${hn}`, 'no A or CNAME record — add one (see docs/GODADDY-CUTOVER.md)');
    else add('pass', `DNS record for ${hn}`, [cname.length ? `CNAME → ${cname.join(', ')}` : '', a.length ? `A → ${a.join(', ')}` : ''].filter(Boolean).join(' · '));
  }

  // ---- HTTP(S) -----------------------------------------------------------------------------
  const results = {};
  for (const hn of hosts) {
    const httpsChain = await follow(`https://${hn}/`);
    const last = httpsChain[httpsChain.length - 1];
    results[hn] = last;
    if (last.status === 200) add('pass', `https://${hn}/ loads`, `${last.status} in ${last.ms} ms${httpsChain.length > 1 ? ' after redirect to ' + last.url : ''}`);
    else add('fail', `https://${hn}/ loads`, last.error ? `connection failed: ${last.error} (DNS not pointing here yet, tunnel route missing, or certificate not issued)` : `HTTP ${last.status}`);

    const httpChain = await follow(`http://${hn}/`);
    const first = httpChain[0], end = httpChain[httpChain.length - 1];
    if (first.status >= 300 && first.status < 400 && /^https:/i.test(first.location)) add('pass', `http://${hn}/ redirects to https`, `→ ${first.location}`);
    else if (end.status === 200 && end.url.startsWith('https:')) add('pass', `http://${hn}/ redirects to https`, `→ ${end.url}`);
    else add(end.status ? 'warn' : 'fail', `http://${hn}/ redirects to https`, end.error ? `connection failed: ${end.error}` : `served ${end.status} over plain http without redirecting — turn on "Always Use HTTPS" at the proxy or Force HTTPS in SEO Wizard → Hosting`);
  }

  // ---- does the page agree with the domain? -------------------------------------------------
  const primary = results[hosts[0]] && results[hosts[0]].status === 200 ? results[hosts[0]] : Object.values(results).find((r) => r.status === 200);
  if (primary) {
    const p = seo.parseHtml(primary.body);
    const servedHost = hostOf(primary.url);
    const isThisSite = /hoteldemo|site\.js\?v=|data-lb-img/.test(primary.body) && p.jsonLd.length;
    add(isThisSite ? 'pass' : 'warn', 'Response is this hotel site', isThisSite ? `title: "${p.title}"` : 'the page does not look like this app (parked page, old site, or wrong vhost)');
    if (p.canonical) {
      const ch = hostOf(p.canonical);
      add(ch === servedHost ? 'pass' : 'fail', 'Canonical host matches the domain', `<link rel=canonical> → ${p.canonical}${ch === servedHost ? '' : ` but the page was served from ${servedHost} — set Site URL to https://${servedHost} in Admin → SEO Wizard → Basics`}`);
    } else add('fail', 'Canonical link present', 'no <link rel="canonical"> — Site URL is not set (Admin → SEO Wizard → Basics)');
    const ogHost = hostOf(p.ogImage);
    if (p.ogImage) add(!ogHost || ogHost === servedHost ? 'pass' : 'warn', 'og:image on the same domain', p.ogImage);
    if (hosts.length === 2 && results[hosts[1]] && results[hosts[1]].status === 200) {
      const other = hostOf(results[hosts[1]].url);
      add(other === servedHost ? 'pass' : 'warn', 'www and bare domain resolve to one host', other === servedHost ? `both end at ${servedHost}` : `${hosts[0]} → ${servedHost}, ${hosts[1]} → ${other}: enable "Enforce canonical host" in SEO Wizard → Hosting once Site URL is final`);
    }
    // robots + sitemap on the served host
    const base = `https://${servedHost}`;
    const [rob, sm] = await Promise.all([fetchUrl(`${base}/robots.txt`), fetchUrl(`${base}/sitemap.xml`)]);
    const smLine = (rob.body.match(/^Sitemap:\s*(\S+)/mi) || [])[1] || '';
    add(rob.status === 200 && !/^\s*Disallow:\s*\/\s*$/m.test(rob.body) ? 'pass' : 'fail', 'robots.txt reachable and not blocking', rob.status === 200 ? (smLine ? `Sitemap: ${smLine}` : 'no Sitemap: line') : `HTTP ${rob.status}`);
    if (smLine) add(hostOf(smLine) === servedHost ? 'pass' : 'fail', 'robots.txt Sitemap line points at this domain', smLine);
    const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    add(sm.status === 200 && locs.length ? 'pass' : 'fail', 'sitemap.xml reachable', sm.status === 200 ? `${locs.length} URLs` : `HTTP ${sm.status}`);
    if (locs.length) { const bad = locs.filter((l) => hostOf(l) !== servedHost); add(bad.length ? 'fail' : 'pass', 'sitemap URLs use this domain', bad.length ? `${bad.length} URL(s) still point at ${hostOf(bad[0])}` : `all ${locs.length} on ${servedHost}`); }
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  if (JSON_OUT) console.log(JSON.stringify({ host, hosts, ok: fails === 0, checks }, null, 2));
  else {
    console.log(`Cutover check for ${host}`);
    for (const c of checks) console.log(`  ${c.status.toUpperCase().padEnd(4)} ${c.label}${c.detail ? '\n       ' + c.detail : ''}`);
    console.log(fails ? `\n${fails} check(s) FAILED — see docs/GODADDY-CUTOVER.md` : '\nAll checks passed.');
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('cutover-check failed:', e.message); process.exit(1); });
