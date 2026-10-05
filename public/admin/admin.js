/* Admin CMS — schema-driven editor for data/site.json. Vanilla JS, no build step. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = (p = 'id') => `${p}-${Math.random().toString(16).slice(2, 10)}`;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') node[k] = Boolean(v);
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const UI = {
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
    palette: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    layout: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/>',
    sparkles: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    footer: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    chart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  };
  const svg = (name, cls = '') => {
    const body = UI[name] || (state.meta && state.meta.iconSvgs && state.meta.iconSvgs[name]) || UI.check;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${body}</svg>`;
  };

  const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const setPath = (obj, path, value) => {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof path[i + 1] === 'number' ? [] : {};
      o = o[k];
    }
    o[path[path.length - 1]] = value;
  };

  async function api(path, opts = {}) {
    const headers = { 'X-Requested-With': 'fetch' };
    if (opts.body && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    const res = await fetch('/admin/api' + path, { credentials: 'same-origin', ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (res.status === 401) { window.location.href = '/admin/login'; throw new Error('Signed out'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, kind = '') {
    let t = $('.toast');
    if (!t) { t = h('div', { class: 'toast' }); document.body.append(t); }
    t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ------------------------------------------------------------------ state
  const state = { site: null, meta: null, dirty: false, section: 'general', collapsed: new Set(), inquiries: null, uploads: null };

  function markDirty() {
    if (!state.dirty) { state.dirty = true; renderStatus(); }
  }

  // ------------------------------------------------------------------ schema
  const HOME_SECTION_KEYS = ['promotions', 'overview', 'rooms', 'amenities', 'dining', 'area', 'gallery', 'reviews', 'faq', 'contact'];
  const POSITIONS = ['after-hero', ...HOME_SECTION_KEYS.map((k) => 'after-' + k), 'before-footer', 'page-amenities', 'page-dining', 'page-area', 'page-gallery'];
  const SOCIALS = ['facebook', 'instagram', 'x', 'youtube', 'linkedin', 'tiktok', 'google', 'tripadvisor', 'yelp', 'website'];

  const F = {
    text: (key, label, extra = {}) => ({ key, label, type: 'text', ...extra }),
    area: (key, label, extra = {}) => ({ key, label, type: 'textarea', ...extra }),
    num: (key, label, extra = {}) => ({ key, label, type: 'number', ...extra }),
    bool: (key, label, extra = {}) => ({ key, label, type: 'boolean', ...extra }),
    sel: (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra }),
    img: (key, label, extra = {}) => ({ key, label, type: 'image', ...extra }),
    color: (key, label, extra = {}) => ({ key, label, type: 'color', ...extra }),
    icon: (key, label, extra = {}) => ({ key, label, type: 'icon', ...extra }),
    code: (key, label, extra = {}) => ({ key, label, type: 'code', ...extra }),
    strings: (key, label, extra = {}) => ({ key, label, type: 'stringlist', ...extra }),
    texts: (key, label, extra = {}) => ({ key, label, type: 'textlist', ...extra }),
    images: (key, label, extra = {}) => ({ key, label, type: 'imagelist', ...extra }),
    list: (key, label, fields, extra = {}) => ({ key, label, type: 'list', fields, ...extra }),
    group: (key, label, fields, extra = {}) => ({ key, label, type: 'group', fields, ...extra }),
  };

  const enabledToggle = (label = 'Show this section on the website') => F.bool('enabled', label);

  const SECTIONS = [
    { id: 'general', title: 'General & Contact Info', icon: 'building', group: 'Site', path: ['general'], fields: [
      { type: 'row', fields: [F.text('hotelName', 'Hotel name'), F.text('locationLine', 'Location line', { help: 'Shown after the name, e.g. "Mesa, Arizona"' })] },
      { type: 'row', fields: [F.text('brandLine', 'Brand line', { help: 'Small uppercase text under the logo' }), F.text('logoText', 'Logo text', { help: 'Short name shown in the header' })] },
      F.area('tagline', 'Tagline', { help: 'Used as the default meta description' }),
      F.img('logoUrl', 'Logo image', { help: 'Optional. Leave blank to show the logo text only.' }),
      { type: 'row', fields: [F.text('phone', 'Phone'), F.text('email', 'Email')] },
      F.group('address', 'Address', [
        { type: 'row', fields: [F.text('street', 'Street'), F.text('city', 'City')] },
        { type: 'row3', fields: [F.text('state', 'State'), F.text('zip', 'ZIP'), F.text('country', 'Country')] },
      ]),
      { type: 'row', fields: [F.text('checkInTime', 'Check-in time', { help: 'Leave blank to hide' }), F.text('checkOutTime', 'Check-out time')] },
      { type: 'row', fields: [F.sel('bookingMode', 'Booking mode', [['inquiry', 'Inquiry form on this site'], ['external', 'External booking link']]), F.text('bookingUrl', 'External booking URL', { help: 'Used when booking mode is "External"' })] },
      { type: 'row', fields: [F.text('bookNowLabel', '"Book" button label'), F.sel('currency', 'Currency', ['USD', 'CAD', 'EUR', 'GBP', 'MXN'])] },
      F.group('rating', 'Rating badge (hero)', [
        F.bool('showRating', 'Show rating in hero'),
        { type: 'row3', fields: [F.num('starRating', 'Star rating (0–5)', { step: 0.5 }), F.num('reviewScore', 'Review score', { step: 0.1 }), F.num('reviewCount', 'Review count')] },
      ], { flat: true }),
      F.group('announcement', 'Announcement bar (top of every page)', [
        F.bool('enabled', 'Show announcement bar'),
        { type: 'row', fields: [F.text('text', 'Text'), F.text('href', 'Link (optional)')] },
      ]),
    ] },
    { id: 'rates', title: 'Rates & Policies', icon: 'tag', group: 'Site', path: ['general'], fields: [
      { type: 'note', html: 'Quick access to rates, check-in/out times and pet policy. Room-level rates are set under <strong>Suites &amp; Rooms</strong> for each room.' },
      { type: 'row', fields: [F.text('checkInTime', 'Check-in time', { help: 'e.g. 3:00 PM — leave blank to hide' }), F.text('checkOutTime', 'Check-out time', { help: 'e.g. 11:00 AM — leave blank to hide' })] },
      F.text('ratesNote', 'Rates note / summary', { help: 'Displayed on the contact and booking pages.' }),
      F.area('petPolicy', 'Pet policy', { help: 'Displayed in the Amenities section. Leave blank to hide.' }),
    ] },
    { id: 'theme', title: 'Theme & Fonts', icon: 'palette', group: 'Site', path: ['theme'], fields: [
      { type: 'row', fields: [F.color('primary', 'Primary color', { help: 'Header accents, buttons, footer' }), F.color('accent', 'Accent color', { help: 'Highlights, call-to-action buttons' })] },
      { type: 'row', fields: [F.sel('headingFont', 'Heading font', 'fonts'), F.sel('bodyFont', 'Body font', 'fonts')] },
      { type: 'row3', fields: [F.sel('headerStyle', 'Header style', [['light', 'Light (white)'], ['dark', 'Dark (primary color)']]), F.sel('buttonStyle', 'Button corners', [['rounded', 'Rounded'], ['pill', 'Pill'], ['none', 'Square']]), F.num('heroOverlay', 'Hero darkness (0–90 %)', { min: 0, max: 90 })] },
      F.code('customCss', 'Custom CSS', { help: 'Advanced: injected into every page.' }),
    ] },
    { id: 'seo', title: 'SEO Wizard', icon: 'search', group: 'Site', custom: 'seo' },
    { id: 'nav', title: 'Navigation', icon: 'menu', group: 'Site', path: [], fields: [
      F.list('nav', 'Menu items', [{ type: 'row', fields: [F.text('label', 'Label'), F.text('href', 'Link')] }, F.bool('enabled', 'Show in menu')], { itemLabel: 'label', template: { label: 'New page', href: '/', enabled: true } }),
      { type: 'note', html: 'Available pages: <code>/</code>, <code>/suites</code>, <code>/amenities</code>, <code>/dining</code>, <code>/area</code>, <code>/gallery</code>, <code>/reviews</code>, <code>/contact</code>, plus <code>/#faq</code>-style anchors and external links.' },
    ] },
    { id: 'layout', title: 'Home Page Layout', icon: 'layout', group: 'Site', path: ['layout'], fields: [
      { type: 'orderlist', key: 'homeOrder', label: 'Order of sections on the home page', options: HOME_SECTION_KEYS, help: 'Remove a section here to keep its page but hide it from the home page. Each section also has its own "show" switch.' },
    ] },
    { id: 'hero', title: 'Hero Banner', icon: 'image', group: 'Content', path: ['hero'], fields: [
      enabledToggle('Show hero banner'),
      { type: 'row', fields: [F.text('badge', 'Badge text', { help: 'Small pill above the heading' }), F.text('heading', 'Heading', { help: 'Leave blank to use the hotel name + location' })] },
      F.area('subheading', 'Subheading'),
      { type: 'row', fields: [F.text('ctaText', 'Primary button text'), F.text('ctaHref', 'Primary button link', { help: 'Leave blank for the booking link' })] },
      { type: 'row', fields: [F.text('secondaryCtaText', 'Secondary button text'), F.text('secondaryCtaHref', 'Secondary button link')] },
      { type: 'row', fields: [F.bool('showBookingBar', 'Show check-in / check-out bar under the hero'), F.num('slideInterval', 'Slideshow interval (seconds)', { min: 3 })] },
      F.list('images', 'Hero images (slideshow)', [F.img('url', 'Image'), F.text('alt', 'Alt text')], { itemLabel: 'alt', thumb: 'url', template: { url: '', alt: '' } }),
    ] },
    { id: 'promotions', title: 'Offers & Promotions', icon: 'tag', group: 'Content', path: ['promotions'], fields: [
      enabledToggle(), F.text('heading', 'Section label'),
      F.list('items', 'Promotions', [
        F.text('title', 'Title'), F.area('text', 'Text'),
        { type: 'row3', fields: [F.text('code', 'Promo code'), F.text('ctaText', 'Button text'), F.text('ctaHref', 'Button link')] },
        { type: 'row', fields: [F.sel('style', 'Card style', [['accent', 'Accent color'], ['dark', 'Dark'], ['light', 'Light tint'], ['info', 'Sand']]), F.bool('enabled', 'Visible')] },
      ], { itemLabel: 'title', template: { title: 'New offer', text: '', code: '', ctaText: 'Learn more', ctaHref: '/contact', style: 'light', enabled: true } }),
    ] },
    { id: 'overview', title: 'Overview', icon: 'text', group: 'Content', path: ['overview'], fields: [
      enabledToggle(), F.text('heading', 'Heading'),
      F.texts('paragraphs', 'Paragraphs'),
      { type: 'row', fields: [F.img('image', 'Side image'), F.text('imageAlt', 'Image alt text')] },
      F.list('highlights', 'Highlights (icon grid)', [{ type: 'row3', fields: [F.icon('icon', 'Icon'), F.text('label', 'Label'), F.text('note', 'Note')] }], { itemLabel: 'label', template: { icon: 'check', label: 'New highlight', note: '' } }),
      F.list('stats', 'Stat boxes', [{ type: 'row', fields: [F.text('value', 'Value'), F.text('label', 'Label')] }], { itemLabel: 'label', template: { value: '', label: '' } }),
    ] },
    { id: 'rooms', title: 'Suites & Rooms', icon: 'bed', group: 'Content', path: ['rooms'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      F.list('items', 'Suites', [
        { type: 'row', fields: [F.text('name', 'Name'), F.text('type', 'Type label', { help: 'e.g. Studio, One Bedroom' })] },
        { type: 'row3', fields: [F.text('slug', 'URL slug', { help: 'Auto-generated if blank' }), F.bool('featured', 'Featured ("Popular" badge)'), F.bool('enabled', 'Visible')] },
        F.img('image', 'Main photo'),
        F.images('images', 'Gallery photos'),
        { type: 'row', fields: [F.text('beds', 'Beds', { help: 'e.g. 1 King, 2 Queens' }), F.text('view', 'View')] },
        { type: 'row3', fields: [F.num('sqft', 'Square feet (0 = hide)'), F.num('sleeps', 'Sleeps'), F.num('bathrooms', 'Bathrooms')] },
        F.area('shortDescription', 'Short description (card)'), F.area('description', 'Full description', { help: 'Blank line = new paragraph' }),
        F.strings('features', 'Features list'),
        { type: 'row3', fields: [F.num('priceFrom', 'Price from (0 = "Rates on request")', { step: 1 }), F.text('priceNote', 'Price note'), F.text('bookHref', 'Custom booking link')] },
      ], { itemLabel: 'name', thumb: 'image', template: { name: 'New suite', slug: '', type: 'Studio', image: '', images: [], sqft: 0, beds: '1 Queen', sleeps: 2, bathrooms: 1, view: '', shortDescription: '', description: '', features: [], priceFrom: 0, priceNote: '', featured: false, enabled: true, bookHref: '' } }),
    ] },
    { id: 'amenities', title: 'Amenities & Policies', icon: 'sparkles', group: 'Content', path: ['amenities'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      F.list('featured', 'Featured amenities (cards with photos)', [{ type: 'row', fields: [F.icon('icon', 'Icon'), F.text('title', 'Title')] }, F.area('text', 'Text'), F.img('image', 'Photo')], { itemLabel: 'title', thumb: 'image', template: { icon: 'check', title: 'New amenity', text: '', image: '' } }),
      F.list('categories', 'Amenity checklists', [F.text('name', 'Category name'), F.strings('items', 'Items')], { itemLabel: 'name', template: { name: 'New category', items: [] } }),
      F.list('policies', 'Policies', [{ type: 'row', fields: [F.text('title', 'Title'), F.text('anchor', 'Anchor id', { help: 'Link to it with /amenities#anchor' })] }, F.area('text', 'Text')], { itemLabel: 'title', template: { title: 'New policy', anchor: '', text: '' } }),
    ] },
    { id: 'dining', title: 'Dining', icon: 'utensils', group: 'Content', path: ['dining'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      F.list('items', 'On-site dining / food services', [{ type: 'row', fields: [F.text('name', 'Name'), F.text('badge', 'Badge', { help: 'e.g. Included, Open 24 hours' })] }, F.text('hours', 'Hours'), F.area('description', 'Description'), { type: 'row', fields: [F.img('image', 'Photo'), F.bool('enabled', 'Visible')] }], { itemLabel: 'name', thumb: 'image', template: { name: 'New item', badge: '', hours: '', description: '', image: '', enabled: true } }),
      F.list('nearby', 'Nearby restaurants', [{ type: 'row', fields: [F.text('name', 'Name'), F.text('cuisine', 'Cuisine / type')] }, { type: 'row', fields: [F.text('distance', 'Distance'), F.text('url', 'Website')] }, F.text('note', 'Note')], { itemLabel: 'name', template: { name: 'New restaurant', cuisine: '', distance: '', note: '', url: '' } }),
    ] },
    { id: 'area', title: 'Local Area & Map', icon: 'map', group: 'Content', path: ['area'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      F.group('map', 'Map', [
        F.text('mapQuery', 'Map search / address', { help: 'What Google Maps should center on. Defaults to the hotel address.' }),
        F.text('mapEmbedUrl', 'Custom embed URL (optional)', { help: 'Google Maps → Share → Embed a map → copy the src="…" URL.' }),
        { type: 'row', fields: [F.num('latitude', 'Latitude', { step: 0.000001 }), F.num('longitude', 'Longitude', { step: 0.000001 })] },
      ], { flat: true }),
      F.strings('categories', 'Attraction categories'),
      F.list('attractions', 'Attractions & points of interest', [{ type: 'row', fields: [F.text('name', 'Name'), F.sel('category', 'Category', 'areaCategories')] }, F.area('description', 'Description'), { type: 'row3', fields: [F.text('distance', 'Distance / drive time'), F.text('url', 'Website'), F.bool('enabled', 'Visible')] }, F.img('image', 'Photo')], { itemLabel: 'name', thumb: 'image', template: { name: 'New attraction', category: '', description: '', distance: '', image: '', url: '', enabled: true } }),
      F.list('airports', 'Airports', [{ type: 'row', fields: [F.text('name', 'Name'), F.text('code', 'Code')] }, { type: 'row', fields: [F.text('distance', 'Distance'), F.text('note', 'Note')] }], { itemLabel: 'name', template: { name: 'Airport', code: '', distance: '', note: '' } }),
      F.list('transport', 'Getting around', [F.text('name', 'Name'), F.text('note', 'Note')], { itemLabel: 'name', template: { name: '', note: '' } }),
    ] },
    { id: 'gallery', title: 'Gallery', icon: 'image', group: 'Content', path: ['gallery'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      { type: 'bulkupload', key: 'items', label: 'Add photos', help: 'Upload several photos at once — each becomes a gallery item.' },
      F.list('items', 'Photos', [F.img('image', 'Photo'), { type: 'row', fields: [F.text('caption', 'Caption'), F.text('category', 'Category', { help: 'Used for the filter buttons' })] }], { itemLabel: 'caption', thumb: 'image', template: { image: '', caption: '', category: '' } }),
    ] },
    { id: 'reviews', title: 'Guest Reviews', icon: 'star', group: 'Content', path: ['reviews'], fields: [
      enabledToggle(), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      { type: 'note', html: 'Only publish reviews guests actually wrote. The summary score uses the rating fields in <strong>General</strong> if set, otherwise the average of these reviews.' },
      F.list('items', 'Reviews', [{ type: 'row3', fields: [F.text('name', 'Guest name'), F.text('location', 'Location'), F.num('rating', 'Rating (1–5)', { min: 1, max: 5 })] }, { type: 'row', fields: [F.text('date', 'Date label'), F.text('title', 'Title')] }, F.area('text', 'Review text'), F.bool('enabled', 'Visible')], { itemLabel: 'name', template: { name: '', location: '', rating: 5, date: '', title: '', text: '', enabled: true } }),
    ] },
    { id: 'faq', title: 'FAQ', icon: 'help', group: 'Content', path: ['faq'], fields: [
      enabledToggle(), F.text('heading', 'Heading'),
      F.list('items', 'Questions', [F.text('q', 'Question'), F.area('a', 'Answer')], { itemLabel: 'q', template: { q: 'New question?', a: '' } }),
    ] },
    { id: 'contact', title: 'Contact Page', icon: 'mail', group: 'Content', path: ['contact'], fields: [
      enabledToggle('Show contact section on the home page'), F.text('heading', 'Heading'), F.area('intro', 'Intro text'),
      { type: 'row', fields: [F.bool('formEnabled', 'Enable the inquiry form'), F.bool('showMap', 'Show map on contact page')] },
      { type: 'row', fields: [F.text('hours', 'Hours line'), F.text('successMessage', 'Message after sending')] },
      { type: 'note', html: 'Submitted inquiries appear under <strong>Inquiries</strong> in the sidebar. Contact details (phone, email, address) are edited under <strong>General</strong>.' },
    ] },
    { id: 'custom', title: 'Custom Sections', icon: 'code', group: 'Content', path: [], fields: [
      { type: 'note', html: 'Add your own blocks of HTML anywhere on the home page or at the bottom of a sub-page. Anything goes: embedded videos, booking widgets, extra text.' },
      F.list('customSections', 'Custom sections', [{ type: 'row3', fields: [F.text('title', 'Title (optional)'), F.text('anchor', 'Anchor id'), F.sel('position', 'Position', POSITIONS)] }, F.code('html', 'HTML content'), F.bool('enabled', 'Visible')], { itemLabel: 'title', template: { title: 'New section', anchor: '', position: 'before-footer', html: '<p>Your content here.</p>', enabled: true } }),
    ] },
    { id: 'footer', title: 'Footer', icon: 'footer', group: 'Content', path: ['footer'], fields: [
      F.area('about', 'About text'),
      F.list('links', 'Footer links', [{ type: 'row', fields: [F.text('label', 'Label'), F.text('href', 'Link')] }], { itemLabel: 'label', template: { label: '', href: '/' } }),
      F.list('social', 'Social links', [{ type: 'row', fields: [F.sel('network', 'Network', SOCIALS), F.text('url', 'URL')] }], { itemLabel: 'network', template: { network: 'facebook', url: '' } }),
      { type: 'row', fields: [F.text('copyright', 'Copyright line', { help: '{year} is replaced with the current year' }), F.text('bottomNote', 'Bottom note')] },
      F.bool('showAdminLink', 'Show "Site Admin" link in the footer'),
    ] },
    { id: 'inquiries', title: 'Inquiries', icon: 'inbox', group: 'Manage', custom: 'inquiries' },
    { id: 'media', title: 'Media Library', icon: 'image', group: 'Manage', custom: 'media' },
    { id: 'data', title: 'Data, Reset & Security', icon: 'database', group: 'Manage', custom: 'data' },
  ];

  // ------------------------------------------------------------------ field rendering
  function fieldLabel(f) {
    return h('label', {}, f.label, f.help ? h('span', { class: 'help', html: ' — ' + esc(f.help) }) : null);
  }

  function selectOptions(opts) {
    if (opts === 'fonts') return state.meta.fonts.map((f) => [f, f]);
    if (opts === 'areaCategories') return (state.site.area.categories || []).map((c) => [c, c]);
    return opts.map((o) => (Array.isArray(o) ? o : [o, o]));
  }

  function renderField(f, basePath) {
    const path = f.key != null ? [...basePath, f.key] : basePath;
    const val = f.key != null ? getPath(state.site, path) : undefined;
    const ds = { path: JSON.stringify(path), type: f.type };

    switch (f.type) {
      case 'row': return h('div', { class: 'grid-2' }, f.fields.map((x) => renderField(x, basePath)));
      case 'row3': return h('div', { class: 'grid-3' }, f.fields.map((x) => renderField(x, basePath)));
      case 'note': return h('div', { class: 'alert alert-info', html: f.html });
      case 'group': {
        const inner = f.fields.map((x) => renderField(x, f.flat ? basePath : path));
        return h('div', { class: 'card', style: 'margin:0' }, h('div', { class: 'card-head' }, h('h2', {}, f.label)), h('div', { class: 'card-body' }, inner));
      }
      case 'text':
        return h('div', { class: 'field' }, fieldLabel(f), h('input', { type: 'text', value: val == null ? '' : val, dataset: ds, placeholder: f.placeholder || '' }));
      case 'number':
        return h('div', { class: 'field' }, fieldLabel(f), h('input', { type: 'number', value: val == null ? '' : val, dataset: ds, step: f.step || 'any', min: f.min, max: f.max }));
      case 'textarea':
        return h('div', { class: 'field' }, fieldLabel(f), h('textarea', { dataset: ds }, val == null ? '' : val));
      case 'code':
        return h('div', { class: 'field' }, fieldLabel(f), h('textarea', { class: 'code', dataset: ds, spellcheck: 'false' }, val == null ? '' : val));
      case 'boolean':
        return h('div', { class: 'field' }, h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: Boolean(val), dataset: ds }), h('span', { class: 'sw' }), h('span', { class: 't-label' }, f.label)), f.help ? h('div', { class: 'help' }, f.help) : null);
      case 'select': {
        const opts = selectOptions(f.options);
        const sel = h('select', { dataset: ds }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
        if (val != null && val !== '' && !opts.some(([v]) => String(v) === String(val))) sel.prepend(h('option', { value: val, selected: true }, val));
        return h('div', { class: 'field' }, fieldLabel(f), sel);
      }
      case 'color': {
        const text = h('input', { type: 'text', value: val || '', dataset: ds, placeholder: '#000000' });
        const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val || '') ? val : '#000000', oninput: (e) => { text.value = e.target.value; text.dispatchEvent(new Event('input', { bubbles: true })); } });
        return h('div', { class: 'field' }, fieldLabel(f), h('div', { class: 'color-row' }, picker, text));
      }
      case 'icon': {
        const opts = state.meta.icons;
        const prev = h('span', { class: 'prev', html: svg(val || 'check') });
        const sel = h('select', { dataset: ds, onchange: (e) => { prev.innerHTML = svg(e.target.value); } }, opts.map((n) => h('option', { value: n, selected: n === val }, n)));
        return h('div', { class: 'field' }, fieldLabel(f), h('div', { class: 'icon-pick' }, prev, sel));
      }
      case 'image': return renderImageField(f, path, val);
      case 'stringlist': return renderStringList(f, path, 'input');
      case 'textlist': return renderStringList(f, path, 'textarea');
      case 'imagelist': return renderImageList(f, path);
      case 'list': return renderList(f, path);
      case 'orderlist': return renderOrderList(f, path);
      case 'bulkupload': return renderBulkUpload(f, path);
      default: return h('div', { class: 'alert alert-warn' }, `Unknown field type ${f.type}`);
    }
  }

  function renderImageField(f, path, val) {
    const ds = { path: JSON.stringify(path), type: 'text' };
    const thumb = h('div', { class: 'thumb' }, val ? h('img', { src: val, alt: '', onerror: (e) => { e.target.replaceWith(document.createTextNode('not found')); } }) : 'no image');
    const input = h('input', { type: 'text', value: val || '', dataset: ds, placeholder: 'https://… or /uploads/…', oninput: (e) => { thumb.innerHTML = ''; thumb.append(e.target.value ? h('img', { src: e.target.value, alt: '' }) : 'no image'); } });
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      if (!e.target.files.length) return;
      try {
        const urls = await uploadFiles(e.target.files);
        input.value = urls[0]; input.dispatchEvent(new Event('input', { bubbles: true }));
        toast('Uploaded', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      e.target.value = '';
    } });
    const controls = h('div', { class: 'controls' },
      h('button', { type: 'button', class: 'btn btn-sm', html: svg('upload') + ' Upload', onclick: () => file.click() }),
      h('button', { type: 'button', class: 'btn btn-sm', html: svg('image') + ' Library', onclick: () => openLibrary((url) => { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); }) }),
      h('button', { type: 'button', class: 'btn btn-sm', html: svg('x') + ' Clear', onclick: () => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); } }),
      file,
    );
    return h('div', { class: 'field' }, fieldLabel(f), h('div', { class: 'image-field' }, thumb, h('div', {}, input, controls)));
  }

  function renderStringList(f, path, kind) {
    const wrap = h('div', { class: 'field' });
    const rerender = () => {
      const arr = getPath(state.site, path) || [];
      wrap.innerHTML = '';
      wrap.append(fieldLabel(f));
      const list = h('div', { class: 'string-list' });
      arr.forEach((v, i) => {
        const ctrl = kind === 'textarea' ? h('textarea', { dataset: { path: JSON.stringify([...path, i]), type: 'text' } }, v || '') : h('input', { type: 'text', value: v || '', dataset: { path: JSON.stringify([...path, i]), type: 'text' } });
        list.append(h('div', { class: 'row' }, ctrl,
          h('button', { type: 'button', class: 'btn btn-icon', title: 'Move up', html: svg('up'), onclick: () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon', title: 'Move down', html: svg('down'), onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon btn-danger', title: 'Remove', html: svg('trash'), onclick: () => { arr.splice(i, 1); markDirty(); rerender(); } }),
        ));
      });
      wrap.append(list, h('div', {}, h('button', { type: 'button', class: 'btn btn-sm', html: svg('plus') + ' Add', onclick: () => { const a = getPath(state.site, path) || []; a.push(''); setPath(state.site, path, a); markDirty(); rerender(); setTimeout(() => { const last = wrap.querySelectorAll('.row'); if (last.length) last[last.length - 1].querySelector('input,textarea').focus(); }, 0); } })));
    };
    rerender();
    return wrap;
  }

  function renderImageList(f, path) {
    const wrap = h('div', { class: 'field' });
    const rerender = () => {
      const arr = getPath(state.site, path) || [];
      wrap.innerHTML = '';
      wrap.append(fieldLabel(f));
      const list = h('div', { class: 'list' });
      arr.forEach((v, i) => {
        list.append(h('div', { class: 'list-item', style: 'padding:10px' },
          renderImageField({ label: `Photo ${i + 1}` }, [...path, i], v),
          h('div', { class: 'list-actions', style: 'margin-top:8px' },
            h('button', { type: 'button', class: 'btn btn-sm', html: svg('up'), onclick: () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); rerender(); } } }),
            h('button', { type: 'button', class: 'btn btn-sm', html: svg('down'), onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; markDirty(); rerender(); } } }),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', html: svg('trash') + ' Remove', onclick: () => { arr.splice(i, 1); markDirty(); rerender(); } }),
          )));
      });
      const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: async (e) => {
        if (!e.target.files.length) return;
        try { const urls = await uploadFiles(e.target.files); const a = getPath(state.site, path) || []; a.push(...urls); setPath(state.site, path, a); markDirty(); rerender(); toast(`${urls.length} uploaded`, 'ok'); } catch (err) { toast(err.message, 'err'); }
        e.target.value = '';
      } });
      wrap.append(list, h('div', { class: 'list-actions', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-sm', html: svg('plus') + ' Add URL', onclick: () => { const a = getPath(state.site, path) || []; a.push(''); setPath(state.site, path, a); markDirty(); rerender(); } }),
        h('button', { type: 'button', class: 'btn btn-sm', html: svg('upload') + ' Upload photos', onclick: () => file.click() }), file));
    };
    rerender();
    return wrap;
  }

  function itemTitle(f, item, i) {
    const v = f.itemLabel ? item[f.itemLabel] : '';
    return (v && String(v).trim()) || `${f.label.replace(/s$/, '')} ${i + 1}`;
  }

  function renderList(f, path) {
    const wrap = h('div', { class: 'field' });
    const rerender = () => {
      const arr = getPath(state.site, path) || [];
      wrap.innerHTML = '';
      wrap.append(h('div', { class: 'lbl', style: 'display:flex;align-items:center;gap:8px' }, h('span', {}, f.label), h('span', { class: 'pill' }, `${arr.length}`), f.help ? h('span', { class: 'help' }, f.help) : null));
      const list = h('div', { class: 'list' });
      arr.forEach((item, i) => {
        if (!item || typeof item !== 'object') return;
        if (!item.id) item.id = uid();
        const key = `${path.join('.')}:${item.id}`;
        const collapsed = !state.collapsed.has(key); // collapsed by default; set holds "expanded" keys
        const li = h('div', { class: `list-item ${collapsed ? 'collapsed' : ''} ${item.enabled === false ? 'disabled' : ''}`, dataset: { itemPath: JSON.stringify([...path, i]), labelKey: f.itemLabel || '' } });
        const head = h('div', { class: 'li-head', onclick: (e) => { if (e.target.closest('button')) return; if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key); li.classList.toggle('collapsed'); } },
          h('span', { html: svg('chevron'), style: 'width:16px;height:16px;display:inline-block;opacity:.6' }),
          f.thumb && item[f.thumb] ? h('span', { class: 'li-thumb', style: `background-image:url("${esc(item[f.thumb])}")` }) : null,
          h('span', { class: 'title', dataset: { fallback: `${f.label.replace(/s$/, '')} ${i + 1}` } }, itemTitle(f, item, i)),
          item.enabled === false ? h('span', { class: 'meta' }, 'hidden') : null,
          h('button', { type: 'button', class: 'btn btn-icon', title: 'Move up', html: svg('up'), onclick: () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon', title: 'Move down', html: svg('down'), onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon', title: 'Duplicate', html: svg('copy'), onclick: () => { const c = clone(item); c.id = uid(); if (c.slug) c.slug = ''; arr.splice(i + 1, 0, c); state.collapsed.add(`${path.join('.')}:${c.id}`); markDirty(); rerender(); } }),
          h('button', { type: 'button', class: 'btn btn-icon btn-danger', title: 'Delete', html: svg('trash'), onclick: () => { if (confirm(`Delete "${itemTitle(f, item, i)}"?`)) { arr.splice(i, 1); markDirty(); rerender(); } } }),
        );
        const body = h('div', { class: 'li-body' }, f.fields.map((x) => renderField(x, [...path, i])));
        li.append(head, body);
        list.append(li);
      });
      wrap.append(list, h('div', { class: 'list-actions', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: svg('plus') + ' Add ' + f.label.replace(/s$/, '').toLowerCase(), onclick: () => { const a = getPath(state.site, path) || []; const item = clone(f.template || {}); item.id = uid(); a.push(item); setPath(state.site, path, a); state.collapsed.add(`${path.join('.')}:${item.id}`); markDirty(); rerender(); wrap.scrollIntoView({ block: 'end', behavior: 'smooth' }); } }),
        arr.length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const anyOpen = arr.some((it) => state.collapsed.has(`${path.join('.')}:${it.id}`)); arr.forEach((it) => { const k = `${path.join('.')}:${it.id}`; if (anyOpen) state.collapsed.delete(k); else state.collapsed.add(k); }); rerender(); } }, 'Expand / collapse all') : null,
        arr.length ? h('button', { type: 'button', class: 'btn btn-sm btn-danger', html: svg('trash') + ' Remove all', onclick: () => { if (confirm(`Remove all ${arr.length} items from "${f.label}"?`)) { setPath(state.site, path, []); markDirty(); rerender(); } } }) : null,
      ));
    };
    rerender();
    return wrap;
  }

  function renderOrderList(f, path) {
    const wrap = h('div', { class: 'field' });
    const rerender = () => {
      const arr = getPath(state.site, path) || [];
      wrap.innerHTML = '';
      wrap.append(fieldLabel(f));
      const list = h('div', { class: 'order-list', style: 'display:grid;gap:6px' });
      arr.forEach((k, i) => {
        const sec = state.site[k];
        list.append(h('div', { class: 'row' }, h('span', { class: 'name' }, k), sec && sec.enabled === false ? h('span', { class: 'pill' }, 'section hidden') : null,
          h('button', { type: 'button', class: 'btn btn-icon', html: svg('up'), onclick: () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon', html: svg('down'), onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; markDirty(); rerender(); } } }),
          h('button', { type: 'button', class: 'btn btn-icon btn-danger', html: svg('trash'), onclick: () => { arr.splice(i, 1); markDirty(); rerender(); } })));
      });
      const missing = f.options.filter((o) => !arr.includes(o));
      const sel = h('select', {}, missing.map((o) => h('option', { value: o }, o)));
      wrap.append(list, missing.length ? h('div', { class: 'list-actions', style: 'margin-top:8px' }, sel, h('button', { type: 'button', class: 'btn btn-sm', html: svg('plus') + ' Add section', onclick: () => { arr.push(sel.value); setPath(state.site, path, arr); markDirty(); rerender(); } })) : null);
    };
    rerender();
    return wrap;
  }

  function renderBulkUpload(f, path) {
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
    const drop = h('div', { class: 'drop' }, h('div', { html: svg('upload') + ' <strong>Drop photos here</strong> or ' }), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => file.click() }, 'choose files'), h('div', { class: 'small' }, f.help || ''));
    const handle = async (files) => {
      if (!files.length) return;
      try {
        const urls = await uploadFiles(files);
        const arr = getPath(state.site, path) || [];
        urls.forEach((u, i) => arr.push({ id: uid('g'), image: u, caption: files[i] ? files[i].name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : '', category: '' }));
        setPath(state.site, path, arr); markDirty(); toast(`${urls.length} photo(s) added — remember to save`, 'ok');
        renderSection(state.section);
      } catch (err) { toast(err.message, 'err'); }
    };
    file.addEventListener('change', (e) => { handle(Array.from(e.target.files)); e.target.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith('image/'))); });
    return h('div', { class: 'field' }, fieldLabel(f), drop, file);
  }

  async function uploadFiles(files) {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    const res = await api('/upload', { method: 'POST', body: fd });
    state.uploads = null;
    return res.files.map((f) => f.url);
  }

  function openLibrary(onPick) {
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
    const grid = h('div', { class: 'media-grid' }, h('div', { class: 'muted' }, 'Loading…'));
    const modal = h('div', { class: 'modal' }, h('div', { class: 'mh' }, h('h3', {}, 'Media library'), h('button', { type: 'button', class: 'btn btn-sm', html: svg('x'), onclick: () => bg.remove() })), h('div', { class: 'mb' }, grid));
    bg.append(modal); document.body.append(bg);
    api('/uploads').then((r) => {
      grid.innerHTML = '';
      const property = ['/img/property/courtyard.jpg', '/img/property/suite-entrance.jpg', '/img/property/office.jpg', '/img/property/suite-king.jpg', '/img/property/suite-queen.jpg'].map((u) => ({ url: u, name: u.split('/').pop() }));
      const all = [...r.files, ...property];
      if (!all.length) grid.append(h('div', { class: 'muted' }, 'No uploads yet.'));
      all.forEach((f) => grid.append(h('div', { class: 'm', style: 'cursor:pointer', onclick: () => { onPick(f.url); bg.remove(); } }, h('div', { class: 'img', style: `background-image:url("${esc(f.url)}")` }), h('div', { class: 'nm', title: f.name }, f.name))));
    }).catch((e) => { grid.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; });
  }

  // ------------------------------------------------------------------ custom sections
  async function renderInquiries(container) {
    container.innerHTML = '<div class="muted">Loading…</div>';
    const r = await api('/inquiries');
    state.inquiries = r.inquiries;
    const unread = r.inquiries.filter((i) => !i.read).length;
    container.innerHTML = '';
    const card = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Inquiries (${r.inquiries.length})`), unread ? h('span', { class: 'pill' }, `${unread} unread`) : null, h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', html: svg('refresh') + ' Refresh', onclick: () => renderInquiries(container) }),
        r.inquiries.length ? h('button', { type: 'button', class: 'btn btn-sm btn-danger', html: svg('trash') + ' Clear all', onclick: async () => { if (confirm('Delete ALL inquiries?')) { await api('/inquiries', { method: 'DELETE' }); renderInquiries(container); updateBadges(); } } }) : null),
    );
    if (!r.inquiries.length) card.append(h('div', { class: 'card-body muted' }, 'No inquiries yet. Submissions from the contact form will show up here.'));
    else {
      const tbl = h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Received', 'Guest', 'Stay', 'Message', ''].map((t) => h('th', {}, t)))));
      r.inquiries.forEach((q) => {
        const stay = [q.room, q.checkin && q.checkout ? `${q.checkin} → ${q.checkout}` : (q.checkin || ''), q.guests ? `${q.guests} guest(s)` : '', q.rooms ? `${q.rooms} suite(s)` : ''].filter(Boolean).join(' · ');
        tbl.append(h('tr', { class: q.read ? '' : 'unread' },
          h('td', {}, new Date(q.receivedAt).toLocaleString()),
          h('td', {}, h('div', {}, h('strong', {}, q.name)), h('div', {}, h('a', { href: `mailto:${esc(q.email)}` }, q.email)), q.phone ? h('div', { class: 'muted' }, q.phone) : null),
          h('td', {}, stay || '—'),
          h('td', { style: 'white-space:pre-wrap;max-width:360px' }, q.message || '—'),
          h('td', { style: 'white-space:nowrap' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await api(`/inquiries/${q.id}`, { method: 'PATCH', body: { read: !q.read } }); renderInquiries(container); updateBadges(); } }, q.read ? 'Mark unread' : 'Mark read'), ' ',
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', html: svg('trash'), onclick: async () => { if (confirm('Delete this inquiry?')) { await api(`/inquiries/${q.id}`, { method: 'DELETE' }); renderInquiries(container); updateBadges(); } } })),
        ));
      });
      card.append(h('div', { style: 'overflow:auto' }, tbl));
    }
    container.append(card);
  }

  async function renderMedia(container) {
    container.innerHTML = '<div class="muted">Loading…</div>';
    const r = await api('/uploads');
    container.innerHTML = '';
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: async (e) => { try { await uploadFiles(e.target.files); toast('Uploaded', 'ok'); renderMedia(container); } catch (err) { toast(err.message, 'err'); } } });
    const grid = h('div', { class: 'media-grid' });
    r.files.forEach((f) => grid.append(h('div', { class: 'm' }, h('div', { class: 'img', style: `background-image:url("${esc(f.url)}")` }), h('div', { class: 'nm', title: f.name }, f.name),
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn btn-sm', title: 'Copy URL', html: svg('copy'), onclick: () => { navigator.clipboard.writeText(f.url).then(() => toast('URL copied', 'ok')); } }), h('a', { class: 'btn btn-sm', href: f.url, target: '_blank', html: svg('external') }),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', html: svg('trash'), onclick: async () => { if (confirm(`Delete ${f.name}? Pages still referencing it will show a broken image.`)) { await api(`/uploads/${encodeURIComponent(f.name)}`, { method: 'DELETE' }); renderMedia(container); } } })))));
    container.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Uploaded images (${r.files.length})`), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: svg('upload') + ' Upload', onclick: () => file.click() }), file),
      h('div', { class: 'card-body' }, h('div', { class: 'muted small' }, 'Files live in public/uploads/. Use the URL anywhere an image field accepts a link. Max 12 MB per image.'), r.files.length ? grid : h('div', { class: 'muted' }, 'Nothing uploaded yet.'))));
  }

  async function renderData(container) {
    container.innerHTML = '';
    const meta = state.meta = await api('/meta');
    const dsNote = state.site.meta && state.site.meta.dataset ? `Current dataset: ${state.site.meta.dataset}` : '';
    const reset = async (mode, label) => {
      if (!confirm(`${label}\n\nThis replaces ALL current content (a backup is kept under Backups). Continue?`)) return;
      try { const r = await api('/reset', { method: 'POST', body: { mode } }); state.site = r.site; state.dirty = false; renderStatus(); toast('Content replaced', 'ok'); renderData(container); } catch (e) { toast(e.message, 'err'); }
    };
    const secSel = h('select', {}, SECTIONS.filter((s) => s.path && s.path.length === 1).map((s) => h('option', { value: s.path[0] }, s.title)));
    const dsSel = h('select', {}, [h('option', { value: 'default' }, 'Default content (Budget Suites)'), h('option', { value: 'blank' }, 'Blank'), ...meta.samples.map((s) => h('option', { value: 'sample:' + s.id }, `Sample: ${s.hotelName || s.id}`))]);

    container.append(
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Load a dataset'), h('span', { class: 'spacer' }), dsNote ? h('span', { class: 'pill' }, dsNote) : null),
        h('div', { class: 'card-body' },
          h('div', { class: 'muted' }, 'Replace everything on the site with one of the bundled datasets. Use this to wipe the sample content before launch, or to restore it.'),
          h('div', { class: 'list-actions' },
            h('button', { type: 'button', class: 'btn', html: svg('refresh') + ' Restore default content', onclick: () => reset('default', 'Restore the default Budget Suites content?') }),
            ...meta.samples.map((s) => h('button', { type: 'button', class: 'btn', html: svg('sparkles') + ' Load sample: ' + esc(s.hotelName || s.id), title: s.note, onclick: () => reset('sample:' + s.id, `Load the sample dataset "${s.hotelName || s.id}"?`) })),
            h('button', { type: 'button', class: 'btn btn-danger', html: svg('trash') + ' Wipe everything (blank site)', onclick: () => reset('blank', 'Wipe ALL content and start from a blank template?') }),
          ),
          h('hr', { style: 'border:0;border-top:1px solid var(--line)' }),
          h('div', { class: 'muted' }, 'Or replace just one section:'),
          h('div', { class: 'list-actions' }, secSel, h('span', {}, 'from'), dsSel, h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { if (!confirm(`Replace the "${secSel.selectedOptions[0].text}" section?`)) return; try { const r = await api('/reset-section', { method: 'POST', body: { section: secSel.value, mode: dsSel.value } }); state.site = r.site; state.dirty = false; renderStatus(); toast('Section replaced', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Replace section')),
        )),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Export / import')),
        h('div', { class: 'card-body' },
          h('div', { class: 'list-actions' },
            h('a', { class: 'btn', href: '/admin/api/export', html: svg('download') + ' Download site.json', onclick: (e) => { e.preventDefault(); fetch('/admin/api/export', { headers: { 'X-Requested-With': 'fetch' } }).then((r) => r.blob()).then((b) => { const a = h('a', { href: URL.createObjectURL(b), download: `site-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(a); a.click(); a.remove(); }); } }),
            h('label', { class: 'btn', html: svg('upload') + ' Import site.json', style: 'cursor:pointer' }, h('input', { type: 'file', accept: 'application/json', class: 'hidden', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const json = JSON.parse(await f.text()); if (!confirm('Import this file and replace all current content?')) return; const r = await api('/import', { method: 'POST', body: json }); state.site = r.site; state.dirty = false; renderStatus(); toast('Imported', 'ok'); renderData(container); } catch (err) { toast(err.message, 'err'); } e.target.value = ''; } })),
          ),
          h('div', { class: 'muted small' }, `Live data file: ${esc(meta.dataDir)}/site.json — every save keeps a backup in ${esc(meta.dataDir)}/backups/ (last 30).`),
        )),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, `Backups (${meta.backups.length})`)),
        h('div', { class: 'card-body' }, meta.backups.length ? h('div', { style: 'overflow:auto' }, h('table', { class: 'tbl' }, h('tbody', {}, meta.backups.slice(0, 30).map((b) => h('tr', {}, h('td', { class: 'mono' }, b), h('td', { style: 'text-align:right' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { if (!confirm(`Restore ${b}? Current content will itself be backed up first.`)) return; try { const r = await api('/backups/restore', { method: 'POST', body: { name: b } }); state.site = r.site; state.dirty = false; renderStatus(); toast('Backup restored', 'ok'); renderData(container); } catch (e) { toast(e.message, 'err'); } } }, 'Restore'))))))) : h('div', { class: 'muted' }, 'No backups yet — one is created automatically each time you save.'))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Admin passphrase'), h('span', { class: 'spacer' }), h('span', { class: 'pill' }, `source: ${meta.passphraseSource}`)),
        h('div', { class: 'card-body' },
          meta.passphraseSource.startsWith('environment') ? h('div', { class: 'alert alert-info' }, 'The passphrase is set by the ADMIN_PASSPHRASE environment variable on the server and cannot be changed here.') : (() => {
            const cur = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current passphrase' });
            const next = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New passphrase (min 6 chars)' });
            const next2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat new passphrase' });
            return h('div', {}, h('div', { class: 'grid-3' }, h('div', { class: 'field' }, cur), h('div', { class: 'field' }, next), h('div', { class: 'field' }, next2)),
              h('div', { class: 'list-actions', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn btn-primary', html: svg('lock') + ' Change passphrase', onclick: async () => { if (next.value !== next2.value) return toast('New passphrases do not match', 'err'); try { await api('/passphrase', { method: 'POST', body: { current: cur.value, next: next.value } }); toast('Passphrase changed', 'ok'); cur.value = next.value = next2.value = ''; } catch (e) { toast(e.message, 'err'); } } }), h('span', { class: 'muted small' }, 'Forgot it? Delete data/admin.json on the server to go back to the default "hoteldemo".')));
          })(),
        )),
    );
  }

  // ------------------------------------------------------------------ SEO wizard
  // Client mirrors of src/seo.js constants/logic. Kept as exact copies (not re-derived) so the
  // patterns and validation shown here never drift from what actually ships. The authoritative
  // preview (title/description/JSON-LD/robots.txt) always comes from the server via /seo/preview —
  // these mirrors are only used for the title-pattern picker buttons and the analytics ID hints.
  const SEO_PAGE_KEYS = ['home', 'suites', 'amenities', 'dining', 'area', 'gallery', 'reviews', 'contact'];
  const SEO_PAGE_LABELS = { home: 'Home', suites: 'Suites & Rooms', amenities: 'Amenities', dining: 'Dining', area: 'Local Area', gallery: 'Gallery', reviews: 'Guest Reviews', contact: 'Contact' };
  const SEO_SCHEMA_TYPES = ['Hotel', 'Motel', 'LodgingBusiness', 'BedAndBreakfast', 'Hostel', 'Resort', 'Campground'];
  const SEO_TITLE_MAX = 60, SEO_DESC_MAX = 160;
  const SEO_GA_RE = /^G-[A-Z0-9]{4,}$/i, SEO_GTM_RE = /^GTM-[A-Z0-9]{4,}$/i, SEO_PIXEL_RE = /^\d{6,}$/, SEO_CLARITY_RE = /^[a-z0-9]{6,}$/i;
  // Title patterns observed on pages that currently rank for "extended stay hotel <city>" queries —
  // same annotated list used server-side in src/seo.js (HOME_TITLE_TEMPLATES / PAGE_TITLE_TEMPLATES).
  const SEO_HOME_TEMPLATES = [
    { tpl: '{category} in {city}, {state} | {hotel}', note: 'Category first, then location, then name (WoodSpring pattern)' },
    { tpl: '{city}, {state} {category}', note: 'Location + category only (InTown Suites pattern)' },
    { tpl: '{hotel} | {category} with {amenity}', note: 'Name, then category and a key amenity (Residence Inn pattern)' },
    { tpl: '{city}, {state} - {hotel} | {brand}', note: 'Location, property, brand (Extended Stay America pattern)' },
    { tpl: '{hotel} – {city}, {state}', note: 'Simple: name and location' },
    { tpl: '{hotel} | {category} in {city}, {state}', note: 'Name first, then category and location' },
  ];
  const SEO_PAGE_TEMPLATES = [
    { tpl: '{page} | {hotel}', note: 'Page name, then hotel name' },
    { tpl: '{page} – {hotel} {city}, {state}', note: 'Page name, hotel and location' },
    { tpl: '{page} | {hotel} – {city}', note: 'Page name, hotel, city' },
    { tpl: '{page} at {hotel} | {category} in {city}, {state}', note: 'Long form with category' },
  ];

  function seoFullName(g) { return [g.hotelName, g.locationLine].filter(Boolean).join(' '); }
  function seoTemplateVars(site) {
    const g = site.general, sd = site.seo, a = g.address || {};
    const s = (v) => (v == null ? '' : String(v).trim());
    return { hotel: s(g.hotelName), site: s(sd.title) || seoFullName(g), brand: s(g.brandLine) || s(g.logoText) || s(g.hotelName), city: s(a.city), state: s(a.state), zip: s(a.zip), category: s(sd.category) || 'Hotel', amenity: s(sd.keyAmenity), tagline: s(g.tagline), phone: s(g.phone), page: '' };
  }
  function seoRenderTemplate(tpl, vars) {
    let out = String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
    out = out.replace(/\s*(\||–|—|-|·)\s*(\||–|—|-|·)\s*/g, ' $1 ').replace(/^\s*(\||–|—|-|·|,|:)\s*/g, '').replace(/\s*(\||–|—|-|·|,|:)\s*$/g, '').replace(/\s+,/g, ',').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\bin\s*,/g, 'in').replace(/\s+with\s*$/, '').trim();
    return out;
  }

  const seoState = { step: 'basics', page: 'home', container: null, lastSuggestions: null };

  async function seoPreview(pageKey) {
    return api('/seo/preview', { method: 'POST', body: { site: state.site, page: pageKey } });
  }

  function seoCounterEl() { return h('span', { class: 'char-counter' }); }
  function seoUpdateCounter(el, n, max) {
    el.textContent = `${n} / ${max} characters`;
    el.className = 'char-counter ' + (n === 0 ? '' : n > max ? 'over' : n > max * 0.85 ? 'warn' : 'ok');
  }

  function seoPatternPicker(templates, templatePath, previewPage) {
    const wrap = h('div', { class: 'seo-pattern-list' });
    const vars = seoTemplateVars(state.site);
    if (previewPage) vars.page = previewPage;
    const current = getPath(state.site, templatePath);
    templates.forEach((t) => {
      const text = seoRenderTemplate(t.tpl, vars);
      wrap.append(h('button', { type: 'button', class: 'seo-pattern' + (current === t.tpl ? ' active' : ''),
        onclick: () => { setPath(state.site, templatePath, t.tpl); markDirty(); renderSeo(seoState.container); } },
        h('div', { class: 'seo-pattern-text' }, text || '(fill in hotel name / city / state to preview)'),
        h('div', { class: 'seo-pattern-note' }, t.note),
      ));
    });
    return wrap;
  }

  function seoJump(stepId) {
    return (e) => { if (e) e.preventDefault(); seoState.step = stepId; renderSeo(seoState.container); };
  }

  // ---- step: Basics
  function renderSeoBasics(body) {
    const base = ['seo'];
    const nodes = [
      h('div', { class: 'grid-2' },
        renderField(F.text('siteUrl', 'Site URL (canonical)', { help: 'The exact URL the live site will use once hosted, e.g. https://hoteldemo1.signaturediversified.com' }), base),
        renderField(F.text('category', 'Business category phrase', { help: 'Used in title templates the way top-ranking hotel pages do, e.g. "Extended Stay Hotel"' }), base),
      ),
      renderField(F.text('keyAmenity', 'Key amenity to highlight in titles', { help: 'A short phrase, e.g. "Weekly & Monthly Rates"' }), base),
      h('div', { class: 'grid-2' },
        renderField(F.text('title', 'Fallback browser/SEO title', { help: 'Used only where no page template or override applies' }), base),
        renderField(F.img('ogImage', 'Default social share image', { help: 'Used when a page has no image of its own. Recommended 1200×630.' }), base),
      ),
      renderField(F.area('description', 'Fallback meta description'), base),
      renderField(F.img('favicon', 'Favicon'), base),
      h('div', { class: 'field' },
        h('label', {}, 'Home page title pattern'),
        h('div', { class: 'help' }, 'Patterns seen on pages that currently rank for "extended stay hotel <city>" searches. Click one to use it for the home page.'),
        seoPatternPicker(SEO_HOME_TEMPLATES, [...base, 'homeTitleTemplate']),
      ),
      h('div', { class: 'field' },
        h('label', {}, 'Other pages title pattern'),
        h('div', { class: 'help' }, 'Applies to every page except the home page (Suites, Amenities, Dining, etc.) unless that page has its own title override.'),
        seoPatternPicker(SEO_PAGE_TEMPLATES, [...base, 'pageTitleTemplate'], 'Amenities'),
      ),
      renderField(F.strings('keywords', 'Target keywords', { help: 'Phrases you want to rank for — the audit checks that these appear in your titles and descriptions.' }), base),
      renderField(F.bool('metaKeywords', 'Also output a <meta name="keywords"> tag', { help: 'Most search engines ignore this tag today; harmless to leave on.' }), base),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Pages & Previews
  function renderSeoPages(body) {
    const wrap = h('div', { class: 'card-body' });
    const pageSel = h('select', {}, SEO_PAGE_KEYS.map((k) => h('option', { value: k, selected: k === seoState.page }, SEO_PAGE_LABELS[k])));
    const serpBox = h('div', { class: 'serp' }, h('div', { class: 'muted small' }, 'Loading preview…'));
    const titleCounter = seoCounterEl(), descCounter = seoCounterEl();
    const fieldsBox = h('div', { class: 'seo-page-fields' });
    let timer;
    const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 450); };

    async function refresh() {
      try {
        const r = await seoPreview(seoState.page);
        seoState.lastSuggestions = r.suggestions;
        serpBox.innerHTML = '';
        serpBox.append(
          h('div', { class: 'serp-url' }, r.meta.canonical || `${r.meta.base || ''}${r.meta.path}`),
          h('div', { class: 'serp-title' }, r.meta.title),
          r.meta.description ? h('div', { class: 'serp-desc' }, r.meta.description) : h('div', { class: 'serp-desc muted' }, '(no description set — search engines will pick their own excerpt)'),
          r.meta.noindex ? h('span', { class: 'pill', style: 'margin-top:6px;display:inline-block' }, 'noindex — hidden from search results') : null,
        );
        seoUpdateCounter(titleCounter, r.meta.title.length, SEO_TITLE_MAX);
        seoUpdateCounter(descCounter, r.meta.description.length, SEO_DESC_MAX);
      } catch (e) {
        serpBox.innerHTML = ''; serpBox.append(h('div', { class: 'alert alert-error' }, e.message));
      }
    }

    function renderFieldsForPage() {
      fieldsBox.innerHTML = '';
      const base = ['seo', 'pages', seoState.page];
      const descField = renderField(F.area('description', 'Description override', { help: 'Leave blank to fall back to this page\'s intro text, then the global description' }), base);
      descField.append(h('div', { class: 'list-actions', style: 'margin-top:6px' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
          const sug = seoState.lastSuggestions;
          const text = sug && sug.descriptions && sug.descriptions[seoState.page];
          if (!text) { toast('No suggestion available yet for this page', 'err'); return; }
          setPath(state.site, [...base, 'description'], text);
          markDirty(); renderFieldsForPage(); scheduleRefresh();
        } }, 'Use suggested description'),
      ));
      fieldsBox.append(
        h('div', { class: 'grid-2' },
          renderField(F.text('title', 'Title override', { help: 'Leave blank to use the title pattern set under Basics' }), base),
          renderField(F.img('ogImage', 'Social image override', { help: 'Leave blank to use the site-wide social image' }), base),
        ),
        descField,
        renderField(F.bool('noindex', 'Hide this page from search engines (noindex)'), base),
      );
    }

    pageSel.addEventListener('change', () => { seoState.page = pageSel.value; renderFieldsForPage(); refresh(); });
    wrap.addEventListener('input', scheduleRefresh);
    wrap.addEventListener('change', (e) => { if (e.target !== pageSel) scheduleRefresh(); });

    renderFieldsForPage();
    wrap.append(
      h('div', { class: 'field' }, h('label', {}, 'Page to preview & edit'), pageSel),
      h('div', { class: 'card', style: 'margin:0' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Live search result preview'), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-sm', html: svg('refresh') + ' Refresh', onclick: refresh })),
        h('div', { class: 'card-body' }, serpBox, h('div', { class: 'seo-metrics' }, titleCounter, descCounter)),
      ),
      fieldsBox,
    );
    body.append(wrap);
    refresh();
  }

  // ---- step: Social Cards
  function renderSeoSocial(body) {
    const base = ['seo', 'social'];
    const previewBox = h('div', { class: 'serp' }, h('div', { class: 'muted small' }, 'Click "Preview card" to see how a shared link will look.'));
    const nodes = [
      h('div', { class: 'grid-2' },
        renderField(F.sel('ogType', 'Open Graph type', [['website', 'Website'], ['article', 'Article'], ['product', 'Product']]), base),
        renderField(F.text('ogLocale', 'Open Graph locale', { help: 'e.g. en_US' }), base),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.sel('twitterCard', 'Twitter/X card style', [['summary_large_image', 'Large image'], ['summary', 'Small summary']]), base),
        renderField(F.text('twitterSite', 'Twitter/X @handle', { help: 'e.g. @yourhotel' }), base),
      ),
      renderField(F.text('fbAppId', 'Facebook App ID', { help: 'Optional — only needed if you use Facebook Insights for this site' }), base),
      h('div', { class: 'card', style: 'margin:0' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Social share card preview'), h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: svg('refresh') + ' Preview card', onclick: async () => {
            try {
              const r = await seoPreview('home');
              previewBox.innerHTML = '';
              previewBox.append(
                r.meta.ogImage ? h('div', { class: 'thumb', style: 'width:100%;height:160px;margin-bottom:8px' }, h('img', { src: r.meta.ogImage, alt: '', style: 'width:100%;height:100%;object-fit:cover;border-radius:8px' })) : null,
                h('div', { class: 'serp-url' }, (r.meta.base || '').replace(/^https?:\/\//, '')),
                h('div', { class: 'serp-title' }, r.meta.title),
                h('div', { class: 'serp-desc' }, r.meta.description),
              );
            } catch (e) { toast(e.message, 'err'); }
          } })),
        h('div', { class: 'card-body' }, previewBox)),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Structured Data
  function renderSeoSchema(body) {
    const base = ['seo', 'schema'];
    const jsonBox = h('pre', { class: 'seo-jsonld' }, 'Click "Preview structured data" to see it.');
    const nodes = [
      renderField(F.bool('enabled', 'Output structured data (JSON-LD)', { help: 'Turning this off removes all schema.org markup from every page.' }), base),
      h('div', { class: 'grid-2' },
        renderField(F.sel('type', 'Business type', SEO_SCHEMA_TYPES), base),
        renderField(F.text('priceRange', 'Price range', { help: 'e.g. "$" — shown in Google\'s knowledge panel' }), base),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.num('numberOfRooms', 'Number of rooms'), base),
        renderField(F.sel('petsAllowed', 'Pets allowed', [['', 'Not set'], ['true', 'Yes'], ['false', 'No']]), base),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.text('openingHours', 'Office hours', { help: 'schema.org format, e.g. Mo-Su 00:00-23:59' }), base),
        renderField(F.text('paymentAccepted', 'Payment methods accepted', { help: 'e.g. "Cash, Credit Card"' }), base),
      ),
      renderField(F.text('slogan', 'Slogan'), base),
      renderField(F.strings('amenityFeatures', 'Amenity features override', { help: 'Leave empty to use the amenities already listed on the site' }), base),
      renderField(F.strings('sameAs', 'Other official profile links', { help: 'Google Business Profile, TripAdvisor, etc. — also pulled automatically from Footer → Social links' }), base),
      renderField(F.text('googleBusinessUrl', 'Google Business Profile URL'), base),
      h('div', { class: 'grid-3' },
        renderField(F.bool('faq', 'Include FAQ schema'), base),
        renderField(F.bool('breadcrumbs', 'Include breadcrumb schema'), base),
        renderField(F.bool('rooms', 'Include room/offer schema'), base),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.bool('website', 'Include website schema'), base),
        renderField(F.bool('reviews', 'Include review ratings in schema'), base),
      ),
      h('div', { class: 'alert alert-warn' }, 'Google does not display star ratings for reviews a business publishes about itself on its own site. If "Include review ratings" is on, Google may simply ignore it — collect reviews on your Google Business Profile instead for ratings that can show in search results.'),
      h('div', { class: 'card', style: 'margin:0' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Structured data preview'), h('span', { class: 'spacer' }),
          h('a', { class: 'btn btn-sm', href: 'https://search.google.com/test/rich-results', target: '_blank', rel: 'noopener', html: svg('external') + ' Google Rich Results Test' }),
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: svg('refresh') + ' Preview structured data', onclick: async () => {
            try { const r = await seoPreview('home'); jsonBox.textContent = JSON.stringify(r.jsonLd, null, 2); } catch (e) { toast(e.message, 'err'); }
          } })),
        h('div', { class: 'card-body' }, jsonBox)),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Local SEO
  function renderSeoLocal(body) {
    const base = ['seo', 'local'];
    const g = state.site.general, a = g.address || {};
    const nap = [seoFullName(g), [a.street, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '), g.phone].filter(Boolean);
    const area = state.site.area || {};
    const nodes = [
      h('div', { class: 'alert alert-info' },
        h('strong', {}, 'NAP (Name, Address, Phone): '), nap.join(' · ') || 'Fill in General & Contact Info first.',
        h('div', { class: 'small', style: 'margin-top:4px' }, 'Keep this exact wording consistent everywhere the hotel is listed online (Google Business Profile, Yelp, TripAdvisor, directories) — inconsistent NAP hurts local rankings.'),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.text('geoRegion', 'Geo region code', { help: 'ISO 3166-2 code, e.g. US-AZ' }), base),
        renderField(F.text('geoPlacename', 'Geo place name', { help: 'e.g. Mesa, Arizona' }), base),
      ),
      renderField(F.strings('serviceAreas', 'Service areas', { help: 'Cities/areas you serve — used as areaServed in structured data' }), base),
      h('div', { class: 'alert', style: 'background:#f9fafb;border:1px solid var(--line)' },
        `Map coordinates: ${area.latitude && area.longitude ? `${area.latitude}, ${area.longitude}` : 'not set'}. `,
        h('a', { href: '#area' }, 'Edit under Local Area →'),
      ),
      h('div', { class: 'alert', style: 'background:#f9fafb;border:1px solid var(--line)' },
        'Google Business Profile URL is set under Structured Data. ',
        h('a', { href: '#', onclick: seoJump('schema') }, 'Edit there →'),
      ),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Search Engines
  function renderSeoSearch(body) {
    const robotsBox = h('pre', { class: 'seo-jsonld' }, 'Click "Preview" to see the generated robots.txt and sitemap size.');
    const nodes = [
      h('div', { class: 'grid-2' },
        renderField(F.bool('index', 'Allow search engines to index this site'), ['seo', 'robots']),
        renderField(F.bool('follow', 'Allow search engines to follow links'), ['seo', 'robots']),
      ),
      renderField(F.code('custom', 'Custom robots.txt (advanced)', { help: 'Completely replaces the generated robots.txt below. Leave blank to use the generated version.' }), ['seo', 'robots']),
      h('div', { class: 'grid-3' },
        renderField(F.bool('enabled', 'Enable sitemap.xml'), ['seo', 'sitemap']),
        renderField(F.bool('includeRooms', 'Include suite pages in sitemap'), ['seo', 'sitemap']),
        renderField(F.sel('changefreq', 'Change frequency', ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']), ['seo', 'sitemap']),
      ),
      h('div', { class: 'grid-3' },
        renderField(F.num('priorityHome', 'Priority: home (0–1)', { step: 0.1, min: 0, max: 1 }), ['seo', 'sitemap']),
        renderField(F.num('priorityPages', 'Priority: other pages (0–1)', { step: 0.1, min: 0, max: 1 }), ['seo', 'sitemap']),
        renderField(F.num('priorityRooms', 'Priority: suite pages (0–1)', { step: 0.1, min: 0, max: 1 }), ['seo', 'sitemap']),
      ),
      h('div', { class: 'grid-2' },
        renderField(F.text('google', 'Google Search Console verification code', { help: 'Paste just the content value of the HTML-tag verification Search Console gives you' }), ['seo', 'verification']),
        renderField(F.text('bing', 'Bing Webmaster Tools verification code'), ['seo', 'verification']),
      ),
      h('div', { class: 'grid-3' },
        renderField(F.text('pinterest', 'Pinterest verification code'), ['seo', 'verification']),
        renderField(F.text('yandex', 'Yandex verification code'), ['seo', 'verification']),
        renderField(F.text('facebookDomain', 'Facebook domain verification code'), ['seo', 'verification']),
      ),
      h('div', { class: 'list-actions' },
        h('a', { class: 'btn btn-sm', href: 'https://search.google.com/search-console', target: '_blank', rel: 'noopener', html: svg('external') + ' Google Search Console' }),
        h('a', { class: 'btn btn-sm', href: 'https://www.bing.com/webmasters', target: '_blank', rel: 'noopener', html: svg('external') + ' Bing Webmaster Tools' }),
      ),
      h('div', { class: 'card', style: 'margin:0' },
        h('div', { class: 'card-head' }, h('h2', {}, 'robots.txt & sitemap preview'), h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: svg('refresh') + ' Preview', onclick: async () => {
            try { const r = await seoPreview('home'); robotsBox.textContent = `${r.robotsTxt}\n— sitemap.xml will list ${r.sitemapCount} URL(s) —`; } catch (e) { toast(e.message, 'err'); }
          } })),
        h('div', { class: 'card-body' }, robotsBox)),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Analytics
  function renderSeoAnalytics(body) {
    const base = ['seo', 'analytics'];
    const an = state.site.seo.analytics || {};
    const hint = (val, re, example) => h('div', { class: 'small', style: `margin-top:-2px;color:${val ? (re.test(val) ? 'var(--ok)' : 'var(--danger)') : 'var(--muted)'}` }, val ? (re.test(val) ? '✓ looks valid' : `Doesn't look right — expected something like ${example}`) : `Expected format: ${example}`);
    const nodes = [
      h('div', { class: 'grid-2' },
        h('div', {}, renderField(F.text('ga4', 'Google Analytics 4 Measurement ID'), base), hint(an.ga4, SEO_GA_RE, 'G-XXXXXXX')),
        h('div', {}, renderField(F.text('gtm', 'Google Tag Manager container ID'), base), hint(an.gtm, SEO_GTM_RE, 'GTM-XXXXXXX')),
      ),
      h('div', { class: 'grid-2' },
        h('div', {}, renderField(F.text('metaPixel', 'Meta (Facebook) Pixel ID'), base), hint(an.metaPixel, SEO_PIXEL_RE, 'a numeric ID, 6+ digits')),
        h('div', {}, renderField(F.text('clarity', 'Microsoft Clarity project ID'), base), hint(an.clarity, SEO_CLARITY_RE, 'a 6+ character project ID')),
      ),
      renderField(F.code('bodyEndHtml', 'Custom HTML before </body>'), base),
      renderField(F.code('customHeadHtml', 'Custom <head> HTML (advanced)', { help: 'Raw HTML injected into every page\'s <head> — extra verification tags, scripts, etc.' }), ['seo']),
    ];
    body.append(h('div', { class: 'card-body' }, nodes));
  }

  // ---- step: Hosting & Redirects
  function renderSeoHosting(body) {
    const nodes = [
      h('div', { class: 'alert', style: 'background:#f9fafb;border:1px solid var(--line)' },
        `Site URL is set under Basics: `, h('strong', {}, state.site.seo.siteUrl || '(not set)'), ' ',
        h('a', { href: '#', onclick: seoJump('basics') }, 'Edit there →'),
      ),
      h('div', { class: 'grid-3' },
        renderField(F.bool('forceHttps', 'Force HTTPS', { help: 'Only turn on once the domain has a working SSL certificate — otherwise this can create a redirect loop.' }), ['seo', 'hosting']),
        renderField(F.bool('enforceCanonicalHost', 'Enforce canonical host', { help: 'Redirects any other hostname pointed at this server to the exact host in Site URL (e.g. www → bare domain, or vice versa).' }), ['seo', 'hosting']),
        renderField(F.bool('trailingSlashRedirect', 'Remove trailing slashes', { help: '/suites/ → /suites, avoiding duplicate-content issues.' }), ['seo', 'hosting']),
      ),
      renderField(F.list('redirects', 'Redirect rules', [
        { type: 'row', fields: [F.text('from', 'From path', { help: '/old-page' }), F.text('to', 'To path or URL', { help: '/new-page' })] },
        F.sel('type', 'Type', [['301', '301 – Permanent'], ['302', '302 – Temporary']]),
      ], { itemLabel: 'from', template: { from: '/old-page', to: '/new-page', type: '301' } }), ['seo']),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Pointing a GoDaddy domain here')),
        h('div', { class: 'card-body' },
          h('div', {}, 'GoDaddy currently exposes DNS under: your Domain Portfolio → select the domain → ', h('strong', {}, 'Domain Settings'), ' → ', h('strong', {}, 'DNS'), ' tab → ', h('strong', {}, 'Add New Record'), '. Menu wording can change — GoDaddy\'s own help center is the source of truth if this looks different.'),
          h('ul', { style: 'margin:0;padding-left:20px' },
            h('li', {}, h('strong', {}, 'A record'), ' (host "@") pointing at this server\'s public IP address is the usual way to connect a domain directly to a server.'),
            h('li', {}, 'If this site is hosted through a platform that gives you a hostname instead of an IP, use a ', h('strong', {}, 'CNAME'), ' record instead (usually on the "www" host, since the root domain cannot be a CNAME).'),
          ),
          h('div', { class: 'alert alert-warn' }, h('strong', {}, 'Domain forwarding and DNS records are two different mechanisms and should not both be set for the same hostname.'), ' Forwarding redirects visitors at the registrar before DNS is even consulted; an A/CNAME record points DNS directly at a server. Having both active for the same domain typically means only one of them actually takes effect, which shows up as the site not loading or loading the wrong thing. Use DNS records (A/CNAME) to point the domain at this server, not forwarding.'),
          h('div', {}, 'Once DNS is live and the exact final domain is known, set it as the ', h('strong', {}, 'Site URL'), ' under Basics — every canonical link, sitemap entry and piece of structured data is built from that one field. Verify ownership with the codes under Search Engines once the domain resolves here, then only turn on Force HTTPS / Enforce canonical host after confirming the site loads correctly over https on the final domain.'),
          h('div', { class: 'list-actions', style: 'margin-top:10px' },
            h('a', { class: 'btn btn-sm', href: 'https://www.godaddy.com/help/manage-dns-680', target: '_blank', rel: 'noopener', html: svg('external') + ' GoDaddy: Manage DNS records' }),
          ),
        )),
    ];
    body.append(h('div', { class: 'card-body' }, nodes.filter(Boolean)));
  }

  // ---- step: Audit & Score
  function seoScoreRing(score) {
    const r = 46, c = 2 * Math.PI * r;
    const color = score >= 80 ? 'var(--ok)' : score >= 50 ? '#b45309' : 'var(--danger)';
    return h('svg', { viewBox: '0 0 110 110', style: 'width:110px;height:110px' },
      (() => { const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); bg.setAttribute('cx', 55); bg.setAttribute('cy', 55); bg.setAttribute('r', r); bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#e5e7eb'); bg.setAttribute('stroke-width', 10); return bg; })(),
      (() => { const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); fg.setAttribute('cx', 55); fg.setAttribute('cy', 55); fg.setAttribute('r', r); fg.setAttribute('fill', 'none'); fg.setAttribute('stroke', color); fg.setAttribute('stroke-width', 10); fg.setAttribute('stroke-linecap', 'round'); fg.setAttribute('stroke-dasharray', `${(score / 100) * c} ${c}`); fg.setAttribute('transform', 'rotate(-90 55 55)'); return fg; })(),
      (() => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', 55); t.setAttribute('y', 62); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '28'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', color); t.textContent = String(score); return t; })(),
    );
  }

  function seoStatusIcon(status) {
    const map = { pass: ['check', 'var(--ok)'], warn: ['alert', '#b45309'], fail: ['x', 'var(--danger)'], info: ['help', 'var(--muted)'] };
    const [name, color] = map[status] || map.info;
    return h('span', { style: `color:${color};display:inline-flex`, html: svg(name) });
  }

  function renderSeoAudit(body) {
    const resultBox = h('div', {});
    const runBtn = h('button', { type: 'button', class: 'btn btn-primary', html: svg('refresh') + ' Run audit', onclick: run });
    body.append(h('div', { class: 'card-body' },
      h('div', {}, 'Fetches every live page on this server and grades it the way search engines see it — titles, descriptions, headings, structured data, robots.txt, sitemap, local SEO and analytics setup.'),
      h('div', { class: 'list-actions' }, runBtn),
      resultBox,
    ));

    async function run() {
      runBtn.disabled = true; runBtn.innerHTML = svg('refresh') + ' Running…';
      resultBox.innerHTML = '';
      try {
        const r = await api('/seo/audit');
        seoState.lastAudit = r;
        renderResult(r);
      } catch (e) {
        resultBox.append(h('div', { class: 'alert alert-error' }, e.message));
      } finally {
        runBtn.disabled = false; runBtn.innerHTML = svg('refresh') + ' Run audit again';
      }
    }

    function renderResult(r) {
      resultBox.innerHTML = '';
      resultBox.append(
        h('div', { class: 'card', style: 'margin:0' }, h('div', { class: 'card-body' },
          h('div', { style: 'display:flex;align-items:center;gap:24px;flex-wrap:wrap' },
            seoScoreRing(r.score),
            h('div', {},
              h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
                h('span', { class: 'pill ok' }, `${r.summary.pass} pass`),
                h('span', { class: 'pill', style: 'background:#fef3c7;color:#92400e' }, `${r.summary.warn} warn`),
                h('span', { class: 'pill', style: 'background:#fee2e2;color:#991b1b' }, `${r.summary.fail} fail`),
              ),
              h('div', { class: 'muted small', style: 'margin-top:6px' }, `Checked ${new Date(r.generatedAt).toLocaleString()} against ${r.base || '(no site URL set)'}`),
            ),
          ))),
      );
      r.groups.forEach((g) => {
        resultBox.append(h('div', { class: 'card', style: 'margin-top:14px' },
          h('div', { class: 'card-head' }, h('h2', {}, g.title)),
          h('div', { class: 'card-body seo-checks' }, g.checks.map((c) => h('div', { class: `seo-check ${c.status}` },
            seoStatusIcon(c.status),
            h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:600' }, c.label), h('div', { class: 'muted small' }, c.detail)),
            c.step ? h('button', { type: 'button', class: 'btn btn-sm', onclick: seoJump(c.step) }, 'Fix') : null,
          ))),
        ));
      });
      if (r.pages && r.pages.length) {
        const tbl = h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['Page', 'Status', 'Title', 'Description', 'H1', 'Images w/o alt', 'Issues'].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.pages.map((pg) => h('tr', {},
            h('td', {}, h('div', {}, h('strong', {}, pg.label)), h('div', { class: 'mono small muted' }, pg.path)),
            h('td', {}, pg.status === 200 ? h('span', { class: 'pill ok' }, '200') : h('span', { class: 'pill', style: 'background:#fee2e2;color:#991b1b' }, String(pg.status))),
            h('td', {}, h('div', {}, pg.title || '—'), h('div', { class: `char-counter ${pg.titleLen > SEO_TITLE_MAX ? 'over' : 'ok'}` }, `${pg.titleLen} chars`)),
            h('td', {}, h('div', { style: 'max-width:240px' }, pg.description || '—'), h('div', { class: `char-counter ${pg.descLen > SEO_DESC_MAX || (pg.descLen && pg.descLen < 70) ? 'warn' : 'ok'}` }, `${pg.descLen} chars`)),
            h('td', {}, pg.h1),
            h('td', {}, pg.imgsNoAlt || 0),
            h('td', {}, pg.issues.length ? h('ul', { style: 'margin:0;padding-left:16px' }, pg.issues.map((i) => h('li', { class: 'small' }, i.msg))) : h('span', { class: 'muted small' }, 'none')),
          ))),
        );
        resultBox.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'card-head' }, h('h2', {}, `Pages (${r.pages.length})`)), h('div', { style: 'overflow:auto' }, tbl)));
      }
    }

    if (seoState.lastAudit) renderResult(seoState.lastAudit);
  }

  const SEO_STEPS = [
    { id: 'basics', label: 'Basics', icon: 'search', render: renderSeoBasics },
    { id: 'pages', label: 'Pages & Previews', icon: 'layout', render: renderSeoPages },
    { id: 'social', label: 'Social Cards', icon: 'tag', render: renderSeoSocial },
    { id: 'schema', label: 'Structured Data', icon: 'code', render: renderSeoSchema },
    { id: 'local', label: 'Local SEO', icon: 'map', render: renderSeoLocal },
    { id: 'search', label: 'Search Engines', icon: 'globe', render: renderSeoSearch },
    { id: 'analytics', label: 'Analytics', icon: 'chart', render: renderSeoAnalytics },
    { id: 'hosting', label: 'Hosting & Redirects', icon: 'upload', render: renderSeoHosting },
    { id: 'audit', label: 'Audit & Score', icon: 'alert', render: renderSeoAudit },
  ];

  function renderSeo(container) {
    seoState.container = container;
    container.innerHTML = '';
    const step = SEO_STEPS.find((s) => s.id === seoState.step) || SEO_STEPS[0];
    const tabs = h('div', { class: 'seo-tabs' }, SEO_STEPS.map((s) => h('button', { type: 'button', class: 'seo-tab' + (s.id === step.id ? ' active' : ''), onclick: () => { seoState.step = s.id; renderSeo(container); } }, h('span', { html: svg(s.icon) }), h('span', {}, s.label))));
    const body = h('div', {});
    container.append(h('div', { class: 'seo-wizard' }, tabs, h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'card-head' }, h('h2', {}, step.label)), body)));
    step.render(body);
  }

  // ------------------------------------------------------------------ shell & routing
  function renderShell() {
    const app = $('#app');
    app.innerHTML = '';
    const groups = [...new Set(SECTIONS.map((s) => s.group))];
    const sidebar = h('aside', { class: 'sidebar' },
      h('div', { class: 'brand', html: svg('building') + `<span>${esc(state.site.general.hotelName || 'Hotel')}<small>Site admin</small></span>` }),
      groups.map((g) => [h('div', { class: 'group' }, g), SECTIONS.filter((s) => s.group === g).map((s) => h('a', { class: 'nav', href: '#' + s.id, dataset: { nav: s.id }, html: svg(s.icon) + `<span>${esc(s.title)}</span>` + (s.id === 'inquiries' ? '<span class="badge hidden" data-inq-badge></span>' : '') }))]),
      h('div', { class: 'foot' },
        h('a', { class: 'btn', href: '/', target: '_blank', html: svg('external') + ' View website' }),
        h('form', { method: 'post', action: '/admin/logout' }, h('button', { type: 'submit', class: 'btn btn-block', html: svg('logout') + ' Sign out' }))),
    );
    const mobileSel = h('select', { onchange: (e) => { window.location.hash = e.target.value; } }, SECTIONS.map((s) => h('option', { value: s.id }, `${s.group} · ${s.title}`)));
    const main = h('div', { class: 'main' },
      h('div', { class: 'mobile-nav' }, mobileSel),
      h('div', { class: 'topbar' }, h('h1', { dataset: { title: '' } }, ''), h('div', { class: 'status' }, h('span', { dataset: { dirty: '' } }), h('button', { type: 'button', class: 'btn btn-primary', dataset: { save: '' }, html: svg('save') + ' Save changes', onclick: save }))),
      h('div', { class: 'content', dataset: { content: '' } }),
    );
    app.append(h('div', { class: 'shell' }, sidebar, main));
    updateBadges();
  }

  function renderStatus() {
    const d = $('[data-dirty]'); const b = $('[data-save]');
    if (!d || !b) return;
    d.innerHTML = state.dirty ? '<span class="dirty">● Unsaved changes</span>' : `<span>Saved${state.site.meta && state.site.meta.updatedAt ? ' · ' + new Date(state.site.meta.updatedAt).toLocaleString() : ''}</span>`;
    b.disabled = !state.dirty;
  }

  async function updateBadges() {
    try {
      const r = await api('/inquiries');
      const n = r.inquiries.filter((i) => !i.read).length;
      const badge = $('[data-inq-badge]');
      if (badge) { badge.textContent = n; badge.classList.toggle('hidden', !n); }
    } catch (_) { /* ignore */ }
  }

  function renderSection(id) {
    const sec = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
    state.section = sec.id;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === sec.id));
    const ms = $('.mobile-nav select'); if (ms) ms.value = sec.id;
    $('[data-title]').textContent = sec.title;
    const content = $('[data-content]');
    content.innerHTML = '';
    if (sec.custom === 'inquiries') return renderInquiries(content);
    if (sec.custom === 'media') return renderMedia(content);
    if (sec.custom === 'data') return renderData(content);
    if (sec.custom === 'seo') return renderSeo(content);
    const body = h('div', { class: 'card-body' }, sec.fields.map((f) => renderField(f, sec.path)));
    content.append(h('div', { class: 'card' }, body));
    renderStatus();
  }

  // delegated input binding
  function coerce(type, el) {
    if (type === 'boolean') return el.checked;
    if (type === 'number') return el.value === '' ? 0 : Number(el.value);
    return el.value;
  }
  document.addEventListener('input', onEdit);
  document.addEventListener('change', onEdit);
  function onEdit(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    if (e.type === 'input' && el.type === 'checkbox') return; // handled on change
    const path = JSON.parse(el.dataset.path);
    setPath(state.site, path, coerce(el.dataset.type, el));
    markDirty();
    // keep list item titles / enabled state in sync
    let li = el.closest('.list-item');
    while (li) {
      if (li.dataset.itemPath === JSON.stringify(path.slice(0, -1))) {
        const key = path[path.length - 1];
        if (key === li.dataset.labelKey) { const t = li.querySelector(':scope > .li-head .title'); if (t) t.textContent = el.value || t.dataset.fallback || ''; }
        if (key === 'enabled' && el.type === 'checkbox') li.classList.toggle('disabled', !el.checked);
        break;
      }
      li = li.parentElement ? li.parentElement.closest('.list-item') : null;
    }
  }

  async function save() {
    const btn = $('[data-save]');
    if (btn) { btn.disabled = true; btn.innerHTML = svg('save') + ' Saving…'; }
    try {
      const r = await api('/site', { method: 'PUT', body: state.site });
      state.site = r.site; state.dirty = false;
      toast('Saved — changes are live', 'ok');
      // re-render so every editor is bound to the normalised copy (ids, slugs) the server returned
      const sec = SECTIONS.find((s) => s.id === state.section);
      if (sec && !sec.custom) { const y = window.scrollY; renderSection(state.section); window.scrollTo(0, y); }
    } catch (e) {
      toast('Save failed: ' + e.message, 'err');
      state.dirty = true;
    } finally {
      if (btn) btn.innerHTML = svg('save') + ' Save changes';
      renderStatus();
    }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.dirty) save(); }
  });
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => {
    const id = window.location.hash.replace('#', '') || 'general';
    renderSection(id);
  });

  // ------------------------------------------------------------------ boot
  (async function boot() {
    try {
      [state.site, state.meta] = await Promise.all([api('/site'), api('/meta')]);
      renderShell();
      renderSection(window.location.hash.replace('#', '') || 'general');
    } catch (e) {
      $('#app').innerHTML = `<div class="alert alert-error" style="margin:40px">${esc(e.message)}</div>`;
    }
  })();
})();
