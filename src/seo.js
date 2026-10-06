'use strict';
/**
 * SEO engine: everything that turns site.seo (+ the rest of site.json) into
 *   - <head> meta tags (title, description, canonical, robots, Open Graph, Twitter, geo, verification)
 *   - JSON-LD structured data (Hotel/Motel/…, HotelRoom offers, FAQPage, BreadcrumbList, WebSite)
 *   - analytics snippets (GA4, GTM, Meta Pixel, Microsoft Clarity, custom HTML)
 *   - robots.txt and sitemap.xml
 *   - redirect / https / canonical-host / trailing-slash middleware
 *   - a live audit that fetches each public page and grades it
 *
 * The admin "SEO Wizard" is a thin UI over this module; /admin/api/seo/preview calls the same
 * functions with the unsaved editor state so what the admin sees is exactly what ships.
 */
const http = require('http');
const h = require('./helpers');

const PAGE_KEYS = ['home', 'suites', 'amenities', 'dining', 'area', 'gallery', 'reviews', 'contact'];
const PAGE_PATHS = { home: '/', suites: '/suites', amenities: '/amenities', dining: '/dining', area: '/area', gallery: '/gallery', reviews: '/reviews', contact: '/contact' };
const PAGE_LABELS = { home: 'Home', suites: 'Suites & Rooms', amenities: 'Amenities', dining: 'Dining', area: 'Local Area', gallery: 'Gallery', reviews: 'Guest Reviews', contact: 'Contact' };
// Section key that controls whether a page exists at all (enabled === false → page redirects home)
const PAGE_SECTION = { suites: 'rooms', amenities: 'amenities', dining: 'dining', area: 'area', gallery: 'gallery', reviews: 'reviews', contact: 'contact' };

const SCHEMA_TYPES = ['Hotel', 'Motel', 'LodgingBusiness', 'BedAndBreakfast', 'Hostel', 'Resort', 'Campground'];

// Title patterns observed on pages that rank for "extended stay hotel <city>" queries (Oct 2026):
//   WoodSpring Suites:        "Extended Stay Hotel in Mesa, AZ | WoodSpring Suites Mesa Chandler"
//   InTown Suites:            "Mesa, AZ Extended Stay Hotel"
//   Extended Stay America:    "Mesa, AZ - Phoenix - Mesa Hotel | Extended Stay America"
//   Residence Inn (Marriott): "Residence Inn Phoenix Mesa | Long-Stay Hotel with In-room Kitchens"
const HOME_TITLE_TEMPLATES = [
  { tpl: '{category} in {city}, {state} | {hotel}', note: 'Category first, then location, then name (WoodSpring pattern)' },
  { tpl: '{city}, {state} {category}', note: 'Location + category only (InTown Suites pattern)' },
  { tpl: '{hotel} | {category} with {amenity}', note: 'Name, then category and a key amenity (Residence Inn pattern)' },
  { tpl: '{city}, {state} - {hotel} | {brand}', note: 'Location, property, brand (Extended Stay America pattern)' },
  { tpl: '{hotel} – {city}, {state}', note: 'Simple: name and location' },
  { tpl: '{hotel} | {category} in {city}, {state}', note: 'Name first, then category and location' },
];
const PAGE_TITLE_TEMPLATES = [
  { tpl: '{page} | {hotel}', note: 'Page name, then hotel name' },
  { tpl: '{page} – {hotel} {city}, {state}', note: 'Page name, hotel and location' },
  { tpl: '{page} | {hotel} – {city}', note: 'Page name, hotel, city' },
  { tpl: '{page} at {hotel} | {category} in {city}, {state}', note: 'Long form with category' },
];

const TITLE_MAX = 60; // Google truncates around 600px ≈ 55–60 characters
const DESC_MAX = 160;

