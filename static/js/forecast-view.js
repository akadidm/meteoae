// A location's weather forecast: current conditions, the daily
// forecast and an hour-by-hour view of one day. Shared by the build (the
// HTML of the forecast page, from the latest snapshot) and the browser
// (static/js/forecast.js re-renders it for the reader's clock, refreshes it from
// Open-Meteo when the snapshot is old, and switches the day shown), so both
// produce identical markup. Browser-safe: no Node imports.
import { SPRITE } from './icons.js?v=mvhdguuf';
import { esc } from './esc.js?v=mvhdguuf';
import { icon, windArrow, weatherIconName } from './icons.js?v=mvhdguuf';
import { fmt, pad } from './view-format.js?v=mvhdguuf';

// Open-Meteo counts a request as (variables / 10) x (days / 14) calls per
// location: these 32 variables over 15 days cost about 3.5 calls.
export const FC_CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'is_day'];
export const FC_DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'uv_index_max', 'sunrise', 'sunset'];
export const FC_HOURLY = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'relative_humidity_2m', 'cloud_cover', 'uv_index', 'is_day'];

/** Forecast API URL for one or more points ({lat, lon, timezone}); one result per point, in order. */
export function forecastApiUrl(points, { days = 14, apiKey = null } = {}) {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    timezone: points.map((p) => p.timezone).join(','),
    forecast_days: String(days),
    current: FC_CURRENT.join(','),
    daily: FC_DAILY.join(','),
    hourly: FC_HOURLY.join(','),
  });
  if (apiKey) params.set('apikey', apiKey);
  return `${apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'}/v1/forecast?${params}`;
}

const num = (v) => (v == null || Number.isNaN(v) ? null : v);
const hhmm = (v) => (typeof v === 'string' && v.includes('T') ? v.slice(11, 16) : null);

/**
 * One Open-Meteo forecast result → the compact model the views render
 * (also published as /data/<country>/<city>/forecast.json).
 * fetched: ISO time (UTC) of the download.
 */
export function normalizeForecast(json, fetched) {
  const d = json.daily;
  const h = json.hourly;
  const c = json.current;
  const hv = (k, i) => num(h[k]?.[i]); // variables added later are missing from older snapshots
  return {
    tz: json.timezone,
    offset: json.utc_offset_seconds ?? null,
    fetched,
    grid: [json.latitude, json.longitude, json.elevation ?? null],
    current: c ? {
      time: c.time, t: num(c.temperature_2m), feels: num(c.apparent_temperature), rh: num(c.relative_humidity_2m), code: num(c.weather_code),
      wind: num(c.wind_speed_10m), dir: num(c.wind_direction_10m), gust: num(c.wind_gusts_10m), pressure: num(c.pressure_msl), isDay: c.is_day !== 0,
    } : null,
    days: d.time.map((date, i) => ({
      date, code: num(d.weather_code[i]), tmax: num(d.temperature_2m_max[i]), tmin: num(d.temperature_2m_min[i]),
      precip: num(d.precipitation_sum[i]), pop: num(d.precipitation_probability_max[i]),
      wind: num(d.wind_speed_10m_max[i]), gust: num(d.wind_gusts_10m_max[i]), dir: num(d.wind_direction_10m_dominant[i]),
      uv: num(d.uv_index_max[i]), sunrise: hhmm(d.sunrise[i]), sunset: hhmm(d.sunset[i]),
    })).filter((x) => x.tmax != null || x.tmin != null),
    hours: h.time.map((time, i) => ({
      time, t: num(h.temperature_2m[i]), pop: num(h.precipitation_probability[i]), precip: num(h.precipitation[i]), code: num(h.weather_code[i]),
      wind: num(h.wind_speed_10m[i]), dir: num(h.wind_direction_10m[i]), isDay: h.is_day[i] !== 0,
      feels: hv('apparent_temperature', i), gust: hv('wind_gusts_10m', i), rh: hv('relative_humidity_2m', i), cloud: hv('cloud_cover', i), uv: hv('uv_index', i),
    })).filter((x) => x.t != null),
  };
}

