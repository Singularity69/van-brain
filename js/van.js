// Van unit: the old iPhone fixed in the van.
import { state, save, hashPin, randomCode, formatCode } from './store.js';
import { MOUNTS, calibrate, angles } from './level-math.js';
import { Sensors, Gps, Wake } from './sensors.js';
import { Siren } from './siren.js';
import { Notifier, ntfySend, mapLinks, TOPIC_RE } from './notify.js';
import { VanLink } from './link.js';
import { VanCamera } from './camera.js';
import { Alarm } from './alarm.js';
import { $, $$, el, esc, toast, askPin, levelView, alarmView, renderChips, renderWarnings } from './ui.js';

const V = state.van;
const A = state.alarm;

// ---- services (created once) ----
const sensors = new Sensors();
const gps = new Gps();
const wake = new Wake();
const siren = new Siren();
const notifier = new Notifier(() => A.topic);
const alarm = new Alarm(A, save);
let link = null;
let camera = null;
let started = false; // the start tap has happened this session
let current = { pitch: null, roll: null };
let app;
let rerender = () => {};

const dims = () => ({ track: V.track, jockey: V.jockey, tol: V.tol });
const flips = () => ({ invertPitch: V.invertPitch, invertRoll: V.invertRoll });

// Level + alarm feed from the motion sensor.
sensors.addEventListener('sample', () => {
  if (V.cal && sensors.gravity) {
    current = angles(sensors.gravity, V.cal, flips());
    alarm.feedLevel(current.pitch, current.roll);
  }
  alarm.feedMove(sensors.rms);
});
gps.addEventListener('fix', () => { if (gps.pos) alarm.feedGps(gps.pos); });

// ---- the start tap: permissions, sound, wake lock, camera ----
async function startGesture() {
  // Order matters on iPhone: kick off everything that needs the tap before any await.
  const pAudio = siren.unlock();
  const pMotion = sensors.requestPermission();
  const pWake = wake.request();
  const results = { motion: false, sound: false, wake: false, location: false, camera: null };
  try { results.motion = (await pMotion) === 'granted'; } catch { results.motion = false; }
  sensors.start();
  await pAudio; results.sound = siren.unlocked;
  results.wake = await pWake;
  gps.start();
  if (V.cameraOn && navigator.mediaDevices?.getUserMedia) {
    try { await VanCamera.prime(); results.camera = true; } catch { results.camera = false; }
  }
  started = true;
  // Give the sensors and GPS a moment to report.
  await new Promise((r) => setTimeout(r, 600));
  results.motion = results.motion || sensors.alive;
  results.location = !gps.error;
  if (A.triggered) siren.start();
  rerender();
  return results;
}

// ---- alarm side effects ----
const posText = () => {
  const p = gps.pos;
  if (!p) return 'No GPS position yet.';
  const l = mapLinks(p);
  return `Position ±${Math.round(p.acc)} m: ${l.apple}\nGoogle: ${l.google}`;
};

let updateTimer = null;
function startUpdates() {
  clearInterval(updateTimer);
  updateTimer = setInterval(() => {
    if (!A.triggered) return clearInterval(updateTimer);
    notifier.send({
      title: 'Van Brain: position update',
      message: `Alarm still triggered (${A.reasons.join('; ')}).\n${posText()}`,
      priority: 5, tags: ['rotating_light', 'round_pushpin'], click: mapLinks(gps.pos).apple,
    });
  }, 120000);
}

alarm.addEventListener('trigger', (e) => {
  siren.start();
  notifier.send({
    title: 'VAN ALARM',
    message: `${e.detail.reason}\n${posText()}`,
    priority: 5, tags: ['rotating_light'], click: mapLinks(gps.pos).apple,
  });
  startUpdates();
  link?.broadcast({ type: 'alert', reason: e.detail.reason });
});
alarm.addEventListener('reason', (e) => {
  notifier.send({ title: 'VAN ALARM: also', message: `${e.detail.reason}\n${posText()}`, priority: 5, tags: ['rotating_light'], click: mapLinks(gps.pos).apple });
});
alarm.addEventListener('armed', (e) => {
  notifier.send({ title: 'Van Brain armed', message: `Armed from the ${e.detail.source}.`, priority: 2, tags: ['lock'] });
});
alarm.addEventListener('disarmed', (e) => {
  siren.stop();
  clearInterval(updateTimer);
  if (e.detail.was !== 'disarmed' && e.detail.was !== 'arming') {
    notifier.send({ title: 'Van Brain disarmed', message: `Disarmed from the ${e.detail.source}.`, priority: 2, tags: ['unlock'] });
  }
});
alarm.addEventListener('would', () => siren.beep());