// ---------------------------------------------------------------- small utils
function str(v) { return v == null ? '' : String(v).trim(); }
function squash(s) { return str(s).replace(/\s+/g, ' '); }
function compact(obj) {
  // remove undefined / '' / empty arrays so the JSON-LD stays tidy
  if (Array.isArray(obj)) return obj.map(compact).filter((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = compact(v);
      if (c === undefined || c === '' || (Array.isArray(c) && !c.length) || (c && typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) continue;
      out[k] = c;
    }
    return out;
  }
  return obj;
}
function truncate(s, n) {
  s = squash(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,;:.\-–—\s]+$/, '') + '…';
}
function stripHtml(s) { return str(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Base URL for absolute links: admin setting → SITE_URL env → request. Never ends with "/". */
function baseUrl(site, req) {
  const fromSite = str(site && site.seo && site.seo.siteUrl);
  const fromEnv = str(process.env.SITE_URL);
  let base = fromSite || fromEnv;
  if (!base && req) base = `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/+$/, '');
}
function absolute(base, u) {
  u = str(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u;
  if (!base) return u;
  return base + (u.startsWith('/') ? u : '/' + u);
}
function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch (_) { return ''; }
}

// ---------------------------------------------------------------- templates
function templateVars(site, extra = {}) {
  const g = site.general, seo = site.seo, a = g.address || {};
  return {
    hotel: str(g.hotelName),
    site: str(seo.title) || h.fullName(g),
    brand: str(g.brandLine) || str(g.logoText) || str(g.hotelName),
    city: str(a.city),
    state: str(a.state),
    zip: str(a.zip),
    category: str(seo.category) || 'Hotel',
    amenity: str(seo.keyAmenity),
    tagline: str(g.tagline),
    phone: str(g.phone),
    page: '',
    ...extra,
  };
}

/** Fill {vars}, then clean up the separators left behind by empty values. */
function renderTemplate(tpl, vars) {
  let out = str(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  out = out
    .replace(/\s*(\||–|—|-|·)\s*(\||–|—|-|·)\s*/g, ' $1 ') // "A | | B" → "A | B"
    .replace(/^\s*(\||–|—|-|·|,|:)\s*/g, '') // leading separator
    .replace(/\s*(\||–|—|-|·|,|:)\s*$/g, '') // trailing separator
    .replace(/\s+,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\bin\s*,/g, 'in') // "in , AZ" → "in AZ"
    .replace(/\s+with\s*$/, '') // "… with" (empty amenity)
    .trim();
  return out;
}

// ---------------------------------------------------------------- per-page meta
/**
 * ctx: { path, page, title (heading passed by the route), description, room, req }
 * Returns a plain object the head partial renders; also used by the admin preview and the audit.
 */
function pageMeta(site, ctx = {}) {
  const g = site.general, seo = site.seo, s = seo.social || {};
  const base = baseUrl(site, ctx.req);
  const pageKey = ctx.page === 'suites' && ctx.room ? 'room' : (PAGE_KEYS.includes(ctx.page) ? ctx.page : (ctx.path === '/' ? 'home' : ''));
  const override = (pageKey && seo.pages && seo.pages[pageKey]) || {};
  const vars = templateVars(site);

  // ---- title
  let title;
  if (ctx.room) {
    title = renderTemplate(seo.pageTitleTemplate || '{page} | {hotel}', { ...vars, page: str(ctx.room.name) });
  } else if (pageKey === 'home' || ctx.path === '/') {
    title = str(override.title) || renderTemplate(seo.homeTitleTemplate || '{hotel} – {city}, {state}', vars) || vars.site;
  } else {
    title = str(override.title) || renderTemplate(seo.pageTitleTemplate || '{page} | {hotel}', { ...vars, page: str(ctx.title) || PAGE_LABELS[pageKey] || '' });
  }
  if (!title) title = vars.site || 'Hotel';

  // ---- description
  let description = str(override.description);
  if (!description && ctx.room) description = str(ctx.room.shortDescription) || stripHtml(ctx.room.description).split(/(?<=\.)\s/)[0];
  if (!description) description = str(ctx.description);
  if (!description) description = str(seo.description) || str(g.tagline);
  description = squash(description);

  // ---- canonical & robots
  const path = str(ctx.path) || '/';
  const canonical = base ? base + (path === '/' ? '/' : path) : '';
  const noindex = Boolean(override.noindex) || seo.robots.index === false || ctx.page === '404';
  const robots = `${noindex ? 'noindex' : 'index'}, ${seo.robots.follow === false ? 'nofollow' : 'follow'}`;

  // ---- images
  const heroImg = site.hero && site.hero.images && site.hero.images[0] && site.hero.images[0].url;
  const ogImage = absolute(base, str(override.ogImage) || (ctx.room && ctx.room.image) || str(seo.ogImage) || heroImg || '');

  const keywords = Array.isArray(seo.keywords) ? seo.keywords.map(str).filter(Boolean) : [];

  return {
    title,
    description,
    canonical,
    robots,
    noindex,
    ogType: str(s.ogType) || 'website',
    ogLocale: str(s.ogLocale) || 'en_US',
    ogSiteName: vars.site,
    ogImage,
    ogImageAlt: ctx.room ? str(ctx.room.name) : h.fullName(g),
    twitterCard: str(s.twitterCard) || 'summary_large_image',
    twitterSite: str(s.twitterSite).replace(/^(?!@)/, '@').replace(/^@$/, ''),
    fbAppId: str(s.fbAppId),
    keywords: seo.metaKeywords ? keywords : [],
    geoRegion: str(seo.local && seo.local.geoRegion),
    geoPlacename: str(seo.local && seo.local.geoPlacename),
    geoPosition: site.area && Number(site.area.latitude) && Number(site.area.longitude) ? `${site.area.latitude};${site.area.longitude}` : '',
    verification: seo.verification || {},
    favicon: str(seo.favicon) || '/img/favicon.svg',
    themeColor: /^#[0-9a-f]{6}$/i.test(str(site.theme && site.theme.primary)) ? site.theme.primary : '',
    base,
    path,
    pageKey,
  };
}

function renderHead(m) {
  const e = h.esc;
  const out = [];
  out.push(`<title>${e(m.title)}</title>`);
  if (m.description) out.push(`<meta name="description" content="${e(m.description)}">`);
  out.push(`<meta name="robots" content="${e(m.robots)}">`);
  if (m.keywords.length) out.push(`<meta name="keywords" content="${e(m.keywords.join(', '))}">`);
  if (m.canonical) out.push(`<link rel="canonical" href="${e(m.canonical)}">`);
  if (m.themeColor) out.push(`<meta name="theme-color" content="${e(m.themeColor)}">`);
  // Open Graph
  out.push(`<meta property="og:type" content="${e(m.ogType)}">`);
  out.push(`<meta property="og:locale" content="${e(m.ogLocale)}">`);
  out.push(`<meta property="og:site_name" content="${e(m.ogSiteName)}">`);
  out.push(`<meta property="og:title" content="${e(m.title)}">`);
  if (m.description) out.push(`<meta property="og:description" content="${e(m.description)}">`);
  if (m.canonical) out.push(`<meta property="og:url" content="${e(m.canonical)}">`);
  if (m.ogImage) {
    out.push(`<meta property="og:image" content="${e(m.ogImage)}">`);
    out.push(`<meta property="og:image:alt" content="${e(m.ogImageAlt)}">`);
  }
  if (m.fbAppId) out.push(`<meta property="fb:app_id" content="${e(m.fbAppId)}">`);
  // Twitter / X
  out.push(`<meta name="twitter:card" content="${e(m.twitterCard)}">`);
  if (m.twitterSite) out.push(`<meta name="twitter:site" content="${e(m.twitterSite)}">`);
  out.push(`<meta name="twitter:title" content="${e(m.title)}">`);
  if (m.description) out.push(`<meta name="twitter:description" content="${e(m.description)}">`);
  if (m.ogImage) out.push(`<meta name="twitter:image" content="${e(m.ogImage)}">`);
  // Geo (legacy but harmless, still read by some local directories)
  if (m.geoRegion) out.push(`<meta name="geo.region" content="${e(m.geoRegion)}">`);
  if (m.geoPlacename) out.push(`<meta name="geo.placename" content="${e(m.geoPlacename)}">`);
  if (m.geoPosition) { out.push(`<meta name="geo.position" content="${e(m.geoPosition)}">`); out.push(`<meta name="ICBM" content="${e(m.geoPosition.replace(';', ', '))}">`); }
  // Site verification
  const v = m.verification;
  if (str(v.google)) out.push(`<meta name="google-site-verification" content="${e(str(v.google))}">`);
  if (str(v.bing)) out.push(`<meta name="msvalidate.01" content="${e(str(v.bing))}">`);
  if (str(v.pinterest)) out.push(`<meta name="p:domain_verify" content="${e(str(v.pinterest))}">`);
  if (str(v.yandex)) out.push(`<meta name="yandex-verification" content="${e(str(v.yandex))}">`);
  if (str(v.facebookDomain)) out.push(`<meta name="facebook-domain-verification" content="${e(str(v.facebookDomain))}">`);
  // Favicon
  const isSvg = /\.svg(\?|$)/i.test(m.favicon);
  out.push(`<link rel="icon" href="${e(m.favicon)}"${isSvg ? ' type="image/svg+xml"' : ''}>`);
  return out.join('\n  ');
}

// ---------------------------------------------------------------- JSON-LD
function amenityFeatures(site) {
  const override = (site.seo.schema.amenityFeatures || []).map(str).filter(Boolean);
  if (override.length) return override;
  const fromCats = (site.amenities.categories || []).flatMap((c) => (c.items || []).map(str)).filter(Boolean);
  const fromFeatured = (site.amenities.featured || []).map((f) => str(f.title)).filter(Boolean);
  return [...new Set([...fromFeatured, ...fromCats])].slice(0, 40);
}

function aggregateRating(site) {
  const g = site.general;
  if (g.showRating && Number(g.reviewScore) > 0 && Number(g.reviewCount) > 0) {
    return { '@type': 'AggregateRating', ratingValue: Number(g.reviewScore), reviewCount: Number(g.reviewCount), bestRating: 5, worstRating: 1 };
  }
  const items = site.reviews.enabled !== false ? h.enabledItems(site.reviews.items).filter((r) => Number(r.rating) > 0) : [];
  if (items.length) {
    const avg = items.reduce((s, r) => s + Number(r.rating), 0) / items.length;
    return { '@type': 'AggregateRating', ratingValue: Math.round(avg * 10) / 10, reviewCount: items.length, bestRating: 5, worstRating: 1 };
  }
  return undefined;
}

function roomSchema(site, base, room) {
  const g = site.general;
  const price = Number(room.priceFrom) || 0;
  return compact({
    '@type': 'HotelRoom',
    '@id': `${base}/suites/${room.slug}#room`,
    name: str(room.name),
    description: str(room.shortDescription) || stripHtml(room.description),
    url: base ? `${base}/suites/${room.slug}` : undefined,
    image: [...new Set([room.image, ...(room.images || [])].map((u) => absolute(base, u)).filter(Boolean))],
    bed: str(room.beds) ? { '@type': 'BedDetails', typeOfBed: str(room.beds) } : undefined,
    occupancy: Number(room.sleeps) ? { '@type': 'QuantitativeValue', maxValue: Number(room.sleeps), unitText: 'persons' } : undefined,
    floorSize: Number(room.sqft) ? { '@type': 'QuantitativeValue', value: Number(room.sqft), unitCode: 'FTK' } : undefined,
    amenityFeature: (room.features || []).map(str).filter(Boolean).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
    offers: price ? { '@type': 'Offer', price, priceCurrency: str(g.currency) || 'USD', availability: 'https://schema.org/InStock', url: base ? `${base}/suites/${room.slug}` : undefined, description: str(room.priceNote) || undefined } : undefined,
  });
}

