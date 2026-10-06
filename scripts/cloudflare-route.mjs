#!/usr/bin/env node
/**
 * Route a hostname through the existing Cloudflare Tunnel to a local port, and create/update
 * the proxied CNAME record for it.
 *
 *   node scripts/cloudflare-route.mjs --host hoteldemo1.signaturediversified.com --port 8097 [--env /home/dad/wwwhotel/.env] [--remove]
 *
 * Reads CF_ACCOUNT_ID, CF_API_TOKEN, CF_TUNNEL_ID, CF_ZONE_ID (and optionally CF_MASTER_TOKEN)
 * from the env file. If CF_API_TOKEN lacks a permission and CF_MASTER_TOKEN is present, a new
 * scoped token (Tunnel Write + DNS Write) is created and appended to the env file as
 * CF_API_TOKEN_TUNNEL_DNS, then used for the retry.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const HOST = args.host;
const PORT = Number(args.port);
const REMOVE = Boolean(args.remove);
const ENV_FILE = path.resolve(args.env || process.env.CF_ENV_FILE || path.join(process.cwd(), '..', '.env'));
if (!HOST || (!REMOVE && !PORT)) {
  console.error('usage: cloudflare-route.mjs --host <hostname> --port <port> [--env <file>] [--remove]');
  process.exit(1);
}

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv(ENV_FILE);
const { CF_ACCOUNT_ID, CF_TUNNEL_ID, CF_ZONE_ID, CF_MASTER_TOKEN } = env;
let token = env.CF_API_TOKEN_TUNNEL_DNS || env.CF_API_TOKEN;
if (!CF_ACCOUNT_ID || !CF_TUNNEL_ID || !CF_ZONE_ID || !token) {
  console.error(`Missing CF_ACCOUNT_ID / CF_TUNNEL_ID / CF_ZONE_ID / CF_API_TOKEN in ${ENV_FILE}`);
  process.exit(1);
}

const API = 'https://api.cloudflare.com/client/v4';
async function cf(method, url, body, tok = token) {
  const res = await fetch(API + url, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(json.errors || json)}`);
    err.status = res.status; err.errors = json.errors || [];
    throw err;
  }
  return json.result;
}

const isAuthError = (e) => e && (e.status === 401 || e.status === 403 || (e.errors || []).some((x) => [10000, 9109, 7000, 7003].includes(x.code)));

async function mintScopedToken() {
  if (!CF_MASTER_TOKEN) throw new Error('CF_API_TOKEN lacks permission and no CF_MASTER_TOKEN is available to create a scoped token.');
  console.log('  → CF_API_TOKEN lacks permission; creating a scoped token with CF_MASTER_TOKEN…');
  const groups = await cf('GET', '/user/tokens/permission_groups', null, CF_MASTER_TOKEN);
  const find = (name, scope) => groups.find((g) => g.name === name && (!scope || (g.scopes || []).includes(scope)));
  const tunnelWrite = find('Cloudflare Tunnel Write', 'com.cloudflare.api.account') || find('Cloudflare Tunnel Write');
  const dnsWrite = find('DNS Write', 'com.cloudflare.api.account.zone') || find('DNS Write');
  if (!tunnelWrite || !dnsWrite) throw new Error('Could not find "Cloudflare Tunnel Write" / "DNS Write" permission groups');
  const created = await cf('POST', '/user/tokens', {
    name: `hoteldemo tunnel+dns (${new Date().toISOString().slice(0, 10)})`,
    policies: [
      { effect: 'allow', resources: { [`com.cloudflare.api.account.${CF_ACCOUNT_ID}`]: '*' }, permission_groups: [{ id: tunnelWrite.id, name: tunnelWrite.name }] },
      { effect: 'allow', resources: { [`com.cloudflare.api.account.zone.${CF_ZONE_ID}`]: '*' }, permission_groups: [{ id: dnsWrite.id, name: dnsWrite.name }] },
    ],
  }, CF_MASTER_TOKEN);
  const value = created.value;
  if (!value) throw new Error('Token created but no value returned');
  fs.appendFileSync(ENV_FILE, `\n# Scoped token created by scripts/cloudflare-route.mjs (Cloudflare Tunnel Write + DNS Write). Token id: ${created.id}\nCF_API_TOKEN_TUNNEL_DNS=${value}\n`);
  console.log(`  → New token saved to ${ENV_FILE} as CF_API_TOKEN_TUNNEL_DNS (id ${created.id})`);
  token = value;
}

async function withRetry(fn) {
  try { return await fn(); } catch (e) {
    if (!isAuthError(e) || env.CF_API_TOKEN_TUNNEL_DNS) throw e;
    await mintScopedToken();
    return fn();
  }
}

async function updateTunnel() {
  const cfgUrl = `/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/configurations`;
  const current = await cf('GET', cfgUrl);
  const config = (current && current.config) || { ingress: [] };
  let ingress = Array.isArray(config.ingress) ? config.ingress : [];
  const catchAll = ingress.filter((r) => !r.hostname);
  let rules = ingress.filter((r) => r.hostname);
  const existing = rules.find((r) => r.hostname === HOST);
  const service = `http://127.0.0.1:${PORT}`;
  if (REMOVE) {
    if (!existing) { console.log(`  tunnel: ${HOST} not present — nothing to remove`); return; }
    rules = rules.filter((r) => r.hostname !== HOST);
  } else if (existing && existing.service === service) {
    console.log(`  tunnel: ${HOST} → ${service} already configured`); return;
  } else if (existing) {
    existing.service = service;
  } else {
    rules.push({ hostname: HOST, service });
  }
  const newIngress = [...rules, ...(catchAll.length ? catchAll : [{ service: 'http_status:404' }])];
  await withRetry(() => cf('PUT', cfgUrl, { config: { ...config, ingress: newIngress } }));
  console.log(`  tunnel: ${REMOVE ? 'removed' : 'set'} ${HOST} → ${service}`);
}

async function updateDns() {
  const target = `${CF_TUNNEL_ID}.cfargotunnel.com`;
  const records = await cf('GET', `/zones/${CF_ZONE_ID}/dns_records?name=${encodeURIComponent(HOST)}`);
  const existing = records.find((r) => r.type === 'CNAME');
  if (REMOVE) {
    if (!existing) { console.log(`  dns: no CNAME for ${HOST}`); return; }
    await withRetry(() => cf('DELETE', `/zones/${CF_ZONE_ID}/dns_records/${existing.id}`));
    console.log(`  dns: deleted CNAME ${HOST}`); return;
  }
  if (existing && existing.content === target && existing.proxied) { console.log(`  dns: CNAME ${HOST} → ${target} (proxied) already exists`); return; }
  const body = { type: 'CNAME', name: HOST, content: target, ttl: 1, proxied: true, comment: 'hoteldemo site via cloudflared tunnel' };
  if (existing) {
    await withRetry(() => cf('PUT', `/zones/${CF_ZONE_ID}/dns_records/${existing.id}`, body));
    console.log(`  dns: updated CNAME ${HOST} → ${target}`);
  } else {
    const other = records.find((r) => r.type === 'A' || r.type === 'AAAA');
    if (other) throw new Error(`An ${other.type} record already exists for ${HOST}; remove it first.`);
    await withRetry(() => cf('POST', `/zones/${CF_ZONE_ID}/dns_records`, body));
    console.log(`  dns: created CNAME ${HOST} → ${target} (proxied)`);
  }
}

(async () => {
  console.log(`Cloudflare route for ${HOST} (env: ${ENV_FILE})`);
  const verify = await cf('GET', '/user/tokens/verify');
  console.log(`  token status: ${verify.status}`);
  await updateTunnel();
  await updateDns();
  console.log('Done.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