// ---- link to cab ----
function alarmStatus() {
  return {
    state: alarm.state, arming: alarm.arming, reasons: A.reasons, test: alarm.test,
    metrics: alarm.metrics, would: alarm.would, sirenOn: siren.sounding,
    cfg: { tiltOn: A.tiltOn, tiltDeg: A.tiltDeg, tiltSecs: A.tiltSecs, moveOn: A.moveOn, moveRms: A.moveRms, gpsOn: A.gpsOn, gpsMetres: A.gpsMetres, armDelay: A.armDelay },
  };
}

function statusMsg() {
  return {
    type: 'status',
    alarm: alarmStatus(),
    sensors: sensors.alive, started, wake: wake.active,
    gps: gps.pos ? { lat: gps.pos.lat, lon: gps.pos.lon, acc: gps.pos.acc, fresh: gps.fresh } : null,
    gpsError: gps.error,
    calibrated: !!V.cal,
    dims: dims(), hitchPitch: V.hitchPitch,
    topic: A.topic,
    cameraError: camera?.error || null,
    queued: notifier.queue.length,
    online: navigator.onLine,
  };
}

const ALARM_KEYS = ['tiltOn', 'tiltDeg', 'tiltSecs', 'moveOn', 'moveRms', 'gpsOn', 'gpsMetres', 'armDelay'];

function onCabMessage({ conn, msg }) {
  switch (msg.type) {
    case 'arm':
      if (!sensors.alive) conn.send({ type: 'toast', text: 'Van sensors are not running: tap the van phone screen once.', kind: 'bad' });
      alarm.arm('cab');
      break;
    case 'disarm': alarm.disarm('cab'); break;
    case 'silence': siren.stop(); break;
    case 'test': alarm.setTest(msg.on); break;
    case 'saveHitch': saveHitch(); break;
    case 'clearHitch': V.hitchPitch = null; save(); break;
    case 'setAlarm':
      for (const [k, v] of Object.entries(msg.patch || {})) if (ALARM_KEYS.includes(k)) A[k] = v;
      save();
      break;
    case 'camera':
      if (msg.on) {
        camera.startFor(conn.peer).catch((e) => conn.send({ type: 'toast', text: e.message, kind: 'bad' }));
      } else camera.stopFor(conn.peer);
      break;
    default: break;
  }
  rerender();
}

async function startLink() {
  if (!A || !state.link.code) return;
  if (!window.Peer) return; // PeerJS failed to load (shouldn't happen: it's cached)
  link = new VanLink(state.link.code, state.link);
  camera = new VanCamera(link);
  link.addEventListener('status', () => rerender());
  link.addEventListener('cab', (e) => { e.detail.send(statusMsg()); rerender(); });
  link.addEventListener('cabgone', (e) => { camera.stopFor(e.detail.peer); rerender(); });
  link.addEventListener('message', (e) => onCabMessage(e.detail));
  await link.start();
  if (location.search.includes('sim')) window.__vb = { link, alarm, sensors, gps }; // test harness hook
  // Live level at 10 Hz, status once a second.
  setInterval(() => {
    if (link.connected && sensors.alive && V.cal) link.broadcast({ type: 'level', p: current.pitch, r: current.roll });
  }, 100);
  setInterval(() => { if (link.connected) link.broadcast(statusMsg()); }, 1000);
}

function saveHitch() {
  if (current.pitch == null || !sensors.alive) { toast('No level reading yet', 'bad'); return; }
  V.hitchPitch = current.pitch;
  save();
  toast(`Hitch height saved (${current.pitch.toFixed(2)}° front to back)`, 'ok');
  rerender();
}

// ---- setup wizard ----
const STEPS = ['start', 'dims', 'mount', 'calibrate', 'alarm', 'pair'];