function lodgingSchema(site, base) {
  const g = site.general, seo = site.seo, sc = seo.schema, a = g.address || {};
  const type = SCHEMA_TYPES.includes(sc.type) ? sc.type : 'Hotel';
  const images = [...new Set([seo.ogImage, ...((site.hero.images || []).map((i) => i && i.url))].map((u) => absolute(base, u)).filter(Boolean))];
  const sameAs = [...new Set([...(sc.sameAs || []), sc.googleBusinessUrl, ...((site.footer.social || []).map((s) => s && s.url))].map(str).filter((u) => /^https?:\/\//i.test(u)))];
  const stars = Number(g.starRating) || 0;
  const geoOk = Number(site.area.latitude) && Number(site.area.longitude);
  const pets = str(sc.petsAllowed);
  const rooms = sc.rooms !== false && site.rooms.enabled !== false ? h.enabledItems(site.rooms.items).map((r) => roomSchema(site, base, r)) : [];

  return compact({
    '@context': 'https://schema.org',
    '@type': type,
    '@id': base ? `${base}/#lodging` : undefined,
    name: h.fullName(g),
    alternateName: str(g.logoText) && str(g.logoText) !== str(g.hotelName) ? str(g.logoText) : undefined,
    slogan: str(sc.slogan) || undefined,
    description: str(seo.description) || str(g.tagline),
    url: base || undefined,
    telephone: str(g.phone) || undefined,
    email: str(g.email) || undefined,
    image: images.length ? images : undefined,
    logo: str(g.logoUrl) ? absolute(base, g.logoUrl) : undefined,
    priceRange: str(sc.priceRange) || undefined,
    currenciesAccepted: str(g.currency) || undefined,
    paymentAccepted: str(sc.paymentAccepted) || undefined,
    openingHours: str(sc.openingHours) || undefined,
    numberOfRooms: Number(sc.numberOfRooms) || undefined,
    address: str(a.street) || str(a.city) ? { '@type': 'PostalAddress', streetAddress: str(a.street), addressLocality: str(a.city), addressRegion: str(a.state), postalCode: str(a.zip), addressCountry: str(a.country) || 'US' } : undefined,
    geo: geoOk ? { '@type': 'GeoCoordinates', latitude: Number(site.area.latitude), longitude: Number(site.area.longitude) } : undefined,
    hasMap: h.directionsUrl(site.area, g) || undefined,
    areaServed: (seo.local.serviceAreas || []).map(str).filter(Boolean).map((name) => ({ '@type': 'City', name })),
    checkinTime: str(g.checkInTime) || undefined,
    checkoutTime: str(g.checkOutTime) || undefined,
    petsAllowed: pets === 'true' ? true : pets === 'false' ? false : undefined,
    starRating: stars ? { '@type': 'Rating', ratingValue: stars, bestRating: 5 } : undefined,
    aggregateRating: sc.reviews ? aggregateRating(site) : undefined,
    amenityFeature: amenityFeatures(site).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
    containsPlace: rooms.length ? rooms : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  });
}

function faqSchema(site) {
  if (site.faq.enabled === false) return null;
  const items = (site.faq.items || []).filter((q) => q && str(q.q) && str(q.a));
  if (!items.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((q) => ({ '@type': 'Question', name: str(q.q), acceptedAnswer: { '@type': 'Answer', text: str(q.a) } })) };
}

function breadcrumbSchema(site, base, ctx) {
  if (!base || ctx.path === '/' ) return null;
  const items = [{ name: 'Home', url: base + '/' }];
  if (ctx.room) items.push({ name: str(site.rooms.heading) || 'Suites & Rooms', url: base + '/suites' }, { name: str(ctx.room.name), url: base + ctx.path });
  else items.push({ name: str(ctx.title) || PAGE_LABELS[ctx.page] || 'Page', url: base + ctx.path });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) };
}

function websiteSchema(site, base) {
  if (!base) return null;
  return compact({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${base}/#website`, url: base + '/', name: str(site.seo.title) || h.fullName(site.general), description: str(site.seo.description) || undefined, publisher: { '@id': `${base}/#lodging` }, inLanguage: 'en-US' });
}

/** All JSON-LD blocks for a page, as an array of objects. */
function jsonLd(site, ctx = {}) {
  const sc = site.seo.schema || {};
  if (sc.enabled === false) return [];
  const base = ctx.base != null ? ctx.base : baseUrl(site, ctx.req);
  const blocks = [];
  const isHome = (ctx.path || '/') === '/';
  if (isHome || ctx.room || ctx.page === 'suites' || ctx.page === 'contact' || ctx.page === 'amenities') blocks.push(lodgingSchema(site, base));
  if (isHome && sc.website !== false) blocks.push(websiteSchema(site, base));
  if (isHome && sc.faq !== false) blocks.push(faqSchema(site));
  if (sc.breadcrumbs !== false) blocks.push(breadcrumbSchema(site, base, ctx));
  return blocks.filter(Boolean);
}

function renderJsonLd(site, ctx) {
  return jsonLd(site, ctx).map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, '\\u003c')}</script>`).join('\n  ');
}

// ---------------------------------------------------------------- analytics
const GA_RE = /^G-[A-Z0-9]{4,}$/i, GTM_RE = /^GTM-[A-Z0-9]{4,}$/i, PIXEL_RE = /^\d{6,}$/, CLARITY_RE = /^[a-z0-9]{6,}$/i;

function renderAnalyticsHead(site) {
  const an = site.seo.analytics || {}, out = [];
  const ga = str(an.ga4), gtm = str(an.gtm), px = str(an.metaPixel), cl = str(an.clarity);
  if (GTM_RE.test(gtm)) {
    out.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(gtm)});</script>`);
  }
  if (GA_RE.test(ga)) {
    out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}"></script>`);
    out.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga)});</script>`);
  }
  if (PIXEL_RE.test(px)) {
    out.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(px)});fbq('track','PageView');</script>`);
    out.push(`<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${encodeURIComponent(px)}&ev=PageView&noscript=1"></noscript>`);
  }
  if (CLARITY_RE.test(cl)) {
    out.push(`<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(cl)});</script>`);
  }
  if (str(site.seo.customHeadHtml)) out.push(site.seo.customHeadHtml);
  return out.join('\n  ');
}

