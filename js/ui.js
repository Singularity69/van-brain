// Shared UI pieces: helpers, the leveller display and the alarm panel.
import { instructions, hitchInstruction } from './level-math.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 3500) {
  let t = $('#toast');
  if (!t) { t = el('<div id="toast" role="status" aria-live="polite"></div>'); document.body.append(t); }
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms);
}

/** PIN entry modal. Resolves with the PIN string, or null if cancelled. */
export function askPin(title = 'Enter PIN') {
  return new Promise((resolve) => {
    const m = el(`<div class="modal" role="dialog" aria-modal="true">
      <form class="modal-card">
        <h2>${esc(title)}</h2>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8" class="pin-input" aria-label="PIN">
        <div class="row">
          <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
          <button type="submit" class="btn primary">OK</button>
        </div>
      </form>
    </div>`);
    document.body.append(m);
    const input = $('input', m);
    setTimeout(() => input.focus(), 50);
    const done = (v) => { m.remove(); resolve(v); };
    $('form', m).addEventListener('submit', (e) => { e.preventDefault(); done(input.value); });
    $('[data-act=cancel]', m).addEventListener('click', () => done(null));
  });
}

const FULL_SCALE = 2; // degrees at the edge of the bubble circle
const R = 52;
const bubblePos = (deg) => Math.sign(deg) * Math.min(1, Math.abs(deg) / FULL_SCALE) * R;

const fmtDeg = (d) => `${Math.abs(d).toFixed(1)}°`;

/**
 * Leveller display. Used full-screen on both phones.
 * opts.onSaveHitch / onClearHitch: optional buttons.
 */
export function levelView(opts = {}) {
  const root = el(`<section class="level">
    <div class="lv-badge" data-k="badge">Waiting for sensors</div>
    <div class="lv-line" data-k="front">&nbsp;</div>
    <svg class="lv-van" viewBox="-115 -135 230 255" aria-hidden="true">
      <text x="0" y="-125" class="lv-lab" text-anchor="middle">HITCH</text>
      <path d="M-34 -78 L0 -112 L34 -78" class="lv-draw"/>
      <circle cx="0" cy="-112" r="5" class="lv-draw-fill"/>
      <rect x="-62" y="-78" width="124" height="180" rx="16" class="lv-body"/>
      <rect x="-70" y="20" width="8" height="34" rx="3" class="lv-wheel"/>
      <rect x="62" y="20" width="8" height="34" rx="3" class="lv-wheel"/>
      <text x="-92" y="42" class="lv-lab" text-anchor="middle">L</text>
      <text x="92" y="42" class="lv-lab" text-anchor="middle">R</text>
      <circle cx="0" cy="10" r="${R}" class="lv-ring"/>
      <circle cx="0" cy="10" r="10" class="lv-tol" data-k="tol"/>
      <line x1="-${R}" y1="10" x2="${R}" y2="10" class="lv-cross"/>
      <line x1="0" y1="${10 - R}" x2="0" y2="${10 + R}" class="lv-cross"/>
      <circle cx="0" cy="10" r="13" class="lv-bubble" data-k="bubble"/>
    </svg>
    <div class="lv-line" data-k="side">&nbsp;</div>
    <div class="lv-angles" data-k="angles"></div>
    <div class="lv-hitch">
      <div class="lv-hitch-text" data-k="hitch"></div>
      <div class="row">
        <button class="btn" data-k="save">Save hitch</button>
        <button class="btn ghost" data-k="clear">Clear</button>
      </div>
    </div>
  </section>`);
  const k = (n) => $(`[data-k=${n}]`, root);
  if (opts.onSaveHitch) k('save').addEventListener('click', opts.onSaveHitch);
  else k('save').remove();
  if (opts.onClearHitch) k('clear').addEventListener('click', opts.onClearHitch);
  else k('clear').remove();

  function update(d) {
    if (!d || d.pitch == null) {
      root.classList.remove('is-level');
      root.classList.add('is-stale');
      k('badge').textContent = d?.message || 'Waiting for sensors';
      k('side').innerHTML = '&nbsp;';
      k('front').innerHTML = '&nbsp;';
      k('angles').textContent = '';
      k('hitch').textContent = '';
      return;
    }
    const ins = instructions(d.pitch, d.roll, d.dims);
    root.classList.toggle('is-level', ins.level);
    root.classList.toggle('is-stale', !!d.stale);
    k('badge').textContent = d.stale ? 'NO LIVE DATA' : ins.level ? 'LEVEL' : 'NOT LEVEL';
    k('side').textContent = ins.side.replace(' mm', ' mm');
    k('side').classList.toggle('ok', ins.sideLevel);
    k('front').textContent = ins.front.replace(' mm', ' mm');
    k('front').classList.toggle('ok', ins.frontLevel);
    k('angles').textContent =
      `Side ${fmtDeg(d.roll)} ${Math.abs(d.roll) < 0.05 ? '' : d.roll > 0 ? 'right high' : 'left high'} · ` +
      `Front ${fmtDeg(d.pitch)} ${Math.abs(d.pitch) < 0.05 ? '' : d.pitch > 0 ? 'hitch high' : 'hitch low'}`;
    const b = k('bubble');
    b.setAttribute('cx', bubblePos(d.roll).toFixed(1));
    b.setAttribute('cy', (10 - bubblePos(d.pitch)).toFixed(1));
    k('tol').setAttribute('r', Math.max(4, (d.dims.tol / FULL_SCALE) * R).toFixed(1));
    if (d.hitchPitch != null) {
      const h = hitchInstruction(d.pitch, d.hitchPitch, d.dims);
      k('hitch').textContent = `Saved hitch height: ${h.text}`;
      k('hitch').classList.toggle('ok', h.matched);
    } else {
      k('hitch').textContent = 'No hitch height saved. While hitched to the car, tap Save.';
      k('hitch').classList.remove('ok');
    }
  }
  return { root, update };
}

