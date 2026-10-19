// Home page weather map: the day, time of day and symbols / wind selectors
// redraw every marker from its data-w ([day][period] → [code, isDay, high, low,
// wind, direction]). The markup matches markerInner() in src/pages/map.js.
import { icon, weatherIconName, windArrow } from './icons.js?v=mvfpd29d';

function markerInner(s, wind, kmh = 'km/h') {
  const [code, isDay, hi, lo, w, dir] = s || [];
  const sym = wind ? (dir != null ? windArrow(dir) : icon('wind')) : icon(weatherIconName(code, !!isDay) || 'cloud', 'ic-w');
  const vals = wind ? `<b class="mk-wind">${w ?? '–'}</b><small>${kmh}</small>` : `<b class="mk-hi">${hi ?? '–'}°</b><b class="mk-lo">${lo ?? '–'}°</b>`;
  return `<span class="mk-sym">${sym}</span><span class="mk-t">${vals}</span>`;
}

for (const map of document.querySelectorAll('[data-wx-map]')) {
  const day = map.querySelector('.wx-day');
  const period = map.querySelector('.wx-period');
  const layer = map.querySelector('.wx-layer');
  const markers = [...map.querySelectorAll('.wx-mk')].map((li) => ({ row: li.querySelector('.mk-row'), data: JSON.parse(li.dataset.w) }));
  const render = () => {
    const d = Number(day.value), p = Number(period.value), wind = layer.value === '1';
    map.classList.toggle('show-wind', wind);
    for (const m of markers) m.row.innerHTML = markerInner(m.data[d]?.[p], wind, map.dataset.kmh);
  };
  for (const el of [day, period, layer]) el.addEventListener('change', render);
  // A choice kept by the browser on back / forward navigation.
  if (day.value !== '0' || period.value !== '0' || layer.value !== '0') render();
}
