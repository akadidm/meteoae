/* Dark mode switch and city search. No dependencies. */
(function () {
  'use strict';
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  // ------------------------------------------------------------ dark mode
  // The theme follows the system until the reader picks one; the <head> script applies a saved choice before paint.
  var root = document.documentElement;
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark() {
    var th = root.getAttribute('data-theme');
    return th ? th === 'dark' : !!(darkQuery && darkQuery.matches);
  }
  function syncTheme() {
    var dark = isDark();
    var btn = document.querySelector('.theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', dark ? '#0b1120' : '#f4f6fb');
  }
  document.addEventListener('click', function (e) {
    if (!(e.target.closest && e.target.closest('.theme-toggle'))) return;
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store.set('theme', next);
    syncTheme();
  });
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', syncTheme);
  syncTheme();

  // ------------------------------------------------------------ search
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var MONTH_ALIASES = { jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  // Arabic month names, Moroccan and Middle-Eastern (as norm() writes them: alef without hamza).
  ['يناير', 'فبراير', 'مارس', 'ابريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'اكتوبر', 'نونبر', 'دجنبر'].forEach(function (m, i) { MONTH_ALIASES[m] = i + 1; });
  [['مايو', 5], ['يوليو', 7], ['اغسطس', 8], ['سبتمبر', 9], ['نوفمبر', 11], ['ديسمبر', 12]].forEach(function (m) { MONTH_ALIASES[m[0]] = m[1]; });
  MONTHS.forEach(function (m, i) { MONTH_ALIASES[m] = i + 1; });
  var STOP = /(?:^|\s)(weather|history|historical|historic|temperature|temperatures|temp|rainfall|rain|precipitation|forecast|previsions?|today|tomorrow|aujourd'?hui|demain|data|in|on|at|the|of|for|what|was|how|hot|cold|meteo|wetter|clima|tiempo|temps|a|au|le|la|les|de|du|des|en|historique|طقس|الطقس|حالة|توقعات|اليوم|غدا|في|تاريخ)(?=\s|$)/g;
  var index = null;
  var loading = null;
  // Accents off; Arabic: no diacritics or tatweel, alef forms unified.
  function norm(s) { return s.normalize('NFKD').replace(/[̀-ͯ\u064b-\u065f\u0640]/g, '').replace(/[\u0622\u0623\u0625]/g, '\u0627').toLowerCase(); }
  function loadIndex(url) {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(url).then(function (r) { return r.json(); }).then(function (list) {
        list.forEach(function (x) {
          x._n = norm(x.n); x._c = norm(x.c); x._r = norm(x.r || '');
          x._a = (x.a || []).map(norm);
        });
        index = list;
        return list;
      });
    }
    return loading;
  }

  // Dates and weather words are dropped, so "rabat août 2020" still finds Rabat.
  function parseQuery(q) {
    var s = ' ' + norm(q).replace(/[,./]+/g, ' ') + ' ';
    s = s.replace(/\b(19[4-9]\d|20\d\d)\b/g, ' ');
    var words = s.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/(st|nd|rd|th)$/, '');
      if (MONTH_ALIASES[words[i]] || (/^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31)) s = s.replace(new RegExp('\\b' + words[i] + '\\b'), ' ');
    }
    var text = s.replace(/\b(climate|climat|records?)\b|مناخ/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    return { text: text };
  }

  function score(x, text) {
    if (!text) return 0;
    var best = 0;
    var words = text.split(' ').filter(function (w) { return w.length >= 3; });
    function test(name, weight) {
      if (!name) return;
      if (name === text) best = Math.max(best, 100 * weight);
      else if (name.indexOf(text) === 0) best = Math.max(best, 80 * weight);
      else if (text.indexOf(name) >= 0 && name.length >= 3) best = Math.max(best, 70 * weight);
      else if (name.indexOf(text) > 0) best = Math.max(best, 40 * weight);
      // Every typed word in the name, in any order: "kelaa sraghna" → "El Kelaa des Sraghna".
      else if (words.length > 1 && words.every(function (w) { return name.indexOf(w) >= 0; })) best = Math.max(best, 50 * weight);
    }
    test(x._n, 1);
    x._a.forEach(function (a) { test(a, 0.95); });
    test(x._n + ' ' + x._c, 0.9);
    return best ? best + Math.log10(1 + x.p) : 0;
  }

  function suggestions(q, prefix, L) {
    L = L || {};
    var p = parseQuery(q);
    var out = index.map(function (x) { return { x: x, s: score(x, p.text) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 6)
      .map(function (r) {
        var x = r.x;
        return { label: L.forecast ? L.forecast.replace('{city}', x.n) : x.n + ' forecast', sub: [x.r, x.c].filter(Boolean).join(', '), url: prefix + x.u };
      });
    // Countries
    var seen = {};
    index.forEach(function (x) {
      if (x.cs && !seen[x.cs] && p.text && (x._c === p.text || (p.text.length >= 3 && x._c.indexOf(p.text) === 0))) {
        seen[x.cs] = 1;
        out.push({ label: x.c, sub: L.country || 'Country', url: prefix + '/weather/' + x.cs + '/' });
      }
    });
    return out.slice(0, 8);
  }


  function initSearch(form) {
    var input = form.querySelector('input');
    var list = form.querySelector('.search-results');
    var items = [];
    var sel = -1;
    var prefix = form.getAttribute('data-prefix') || '';
    var labels = {};
    try { labels = JSON.parse(form.getAttribute('data-s') || '{}'); } catch (e) { /* defaults */ }
    function render() {
      list.innerHTML = '';
      items.forEach(function (it, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = list.id + '-' + i;
        if (i === sel) li.setAttribute('aria-selected', 'true');
        var a = document.createElement('a');
        a.href = it.url;
        a.textContent = it.label;
        var small = document.createElement('small');
        small.textContent = it.sub || '';
        a.appendChild(small);
        li.appendChild(a);
        list.appendChild(li);
      });
      list.hidden = !items.length;
      input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
      if (sel >= 0) input.setAttribute('aria-activedescendant', list.id + '-' + sel); else input.removeAttribute('aria-activedescendant');
    }
    function update() {
      var q = input.value.trim();
      if (!q) { items = []; sel = -1; render(); return; }
      loadIndex(form.getAttribute('data-index')).then(function () {
        items = suggestions(q, prefix, labels);
        sel = items.length ? 0 : -1;
        render();
      });
    }
    input.addEventListener('focus', function () { loadIndex(form.getAttribute('data-index')); });
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        render();
      } else if (e.key === 'Escape') { items = []; render(); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var go = function () { if (items[sel] || items[0]) location.href = (items[sel] || items[0]).url; };
      if (items.length) go();
      else loadIndex(form.getAttribute('data-index')).then(function () { items = suggestions(input.value, prefix, labels); sel = 0; if (items.length) go(); else render(); });
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) { items = []; render(); } });
  }
  window.wxSearch = { parse: parseQuery, suggest: function (q, prefix, labels) { return suggestions(q, prefix || '', labels); }, load: loadIndex };
  var forms = document.querySelectorAll('form.search');
  for (var i = 0; i < forms.length; i++) initSearch(forms[i]);
})();