function renderBodyStart(site) {
  const gtm = str(site.seo.analytics && site.seo.analytics.gtm);
  return GTM_RE.test(gtm) ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtm)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
}

function renderBodyEnd(site) {
  return str(site.seo.analytics && site.seo.analytics.bodyEndHtml) ? site.seo.analytics.bodyEndHtml : '';
}

// ---------------------------------------------------------------- robots & sitemap
/**
 * Parse robots.txt into user-agent groups: [{ agents: ['*'], rules: [['disallow','/'], ...] }].
 * Needed because a proxy (Cloudflare's managed robots.txt) may prepend blocks for specific AI
 * crawlers — a "Disallow: /" there only blocks that crawler, not search engines.
 */
function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur) cur.rules.push([key, val]);
    }
  }
  return groups;
}
/** A rule value of "/" or "/*" matches every path — the two spellings people actually use for "block everything". */
const blocksRoot = (v) => v === '/' || v === '/*';

/** True when a rule group disallows everything AND nothing of equal specificity allows it back (Allow beats Disallow of the same length — the convention Google and most crawlers use). */
function groupBlocksAll(g) {
  return g.rules.some(([k, v]) => k === 'disallow' && blocksRoot(v)) && !g.rules.some(([k, v]) => k === 'allow' && blocksRoot(v));
}

/** True when search engines in general (User-agent: *) are told Disallow: / (or /*) with no Allow: / undoing it. */
function robotsBlocksAll(text) {
  return parseRobots(text).some((g) => g.agents.includes('*') && groupBlocksAll(g));
}
/** Names of specific crawlers that are fully blocked (e.g. Cloudflare's AI-bot list). */
function robotsBlockedAgents(text) {
  return [...new Set(parseRobots(text).filter((g) => !g.agents.includes('*') && groupBlocksAll(g)).flatMap((g) => g.agents))];
}

function robotsTxt(site, req) {
  const seo = site.seo;
  if (str(seo.robots.custom)) return seo.robots.custom.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
  const base = baseUrl(site, req);
  const lines = ['User-agent: *'];
  if (seo.robots.index === false) lines.push('Disallow: /');
  else { lines.push('Disallow: /admin', 'Disallow: /admin/', 'Allow: /'); }
  // no point advertising a sitemap full of URLs the line above just told every crawler to ignore
  if (seo.robots.index !== false && seo.sitemap.enabled !== false && base) lines.push('', `Sitemap: ${base}/sitemap.xml`);
  return lines.join('\n') + '\n';
}

/** Every indexable URL with its sitemap attributes. */
function sitemapEntries(site, req) {
  const seo = site.seo, sm = seo.sitemap;
  // a site-wide noindex means nothing here is meant to be indexable — an empty sitemap, not one
  // advertising URLs that robots.txt (above) just told every crawler to ignore
  if (seo.robots && seo.robots.index === false) return [];
  const base = baseUrl(site, req);
  const lastmod = site.meta && site.meta.updatedAt ? String(site.meta.updatedAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const freq = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'].includes(sm.changefreq) ? sm.changefreq : 'weekly';
  const pri = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : d; };
  const entries = [];
  for (const key of PAGE_KEYS) {
    const sec = PAGE_SECTION[key];
    if (sec && site[sec] && site[sec].enabled === false) continue;
    if (key === 'reviews' && site.reviews.enabled === false) continue;
    if (seo.pages[key] && seo.pages[key].noindex) continue;
    entries.push({ loc: base + PAGE_PATHS[key], lastmod, changefreq: freq, priority: key === 'home' ? pri(sm.priorityHome, 1) : pri(sm.priorityPages, 0.8), page: key });
  }
  if (sm.includeRooms !== false && site.rooms.enabled !== false) {
    for (const r of h.enabledItems(site.rooms.items)) entries.push({ loc: `${base}/suites/${r.slug}`, lastmod, changefreq: freq, priority: pri(sm.priorityRooms, 0.7), page: 'room', room: r });
  }
  return entries;
}