/**
 * Local wall-clock time of a forecast's location, as 'YYYY-MM-DDTHH:MM' (the
 * format of the API's local times). Uses the API's UTC offset rather than the
 * browser's time-zone database, which can be out of date (Morocco changes its
 * offset around Ramadan).
 */
export function localNow(F, date = new Date()) {
  if (F.offset != null) return new Date(date.getTime() + F.offset * 1000).toISOString().slice(0, 16);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: F.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Days from the local "today" onwards. */
export const upcomingDays = (F, now) => F.days.filter((d) => d.date >= now.slice(0, 10));

const minutesBetween = (a, b) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/**
 * Current conditions: the observed-model "current" block while it is recent,
 * otherwise the forecast for the current hour (labelled as such).
 */
function nowBlock(F, now) {
  if (F.current && Math.abs(minutesBetween(F.current.time, now)) <= 90) return { ...F.current, live: true };
  const hour = F.hours.find((h) => h.time === `${now.slice(0, 13)}:00`);
  return hour ? { time: hour.time, t: hour.t, code: hour.code, wind: hour.wind, dir: hour.dir, isDay: hour.isDay, pop: hour.pop, live: false } : null;
}

function dayLabel(S, f, iso, today) {
  if (iso === today) return S.today;
  const tomorrow = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1)).toISOString().slice(0, 10);
  return iso === tomorrow ? S.tomorrow : f.weekday(iso);
}

const tile = (ic, label, value, sub = '') => `<div class="tile"><div class="tile-label">${icon(ic)}${esc(label)}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
const popText = (S, p) => (p == null ? '' : esc(fill(S.pop, { pct: Math.round(p) })));

/**
 * The whole forecast view.
 * F: normalized forecast; now: local time 'YYYY-MM-DDTHH:MM'; sel: index of
 * the day shown hour by hour; S: translated strings.
 */
export function forecastViewHtml({ F, now, sel = 0, S, lang }) {
  const f = fmt(S, lang);
  const days = upcomingDays(F, now);
  if (!days.length) return `<p class="callout">${esc(S.stale)}</p>`;
  const today = now.slice(0, 10);
  const T0 = days[0];
  const cur = nowBlock(F, now);

  // ---- now
  let nowHtml = '';
  if (cur) {
    const facts = [
      cur.feels != null ? [icon('thermo'), S.feelsLike, f.T(cur.feels)] : null,
      cur.rh != null ? [icon('humidity'), S.humidity, f.pct(cur.rh)] : null,
      [icon('wind'), S.wind, cur.wind == null ? f.na : `<span class="with-ic">${cur.dir != null ? windArrow(cur.dir) : ''}${f.W(cur.wind)}</span>`],
      cur.gust != null ? [icon('gust'), S.gust, f.W(cur.gust)] : null,
      cur.pressure != null ? [icon('gauge'), S.pressure, f.hPa(cur.pressure)] : null,
      cur.pop != null ? [icon('umbrella'), S.chanceOfRain, f.pct(cur.pop)] : null,
      T0.sunrise ? [icon('sunrise'), S.sunrise, T0.sunrise] : null,
      T0.sunset ? [icon('sunset'), S.sunset, T0.sunset] : null,
    ].filter(Boolean);
    nowHtml = `<div class="fc-now" data-sky="${sky(cur.code)}" data-day="${cur.isDay === false ? 0 : 1}">
<div class="fc-now-main">
  <p class="fc-now-label">${esc(cur.live ? fill(S.nowAt, { time: cur.time.slice(11, 16) }) : fill(S.forecastAt, { time: cur.time.slice(11, 16) }))}</p>
  <div class="fc-now-temp">${icon(weatherIconNameFor(cur.code, cur.isDay), 'ic-w ic-big')}<span>${f.T(cur.t)}</span></div>
  <p class="fc-now-cond">${cur.code != null && cur.code in S.wmo ? esc(S.wmo[cur.code]) : ''}</p>
  <p class="fc-now-hilo">${esc(S.high)} ${f.T(T0.tmax)} · ${esc(S.low)} ${f.T(T0.tmin)}</p>
