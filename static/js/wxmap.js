// Interactive weather map (src/pages/wxmap.js): a MapLibre map of the country from
// its own outline, a colour field (wind speed, temperature or rain) from the
// forecast grid with wind particles on top, city labels, and the live Meteosat
// satellite loop. The timeline steps through the grid (every 3 hours) or the
// satellite images (every 10 minutes).
import { icon, weatherIconName } from './icons.js?v=mvrdend4';
import { SCALES, LUTS, rgba, dilate } from './wxscales.js?v=mvrdend4';

const root = document.querySelector('[data-wxm]');
if (root) init(root).catch((err) => console.error('[wxmap]', err));

// ------------------------------------------------------------------ projection helpers

const R = 6378137;
const mercX = (lon) => (R * lon * Math.PI) / 180;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfY = (y) => (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90;

const waitFor = (test) => new Promise((resolve) => {
  if (test()) return resolve();
  const id = setInterval(() => { if (test()) { clearInterval(id); resolve(); } }, 30);
});

// ------------------------------------------------------------------ main

async function init(el) {
  const cfg = JSON.parse(el.dataset.wxm);
  const S = cfg.s;
  const nf = (d) => new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
  const geo = JSON.parse(el.querySelector('.wxm-geo').textContent);
  const cityList = JSON.parse(el.querySelector('.wxm-cities').textContent);
  const [meta, buf, citySeries] = await Promise.all([
    fetch(cfg.grid).then((r) => r.json()),
    fetch(cfg.bin).then((r) => r.arrayBuffer()),
    fetch(cfg.cities).then((r) => r.json()).catch(() => []),
  ]);
  await waitFor(() => window.maplibregl);
  const maplibregl = window.maplibregl;

  // ---- grid
  const { nx, ny, step: gstep, lon0, lat0 } = meta;
  const lon1 = lon0 + (nx - 1) * gstep, lat1 = lat0 + (ny - 1) * gstep;
  const N = nx * ny;
  const i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  const steps = meta.times.map((x) => Date.parse(x));
  const B = meta.bytes || 4;
  const U = new Float32Array(N), V = new Float32Array(N), T = new Float32Array(N), P = new Float32Array(N);
  // Waves: height (m), and the direction they travel towards as a vector (WU east, WV north).
  const WH = new Float32Array(N), WU = new Float32Array(N), WV = new Float32Array(N);
  let WHfill = WH; // WH spread two cells inland, for the colour field drawn under the land
  const loadStep = (s) => {
    for (let i = 0; i < N; i++) {
      const o = (s * N + i) * B;
      U[i] = i8[o] === -128 ? NaN : i8[o] * 0.5;
      V[i] = i8[o + 1] === -128 ? NaN : i8[o + 1] * 0.5;
      T[i] = i8[o + 2] === -128 ? NaN : i8[o + 2];
      P[i] = u8[o + 3] === 255 ? NaN : u8[o + 3] * 0.2;
      WH[i] = B < 6 || u8[o + 4] === 255 ? NaN : u8[o + 4] * 0.1;
      const a = B < 6 || u8[o + 5] === 255 ? NaN : (u8[o + 5] * 2 * Math.PI) / 180;
      // From the direction they come from: 2 + 1.5 m/s per metre of height, for the particles.
      const sp = 2 + 1.5 * (WH[i] || 0);
      WU[i] = -Math.sin(a) * sp;
      WV[i] = -Math.cos(a) * sp;
    }
    WHfill = dilate(WH, nx, ny);
  };
  // Bilinear value of a field at lon / lat (NaN outside the grid).
  const sample = (A, lon, lat) => {
    const fx = (lon - lon0) / gstep, fy = (lat - lat0) / gstep;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return NaN;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy));
    const dx = fx - i, dy = fy - j, k = j * nx + i;
    return (A[k] * (1 - dx) + A[k + 1] * dx) * (1 - dy) + (A[k + nx] * (1 - dx) + A[k + nx + 1] * dx) * dy;
  };
  const value = (layer, lon, lat) => {
    if (layer === 'wind') return Math.hypot(sample(U, lon, lat), sample(V, lon, lat)) * 3.6;
    if (layer === 'temp') return sample(T, lon, lat);
    if (layer === 'waves') return sample(WHfill, lon, lat);
    return sample(P, lon, lat);
  };

  // ---- state
  const layerKeys = Object.keys(cfg.urls);
  // The page's layer (each layer has its own page); an old #layer link still works.
  let layer = !cfg.inPage && layerKeys.includes(location.hash.slice(1)) ? location.hash.slice(1) : cfg.layer || 'wind';
  const nowMs = Date.now();
  let fStep = Math.max(0, steps.findIndex((x) => x + (meta.hours * 3_600_000) / 2 > nowMs));
  let sat = { frames: [], idx: 0, ready: false };
  let playing = false, timer = null;

  // ---- map
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const poly = (rings) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) } });
  const lines = (ls) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: ls } });
  const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const gridCorners = [[lon0, lat1], [lon1, lat1], [lon1, lat0], [lon0, lat0]];
  const land = [geo.outline, ...geo.islands];
  const outlineLons = geo.outline.map((p) => p[0]), outlineLats = geo.outline.map((p) => p[1]);
  const countryBounds = [[Math.min(...outlineLons), Math.min(...outlineLats)], [Math.max(...outlineLons), Math.max(...outlineLats)]];

  // Room for the layer buttons (top) and the timeline (bottom).
  const fitPadding = () => {
    const small = el.clientWidth < 640;
    // The top city (Tanger) needs room for its label under the layer buttons.
    return { top: small ? 64 : 78, bottom: small ? 118 : 112, left: 12, right: small ? 12 : 56 };
  };
  const map = new maplibregl.Map({
    container: el.querySelector('.wxm-map'),
    bounds: countryBounds,
    fitBoundsOptions: { padding: fitPadding() },
    // Only the area with data: the view never goes beyond the grid.
    maxBounds: [[lon0, lat0], [lon1, lat1]],
    minZoom: 3, maxZoom: 9,
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        neighbours: { type: 'geojson', data: poly(geo.neighbours) },
        land: { type: 'geojson', data: poly(land) },
        regions: { type: 'geojson', data: lines(geo.regions) },
        field: { type: 'image', url: blank, coordinates: gridCorners },
        sat: { type: 'image', url: blank, coordinates: gridCorners },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': css('--map-sea') } },
        { id: 'neighbours', type: 'fill', source: 'neighbours', paint: { 'fill-color': css('--map-other') } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': css('--map-land') } },
        { id: 'field', type: 'raster', source: 'field', paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } },
        { id: 'regions', type: 'line', source: 'regions', paint: { 'line-color': 'rgba(255,255,255,0.55)', 'line-width': 0.8, 'line-dasharray': [3, 2] } },
        { id: 'neighbours-line', type: 'line', source: 'neighbours', paint: { 'line-color': 'rgba(255,255,255,0.45)', 'line-width': 0.8 } },
        { id: 'land-line', type: 'line', source: 'land', paint: { 'line-color': 'rgba(255,255,255,0.95)', 'line-width': 1.4 } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), cfg.rtl ? 'top-left' : 'top-right');
  await new Promise((r) => map.on('load', r));
  // The container's final size is known now: fit the whole country.
  map.resize();
  map.fitBounds(countryBounds, { padding: fitPadding(), duration: 0 });

  // Theme: the base colours follow the site's light / dark theme.
  // Borders: white over the colour fields and the satellite, the theme's border colour where the land shows (rain, waves).
  const lineColors = () => {
    const pale = layer === 'rain' || layer === 'waves';
    map.setPaintProperty('land-line', 'line-color', pale ? css('--map-border') : 'rgba(255,255,255,0.95)');
    map.setPaintProperty('regions', 'line-color', pale ? css('--map-border') : 'rgba(255,255,255,0.55)');
    map.setPaintProperty('neighbours-line', 'line-color', pale ? css('--map-border') : 'rgba(255,255,255,0.45)');
  };
  const applyTheme = () => {
    lineColors();
    map.setPaintProperty('sea', 'background-color', css('--map-sea'));
    map.setPaintProperty('neighbours', 'fill-color', css('--map-other'));
    map.setPaintProperty('land', 'fill-color', css('--map-land'));
  };
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ---- colour field: the grid drawn into an image in Web Mercator rows
  const fieldCanvas = document.createElement('canvas');
  const FW = Math.min(720, nx * 12);
  const y0m = mercY(lat0), y1m = mercY(lat1);
  const FH = Math.round((FW * (y1m - y0m)) / (mercX(lon1) - mercX(lon0)));
  fieldCanvas.width = FW; fieldCanvas.height = FH;
  const fctx = fieldCanvas.getContext('2d');
  const rowLat = Float32Array.from({ length: FH }, (_, y) => latOfY(y1m - ((y1m - y0m) * y) / (FH - 1)));
  const drawField = () => {
    if (layer === 'sat') return;
    const { out, lo, hi } = LUTS[layer];
    const img = fctx.createImageData(FW, FH);
    const d = img.data;
    for (let y = 0; y < FH; y++) {
      const lat = rowLat[y];
      for (let x = 0; x < FW; x++) {
        const v = value(layer, lon0 + ((lon1 - lon0) * x) / (FW - 1), lat);
        const o = (y * FW + x) * 4;
        if (Number.isNaN(v)) { d[o + 3] = 0; continue; }
        const k = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255))) * 4;
        d[o] = out[k]; d[o + 1] = out[k + 1]; d[o + 2] = out[k + 2]; d[o + 3] = out[k + 3];
      }
    }
    fctx.putImageData(img, 0, 0);
    map.getSource('field').updateImage({ url: fieldCanvas.toDataURL(), coordinates: gridCorners });
  };

  // ---- wind particles
  const pc = el.querySelector('.wxm-particles');
  const pctx = pc.getContext('2d');
  let dpr = 1, parts = [];
  const view = () => {
    const b = map.getBounds();
    return [Math.max(lon0, b.getWest()), Math.max(lat0, b.getSouth()), Math.min(lon1, b.getEast()), Math.min(lat1, b.getNorth())];
  };
  const spawn = (p, v) => {
    p.lon = v[0] + Math.random() * (v[2] - v[0]);
    p.lat = v[1] + Math.random() * (v[3] - v[1]);
    p.age = 0;
    p.max = 40 + Math.random() * 60;
    return p;
  };
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    const { width, height } = map.getContainer().getBoundingClientRect();
    pc.width = Math.round(width * dpr); pc.height = Math.round(height * dpr);
    pc.style.width = `${width}px`; pc.style.height = `${height}px`;
    const count = Math.round(Math.min(4500, (width * height) / 260));
    const v = view();
    parts = Array.from({ length: count }, () => spawn({}, v));
    for (const p of parts) p.age = Math.random() * p.max;
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let moving = false;
  const PX_PER_MS = 0.11; // screen px per frame for 1 m/s
  const tick = () => {
    requestAnimationFrame(tick);
    if (layer === 'sat' || moving || document.hidden) return;
    pctx.globalCompositeOperation = 'destination-in';
    pctx.fillStyle = 'rgba(0,0,0,0.92)';
    pctx.fillRect(0, 0, pc.width, pc.height);
    pctx.globalCompositeOperation = 'source-over';
    const z = map.getZoom();
    const degPerPx = 360 / (512 * 2 ** z);
    const v = view();
    pctx.beginPath();
    for (const p of parts) {
      const u = sample(layer === 'waves' ? WU : U, p.lon, p.lat), w = sample(layer === 'waves' ? WV : V, p.lon, p.lat);
      if (p.age++ > p.max || Number.isNaN(u) || Number.isNaN(w)) { spawn(p, v); continue; }
      const k = PX_PER_MS * degPerPx * (reduced ? 0.4 : 1);
      const nlon = p.lon + (u * k) / Math.cos((p.lat * Math.PI) / 180), nlat = p.lat + w * k;
      const a = map.project([p.lon, p.lat]), b = map.project([nlon, nlat]);
      pctx.moveTo(a.x * dpr, a.y * dpr);
      pctx.lineTo(b.x * dpr, b.y * dpr);
      p.lon = nlon; p.lat = nlat;
    }
    pctx.strokeStyle = layer === 'rain' ? 'rgba(40,50,70,0.55)' : 'rgba(255,255,255,0.8)';
    pctx.lineWidth = 1.1 * dpr;
    pctx.stroke();
  };
  const clearParticles = () => pctx.clearRect(0, 0, pc.width, pc.height);
  map.on('movestart', () => { moving = true; clearParticles(); hideReadout(); });
  map.on('moveend', () => { moving = false; const v = view(); for (const p of parts) spawn(p, v); });
  map.on('resize', () => { resize(); placeLabels(); });
  resize();
  requestAnimationFrame(tick);

  // ---- city labels: as many as fit, the most important first
  const labelBox = el.querySelector('.wxm-labels');
  const cities = cityList.map(([name, lon, lat, url], i) => {
    const a = document.createElement('a');
    a.className = 'wxm-city';
    a.href = url;
    a.innerHTML = `<span class="c-sym"></span><b class="c-t"></b><span class="c-n"></span>`;
    a.querySelector('.c-n').textContent = name;
    a.tabIndex = -1;
    const dot = document.createElement('i');
    dot.className = 'wxm-dot';
    labelBox.append(dot, a);
    return { a, dot, lon, lat, series: citySeries[i] || [], w: 0, h: 0 };
  });
  // Labels: temperature and symbol; on the waves layer only the coastal cities, with their wave height.
  const fillLabels = () => {
    for (const c of cities) {
      const s = c.series[fStep];
      const waves = layer === 'waves';
      c.skip = waves && s?.[3] == null;
      const showT = layer !== 'sat' && s && !c.skip;
      c.a.classList.toggle('no-t', !showT);
      c.a.querySelector('.c-t').textContent = !showT ? '' : waves ? `${nf(1).format(s[3])}\u202f${S.m}` : `${s[0]}°`;
      c.a.querySelector('.c-sym').innerHTML = showT && !waves && s[1] >= 0 ? icon(weatherIconName(s[1], !!s[2]) || 'cloud', 'ic-w') : '';
      c.w = 0;
    }
  };
  // Each shown city has a dot; its label goes beside it (right, left, above or below), wherever there is room.
  // [x, y] of the label's corner from the dot: beside, above, below, then the four corners.
  const SIDES = ['right', 'left', 'above', 'below', 'above-right', 'below-right', 'above-left', 'below-left']
    .map((side) => (cfg.rtl ? side.replace(/left|right/, (m) => (m === 'left' ? 'right' : 'left')) : side));
  const at = (side, p, w, h) => [
    side === 'right' ? p.x + 7 : side === 'left' ? p.x - 7 - w : side.endsWith('right') ? p.x + 2 : side.endsWith('left') ? p.x - 2 - w : p.x - w / 2,
    side.startsWith('above') ? p.y - 6 - h : side.startsWith('below') ? p.y + 6 : p.y - h / 2,
  ];
  const placeLabels = () => {
    const { width, height } = map.getContainer().getBoundingClientRect();
    const taken = [];
    // Room for the layer buttons and the timeline.
    const top = 50, bottom = height - (el.clientWidth < 640 ? 112 : 108);
    const overlap = (r, q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3];
    const pts = cities.map((c) => map.project([c.lon, c.lat]));
    // A label may not hide the spot of one of the largest cities, which come later in the loop.
    const major = pts.slice(0, 16).map((p, i) => [i, [p.x - 5, p.y - 5, p.x + 5, p.y + 5]]);
    // (Not one right next to this city: that one gives way.)
    const far = (i, j) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 14;
    for (const [ci, c] of cities.entries()) {
      const p = pts[ci];
      if (c.skip) { c.a.style.display = c.dot.style.display = 'none'; continue; }
      if (!c.w) { c.a.style.display = ''; c.w = c.a.offsetWidth; c.h = c.a.offsetHeight; }
      let box = null;
      // The dot itself (3 px): a city whose spot is free of other labels can still be shown.
      const dotBox = [p.x - 2, p.y - 2, p.x + 2, p.y + 2];
      if (p.x > 0 && p.x < width && p.y > top && p.y < bottom && !taken.some((q) => overlap(dotBox, q))) {
        // The free side that hides the least important of the large cities' spots (none, ideally).
        let best = Infinity;
        for (const side of SIDES) {
          const [x, y] = at(side, p, c.w, c.h);
          const r = [x - 2, y - 2, x + c.w + 2, y + c.h + 2];
          if (r[0] <= 0 || r[2] >= width || r[1] <= top || r[3] >= bottom || taken.some((q) => overlap(r, q))) continue;
          const cost = major.reduce((sum, [i, q]) => sum + (i > ci && far(i, ci) && overlap(r, q) ? major.length - i : 0), 0);
          if (cost < best) { best = cost; box = r; }
          if (cost === 0) break;
        }
      }
      c.a.style.display = c.dot.style.display = box ? '' : 'none';
      if (!box) continue;
      taken.push(box, dotBox);
      c.a.style.transform = `translate(${Math.round(box[0] + 2)}px, ${Math.round(box[1] + 2)}px)`;
      c.dot.style.transform = `translate(${Math.round(p.x - 3)}px, ${Math.round(p.y - 3)}px)`;
    }
  };
  map.on('move', placeLabels);

  // ---- point readout on click
  const readout = el.querySelector('.wxm-readout');
  const hideReadout = () => { readout.hidden = true; };
  const fromDir = (deg) => S.from[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  map.on('click', (e) => {
    if (layer === 'sat') return;
    const { lng, lat } = e.lngLat;
    const u = sample(U, lng, lat), w = sample(V, lng, lat), t = sample(T, lng, lat), r = sample(P, lng, lat);
    if (Number.isNaN(u)) return hideReadout();
    const spd = Math.hypot(u, w) * 3.6;
    const from = (Math.atan2(-u, -w) * 180) / Math.PI;
    const wh = sample(WH, lng, lat);
    const wave = layer === 'waves' && !Number.isNaN(wh)
      ? `<span><b>${nf(1).format(wh)}</b> ${S.m} ${fromDir((Math.atan2(-sample(WU, lng, lat), -sample(WV, lng, lat)) * 180) / Math.PI)}</span>` : '';
    readout.innerHTML = `${wave}<span><b>${nf(0).format(spd)}</b> ${S.kmh} ${fromDir(from)}</span><span><b>${nf(0).format(t)}°</b></span>${layer === 'waves' ? '' : `<span><b>${nf(1).format(r)}</b> ${S.mm3h}</span>`}`;
    readout.hidden = false;
    const { width } = map.getContainer().getBoundingClientRect();
    readout.style.transform = `translate(${Math.round(Math.min(width - readout.offsetWidth - 8, Math.max(8, e.point.x - readout.offsetWidth / 2)))}px, ${Math.round(e.point.y + 14)}px)`;
  });

  // ---- legend
  const legendBar = el.querySelector('.wxm-legend-bar'), legendTicks = el.querySelector('.wxm-legend-ticks');
  const drawLegend = () => {
    const legend = el.querySelector('.wxm-legend');
    legend.hidden = layer === 'sat';
    if (layer === 'sat') return;
    const sc = SCALES[layer], lo = sc.stops[0][0], hi = sc.stops[sc.stops.length - 1][0];
    // Rain: a log-like spread, its stops close to zero would otherwise vanish.
    const pos = (v) => (layer === 'rain' ? Math.sqrt((v - lo) / (hi - lo)) : (v - lo) / (hi - lo)) * 100;
    const stops = sc.stops.map((st) => `${rgba(layer === 'rain' ? [st[0], st[1], st[2], st[3], Math.max(st[4], 0.08)] : st)} ${pos(st[0]).toFixed(1)}%`);
    legendBar.style.background = `linear-gradient(to ${cfg.rtl ? 'left' : 'right'}, ${stops.join(',')})`;
    const unit = sc.unit === 'kmh' ? S.kmh : sc.unit === 'mm' ? S.mm3h : sc.unit === 'm' ? S.m : '°C';
    legendTicks.innerHTML = sc.ticks.map((v) => `<span style="inset-inline-start:${pos(v).toFixed(1)}%">${nf(v < 1 && v > 0 ? 1 : 0).format(v)}</span>`).join('') + `<em>${unit}</em>`;
  };

  // ---- timeline
  const slider = el.querySelector('.wxm-slider'), when = el.querySelector('.wxm-when'), daysEl = el.querySelector('.wxm-days');
  const playBtn = el.querySelector('.wxm-play');
  const local = (ms) => new Date(ms + cfg.offset * 1000);
  const fmtDay = new Intl.DateTimeFormat(cfg.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtWeekday = new Intl.DateTimeFormat(cfg.locale, { weekday: 'short', timeZone: 'UTC' });
  const fmtTime = new Intl.DateTimeFormat(cfg.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  const setupTimeline = () => {
    if (layer === 'sat') {
      slider.max = Math.max(0, sat.frames.length - 1);
      slider.value = sat.idx;
      daysEl.innerHTML = '';
    } else {
      slider.max = steps.length - 1;
      slider.value = fStep;
      // A label at each local midnight.
      let html = '';
      steps.forEach((ms, i) => {
        const d = local(ms);
        if (i > 0 && d.getUTCHours() < meta.hours) html += `<span style="inset-inline-start:${((i / (steps.length - 1)) * 100).toFixed(2)}%">${fmtWeekday.format(d)}</span>`;
      });
      daysEl.innerHTML = html;
    }
    showWhen();
  };
  const showWhen = () => {
    if (layer === 'sat') {
      const f = sat.frames[sat.idx];
      when.textContent = f ? S.satNote.replace('{time}', fmtTime.format(local(f.ms))) : (sat.error ? S.satError : S.satLoading);
    } else {
      const d = local(steps[fStep]);
      when.textContent = `${fmtDay.format(d)} · ${fmtTime.format(d)}`;
    }
  };
  const go = (i) => {
    if (layer === 'sat') {
      sat.idx = i;
      const f = sat.frames[i];
      sat.shown = f;
      if (f) map.getSource('sat').updateImage({ url: f.url, coordinates: satCorners });
    } else {
      fStep = i;
      loadStep(fStep);
      drawField();
      fillLabels();
      placeLabels();
    }
    slider.value = i;
    showWhen();
  };
  slider.addEventListener('input', () => { if (layer === 'sat') sat.touched = true; go(Number(slider.value)); });
  const setPlaying = (on) => {
    playing = on;
    clearInterval(timer);
    playBtn.classList.toggle('is-playing', on);
    playBtn.setAttribute('aria-label', on ? S.pause : S.play);
    if (!on) return;
    timer = setInterval(() => {
      const max = Number(slider.max);
      if (max < 1) return;
      go(Number(slider.value) >= max ? 0 : Number(slider.value) + 1);
    }, layer === 'sat' ? 450 : 1000);
  };
  playBtn.addEventListener('click', () => { if (layer === 'sat') sat.touched = true; setPlaying(!playing); });

  // ---- satellite (EUMETSAT Meteosat, every 10 minutes, the last 2 hours)
  const satW = 1024, satH = Math.round((satW * (y1m - y0m)) / (mercX(lon1) - mercX(lon0)));
  const satCorners = gridCorners;
  const loadSat = () => {
    if (sat.started) return;
    sat.started = true;
    const latest = Math.floor((Date.now() - 25 * 60_000) / 600_000) * 600_000;
    const times = Array.from({ length: 12 }, (_, k) => latest - (11 - k) * 600_000);
    const url = (ms) => `https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=mtg_fd:rgb_geocolour&styles=&format=image/jpeg&crs=EPSG:3857&bbox=${[mercX(lon0), y0m, mercX(lon1), y1m].map((x) => x.toFixed(0)).join(',')}&width=${satW}&height=${satH}&time=${new Date(ms).toISOString().slice(0, 16)}:00Z`;
    // The newest image first, then the older ones, a few at a time.
    const queue = [...times].reverse();
    let pending = queue.length, active = 0;
    const next = () => {
      while (active < 4 && queue.length) {
        const ms = queue.shift();
        const img = new Image();
        active++;
        img.crossOrigin = 'anonymous';
        img.onload = () => { add({ ms, url: img.src }); finish(); };
        img.onerror = finish;
        img.src = url(ms);
      }
    };
    const add = (frame) => {
      sat.frames = [...sat.frames, frame].sort((a, b) => a.ms - b.ms);
      // Stay on the image shown: the newest, unless the reader picked another.
      sat.idx = sat.touched ? sat.frames.indexOf(sat.shown ?? frame) : sat.frames.length - 1;
      if (layer === 'sat') { setupTimeline(); go(sat.idx); }
    };
    function finish() {
      active--; pending--;
      if (pending === 0 && !sat.frames.length) { sat.error = true; if (layer === 'sat') showWhen(); }
      next();
    }
    next();
  };

  // ---- layers: the links switch the map in place and bring in that page's text and title
  const links = [...el.querySelectorAll('.wxm-layers [data-layer]')];
  const setLayer = (k) => {
    setPlaying(false);
    layer = k;
    for (const a of links) {
      if (a.tagName === 'BUTTON') a.setAttribute('aria-pressed', String(a.dataset.layer === k));
      else if (a.dataset.layer === k) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    el.dataset.layer = k;
    const isSat = k === 'sat';
    map.setLayoutProperty('field', 'visibility', isSat ? 'none' : 'visible');
    map.setLayoutProperty('sat', 'visibility', isSat ? 'visible' : 'none');
    // The waves go under the land (they are spread inland to reach the coast); the other fields over it.
    map.moveLayer('field', k === 'waves' ? 'neighbours' : 'sat');
    clearParticles();
    hideReadout();
    if (isSat) loadSat(); else drawField();
    lineColors();
    fillLabels();
    placeLabels();
    drawLegend();
    setupTimeline();
    if (isSat && sat.frames.length) go(sat.idx);
  };
  // The summary, heading, title and breadcrumb of another layer's page.
  const swapPage = async (url) => {
    try {
      const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html');
      for (const sel of ['.wxm-summary', 'h1.page-title', '.crumbs']) {
        const from = doc.querySelector(sel), to = document.querySelector(sel);
        if (from && to) to.innerHTML = from.innerHTML;
      }
      document.title = doc.title;
    } catch { location.href = url; }
  };
  const layerOfPath = (p) => layerKeys.find((k) => cfg.urls[k] === p) || (p === cfg.overview ? 'wind' : null);
  links.forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    // On the home page (inPage) the map changes alone; on a map page, the page follows.
    if (cfg.inPage) { if (a.dataset.layer !== layer) setLayer(a.dataset.layer); return; }
    if (a.dataset.layer === layer && location.pathname === a.pathname) return;
    setLayer(a.dataset.layer);
    history.pushState(null, '', a.pathname);
    swapPage(a.pathname);
  }));
  if (!cfg.inPage) addEventListener('popstate', () => {
    const k = layerOfPath(location.pathname);
    if (!k) return;
    setLayer(k);
    swapPage(location.pathname);
  });
  if (!cfg.inPage && location.hash && layerKeys.includes(location.hash.slice(1))) {
    history.replaceState(null, '', cfg.urls[layer]);
    swapPage(cfg.urls[layer]);
  }

  loadStep(fStep);
  setLayer(layer);
  el.classList.add('is-ready');
}
