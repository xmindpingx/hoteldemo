#!/usr/bin/env node
/**
 * Command-line version of the admin panel's "SEO Wizard → Audit & Score" tab.
 * Runs the same src/seo.js audit against the server on 127.0.0.1:<port> and prints the result.
 * Read-only: never writes to data/, never touches pm2. Safe to run any time.
 *
 *   node scripts/seo-audit.mjs                 # audits the running server on $PORT or 8097
 *   node scripts/seo-audit.mjs --port 8097     # explicit port
 *   node scripts/seo-audit.mjs --json          # machine-readable output
 *   node scripts/seo-audit.mjs --fail-under 80 # exit 1 if the score is below 80 (for cron / CI)
 *
 * Exit code: 0 normally, 1 if the server is unreachable or the score is below --fail-under.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
require('./lib.cjs').loadPm2Env(); // PORT / SITE_URL / DATA_DIR exactly as pm2 gives them to the server
const store = require('../src/store');
const seo = require('../src/seo');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const PORT = Number(flag('--port', process.env.PORT || 8097));
const JSON_OUT = args.includes('--json');
const FAIL_UNDER = Number(flag('--fail-under', 0)) || 0;

function reachable(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/robots.txt', method: 'HEAD', timeout: 4000, headers: { 'x-seo-audit': '1' } }, (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'info' };

(async () => {
  if (!(await reachable(PORT))) {
    console.error(`Server is not answering on 127.0.0.1:${PORT}. Is pm2 running it?  (pm2 list / pm2 logs hoteldemo)`);
    process.exit(1);
  }
  const site = store.getSite();
  const result = await seo.audit(site, { port: PORT, base: seo.baseUrl(site) });

  if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); }
  else {
    console.log(`SEO audit — score ${result.score}/100   (${result.summary.pass} pass · ${result.summary.warn} warn · ${result.summary.fail} fail)`);
    console.log(`Base URL: ${result.base || '(not set — set Site URL in Admin → SEO Wizard → Basics)'}`);
    for (const g of result.groups) {
      console.log(`\n== ${g.title}`);
      for (const c of g.checks) {
        const where = c.step ? `  [fix: SEO Wizard → ${c.step}${c.field ? ' → ' + c.field : ''}]` : '';
        console.log(`  ${ICON[c.status].padEnd(4)} ${c.label}${c.status === 'pass' ? '' : where}`);
        if (c.status !== 'pass' && c.detail) console.log(`       ${c.detail}`);
      }
    }
    if (result.pages.length) {
      console.log('\n== Pages (title chars / description chars / H1 count / imgs without alt)');
      for (const p of result.pages) {
        const flags = p.issues.map((i) => `${i.status}: ${i.msg}`).join('; ');
        console.log(`  ${String(p.status).padEnd(3)} ${p.path.padEnd(28)} ${String(p.titleLen).padStart(3)}t ${String(p.descLen).padStart(3)}d  H1=${p.h1} alt-missing=${p.imgsNoAlt}${flags ? '\n       ' + flags : ''}`);
      }
    }
  }
  if (FAIL_UNDER && result.score < FAIL_UNDER) {
    console.error(`\nScore ${result.score} is below the required ${FAIL_UNDER}.`);
    process.exit(1);
  }
})().catch((e) => { console.error('audit failed:', e.message); process.exit(1); });