function wizard(step, { single = false, then = null } = {}) {
  const next = () => {
    if (then) return wizard(then, { single });
    if (single) return main();
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) wizard(STEPS[i + 1]);
    else { state.setupDone = true; save(); main(); }
  };
  const back = () => {
    if (single) return main();
    const i = STEPS.indexOf(step);
    if (i > 0) wizard(STEPS[i - 1]);
  };
  const n = STEPS.indexOf(step) + 1;
  const shell = el(`<div class="screen wizard">
    <header class="wiz-head">
      ${single ? '' : `<span class="wiz-step">Van unit setup · step ${n} of ${STEPS.length}</span>`}
    </header>
    <main class="wiz-body"></main>
    <footer class="wiz-foot row">
      <button class="btn ghost" data-act="back" ${!single && n === 1 ? 'hidden' : ''}>${single ? 'Cancel' : 'Back'}</button>
      <button class="btn primary" data-act="next">${single ? 'Done' : n === STEPS.length ? 'Finish' : 'Next'}</button>
    </footer>
  </div>`);
  const body = $('.wiz-body', shell);
  const nextBtn = $('[data-act=next]', shell);
  $('[data-act=back]', shell).addEventListener('click', back);
  let validate = async () => true;
  nextBtn.addEventListener('click', async () => {
    nextBtn.disabled = true;
    try { if (await validate()) next(); } finally { nextBtn.disabled = false; }
  });
  app.replaceChildren(shell);
  rerender = () => {};

  if (step === 'start') {
    body.innerHTML = `
      <h1>Van unit</h1>
      <p>This phone stays in the van. It reads the level, runs the alarm and streams the camera.</p>
      <p>iPhone needs one tap to allow motion sensors and sound. You will see this button again after the app reloads.</p>
      <button class="btn primary huge" data-act="go">Enable sensors, sound &amp; location</button>
      <ul class="checks" data-k="res"></ul>
      <p class="hint">Allow Motion &amp; Orientation, Location and Camera when asked.</p>`;
    $('[data-act=go]', body).addEventListener('click', async () => {
      const r = await startGesture();
      const li = (ok, t) => `<li class="${ok === null ? 'off' : ok ? 'ok' : 'bad'}">${t}</li>`;
      $('[data-k=res]', body).innerHTML =
        li(r.motion && sensors.listening, 'Motion sensors') + li(r.sound, 'Siren sound') +
        li(r.wake, 'Keep screen awake') + li(r.location, 'Location') + li(r.camera, 'Camera');
      setTimeout(() => {
        if (!sensors.alive) toast('No motion readings yet. On a computer this is expected; on the iPhone, check Settings > Safari > Motion & Orientation Access.', 'bad', 6000);
      }, 1500);
    });
    validate = async () => {
      if (!started) { toast('Tap the big button first', 'bad'); return false; }
      return true;
    };
  }

  if (step === 'dims') {
    body.innerHTML = `
      <h1>Van measurements</h1>
      <label class="field">Wheel track width (mm)<small>Centre of left wheel to centre of right wheel</small>
        <input type="number" inputmode="numeric" name="track" value="${V.track}" min="800" max="3500"></label>
      <label class="field">Axle centre to jockey wheel (mm)
        <input type="number" inputmode="numeric" name="jockey" value="${V.jockey}" min="1000" max="9000"></label>
      <label class="field">Level tolerance (degrees)<small>Within this counts as LEVEL. Default 0.3</small>
        <input type="number" inputmode="decimal" name="tol" value="${V.tol}" min="0.05" max="2" step="0.05"></label>`;
    validate = async () => {
      const t = Number($('[name=track]', body).value);
      const j = Number($('[name=jockey]', body).value);
      const tol = Number($('[name=tol]', body).value);
      if (!(t >= 800 && t <= 3500)) { toast('Track width should be 800 to 3500 mm', 'bad'); return false; }
      if (!(j >= 1000 && j <= 9000)) { toast('Axle to jockey should be 1000 to 9000 mm', 'bad'); return false; }
      if (!(tol > 0 && tol <= 2)) { toast('Tolerance should be between 0.05 and 2 degrees', 'bad'); return false; }
      Object.assign(V, { track: t, jockey: j, tol });
      save();
      return true;
    };
  }

  if (step === 'mount') {
    body.innerHTML = `
      <h1>How is the phone mounted?</h1>
      <p>Pick the closest match. "Hitch" is the front (A-frame) end. For the reversing camera, mount it upright on the rear window, screen facing the hitch.</p>
      <div class="choices">${Object.entries(MOUNTS).map(([key, m]) => `
        <label class="choice"><input type="radio" name="mount" value="${key}" ${V.mount === key ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('')}
      </div>
      <p class="hint">Changing this needs a new calibration.</p>`;
    validate = async () => {
      const v = $('[name=mount]:checked', body)?.value;
      if (!v) return false;
      if (v !== V.mount) { V.mount = v; V.cal = null; V.invertPitch = false; V.invertRoll = false; save(); }
      return true;
    };
    if (single) { /* mount from settings continues into calibrate */ }
  }

  if (step === 'calibrate') {
    body.innerHTML = `
      <h1>Calibrate</h1>
      <ol class="steps">
        <li>Park on a spot and level the van using a spirit level on the floor (side to side and front to back).</li>
        <li>Check the phone is fixed firmly in its mount: ${esc(MOUNTS[V.mount].label.toLowerCase())}.</li>
        <li>Nobody moving in the van. Tap Calibrate and wait 3 seconds.</li>
      </ol>
      <button class="btn primary huge" data-act="cal">Calibrate now</button>
      <div class="cal-live" data-k="live"></div>
      <div class="card">
        <h3>Check direction</h3>
        <p>After calibrating, wind the jockey UP a little: the reading should say <b>hitch high</b>. Then put a block under the RIGHT wheel (or stand on that side): it should say <b>right high</b>. If either is backwards, flip it here.</p>
        <label class="switch"><input type="checkbox" name="ip" ${V.invertPitch ? 'checked' : ''}><span>Flip front/back</span></label>
        <label class="switch"><input type="checkbox" name="ir" ${V.invertRoll ? 'checked' : ''}><span>Flip left/right</span></label>
      </div>`;
    const live = $('[data-k=live]', body);
    $('[name=ip]', body).addEventListener('change', (e) => { V.invertPitch = e.target.checked; save(); });
    $('[name=ir]', body).addEventListener('change', (e) => { V.invertRoll = e.target.checked; save(); });
    $('[data-act=cal]', body).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!sensors.alive && !started) await startGesture();
      b.disabled = true;
      b.textContent = 'Hold still…';
      try {
        const avg = await sensors.average(2500);
        V.cal = calibrate(avg, V.mount);
        save();
        toast('Calibrated', 'ok');
      } catch (err) {
        toast(err.message, 'bad', 6000);
      } finally {
        b.disabled = false;
        b.textContent = 'Calibrate again';
      }
    });
    rerender = () => {
      if (!V.cal) { live.textContent = sensors.alive ? 'Not calibrated yet' : 'Motion sensors not running'; return; }
      if (!sensors.alive) { live.textContent = 'Motion sensors not running'; return; }
      const { pitch, roll } = current;
      live.innerHTML = `Front <b>${Math.abs(pitch).toFixed(2)}°</b> ${pitch > 0.05 ? 'hitch high' : pitch < -0.05 ? 'hitch low' : ''}<br>
        Side <b>${Math.abs(roll).toFixed(2)}°</b> ${roll > 0.05 ? 'right high' : roll < -0.05 ? 'left high' : ''}`;
    };
    validate = async () => {
      if (!V.cal) { toast('Calibrate first', 'bad'); return false; }
      return true;
    };
  }

  if (step === 'alarm') {
    if (!A.topic) { A.topic = `vanbrain-${randomCode(12).toLowerCase()}`; save(); }
    body.innerHTML = `
      <h1>Alarm alerts</h1>
      <label class="field">ntfy topic<small>Alerts go to ntfy.sh on this topic. Keep it hard to guess: anyone who knows it can read your alerts.</small>
        <input name="topic" value="${esc(A.topic)}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <button class="btn" data-act="test">Send a test push</button>
      <p class="hint">On your main phone: install the free <b>ntfy</b> app, tap +, and subscribe to this exact topic on ntfy.sh. Allow notifications. Turn on "Time Sensitive" if offered.</p>
      <label class="field">${A.pinHash ? 'New PIN (leave blank to keep the current one)' : 'Alarm PIN (4 to 8 digits)'}<small>Needed to arm or disarm on this phone</small>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></label>
      <label class="field">Repeat PIN
        <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></label>`;
    $('[data-act=test]', body).addEventListener('click', async () => {
      const t = $('[name=topic]', body).value.trim();
      if (!TOPIC_RE.test(t)) { toast('Topic can only use letters, numbers, - and _', 'bad'); return; }
      try {
        await ntfySend(t, { title: 'Van Brain test', message: `Test push from the van unit.\n${posText()}`, priority: 4, tags: ['white_check_mark'], click: mapLinks(gps.pos).apple });
        toast('Sent. Check your main phone.', 'ok');
      } catch (e) { toast(`Could not send: ${e.message}`, 'bad'); }
    });
    validate = async () => {
      const t = $('[name=topic]', body).value.trim();
      if (!TOPIC_RE.test(t)) { toast('Topic can only use letters, numbers, - and _', 'bad'); return false; }
      const p1 = $('[name=pin]', body).value;
      const p2 = $('[name=pin2]', body).value;
      if (p1 || !A.pinHash) {
        if (!/^\d{4,8}$/.test(p1)) { toast('PIN must be 4 to 8 digits', 'bad'); return false; }
        if (p1 !== p2) { toast('PINs do not match', 'bad'); return false; }
        A.pinHash = await hashPin(p1);
      }
      A.topic = t;
      save();
      return true;
    };
  }

  if (step === 'pair') {
    if (!state.link.code) { state.link.code = randomCode(10); save(); }
    body.innerHTML = `
      <h1>Pair the cab display</h1>
      <p>On your main phone, open Van Brain, choose <b>Cab display</b> and enter this code:</p>
      <div class="code">${formatCode(state.link.code)}</div>
      <p class="hint">Both phones need mobile data for the live link. The leveller on this phone works with no signal.</p>
      <button class="btn ghost" data-act="new">Make a new code</button>`;
    $('[data-act=new]', body).addEventListener('click', () => {
      if (!confirm('Make a new pairing code? The cab will need the new code.')) return;
      state.link.code = randomCode(10);
      save();
      location.reload();
    });
  }
}

// ---- main screen ----
let tab = 'level';

function main() {
  const shell = el(`<div class="screen main van">
    <header class="top">
      <div class="title">Van unit</div>
      <div class="chips" data-k="chips"></div>
    </header>
    <div class="warnings" data-k="warn" hidden></div>
    <main class="content" data-k="content"></main>
    <nav class="tabs">
      <button data-tab="level">Level</button>
      <button data-tab="alarm">Alarm</button>
      <button data-tab="settings">Setup</button>
    </nav>
    <div class="overlay" data-k="overlay" hidden>
      <button class="overlay-btn" data-act="start">
        <span class="o-title" data-k="otitle">Tap to start</span>
        <span class="o-sub">Turns on motion sensors, siren sound and screen awake</span>
      </button>
    </div>
  </div>`);
  app.replaceChildren(shell);
  const content = $('[data-k=content]', shell);
  const overlay = $('[data-k=overlay]', shell);
  $('[data-act=start]', overlay).addEventListener('click', async () => { await startGesture(); rerender(); });
  for (const b of $$('[data-tab]', shell)) b.addEventListener('click', () => { tab = b.dataset.tab; showTab(); });

  const lv = levelView({
    onSaveHitch: saveHitch,
    onClearHitch: () => { V.hitchPitch = null; save(); rerender(); },
  });
  const av = alarmView({
    onArm: async () => {
      if (!await checkPin('PIN to arm')) return;
      if (!sensors.alive) toast('Motion sensors are not running: tilt and movement will not work', 'bad');
      alarm.arm('van');
    },
    onDisarm: async () => { if (await checkPin('PIN to disarm')) alarm.disarm('van'); },
    onSilence: async () => { if (await checkPin('PIN to silence')) siren.stop(); },
    onTest: (on) => alarm.setTest(on),
    onCfg: (patch) => { Object.assign(A, patch); save(); },
  });
  const settings = settingsView();

  function showTab() {
    for (const b of $$('[data-tab]', shell)) b.classList.toggle('active', b.dataset.tab === tab);
    content.replaceChildren(tab === 'level' ? lv.root : tab === 'alarm' ? av.root : settings);
    rerender();
  }

  rerender = () => {
    // Status chips
    const ls = link?.status || 'off';
    renderChips($('[data-k=chips]', shell), [
      { label: { connected: 'Cab linked', waiting: 'Waiting for cab', reconnecting: 'Link reconnecting', offline: 'No signal', starting: 'Link starting', off: 'Link off' }[ls] || ls,
        state: ls === 'connected' ? 'ok' : ls === 'waiting' ? 'off' : 'warn' },
      { label: sensors.alive ? 'Sensors' : 'Sensors off', state: sensors.alive ? 'ok' : 'bad' },
      { label: wake.active ? 'Awake' : 'May sleep', state: wake.active ? 'ok' : 'warn' },
      { label: gps.pos && gps.fresh ? `GPS ±${Math.round(gps.pos.acc)} m` : gps.error || 'GPS…', state: gps.pos && gps.fresh ? (gps.pos.acc < 30 ? 'ok' : 'warn') : 'warn' },
      ...(camera?.active ? [{ label: 'Camera live', state: 'ok' }] : []),
    ]);
    // Warnings
    const w = [];
    if (started && !sensors.alive) w.push({ id: 'sensors', text: 'Motion sensors lost. Tap here to restart them.' });
    if (started && !wake.active) w.push({ id: 'wake', text: 'Screen wake lock lost. Tap here. Keep Auto-Lock set to Never.', level: 'warn' });
    if (!V.cal) w.push({ id: 'cal', text: 'Not calibrated. Tap to calibrate.' });
    if (!navigator.onLine) w.push({ id: 'net', text: 'No signal: alerts will queue and send when signal returns. Leveller still works.', level: 'warn' });
    if (notifier.queue.length) w.push({ id: 'queue', text: `${notifier.queue.length} alert(s) waiting to send. ${notifier.lastError || ''}`, level: 'warn' });
    if (A.armed && !A.topic) w.push({ id: 'topic', text: 'No ntfy topic set: alarm cannot push alerts.' });
    renderWarnings($('[data-k=warn]', shell), w);

    // Overlay after reload / before first tap
    overlay.hidden = started;
    $('[data-k=otitle]', overlay).textContent = A.triggered ? 'ALARM TRIGGERED: tap to resume' : A.armed ? 'ALARM ARMED: tap to resume sensors' : 'Tap to start';

    shell.dataset.alarm = alarm.state;
    if (tab === 'level') {
      if (!V.cal) lv.update({ message: 'Not calibrated' });
      else if (!sensors.alive) lv.update({ message: 'Motion sensors not running' });
      else lv.update({ pitch: current.pitch, roll: current.roll, dims: dims(), hitchPitch: V.hitchPitch });
    } else if (tab === 'alarm') {
      av.update({ ...alarmStatus(), note: alarm.state === 'armed' ? 'Watching tilt, movement and GPS' : '' });
    }
  };

  $('[data-k=warn]', shell).addEventListener('click', async (e) => {
    const id = e.target.closest('[data-w]')?.dataset.w;
    if (id === 'sensors' || id === 'wake') { await startGesture(); }
    if (id === 'cal') wizard('calibrate', { single: true });
  });

  showTab();
}

async function checkPin(title) {
  if (!A.pinHash) return true;
  const pin = await askPin(title);
  if (pin == null) return false;
  if ((await hashPin(pin)) === A.pinHash) return true;
  toast('Wrong PIN', 'bad');
  return false;
}

function settingsView() {
  const root = el(`<section class="settings">
    <div class="card">
      <h3>Leveller</h3>
      <p>Track ${V.track} mm · axle to jockey ${V.jockey} mm · tolerance ${V.tol}°</p>
      <p>Mount: ${esc(MOUNTS[V.mount].label)}</p>
      <div class="row wrap">
        <button class="btn" data-act="dims">Change measurements</button>
        <button class="btn" data-act="mount">Change mount &amp; recalibrate</button>
        <button class="btn" data-act="cal">Recalibrate</button>
      </div>
    </div>
    <div class="card">
      <h3>Alarm</h3>
      <p>ntfy topic: <code>${esc(A.topic || 'not set')}</code></p>
      <div class="row wrap"><button class="btn" data-act="alarm">Change topic or PIN</button></div>
    </div>
    <div class="card">
      <h3>Cab pairing</h3>
      <div class="code small">${formatCode(state.link.code)}</div>
      <div class="row wrap"><button class="btn" data-act="pair">Show pairing</button></div>
    </div>
    <div class="card">
      <h3>Camera</h3>
      <label class="switch"><input type="checkbox" data-k="cam" ${V.cameraOn ? 'checked' : ''}><span>Ask for the camera at start-up (needed for the reversing camera)</span></label>
    </div>
    <details class="card">
      <summary>Advanced: own TURN relay</summary>
      <p class="hint">Only if the live link won't connect on mobile data. Entered here, stored on this phone only. Enter the same on the cab.</p>
      <label class="field">TURN URL(s)<input data-t="turnUrl" value="${esc(state.link.turnUrl)}" placeholder="turn:example.com:3478" autocapitalize="off"></label>
      <label class="field">Username<input data-t="turnUser" value="${esc(state.link.turnUser)}" autocapitalize="off"></label>
      <label class="field">Password<input data-t="turnPass" type="password" value="${esc(state.link.turnPass)}"></label>
      <button class="btn" data-act="saveturn">Save and reload</button>
    </details>
    <div class="card">
      <h3>This phone</h3>
      <p class="hint">Safari can't read phone temperature or battery level. Keep the van phone on a charger and out of direct sun.</p>
      <button class="btn danger" data-act="reset">Change role / reset everything</button>
    </div>
  </section>`);
  const on = (act, fn) => $(`[data-act=${act}]`, root).addEventListener('click', fn);
  on('dims', () => wizard('dims', { single: true }));
  on('mount', () => wizard('mount', { single: true, then: 'calibrate' }));
  on('cal', () => wizard('calibrate', { single: true }));
  on('alarm', async () => { if (await checkPin('Current PIN')) wizard('alarm', { single: true }); });
  on('pair', () => wizard('pair', { single: true }));
  $('[data-k=cam]', root).addEventListener('change', (e) => { V.cameraOn = e.target.checked; save(); });
  on('saveturn', () => {
    for (const i of $$('[data-t]', root)) state.link[i.dataset.t] = i.value.trim();
    save();
    location.reload();
  });
  on('reset', async () => {
    if (!await checkPin('PIN to reset')) return;
    if (!confirm('Erase all settings on this phone (calibration, PIN, pairing)?')) return;
    localStorage.clear();
    location.reload();
  });
  return root;
}

// ---- entry ----
export async function startVan(appEl) {
  app = appEl;
  // Try sensors without a tap: some iOS versions keep the permission after a reload.
  sensors.start();
  gps.start();
  if (A.armed && A.base) {
    // Resumed after a reload while armed. Keep the stored baseline.
    if (A.triggered) startUpdates();
  }
  if (state.setupDone) await startLink().catch(() => {});
  if (!state.setupDone) wizard('start');
  else main();

  // Repaint ~6 times a second.
  setInterval(() => rerender(), 160);
  wake.addEventListener('change', () => rerender());

  // If the app reloaded while armed and nobody taps within 2 minutes, warn by push.
  if (A.armed) {
    setTimeout(() => {
      if (!started && !sensors.alive) {
        notifier.send({
          title: 'Van Brain needs a tap',
          message: `The van unit restarted while ARMED. Motion sensors are off until someone taps the van phone screen. GPS alarm ${gps.pos ? 'is still running' : 'has no fix'}.\n${posText()}`,
          priority: 4, tags: ['warning'],
        });
      }
    }, 120000);
  }
  // Late link start once setup finishes.
  const waitSetup = setInterval(() => {
    if (state.setupDone && !link) { startLink().catch(() => {}); }
    if (link) clearInterval(waitSetup);
  }, 1000);
}