</div>
<dl class="fc-now-facts">${facts.map(([ic, k, v]) => `<div><dt>${ic}${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
</div>`;
  }

  // ---- days: a strip of day cards (tabs), then one panel per day, hour by hour.
  // Every panel is in the HTML; only the selected one is shown.
  const cards = days.map((d, i) => {
    const on = i === sel;
    const wet = d.precip != null && d.precip >= S.rainyMm;
    return `<li role="presentation"><button type="button" role="tab" id="fc-tab-${i}" class="fc-dc${i >= 7 ? ' far' : ''}" data-day="${i}" aria-selected="${on}" aria-controls="fc-panel-${i}"${on ? '' : ' tabindex="-1"'}>
<span class="fc-dc-day">${esc(dayLabel(S, f, d.date, today))}</span>
<span class="fc-dc-date">${esc(f.shortDate(d.date))}</span>
${icon(weatherIconNameFor(d.code, true), 'ic-w fc-dc-ic')}<span class="fc-dc-cond">${d.code in S.wmo ? esc(S.wmo[d.code]) : ''}</span>
<span class="fc-dc-t"><b>${f.Tr(d.tmax)}</b> / <span>${f.Tr(d.tmin)}</span></span>
<span class="fc-dc-rain${wet ? ' wet' : ''}">${icon('droplet')}${d.pop == null ? '' : `${Math.round(d.pop)}&#8239;%`}${wet ? ` · ${f.P(d.precip)}` : ''}</span>
<span class="fc-dc-wind">${d.dir != null ? windArrow(d.dir) : icon('wind')}${f.W(d.wind)}</span>
</button></li>`;
  }).join('');
  const weeks = days.length > 7 ? `<div class="fc-weeks">${[[0, 7], [7, days.length]].map(([x, y], k) => `<button type="button" data-scroll="${x}" aria-pressed="${k === 0}">${esc(fill(S.daysRange, { a: x + 1, b: y }))}</button>`).join('')}</div>` : '';
  const panels = days.map((d, i) => dayPanelHtml({ F, d, i, sel, now, today, S, f })).join('\n');
  const list = `<div class="fc-days-head"><h2 class="fc-h2">${esc(fill(S.daysTitle, { n: days.length }))}</h2>${weeks}</div>
<ol class="fc-strip15" role="tablist" aria-label="${esc(S.forecastDay)}">${cards}</ol>
${days.length > 7 ? `<p class="muted fc-note">${esc(S.farNote)}</p>` : ''}
${panels}`;

  return `${nowHtml}
<div class="fc-days-wrap">${list}</div>
<h3>${esc(S.chartsTitle)}</h3>${comboChart({ days, sel, S, f })}`;
}

/**
 * One day hour by hour (every 3 hours after the first week), each hour
 * expandable for humidity, cloud cover, UV and gusts.
 */
function dayPanelHtml({ F, d, i, sel, now, today, S, f }) {
  const current = `${now.slice(0, 13)}:00`;
  let hours = F.hours.filter((h) => h.time.startsWith(d.date) && (d.date !== today || h.time >= current));
  if (i >= 7) hours = hours.filter((h) => Number(h.time.slice(11, 13)) % 3 === 0);
  const compass = (deg) => S.compass[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const rows = hours.map((h) => {
    const wet = h.precip != null && h.precip >= 0.1;
    const more = [
      h.rh != null && `${esc(S.humidity)} <b>${f.pct(h.rh)}</b>`,
      h.cloud != null && `${esc(S.cloudCover)} <b>${f.pct(h.cloud)}</b>`,
      h.uv != null && `${esc(S.uv)} <b>${f.num(h.uv, 0)}</b>`,
      h.gust != null && `${esc(S.gusts)} <b>${f.W(h.gust)}</b>`,
      `${esc(S.precip)} <b>${f.P(h.precip ?? 0)}</b>`,
    ].filter(Boolean);
    return `<li><details class="fc-hr"><summary${h.time === current ? ' class="now"' : ''}>
<span class="fc-hr-time">${h.time.slice(11, 16)}</span>
<span class="fc-hr-ic">${icon(weatherIconNameFor(h.code, h.isDay), 'ic-w')}</span>
<span class="fc-hr-t">${f.Tr(h.t)}</span>
<span class="fc-hr-cond">${h.code in S.wmo ? esc(S.wmo[h.code]) : ''}${h.feels != null ? `<small>${esc(S.feelsLike)} ${f.Tr(h.feels)}</small>` : ''}</span>
<span class="fc-hr-wind">${h.dir != null ? windArrow(h.dir) : icon('wind')}<span><b class="fc-hr-dir">${h.dir != null ? esc(compass(h.dir)) : ''}</b><small>${f.W(h.wind)}<span class="fc-hr-gust">${h.gust != null ? ` – ${f.W(h.gust)}` : ''}</span></small></span></span>
<span class="fc-hr-rain${wet ? ' wet' : ''}">${icon('droplet')}<span>${h.pop == null ? '' : `${Math.round(h.pop)}&#8239;%`}<small>${wet ? f.P(h.precip) : ''}</small></span></span>
<span class="fc-chev" aria-hidden="true"></span>
</summary><p class="fc-hr-more">${more.join('<span aria-hidden="true"> · </span>')}</p></details></li>`;
  }).join('');
  const facts = [
    d.sunrise && `${icon('sunrise')}${esc(S.sunriseSunset)} <b>${d.sunrise} · ${d.sunset || '–'}</b>`,
    d.uv != null && `${icon('sun')}${esc(S.uv)} <b>${f.num(d.uv, 0)}</b> (${esc(uvLevel(S, d.uv))})`,
    d.gust != null && `${icon('gust')}${esc(S.gusts)} <b>${f.W(d.gust)}</b>`,
    d.precip != null && `${icon('droplet')}${esc(S.precip)} <b>${f.P(d.precip)}</b>`,
  ].filter(Boolean);
  const title = d.date === today ? S.todayTitle : fill(S.dayTitle, { date: `${f.weekday(d.date)} ${f.date(d.date)}` });
  return `<section class="fc-panel" role="tabpanel" id="fc-panel-${i}" aria-labelledby="fc-tab-${i}"${i === sel ? '' : ' hidden'}>
<div class="fc-panel-head"><h3 class="fc-panel-title">${esc(title)} <span class="fc-detail-cond">${f.code(d.code)}</span></h3>
<div class="fc-hours-view" role="group" aria-label="${esc(S.hoursView)}"><button type="button" data-hours="strip">${esc(S.hoursStrip)}</button><button type="button" data-hours="list">${esc(S.hoursList)}</button></div></div>
<p class="fc-panel-facts">${facts.map((x) => `<span>${x}</span>`).join('')}</p>
${rows ? `<ol class="fc-hrs">${rows}</ol>` : `<p class="muted">${esc(S.noHourly)}</p>`}
</section>`;
}

// Smooth curve through points (Catmull-Rom as cubic Béziers); gaps (null) split it.
function smoothPath(pts) {
  const runs = [];
  let run = [];
  for (const p of pts) { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } }
  if (run.length) runs.push(run);
  return runs.map((r) => r.map((p, i) => {
    if (i === 0) return `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const p0 = r[i - 2] || r[i - 1], p1 = r[i - 1], p3 = r[i + 1] || p;
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
    return `C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }).join('')).join('');
}

/**
 * One chart for the whole forecast: the day's weather icon, high and low as
 * smooth labelled curves, and precipitation bars underneath. Each column
 * selects its day (static/js/forecast.js), like the day cards.
 */
function comboChart({ days, sel, S, f }) {
  const n = days.length;
  const colW = 64, W = n * colW, top = 82, tempH = 150, gap = 50, rainH = 54, axisH = 40;
  const H = top + tempH + gap + rainH + axisH;
  const temps = days.flatMap((d) => [d.tmax, d.tmin]).filter((v) => v != null);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const span = Math.max(hi - lo, 4);
  const y = (v) => top + ((hi - v) / span) * tempH;
  // Right to left pages run the days from the right edge, like the day cards.
  const x = (i) => (S.rtl ? n - 1 - i : i) * colW + colW / 2;
  const rainTop = top + tempH + gap, rainBase = rainTop + rainH;
  const pMax = Math.max(5, ...days.map((d) => d.precip ?? 0));
  const num0 = (v) => f.num(Math.round(v) || 0, 0);
  const tLabel = (v) => `<tspan data-t="${Number(v.toFixed(1))}" data-dp="0">${num0(v)}</tspan>°`;
  const cols = days.map((d, i) => {
    const cx = x(i);
    const name = weatherIconNameFor(d.code, true);
    const rain = d.precip ?? 0;
    const bh = rain > 0 ? Math.max(2, (rain / pMax) * rainH) : 0;
    return `<g class="fc-cc${i === sel ? ' sel' : ''}" data-day="${i}">
<rect class="fc-cc-hit" x="${cx - colW / 2}" y="0" width="${colW}" height="${H}" rx="8"/>
${d.tmax != null ? `<use href="${SPRITE}#${name}" x="${cx - 16}" y="${y(d.tmax) - 62}" width="32" height="32"/>` : ''}
${d.tmax != null ? `<text class="fc-cc-hi" x="${cx}" y="${y(d.tmax) - 12}">${tLabel(d.tmax)}</text>` : ''}
${d.tmin != null ? `<text class="fc-cc-lo" x="${cx}" y="${y(d.tmin) + 24}">${tLabel(d.tmin)}</text>` : ''}
${bh ? `<rect class="fc-cc-bar" x="${cx - 13}" y="${(rainBase - bh).toFixed(1)}" width="26" height="${bh.toFixed(1)}" rx="3"/><text class="fc-cc-mm" x="${cx}" y="${(rainBase - bh - 5).toFixed(1)}"><tspan data-p="${Number(rain.toFixed(1))}" data-dp="1">${f.num(rain, 1)}</tspan></text>` : ''}
<text class="fc-cc-day" x="${cx}" y="${rainBase + 18}">${esc(f.weekdayShort(d.date))}</text>
<text class="fc-cc-date" x="${cx}" y="${rainBase + 34}">${Number(d.date.slice(8, 10))}</text>
</g>`;
  }).join('');
  const line = (k, cls) => `<path class="fc-cc-line ${cls}" d="${smoothPath(days.map((d, i) => (d[k] == null ? null : [x(i), y(d[k])])))}"/>`;
  const dots = (k, cls) => days.map((d, i) => (d[k] == null ? '' : `<circle class="fc-cc-dot ${cls}" cx="${x(i)}" cy="${y(d[k]).toFixed(1)}" r="3.5"/>`)).join('');
  return `<figure class="chart fc-combo">
<div class="fc-combo-legend"><span class="k-max">${esc(S.high)}</span><span class="k-min">${esc(S.low)}</span><span class="k-rain">${esc(S.precip)}</span></div>
<div class="fc-combo-scroll"><svg class="fc-combo-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(S.tempAria)}">
<line class="fc-cc-base" x1="0" x2="${W}" y1="${rainBase}" y2="${rainBase}"/>
${cols}${line('tmax', 's-max')}${line('tmin', 's-min')}${dots('tmax', 's-max')}${dots('tmin', 's-min')}
</svg></div></figure>`;
}

function uvLevel(S, uv) {
  const i = uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4;
  return S.uvLevels[i];
}

// Always an icon: unknown codes fall back to a plain cloud.
function weatherIconNameFor(code, isDay) { return weatherIconName(code, isDay) || 'cloud'; }

/** The sky behind the current conditions (static/site.css colours it, with day / night). */
function sky(code) {
  if (code == null) return 'cloudy';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48 || code === 3) return 'cloudy';
  return code === 2 ? 'partly' : 'clear';
}

/** Compact day card used on country and home pages: [{date, code, tmax, tmin, precip, wind}]. */
export function dayChipHtml(d, f) {
  return `${icon(weatherIconNameFor(d.code, true), 'ic-w')}<b>${f.T(d.tmax)}</b><span>${f.T(d.tmin)}</span>`;
}

export { pad };
