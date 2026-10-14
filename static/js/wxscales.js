// Colour scales of the weather map layers, shared by the browser map
// (static/js/wxmap.js) and the build's preview images (src/pages/wxmap.js).
// [value, r, g, b, a]; colours between stops are interpolated.
export const SCALES = {
  wind: { unit: 'kmh', ticks: [0, 20, 40, 60, 80, 100], stops: [
    [0, 98, 113, 183, 1], [7, 57, 97, 159, 1], [14, 74, 148, 169, 1], [22, 77, 141, 123, 1], [30, 83, 165, 83, 1],
    [40, 53, 159, 53, 1], [50, 167, 157, 81, 1], [60, 159, 127, 58, 1], [72, 161, 108, 92, 1], [85, 129, 58, 78, 1],
    [100, 175, 80, 136, 1], [120, 117, 74, 147, 1], [150, 109, 97, 163, 1]] },
  temp: { unit: '°', ticks: [-10, 0, 10, 20, 30, 40], stops: [
    [-20, 96, 48, 136, 1], [-10, 60, 82, 180, 1], [0, 62, 140, 200, 1], [5, 80, 180, 190, 1], [10, 110, 196, 150, 1],
    [15, 170, 210, 110, 1], [20, 232, 222, 105, 1], [25, 245, 180, 80, 1], [30, 235, 125, 60, 1], [35, 210, 70, 60, 1],
    [40, 160, 30, 70, 1], [48, 100, 10, 50, 1]] },
  rain: { unit: 'mm', ticks: [0.5, 2, 5, 10, 20], stops: [
    [0, 0, 0, 0, 0], [0.15, 120, 190, 240, 0], [0.4, 120, 190, 240, 0.55], [1, 60, 150, 235, 0.75], [2.5, 30, 100, 220, 0.85],
    [5, 60, 60, 200, 0.9], [10, 140, 50, 200, 0.92], [20, 210, 40, 170, 0.95], [40, 250, 60, 90, 0.95]] },
  waves: { unit: 'm', ticks: [0.5, 1, 2, 3, 4, 6], stops: [
    [0, 40, 70, 150, 1], [0.5, 50, 110, 190, 1], [1, 60, 160, 200, 1], [1.5, 80, 190, 160, 1], [2, 150, 205, 100, 1],
    [2.5, 225, 210, 80, 1], [3, 240, 165, 60, 1], [4, 225, 100, 60, 1], [5, 195, 50, 80, 1], [6, 150, 40, 130, 1], [9, 100, 40, 160, 1]] },
};

export function lut(scale) {
  const s = scale.stops, lo = s[0][0], hi = s[s.length - 1][0];
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255;
    let k = 1;
    while (k < s.length - 1 && s[k][0] < v) k++;
    const a = s[k - 1], b = s[k], f = Math.max(0, Math.min(1, (v - a[0]) / (b[0] - a[0] || 1)));
    for (let c = 0; c < 4; c++) out[i * 4 + c] = (a[c + 1] + (b[c + 1] - a[c + 1]) * f) * (c === 3 ? 255 : 1);
  }
  return { out, lo, hi };
}
export const LUTS = Object.fromEntries(Object.entries(SCALES).map(([k, s]) => [k, lut(s)]));
export const rgba = (st) => `rgba(${st[1]},${st[2]},${st[3]},${st[4]})`;

/**
 * Fills the missing (NaN) cells next to known ones with the mean of their known
 * neighbours, `passes` times: the waves reach the coast when drawn under the land.
 */
export function dilate(A, nx, ny, passes = 2) {
  let src = A;
  for (let k = 0; k < passes; k++) {
    const out = Float32Array.from(src);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!Number.isNaN(src[j * nx + i])) continue;
      let sum = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const v = src[y * nx + x];
        if (!Number.isNaN(v)) { sum += v; n++; }
      }
      if (n) out[j * nx + i] = sum / n;
    }
    src = out;
  }
  return src;
}
