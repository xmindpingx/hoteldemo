'use strict';
/**
 * Shared bits for the scripts in this folder.
 * loadPm2Env(): when a script runs from a plain shell, PORT / SITE_URL / DATA_DIR are not set — pm2 only
 * injects them into the server process. Read the same values from ecosystem.config.cjs so the scripts
 * see exactly what the running server sees. Real environment variables still win.
 */
const path = require('path');

function loadPm2Env() {
  try {
    const eco = require(path.join(__dirname, '..', 'ecosystem.config.cjs'));
    const app = (eco.apps || []).find((a) => a.name === 'hoteldemo') || (eco.apps || [])[0];
    const env = (app && app.env) || {};
    for (const k of ['PORT', 'SITE_URL', 'DATA_DIR', 'ADMIN_PASSPHRASE']) {
      if (process.env[k] == null && env[k] != null) process.env[k] = String(env[k]);
    }
    return env;
  } catch (_) {
    return {};
  }
}

module.exports = { loadPm2Env };
