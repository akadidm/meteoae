// Tide pages and the tides section of a city page (src/pages/tides.js): the
// current time on the tide curve, and the next high or low tide with a countdown.
// Times are the city's wall-clock times on a UTC time line (data-offset: its UTC offset in s).
for (const box of document.querySelectorAll('.tide-next')) {
  const turns = JSON.parse(box.dataset.turns);
  const S = JSON.parse(box.dataset.s);
  const offset = Number(box.dataset.offset) * 1000;
  const show = () => {
    const now = Date.now() + offset;
    const next = turns.find(([ms]) => ms > now);
    if (!next) { box.hidden = true; return; }
    const mins = Math.round((next[0] - now) / 60_000);
    const left = mins >= 60 ? S.hm.replace('{h}', Math.floor(mins / 60)).replace('{m}', mins % 60) : S.min.replace('{m}', mins);
    const at = new Date(next[0]).toISOString().slice(11, 16);
    box.innerHTML = `<span class="tide-next-k">${S.next}</span> <b class="${next[1] ? 'is-high' : 'is-low'}">${next[1] ? S.high : S.low} · ${at}</b> <span class="tide-next-in">${S.inTime.replace('{time}', left)}</span>`;
    box.hidden = false;
  };
  show();
  setInterval(show, 60_000);
}

for (const fig of document.querySelectorAll('.tide-curve')) {
  const line = fig.querySelector('.tc-now');
  const t0 = Number(fig.dataset.t0), t1 = Number(fig.dataset.t1), offset = Number(fig.dataset.offset) * 1000;
  const svg = fig.querySelector('svg');
  const [, , W] = svg.getAttribute('viewBox').split(' ').map(Number);
  const place = () => {
    const now = Date.now() + offset;
    if (now < t0 || now > t1) { line.setAttribute('hidden', ''); return; }
    const x = 8 + ((now - t0) / (t1 - t0)) * (W - 16);
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('x2', x.toFixed(1));
    line.removeAttribute('hidden');
  };
  place();
  setInterval(place, 60_000);
}