const fmt = {
  tilt: (v) => `${v.toFixed(2)}°`,
  move: (v) => `${v.toFixed(2)} m/s²`,
  gps: (v) => (v == null ? '—' : `${Math.round(v)} m`),
};

/**
 * Alarm panel. role 'van' or 'cab'. Actions are callbacks.
 * update(s): s = { state, arming, reasons, test, metrics, would, cfg, sirenOn, canArm, note }
 */
export function alarmView(a) {
  const root = el(`<section class="alarm">
    <div class="al-state" data-k="state"><div class="al-big" data-k="big">—</div><div class="al-sub" data-k="sub"></div></div>
    <div class="row wrap">
      <button class="btn primary big" data-k="arm">Arm</button>
      <button class="btn danger big" data-k="disarm">Disarm</button>
      <button class="btn big" data-k="silence">Silence siren</button>
    </div>
    <label class="switch"><input type="checkbox" data-k="test"><span>Test mode (show live readings, no siren)</span></label>
    <div class="al-metrics" data-k="metrics">
      <div class="meter" data-m="tilt"><div class="meter-top"><span>Tilt change</span><b data-v></b></div><div class="bar"><i></i></div><small data-w></small></div>
      <div class="meter" data-m="move"><div class="meter-top"><span>Movement</span><b data-v></b></div><div class="bar"><i></i></div><small data-w></small></div>
      <div class="meter" data-m="gps"><div class="meter-top"><span>GPS distance moved</span><b data-v></b></div><div class="bar"><i></i></div><small data-w></small></div>
    </div>
    <details class="card" data-k="sens">
      <summary>Sensitivity</summary>
      <div class="sens">
        <label class="switch"><input type="checkbox" data-c="tiltOn"><span>Tilt trigger</span></label>
        <label class="slider">Tilt more than <b data-o="tiltDeg"></b>°<input type="range" min="0.1" max="3" step="0.1" data-c="tiltDeg"></label>
        <label class="slider">for <b data-o="tiltSecs"></b> seconds<input type="range" min="1" max="20" step="1" data-c="tiltSecs"></label>
        <label class="switch"><input type="checkbox" data-c="moveOn"><span>Movement trigger</span></label>
        <label class="slider">Movement above <b data-o="moveRms"></b> m/s²<input type="range" min="0.1" max="3" step="0.05" data-c="moveRms"></label>
        <label class="switch"><input type="checkbox" data-c="gpsOn"><span>GPS trigger</span></label>
        <label class="slider">GPS moved more than <b data-o="gpsMetres"></b> m<input type="range" min="10" max="500" step="10" data-c="gpsMetres"></label>
        <label class="slider">Arming delay <b data-o="armDelay"></b> s<input type="range" min="0" max="120" step="5" data-c="armDelay"></label>
        <p class="hint">Use Test mode on a windy or rainy night to find settings that don't false-alarm. Lower numbers are more sensitive.</p>
      </div>
    </details>
  </section>`);
  const k = (n) => $(`[data-k=${n}]`, root);
  k('arm').addEventListener('click', a.onArm);
  k('disarm').addEventListener('click', a.onDisarm);
  k('silence').addEventListener('click', a.onSilence);
  k('test').addEventListener('change', (e) => a.onTest(e.target.checked));
  for (const inp of $$('[data-c]', root)) {
    inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
      const key = inp.dataset.c;
      const val = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      const out = $(`[data-o=${key}]`, root);
      if (out) out.textContent = val;
      a.onCfg({ [key]: val });
    });
  }

  function update(s) {
    if (!s) {
      k('big').textContent = 'No link to van';
      k('sub').textContent = '';
      root.dataset.state = 'unknown';
      return;
    }
    root.dataset.state = s.state;
    const big = { disarmed: 'DISARMED', arming: `ARMING ${s.arming}s`, armed: 'ARMED', triggered: 'ALARM!' }[s.state];
    k('big').textContent = big;
    k('sub').textContent = s.state === 'triggered' ? s.reasons.join(' · ') : (s.note || '');
    k('arm').hidden = s.state !== 'disarmed';
    k('disarm').hidden = s.state === 'disarmed';
    k('silence').hidden = !(s.state === 'triggered' && s.sirenOn);
    if (document.activeElement !== k('test')) k('test').checked = !!s.test;
    k('test').closest('label').hidden = s.state !== 'disarmed';

    const live = s.test || s.state === 'armed' || s.state === 'triggered';
    k('metrics').classList.toggle('dim', !live);
    const m = s.metrics || {};
    const c = s.cfg || {};
    const meter = (key, val, thr, text, wouldCount, extra = '') => {
      const box = $(`[data-m=${key}]`, root);
      $('[data-v]', box).textContent = text;
      const ratio = val == null || !thr ? 0 : val / thr;
      const bar = $('i', box);
      bar.style.width = `${Math.min(100, ratio * 100)}%`;
      box.classList.toggle('over', ratio >= 1);
      $('[data-w]', box).textContent = (s.test ? `Would have triggered ${wouldCount || 0}×. ` : '') + extra;
    };
    meter('tilt', m.tilt, c.tiltDeg, `${fmt.tilt(m.tilt || 0)} / ${c.tiltDeg}° for ${c.tiltSecs}s`, s.would?.tilt,
      m.tiltFor ? `Over for ${m.tiltFor.toFixed(1)} s` : '');
    meter('move', m.move, c.moveRms, `${fmt.move(m.move || 0)} / ${c.moveRms}`, s.would?.move,
      m.movePeak ? `Peak ${m.movePeak.toFixed(2)}` : '');
    meter('gps', m.gpsDist, c.gpsMetres, `${fmt.gps(m.gpsDist)} / ${c.gpsMetres} m`, s.would?.gps,
      m.gpsAcc != null ? `Fix accuracy ±${Math.round(m.gpsAcc)} m` : 'Waiting for a GPS fix');

    for (const inp of $$('[data-c]', root)) {
      if (document.activeElement === inp) continue;
      const key = inp.dataset.c;
      if (!(key in c)) continue;
      if (inp.type === 'checkbox') inp.checked = !!c[key];
      else inp.value = c[key];
      const out = $(`[data-o=${key}]`, root);
      if (out) out.textContent = c[key];
    }
  }
  return { root, update };
}

/** Status chips at the top of the screen. items: [{label, state:'ok'|'warn'|'bad'|'off'}] */
export function renderChips(container, items) {
  container.innerHTML = items.map((i) => `<span class="chip ${i.state}">${esc(i.label)}</span>`).join('');
}

export function renderWarnings(container, list) {
  container.innerHTML = list.map((w) => `<button class="warn ${w.level || 'bad'}" data-w="${esc(w.id)}">${esc(w.text)}</button>`).join('');
  container.hidden = !list.length;
}