function sitemapXml(site, req) {
  const items = sitemapEntries(site, req).map((u) => `  <url>\n    <loc>${h.esc(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority.toFixed(1)}</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>\n`;
}

// ---------------------------------------------------------------- middleware
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

/**
 * Redirect rules, https enforcement, canonical host and trailing slashes.
 * - never touches /admin (so a bad setting can always be fixed from the admin)
 * - never redirects local requests or the audit's own internal fetches
 */
function middleware(getSite) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/admin')) return next();
    const site = getSite();
    const seo = site.seo || {};
    const host = str(req.get('host')).toLowerCase();
    const internal = LOCAL_HOSTS.test(host) || req.get('x-seo-audit') === '1';
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';

    // 1. explicit redirect rules (exact path match, case-insensitive, slash-insensitive)
    const want = req.path.length > 1 ? req.path.replace(/\/+$/, '').toLowerCase() : '/';
    const rule = (seo.redirects || []).find((r) => r && r.from && r.to && r.from.toLowerCase() === want);
    if (rule && rule.to !== req.path) return res.redirect(rule.type === 302 ? 302 : 301, rule.to + (rule.to.includes('?') ? '' : qs));

    // 2. trailing slash → none  (/suites/ → /suites)
    if (seo.hosting && seo.hosting.trailingSlashRedirect !== false && req.path.length > 1 && req.path.endsWith('/')) {
      return res.redirect(301, req.path.replace(/\/+$/, '') + qs);
    }

    if (internal) return next();
    const base = str(seo.siteUrl);
    const canonicalHost = hostOf(base);

    // 3. https
    if (seo.hosting && seo.hosting.forceHttps && req.protocol !== 'https') {
      return res.redirect(301, `https://${canonicalHost || host}${req.originalUrl}`);
    }
    // 4. canonical host (www vs bare, old domains → new)
    if (seo.hosting && seo.hosting.enforceCanonicalHost && canonicalHost && host !== canonicalHost) {
      const proto = /^https:/i.test(base) ? 'https' : req.protocol;
      return res.redirect(301, `${proto}://${canonicalHost}${req.originalUrl}`);
    }
    next();
  };
}

// ---------------------------------------------------------------- suggestions (deterministic, from the site's own data)
function suggestions(site) {
  const g = site.general, seo = site.seo, a = g.address || {};
  const vars = templateVars(site);
  const cityState = [vars.city, vars.state].filter(Boolean).join(', ');
  const topAmenities = amenityFeatures(site).slice(0, 3);
  const amenityText = topAmenities.length ? topAmenities.map((x) => x.replace(/\.$/, '')).join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
  const rates = /weekly|monthly/i.test(str(g.ratesNote) + str(g.brandLine)) ? 'Weekly and monthly rates' : '';
  const roomNames = h.enabledItems(site.rooms.items).map((r) => str(r.name)).filter(Boolean);

  const descHome = truncate([`${vars.hotel} in ${cityState}:`, (vars.category || 'hotel').toLowerCase(), amenityText ? `with ${amenityText.toLowerCase()}.` : '.', rates ? `${rates}.` : '', vars.phone ? `Call ${vars.phone}.` : ''].filter(Boolean).join(' ').replace(/\s\./g, '.'), DESC_MAX);
  const descSuites = truncate([roomNames.length ? `${roomNames.join(', ').replace(/, ([^,]*)$/, ' and $1')} suites` : 'Suites', `at ${vars.hotel} in ${cityState}.`, amenityText ? `${amenityText}.` : '', rates ? `${rates}.` : '', vars.phone ? `Call ${vars.phone}.` : ''].filter(Boolean).join(' '), DESC_MAX);
  const descAmenities = truncate(`Amenities at ${vars.hotel} in ${cityState}: ${amenityFeatures(site).slice(0, 6).join(', ').toLowerCase()}.`, DESC_MAX);
  const descContact = truncate([`Contact ${vars.hotel}`, h.fullAddress(a) ? `at ${h.fullAddress(a)}.` : '.', vars.phone ? `Call ${vars.phone}` : '', rates ? `for ${rates.toLowerCase()}` : '', 'or send a booking inquiry online.'].filter(Boolean).join(' ').replace(/\s\./g, '.'), DESC_MAX);
  const descArea = truncate(`Things to do near ${vars.hotel} in ${cityState}: ${h.enabledItems(site.area.attractions).slice(0, 5).map((x) => str(x.name)).filter(Boolean).join(', ')}.`, DESC_MAX);
  const descDining = truncate(`Dining at and around ${vars.hotel} in ${cityState}: ${[...h.enabledItems(site.dining.items), ...(site.dining.nearby || [])].slice(0, 5).map((x) => str(x.name)).filter(Boolean).join(', ')}.`, DESC_MAX);
  const descGallery = truncate(`Photos of ${vars.hotel} in ${cityState}: suites, ${topAmenities.slice(0, 2).join(', ').toLowerCase()} and the property.`, DESC_MAX);
  const descReviews = truncate(`Guest reviews of ${vars.hotel} in ${cityState}.`, DESC_MAX);

  const cat = (vars.category || 'hotel').toLowerCase();
  const kw = [
    `${cat} ${vars.city} ${vars.state}`, `${cat} ${vars.city}`, `weekly rates hotel ${vars.city}`, `monthly hotel ${vars.city} ${vars.state}`,
    `${vars.hotel}`, `${vars.hotel} ${vars.city}`, `suites ${vars.city} ${vars.state}`, vars.zip ? `hotel ${vars.zip}` : '',
  ].map(squash).filter((k) => k && !/undefined/.test(k));

  return {
    titles: {
      home: HOME_TITLE_TEMPLATES.map((t) => ({ ...t, text: renderTemplate(t.tpl, vars) })),
      page: PAGE_TITLE_TEMPLATES.map((t) => ({ ...t, text: renderTemplate(t.tpl, { ...vars, page: 'Suites & Rooms' }) })),
    },
    descriptions: { home: descHome, suites: descSuites, amenities: descAmenities, contact: descContact, area: descArea, dining: descDining, gallery: descGallery, reviews: descReviews },
    keywords: [...new Set(kw)],
    amenityFeatures: amenityFeatures(site),
  };
}

// ---------------------------------------------------------------- audit
function fetchLocal(port, path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { 'x-seo-audit': '1', 'accept-encoding': 'identity', ...headers }, timeout: 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 3e6) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, ms: Date.now() - t0 }));
    });
    const t0 = Date.now();
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: 0, error: e.message, body: '', headers: {}, ms: Date.now() - t0 }));
    req.end();
  });
}

