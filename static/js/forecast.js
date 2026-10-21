// Forecast page: renders the forecast for the reader's clock (the HTML was
// rendered at build time), refreshes it straight from Open-Meteo when the
// build's snapshot is older than data-refresh minutes, and switches the day
// shown hour by hour from the strip of day cards (#day=N, a fragment so
// no duplicate URLs get crawled). forecast-view.js is
// the build's own module, so the markup matches. Also drives the day tabs of the forecast cards on country / home pages.
import { forecastViewHtml, normalizeForecast, localNow, upcomingDays } from './forecast-view.js?v=mvhdiq6y';

const view = document.getElementById('forecast-view');

if (view) {
  const S = JSON.parse(view.dataset.strings);
  const { lang, live } = view.dataset;
  const refreshMin = Number(view.dataset.refresh) || 0;
  let F = null;
  // #day=N; ?day=N from old links still works and is dropped from the URL.
  const dayParam = new URLSearchParams(location.hash.slice(1)).get('day') ?? new URLSearchParams(location.search).get('day');
  let sel = Math.max(0, Number(dayParam) || 0);

  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const ageMin = (x) => (Date.now() - Date.parse(x.fetched)) / 60000;

  async function load() {
    const snapshot = await fetch(view.dataset.json).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!live || !refreshMin || (snapshot && ageMin(snapshot) < refreshMin)) return snapshot;
    const cached = session.get(live);
    if (cached && ageMin(cached) < Math.min(refreshMin, 15)) return cached;
    try {
      const json = await fetch(live).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
      const fresh = normalizeForecast(json, new Date().toISOString());
      session.set(live, fresh);
      return fresh;
    } catch {
      return snapshot; // offline or rate-limited: keep the build's snapshot
    }
  }

  function render() {
    const now = localNow(F);
    sel = Math.min(sel, Math.max(0, upcomingDays(F, now).length - 1));
    view.innerHTML = forecastViewHtml({ F, now, sel, S, lang });
    for (const b of view.querySelectorAll('.fc-hours-view button')) b.setAttribute('aria-pressed', String(b.dataset.hours === (view.dataset.hours || 'strip')));
    if (sel) showCard(sel, 'instant');
  }

  // Scrolls the strip to a day card and marks its week ("Days 1–7" / "8–15").
  function showCard(i, behavior = 'smooth') {
    view.querySelector(`.fc-dc[data-day="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
    for (const b of view.querySelectorAll('.fc-weeks button')) b.setAttribute('aria-pressed', String(Number(b.dataset.scroll) === (i >= 7 ? 7 : 0)));
  }

  function select(i, focus = false) {
    const tabs = [...view.querySelectorAll('.fc-dc')];
    if (!tabs[i]) return;
    sel = i;
    for (const t of tabs) {
      const on = Number(t.dataset.day) === sel;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const p of view.querySelectorAll('.fc-panel')) p.hidden = p.id !== `fc-panel-${sel}`;
    for (const c of view.querySelectorAll('.fc-cc')) c.classList.toggle('sel', Number(c.dataset.day) === sel);
    if (focus) tabs[i].focus();
    showCard(sel);
    const url = new URL(location.href);
    url.searchParams.delete('day');
    url.hash = sel ? `day=${sel}` : '';
    history.replaceState(null, '', url.hash ? url : url.href.replace(/#$/, ''));
  }

  // Hours as a strip of cards (the default) or the detailed list; the choice is kept.
  const HOURS_KEY = 'hours-view';
  const setHours = (v) => {
    view.dataset.hours = v;
    for (const b of view.querySelectorAll('.fc-hours-view button')) b.setAttribute('aria-pressed', String(b.dataset.hours === v));
  };
  let hoursView = 'strip';
  try { hoursView = localStorage.getItem(HOURS_KEY) === 'list' ? 'list' : 'strip'; } catch { /* storage off */ }
  setHours(hoursView);
  view.addEventListener('click', (e) => {
    const hv = e.target.closest?.('.fc-hours-view button');
    if (hv) {
      hoursView = hv.dataset.hours;
      setHours(hoursView);
      try { localStorage.setItem(HOURS_KEY, hoursView); } catch { /* storage off */ }
      return;
    }
    // In the strip an hour is a card, not an expandable row.
    if (view.dataset.hours !== 'list' && e.target.closest?.('.fc-hr > summary')) { e.preventDefault(); return; }
  });
  view.addEventListener('click', (e) => {
    const tab = e.target.closest?.('.fc-dc, .fc-cc');
    if (tab) {
      select(Number(tab.dataset.day));
      // From the chart, bring the day's hours into view.
      if (tab.matches('.fc-cc')) view.querySelector(`#fc-panel-${sel}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const week = e.target.closest?.('.fc-weeks button');
    if (week) {
      view.querySelector('.fc-strip15').children[Number(week.dataset.scroll)]?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' });
      for (const b of view.querySelectorAll('.fc-weeks button')) b.setAttribute('aria-pressed', String(b === week));
    }
  });

  // Arrow keys move between day cards (tabs pattern).
  view.addEventListener('keydown', (e) => {
    if (!e.target.closest?.('.fc-dc')) return;
    const rtl = getComputedStyle(view).direction === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, Home: -Infinity, End: Infinity }[e.key];
    if (step == null) return;
    e.preventDefault();
    const n = view.querySelectorAll('.fc-dc').length;
    select(Math.max(0, Math.min(n - 1, Number.isFinite(step) ? sel + step : step < 0 ? 0 : n - 1)), true);
  });

  load().then((data) => {
    if (!data) return;
    F = data;
    render();
    // Keep "now" and the next hours current on a page left open.
    setInterval(render, 10 * 60 * 1000);
  });
}

// Day tabs on forecast card grids.
for (const grid of document.querySelectorAll('[data-fc-grid]')) {
  grid.addEventListener('click', (e) => {
    const b = e.target.closest?.('.fc-tabs button');
    if (!b) return;
    const i = b.dataset.day;
    for (const t of grid.querySelectorAll('.fc-tabs button')) t.setAttribute('aria-selected', String(t === b));
    for (const d of grid.querySelectorAll('.fc-card-day')) d.hidden = d.dataset.day !== i;
  });
}
