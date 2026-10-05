'use strict';
const { icon } = require('./icons');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape text and turn line breaks into <br>/paragraphs. */
function nl2br(s) {
  return esc(s).replace(/\r?\n/g, '<br>');
}

function paragraphs(s, cls = '') {
  return String(s || '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="${cls}">${nl2br(p)}</p>`)
    .join('');
}

function money(amount, currency = 'USD') {
  const n = Number(amount);
  if (!n) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch (_) {
    return `$${n}`;
  }
}

function stars(rating, cls = 'w-4 h-4') {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  let html = '<span class="inline-flex items-center gap-0.5" aria-label="' + r + ' out of 5 stars">';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(r);
    html += icon('star', `${cls} ${filled ? 'fill-current text-accent' : 'text-gray-300'}`);
  }
  return html + '</span>';
}

function hexToRgb(hex) {
  const m = String(hex || '').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function shade(hex, pct) {
  const rgb = hexToRgb(hex) || [31, 58, 95];
  const f = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  const out = rgb.map((c) => Math.round((f - c) * p + c));
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
}

function rgbTriplet(hex, fallback = '31 58 95') {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(' ') : fallback;
}

const FONT_OPTIONS = ['Playfair Display', 'Cormorant Garamond', 'Lora', 'Merriweather', 'DM Serif Display', 'Libre Baskerville', 'Inter', 'Nunito Sans', 'Source Sans 3', 'Montserrat', 'Poppins', 'Raleway', 'Lato', 'Open Sans', 'Work Sans'];

function fontsHref(theme) {
  const fams = [...new Set([theme.headingFont, theme.bodyFont].filter(Boolean))];
  if (!fams.length) return '';
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

function fullAddress(a) {
  if (!a) return '';
  const line1 = a.street || '';
  const line2 = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(', ');
}

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return `tel:${digits.length === 10 ? '+1' + digits : digits}`;
}

function mapEmbedUrl(area, general) {
  if (area && area.mapEmbedUrl) return area.mapEmbedUrl;
  const q = (area && area.mapQuery) || fullAddress(general && general.address);
  if (!q) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed`;
}

function directionsUrl(area, general) {
  const q = (area && area.mapQuery) || fullAddress(general && general.address);
  if (!q) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function fullName(general) {
  return [general.hotelName, general.locationLine].filter(Boolean).join(' ');
}

function siteTitle(site, pageTitle) {
  const base = site.seo.title || fullName(site.general);
  return pageTitle ? `${pageTitle} | ${base}` : base;
}

function bookingHref(site, fallback = '/contact') {
  const g = site.general;
  if (g.bookingMode === 'external' && g.bookingUrl) return g.bookingUrl;
  return fallback;
}

function heroHeading(site) {
  return site.hero.heading || fullName(site.general);
}

function year() {
  return new Date().getFullYear();
}

function enabledItems(list) {
  return (Array.isArray(list) ? list : []).filter((i) => i && i.enabled !== false);
}

module.exports = {
  esc,
  nl2br,
  paragraphs,
  money,
  stars,
  shade,
  rgbTriplet,
  FONT_OPTIONS,
  fontsHref,
  fullAddress,
  telHref,
  mapEmbedUrl,
  directionsUrl,
  fullName,
  siteTitle,
  bookingHref,
  heroHeading,
  year,
  enabledItems,
};