function parseHtml(html) {
  const get = (re) => { const m = html.match(re); return m ? m[1] : ''; };
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const metaContent = (name, attr = 'name') => { const m = html.match(new RegExp(`<meta[^>]+${attr}=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')); return m ? decode(m[1]) : ''; };
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripHtml(m[1]));
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imgsNoAlt = imgs.filter((t) => !/\balt\s*=/i.test(t));
  const imgsEmptyAltContent = imgs.filter((t) => /\balt\s*=\s*(""|'')/i.test(t) && !/data-lb-img|aria-hidden/i.test(t)).length;
  const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]); } catch (_) { return { __invalid: true }; } });
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = stripHtml(body);
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  return {
    title: decode(stripHtml(get(/<title[^>]*>([\s\S]*?)<\/title>/i))),
    description: metaContent('description'),
    robots: metaContent('robots'),
    canonical: (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || '',
    ogTitle: metaContent('og:title', 'property'), ogDescription: metaContent('og:description', 'property'), ogImage: metaContent('og:image', 'property'),
    twitterCard: metaContent('twitter:card'),
    viewport: Boolean(metaContent('viewport')),
    lang: get(/<html[^>]*\blang=["']([^"']+)["']/i),
    h1s, h2Count: (html.match(/<h2\b/gi) || []).length,
    imgCount: imgs.length, imgsNoAlt: imgsNoAlt.length, imgsEmptyAlt: imgsEmptyAltContent,
    lazyImgs: imgs.filter((t) => /loading=["']lazy["']/i.test(t)).length,
    jsonLd: ld,
    words: text ? text.split(/\s+/).length : 0,
    internalLinks: links.filter((l) => l.startsWith('/') || !/^https?:/i.test(l)).length,
    externalLinks: links.filter((l) => /^https?:/i.test(l)).length,
    bytes: Buffer.byteLength(html, 'utf8'),
  };
}

/**
 * Grade the live site. Returns { score, generatedAt, groups: [...], pages: [...] }.
 * Each check: { id, status: 'pass'|'warn'|'fail'|'info', weight, label, detail, step, field }
 */
async function audit(site, { port, base: baseOverride } = {}) {
  const seo = site.seo, g = site.general;
  const base = str(baseOverride) || baseUrl(site);
  const checks = [];
  const add = (group, c) => checks.push({ group, weight: 2, status: 'info', ...c });
  const P = (v) => (v ? 'pass' : 'fail');

  // ---- settings-level checks (no HTTP needed)
  add('setup', { id: 'siteUrl', weight: 3, status: P(str(seo.siteUrl)), label: 'Canonical site URL set', detail: str(seo.siteUrl) || 'Set the public URL so canonical links, sitemap and structured data use absolute URLs.', step: 'basics', field: 'siteUrl' });
  add('setup', { id: 'https', weight: 2, status: str(seo.siteUrl) ? P(/^https:/i.test(seo.siteUrl)) : 'info', label: 'Site URL uses HTTPS', detail: /^https:/i.test(str(seo.siteUrl)) ? 'Good — Google prefers HTTPS pages.' : 'Serve the site over HTTPS and set the URL with https://', step: 'basics', field: 'siteUrl' });
  add('setup', { id: 'robotsIndex', weight: 3, status: seo.robots.index === false ? 'fail' : 'pass', label: 'Site allowed to be indexed', detail: seo.robots.index === false ? 'Indexing is switched OFF — search engines are told to ignore every page.' : 'robots meta allows indexing.', step: 'search', field: 'robots.index' });
  add('setup', { id: 'sitemapOn', weight: 2, status: P(seo.sitemap.enabled !== false), label: 'XML sitemap enabled', detail: '/sitemap.xml lists every public page for search engines.', step: 'search', field: 'sitemap.enabled' });
  add('setup', { id: 'gsc', weight: 1, status: str(seo.verification.google) ? 'pass' : 'warn', label: 'Google Search Console verified', detail: str(seo.verification.google) ? 'Verification tag is in the <head>.' : 'Add the verification code from Search Console so you can submit the sitemap and see search performance.', step: 'search', field: 'verification.google' });
  add('setup', { id: 'bing', weight: 1, status: str(seo.verification.bing) ? 'pass' : 'info', label: 'Bing Webmaster Tools verified', detail: str(seo.verification.bing) ? 'Verification tag present.' : 'Optional — Bing powers Yahoo, DuckDuckGo and Copilot results.', step: 'search', field: 'verification.bing' });
  add('setup', { id: 'analytics', weight: 1, status: (GA_RE.test(str(seo.analytics.ga4)) || GTM_RE.test(str(seo.analytics.gtm))) ? 'pass' : 'warn', label: 'Analytics installed', detail: 'Google Analytics 4 or Tag Manager lets you measure which pages and keywords bring guests.', step: 'analytics', field: 'analytics.ga4' });

  // ---- local SEO / NAP
  const a = g.address || {};
  add('local', { id: 'nap', weight: 3, status: P(str(g.hotelName) && str(a.street) && str(a.city) && str(a.state) && str(a.zip) && str(g.phone)), label: 'Name, address and phone complete', detail: [h.fullName(g), h.fullAddress(a), str(g.phone)].filter(Boolean).join(' · ') || 'Fill in the full address and phone under General.', step: 'local' });
  add('local', { id: 'geo', weight: 2, status: Number(site.area.latitude) && Number(site.area.longitude) ? 'pass' : 'warn', label: 'Map coordinates set', detail: Number(site.area.latitude) ? `${site.area.latitude}, ${site.area.longitude}` : 'Latitude/longitude go into the structured data and geo meta tags (Local Area → Map).', step: 'local' });
  add('local', { id: 'gbp', weight: 2, status: str(seo.schema.googleBusinessUrl) ? 'pass' : 'warn', label: 'Google Business Profile linked', detail: str(seo.schema.googleBusinessUrl) || 'Add your Google Business Profile URL — it is the single biggest factor for "near me" and map results.', step: 'local', field: 'schema.googleBusinessUrl' });
  add('local', { id: 'hours', weight: 1, status: str(seo.schema.openingHours) ? 'pass' : 'info', label: 'Office hours in structured data', detail: str(seo.schema.openingHours) || 'e.g. Mo-Su 00:00-23:59 for a 24-hour office.', step: 'schema', field: 'schema.openingHours' });
  add('local', { id: 'checkin', weight: 1, status: str(g.checkInTime) && str(g.checkOutTime) ? 'pass' : 'info', label: 'Check-in / check-out times published', detail: [g.checkInTime, g.checkOutTime].filter(Boolean).join(' / ') || 'Set under Rates & Policies — shown on pages and in structured data.', step: 'schema' });
  add('local', { id: 'geoMeta', weight: 1, status: str(seo.local.geoRegion) ? 'pass' : 'info', label: 'geo.region / geo.placename meta tags', detail: str(seo.local.geoRegion) ? `${seo.local.geoRegion} · ${seo.local.geoPlacename}` : 'Optional legacy tags some directories still read (e.g. US-AZ, Mesa, Arizona).', step: 'local', field: 'local.geoRegion' });

  // ---- content / keywords
  const kws = (seo.keywords || []).map(str).filter(Boolean);
  add('content', { id: 'keywords', weight: 1, status: kws.length ? 'pass' : 'warn', label: 'Target keywords defined', detail: kws.length ? kws.join(', ') : 'List the phrases you want to rank for; the audit checks they appear in titles and descriptions.', step: 'basics', field: 'keywords' });
  add('content', { id: 'category', weight: 2, status: str(seo.category) ? 'pass' : 'warn', label: 'Business category phrase set', detail: str(seo.category) || 'e.g. "Extended Stay Hotel" — used in title templates the way top-ranking hotel pages do.', step: 'basics', field: 'category' });
  add('content', { id: 'ogImage', weight: 2, status: str(seo.ogImage) || (site.hero.images[0] && site.hero.images[0].url) ? 'pass' : 'fail', label: 'Default social share image', detail: str(seo.ogImage) || 'Falls back to the first hero image. Recommended 1200×630.', step: 'social', field: 'ogImage' });
  add('content', { id: 'faq', weight: 1, status: site.faq.enabled !== false && (site.faq.items || []).length >= 3 ? 'pass' : 'info', label: 'FAQ with 3+ questions (FAQ structured data)', detail: `${(site.faq.items || []).length} question(s).`, step: 'schema', field: 'schema.faq' });
  add('content', { id: 'altHero', weight: 2, status: (site.hero.images || []).every((i) => !i || !i.url || str(i.alt)) ? 'pass' : 'warn', label: 'Hero images have alt text', detail: 'Alt text describes images for search engines and screen readers.', step: 'content' });
  add('content', { id: 'altGallery', weight: 1, status: h.enabledItems(site.gallery.items).every((i) => str(i.caption)) ? 'pass' : 'warn', label: 'Gallery photos have captions', detail: `${h.enabledItems(site.gallery.items).filter((i) => !str(i.caption)).length} photo(s) without a caption (used as alt text).`, step: 'content' });
  add('content', { id: 'roomsDesc', weight: 1, status: h.enabledItems(site.rooms.items).every((r) => str(r.shortDescription) || str(r.description)) ? 'pass' : 'warn', label: 'Every suite has a description', detail: 'Suite pages use the short description as their meta description.', step: 'content' });
  add('content', { id: 'priceRange', weight: 1, status: str(seo.schema.priceRange) ? 'pass' : 'info', label: 'Price range in structured data', detail: str(seo.schema.priceRange) || 'e.g. "$" or "$75–$120" — appears in Google\'s knowledge panel.', step: 'schema', field: 'schema.priceRange' });
  add('content', { id: 'pets', weight: 1, status: str(seo.schema.petsAllowed) ? 'pass' : 'info', label: 'Pet policy in structured data', detail: str(seo.schema.petsAllowed) ? `petsAllowed: ${seo.schema.petsAllowed}` : 'Set yes/no so "pet friendly hotel" searches can match.', step: 'schema', field: 'schema.petsAllowed' });
  if (seo.schema.reviews) add('content', { id: 'selfReviews', weight: 1, status: 'warn', label: 'Review ratings in structured data are from this site', detail: 'Google does not show star ratings for reviews a business publishes about itself ("self-serving reviews"). Collect reviews on Google Business Profile instead.', step: 'schema', field: 'schema.reviews' });

  // ---- redirects sanity
  const badRules = (seo.redirects || []).filter((r) => !r.from || !r.to || r.from === r.to);
  add('setup', { id: 'redirects', weight: 1, status: badRules.length ? 'warn' : 'pass', label: 'Redirect rules valid', detail: badRules.length ? `${badRules.length} rule(s) missing a from/to or pointing to themselves.` : `${(seo.redirects || []).length} rule(s).`, step: 'hosting', field: 'redirects' });

  // ---- live page checks
  const pages = [];
  if (port) {
    const targets = sitemapEntries(site).map((e) => ({ path: e.loc.replace(base, '') || '/', label: e.page === 'room' ? `Suite: ${e.room.name}` : PAGE_LABELS[e.page] }));
    const results = await Promise.all(targets.map((t) => fetchLocal(port, t.path, { host: hostOf(base) || 'localhost' })));
    const primaryKw = (kws[0] || '').toLowerCase();
    results.forEach((r, i) => {
      const t = targets[i];
      const p = r.status === 200 ? parseHtml(r.body) : null;
      const issues = [];
      if (!p) issues.push({ status: 'fail', msg: r.error ? `Could not fetch (${r.error})` : `HTTP ${r.status}` });
      else {
        if (!p.title) issues.push({ status: 'fail', msg: 'Missing <title>' });
        else if (p.title.length > 70) issues.push({ status: 'fail', msg: `Title too long (${p.title.length} chars; aim for ≤ ${TITLE_MAX})` });
        else if (p.title.length > TITLE_MAX) issues.push({ status: 'warn', msg: `Title may be cut off (${p.title.length} chars; aim for ≤ ${TITLE_MAX})` });
        else if (p.title.length < 20) issues.push({ status: 'warn', msg: `Title is short (${p.title.length} chars)` });
        if (!p.description) issues.push({ status: 'fail', msg: 'Missing meta description' });
        else if (p.description.length > 175) issues.push({ status: 'fail', msg: `Description too long (${p.description.length} chars; aim for ≤ ${DESC_MAX})` });
        else if (p.description.length > DESC_MAX) issues.push({ status: 'warn', msg: `Description may be cut off (${p.description.length} chars)` });
        else if (p.description.length < 70) issues.push({ status: 'warn', msg: `Description is short (${p.description.length} chars; 120–160 is ideal)` });
        if (p.h1s.length === 0) issues.push({ status: 'fail', msg: 'No H1 heading' });
        else if (p.h1s.length > 1) issues.push({ status: 'warn', msg: `${p.h1s.length} H1 headings (use one)` });
        if (p.imgsNoAlt) issues.push({ status: 'warn', msg: `${p.imgsNoAlt} image(s) without an alt attribute` });
        if (!p.canonical) issues.push({ status: 'warn', msg: 'No canonical link (set the site URL)' });
        if (!p.ogImage) issues.push({ status: 'warn', msg: 'No og:image' });
        if (p.jsonLd.some((b) => b.__invalid)) issues.push({ status: 'fail', msg: 'A JSON-LD block does not parse' });
        if (p.words < 150 && !/^\/suites\//.test(t.path)) issues.push({ status: 'info', msg: `Thin content (${p.words} words)` });
        if (/noindex/i.test(p.robots)) issues.push({ status: 'info', msg: 'Page is set to noindex' });
        if (primaryKw && t.path === '/' && !(p.title + ' ' + p.description).toLowerCase().includes(primaryKw)) issues.push({ status: 'warn', msg: `Primary keyword "${kws[0]}" not in home title/description` });
        if (r.ms > 1500) issues.push({ status: 'warn', msg: `Slow server response (${r.ms} ms)` });
      }
      pages.push({ path: t.path, label: t.label, status: r.status, ms: r.ms, title: p ? p.title : '', titleLen: p ? p.title.length : 0, description: p ? p.description : '', descLen: p ? p.description.length : 0, h1: p ? p.h1s.length : 0, imgs: p ? p.imgCount : 0, imgsNoAlt: p ? p.imgsNoAlt : 0, words: p ? p.words : 0, jsonLd: p ? p.jsonLd.filter((b) => !b.__invalid).map((b) => b['@type']) : [], canonical: p ? p.canonical : '', noindex: p ? /noindex/i.test(p.robots) : false, issues });
    });

    const worst = (status) => pages.some((pg) => pg.issues.some((x) => x.status === status));
    add('pages', { id: 'pagesReachable', weight: 3, status: pages.every((pg) => pg.status === 200) ? 'pass' : 'fail', label: 'All public pages return 200', detail: `${pages.filter((pg) => pg.status === 200).length} of ${pages.length} pages OK.`, step: 'pages' });
    add('pages', { id: 'titles', weight: 3, status: pages.some((pg) => pg.issues.some((x) => /Title/.test(x.msg) && x.status === 'fail')) ? 'fail' : pages.some((pg) => pg.issues.some((x) => /Title/.test(x.msg))) ? 'warn' : 'pass', label: 'Page titles present and ≤ 60 characters', detail: `${pages.filter((pg) => pg.titleLen > TITLE_MAX).length} page(s) over ${TITLE_MAX} characters.`, step: 'pages' });
    add('pages', { id: 'descs', weight: 3, status: pages.some((pg) => pg.issues.some((x) => /[Dd]escription/.test(x.msg) && x.status === 'fail')) ? 'fail' : pages.some((pg) => pg.issues.some((x) => /[Dd]escription/.test(x.msg))) ? 'warn' : 'pass', label: 'Meta descriptions present, 70–160 characters', detail: `${pages.filter((pg) => !pg.descLen).length} missing · ${pages.filter((pg) => pg.descLen > DESC_MAX).length} too long · ${pages.filter((pg) => pg.descLen && pg.descLen < 70).length} short.`, step: 'pages' });
    add('pages', { id: 'h1', weight: 2, status: pages.every((pg) => pg.h1 === 1) ? 'pass' : pages.some((pg) => pg.h1 === 0) ? 'fail' : 'warn', label: 'Exactly one H1 per page', detail: `${pages.filter((pg) => pg.h1 !== 1).length} page(s) need attention.`, step: 'content' });
    add('pages', { id: 'alt', weight: 2, status: pages.every((pg) => !pg.imgsNoAlt) ? 'pass' : 'warn', label: 'All images have alt attributes', detail: `${pages.reduce((s, pg) => s + pg.imgsNoAlt, 0)} image tag(s) missing alt across the site.`, step: 'content' });
    add('pages', { id: 'canonical', weight: 2, status: pages.every((pg) => pg.canonical) ? 'pass' : 'warn', label: 'Canonical link on every page', detail: pages.every((pg) => pg.canonical) ? 'Prevents duplicate-content issues between www/non-www and http/https.' : 'Set the canonical site URL under Basics.', step: 'basics', field: 'siteUrl' });
    add('pages', { id: 'jsonld', weight: 3, status: pages.some((pg) => pg.issues.some((x) => /JSON-LD/.test(x.msg))) ? 'fail' : pages[0] && pages[0].jsonLd.length ? 'pass' : 'warn', label: 'Structured data present and valid', detail: pages[0] ? `Home page: ${pages[0].jsonLd.join(', ') || 'none'}.` : '', step: 'schema' });
    add('pages', { id: 'speed', weight: 1, status: worst('warn') && pages.some((pg) => pg.ms > 1500) ? 'warn' : 'pass', label: 'Server response time', detail: `Slowest page ${Math.max(...pages.map((pg) => pg.ms))} ms (local).`, step: 'hosting' });

    // robots & sitemap over HTTP
    const [rob, sm] = await Promise.all([fetchLocal(port, '/robots.txt', { host: hostOf(base) || 'localhost' }), fetchLocal(port, '/sitemap.xml', { host: hostOf(base) || 'localhost' })]);
    const robBlocksAll = robotsBlocksAll(rob.body);
    add('setup', { id: 'robotsTxt', weight: 3, status: rob.status === 200 ? (robBlocksAll ? 'fail' : 'pass') : 'fail', label: 'robots.txt reachable and not blocking the site', detail: rob.status === 200 ? (robBlocksAll ? 'robots.txt contains "Disallow: /" — the whole site is blocked.' : `${rob.body.trim().split('\n').length} lines · ${/Sitemap:/i.test(rob.body) ? 'references the sitemap' : 'no Sitemap: line (set the site URL)'}`) : `HTTP ${rob.status}`, step: 'search', field: 'robots.custom' });
    const urlCount = (sm.body.match(/<loc>/g) || []).length;
    add('setup', { id: 'sitemapXml', weight: 2, status: sm.status === 200 && urlCount ? 'pass' : 'fail', label: 'sitemap.xml reachable', detail: sm.status === 200 ? `${urlCount} URL(s) listed.` : `HTTP ${sm.status}`, step: 'search' });
  }

  // ---- score
  const scored = checks.filter((c) => c.status !== 'info');
  const max = scored.reduce((s, c) => s + c.weight, 0);
  const got = scored.reduce((s, c) => s + (c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0), 0);
  const score = max ? Math.round((got / max) * 100) : 0;
  const GROUPS = [
    { id: 'setup', title: 'Search engine setup' },
    { id: 'pages', title: 'Live pages' },
    { id: 'content', title: 'Content & keywords' },
    { id: 'local', title: 'Local SEO' },
  ];
  return {
    score,
    generatedAt: new Date().toISOString(),
    base,
    summary: { pass: scored.filter((c) => c.status === 'pass').length, warn: scored.filter((c) => c.status === 'warn').length, fail: scored.filter((c) => c.status === 'fail').length },
    groups: GROUPS.map((gr) => ({ ...gr, checks: checks.filter((c) => c.group === gr.id) })).filter((gr) => gr.checks.length),
    pages,
  };
}

module.exports = {
  PAGE_KEYS, PAGE_PATHS, PAGE_LABELS, SCHEMA_TYPES, HOME_TITLE_TEMPLATES, PAGE_TITLE_TEMPLATES, TITLE_MAX, DESC_MAX,
  baseUrl, absolute, templateVars, renderTemplate,
  pageMeta, renderHead, jsonLd, renderJsonLd, renderAnalyticsHead, renderBodyStart, renderBodyEnd,
  robotsTxt, sitemapEntries, sitemapXml, middleware, suggestions, audit, parseHtml,
  parseRobots, robotsBlocksAll, robotsBlockedAgents,
};
