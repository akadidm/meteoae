// Inline references to the SVG sprite in static/icons.svg. Icons are decorative
// (aria-hidden): every icon sits next to a visible text label.
import { ASSET_VERSION } from './version.js?v=mveigajt';

export const SPRITE = `/static/icons.svg?v=${ASSET_VERSION}`;

// i-<name> lets site.css give each measure icon its own colour (rain blue, heat orange …).
export const icon = (name, cls = '') => `<svg class="ic i-${name}${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;

/** WMO weather code → condition icon; isDay false picks the night variant (hourly forecasts). */
export function weatherIconName(code, isDay = true) {
  if (code == null) return null;
  if (code === 0) return isDay ? 'w-clear' : 'w-clear-night';
  if (code === 1) return isDay ? 'w-mostly-clear' : 'w-clear-night';
  if (code === 2) return isDay ? 'w-partly-cloudy' : 'w-partly-cloudy-night';
  if (code === 3) return 'w-overcast';
  if (code === 45 || code === 48) return 'w-fog';
  if (code >= 51 && code <= 55) return 'w-drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'w-freezing';
  if (code === 61 || code === 63) return 'w-rain';
  if (code === 65) return 'w-heavy-rain';
  if (code >= 80 && code <= 82) return 'w-showers';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'w-snow';
  if (code >= 95) return 'w-thunder';
  return null;
}

/**
 * Arrow showing where the wind blows to. Meteorological direction is where it
 * comes from, so a north wind (0°) points down.
 */
export const windArrow = (deg) => `<svg class="ic ic-wind-dir" aria-hidden="true" style="transform:rotate(${Math.round(deg)}deg)"><use href="${SPRITE}#arrow"/></svg>`;
