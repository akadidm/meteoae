// Value formatters for browser-rendered views (the forecast view). Shared by
// the build and the browser. Browser-safe: no Node imports.
import { esc } from './esc.js?v=mvukxtsh';
import { icon, weatherIconName, windArrow } from './icons.js?v=mvukxtsh';

export const pad = (n) => String(n).padStart(2, '0');

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Value formatters for browser-rendered views; S carries the translated strings. */
export function fmt(S, lang) {
  const nfs = [0, 1].map((d) => new Intl.NumberFormat(lang, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const num = (v, d = 1) => nfs[d].format(v);
  const u = S.units || { C: '°C', mm: 'mm', kmh: 'km/h', hPa: 'hPa', cm: 'cm', h: 'h', min: 'min' };
  const na = `<span class="na">${esc(S.na)}</span>`;
  const unit = (kind, v, d, suffix, signed = false) => {
    if (v == null) return na;
    const r = Number(v.toFixed(d));
    return `<i data-${kind}="${r}"${signed ? ' data-sign' : ''}>${signed && r > 0 ? '+' : ''}${num(r === 0 ? 0 : r, d)} ${suffix}</i>`;
  };
  const date = (iso) => fill(S.dateFormat, { month: S.monthsLong[Number(iso.slice(5, 7)) - 1], monthShort: S.monthsShort[Number(iso.slice(5, 7)) - 1], day: Number(iso.slice(8, 10)), year: iso.slice(0, 4) });
  const shortDate = (iso) => fill(S.shortDateFormat, { month: S.monthsLong[Number(iso.slice(5, 7)) - 1], monthShort: S.monthsShort[Number(iso.slice(5, 7)) - 1], day: Number(iso.slice(8, 10)) });
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
  const weekdayShort = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
  return {
    na, num, date, shortDate,
    weekday: (iso) => weekday.format(new Date(`${iso}T12:00:00Z`)),
    weekdayShort: (iso) => weekdayShort.format(new Date(`${iso}T12:00:00Z`)),
    monthYear: (y, m) => fill(S.monthYearFormat, { month: S.monthsLong[m - 1], year: y }),
    T: (v) => unit('t', v, 1, u.C),
    // Rounded, unit-less "26°" (the unit switch keeps data-dp="0").
    Tr: (v) => (v == null ? na : `<i data-t="${Number(v.toFixed(1))}" data-dp="0">${num(Math.round(v) || 0, 0)}</i>°`),
    TD: (v) => unit('td', v, 1, u.C, true),
    P: (v) => unit('p', v, 1, u.mm),
    W: (v) => unit('w', v, 0, u.kmh),
    S: (v) => unit('s', v, 1, u.cm),
    hPa: (v) => (v == null ? na : `${num(v, 0)} ${u.hPa}`),
    pct: (v) => (v == null ? na : `${num(v, 0)} %`),
    hours: (v, d = 1) => (v == null ? na : `${num(v, d)} ${u.h}`),
    hm: (h) => {
      if (h == null) return na;
      const total = Math.round(h * 60);
      return `${Math.floor(total / 60)}&#8239;${u.h} ${pad(total % 60)}&#8239;${u.min}`;
    },
    dir: (deg) => (deg == null ? na : `<span class="with-ic">${windArrow(deg)}${S.compass[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]} (${Math.round(deg)}°)</span>`),
    code: (c, isDay = true) => {
      if (c == null || !(c in S.wmo)) return na;
      const name = weatherIconName(c, isDay);
      return `<span class="with-ic cond">${name ? icon(name, 'ic-w') : ''}${esc(S.wmo[c])}</span>`;
    },
  };
}
