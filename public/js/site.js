/* Guest-site behaviour: mobile nav, sticky header shadow, hero slideshow, booking-bar dates, filters, lightbox. */
(function () {
  'use strict';

  // ---- mobile nav ----
  var toggle = document.querySelector('[data-nav-toggle]');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('hidden') === false;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.icon-open').classList.toggle('hidden', open);
      toggle.querySelector('.icon-close').classList.toggle('hidden', !open);
    });
  }

  // ---- header shadow on scroll ----
  var header = document.getElementById('site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---- hero slideshow ----
  var hero = document.querySelector('[data-hero]');
  if (hero) {
    var slides = Array.prototype.slice.call(hero.querySelectorAll('.hero-slide'));
    var dots = Array.prototype.slice.call(hero.querySelectorAll('[data-hero-dot]'));
    var current = 0;
    var interval = (parseInt(hero.getAttribute('data-interval'), 10) || 7) * 1000;
    var timer = null;
    var show = function (i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, idx) { s.classList.toggle('opacity-100', idx === current); s.classList.toggle('opacity-0', idx !== current); });
      dots.forEach(function (d, idx) { d.classList.toggle('bg-white', idx === current); d.classList.toggle('bg-transparent', idx !== current); });
    };
    var start = function () { if (slides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { timer = setInterval(function () { show(current + 1); }, interval); } };
    dots.forEach(function (d) { d.addEventListener('click', function () { clearInterval(timer); show(parseInt(d.getAttribute('data-hero-dot'), 10)); start(); }); });
    start();
  }

  // ---- booking bar: sensible default dates & keep check-out after check-in ----
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var today = new Date();
  var tomorrow = new Date(today.getTime() + 86400000);
  document.querySelectorAll('[data-checkin]').forEach(function (ci) {
    var form = ci.closest('form');
    var co = form ? form.querySelector('[data-checkout]') : null;
    ci.min = iso(today);
    if (!ci.value) ci.value = iso(today);
    if (co) {
      co.min = iso(tomorrow);
      if (!co.value) co.value = iso(tomorrow);
      ci.addEventListener('change', function () {
        var d = new Date(ci.value + 'T00:00:00');
        if (isNaN(d)) return;
        var next = new Date(d.getTime() + 86400000);
        co.min = iso(next);
        if (!co.value || co.value <= ci.value) co.value = iso(next);
      });
    }
  });

  // ---- category filters (gallery, attractions) ----
  document.querySelectorAll('[data-filter-group]').forEach(function (group) {
    var name = group.getAttribute('data-filter-group');
    var items = document.querySelector('[data-filter-items="' + name + '"]');
    if (!items) return;
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-filter]');
      if (!btn) return;
      var f = btn.getAttribute('data-filter');
      group.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('is-active', c === btn); });
      Array.prototype.forEach.call(items.children, function (el) {
        el.classList.toggle('is-hidden', f !== '*' && el.getAttribute('data-category') !== f);
      });
    });
  });

  // ---- lightbox ----
  var lb = document.getElementById('lightbox');
  if (lb) {
    var img = lb.querySelector('[data-lb-img]');
    var cap = lb.querySelector('[data-lb-caption]');
    var list = [];
    var idx = 0;
    var open = function (items, i) {
      list = items; idx = i;
      render();
      lb.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    var close = function () { lb.classList.remove('is-open'); document.body.style.overflow = ''; };
    var render = function () {
      var it = list[idx];
      if (!it) return;
      img.src = it.src; img.alt = it.caption || ''; cap.textContent = it.caption || '';
      lb.querySelector('[data-lb-prev]').style.visibility = list.length > 1 ? 'visible' : 'hidden';
      lb.querySelector('[data-lb-next]').style.visibility = list.length > 1 ? 'visible' : 'hidden';
    };
    var step = function (n) { idx = (idx + n + list.length) % list.length; render(); };
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-lightbox]');
      if (!a) return;
      e.preventDefault();
      var group = a.closest('[data-lightbox-group]') || document;
      var links = Array.prototype.slice.call(group.querySelectorAll('[data-lightbox]')).filter(function (el) { return !el.classList.contains('is-hidden'); });
      var items = links.map(function (el) { return { src: el.getAttribute('href'), caption: el.getAttribute('data-caption') || '' }; });
      open(items, Math.max(0, links.indexOf(a)));
    });
    lb.querySelector('[data-lb-close]').addEventListener('click', close);
    lb.querySelector('[data-lb-prev]').addEventListener('click', function () { step(-1); });
    lb.querySelector('[data-lb-next]').addEventListener('click', function () { step(1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }
})();
