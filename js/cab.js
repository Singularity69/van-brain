// Cab display: Gavin's main phone. Shows the level, the camera and controls the alarm.
import { state, save, cleanCode, formatCode } from './store.js';
import { CabLink } from './link.js';
import { CabCamera } from './camera.js';
import { Wake } from './sensors.js';
import { Siren } from './siren.js';
import { $, $$, el, esc, toast, levelView, alarmView, renderChips, renderWarnings } from './ui.js';

const C = state.cab;
let app;
let link;
let cam;
const wake = new Wake();
const siren = new Siren();
let started = false;
let vanStatus = null;
let level = null; // { p, r, at }
let rerender = () => {};

function pairScreen() {
  const shell = el(`<div class="screen wizard">
    <main class="wiz-body">
      <h1>Cab display</h1>
      <p>Enter the pairing code shown on the van unit (Setup tab).</p>
      <input class="code-input" name="code" value="${esc(formatCode(state.link.code))}" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="11" aria-label="Pairing code">
      <p class="hint">Both phones need mobile data or Wi-Fi for the live link.</p>
    </main>
    <footer class="wiz-foot row">
      <button class="btn ghost" data-act="back">Back</button>
      <button class="btn primary" data-act="next">Pair</button>
    </footer>
  </div>`);
  app.replaceChildren(shell);
  const inp = $('[name=code]', shell);
  inp.addEventListener('input', () => {
    const c = cleanCode(inp.value).slice(0, 10);
    inp.value = formatCode(c);
  });
  $('[data-act=back]', shell).addEventListener('click', () => {
    if (state.setupDone) return main();
    state.role = null; save(); location.reload();
  });
  $('[data-act=next]', shell).addEventListener('click', () => {
    const c = cleanCode(inp.value);
    if (c.length !== 10) { toast('The code is 10 letters and numbers', 'bad'); return; }
    const changed = c !== state.link.code;
    state.link.code = c;
    state.setupDone = true;
    save();
    if (changed && link) location.reload();
    else { startLink(); main(); }
  });
}

function startLink() {
  if (link || !state.link.code || !window.Peer) return;
  link = new CabLink(state.link.code, state.link);
  link.addEventListener('status', () => {
    if (link.connected && C.tab === 'camera') link.send({ type: 'camera', on: true });
    rerender();
  });
  link.addEventListener('message', (e) => {
    const m = e.detail;
    if (m.type === 'level') level = { p: m.p, r: m.r, at: Date.now() };
    else if (m.type === 'status') {
      const was = vanStatus?.alarm?.state;
      vanStatus = { ...m, at: Date.now() };
      if (m.alarm.state === 'triggered' && was !== 'triggered') onAlert(m.alarm.reasons.join(' · '));
    } else if (m.type === 'alert') onAlert(m.reason);
    else if (m.type === 'toast') toast(m.text, m.kind || 'info', 6000);
    else if (m.type === 'would') siren.beep();
  });
  link.addEventListener('call', (e) => cam?.attach(e.detail));
  link.start();
}

function onAlert(reason) {
  toast(`VAN ALARM: ${reason}`, 'bad', 15000);
  siren.beep();
  if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
}

function send(msg) {
  if (!link?.send(msg)) { toast('Not connected to the van', 'bad'); return false; }
  return true;
}

function main() {
  const shell = el(`<div class="screen main cab">
    <header class="top">
      <div class="title">Cab display</div>
      <div class="chips" data-k="chips"></div>
    </header>
    <div class="warnings" data-k="warn" hidden></div>
    <main class="content" data-k="content"></main>
    <nav class="tabs">
      <button data-tab="level">Level</button>
      <button data-tab="camera">Camera</button>
      <button data-tab="alarm">Alarm</button>
      <button data-tab="settings">Setup</button>
    </nav>
  </div>`);
  app.replaceChildren(shell);
  const content = $('[data-k=content]', shell);
  for (const b of $$('[data-tab]', shell)) b.addEventListener('click', () => { setTab(b.dataset.tab); });
  // Any tap keeps the screen awake and unlocks the alert beep.
  shell.addEventListener('click', () => {
    if (!started) { started = true; siren.unlock(); wake.request(); }
  }, { capture: true });

  const lv = levelView({
    onSaveHitch: () => { if (send({ type: 'saveHitch' })) toast('Hitch height saved on the van unit', 'ok'); },
    onClearHitch: () => send({ type: 'clearHitch' }),
  });
  const av = alarmView({
    onArm: () => send({ type: 'arm' }),
    onDisarm: () => send({ type: 'disarm' }),
    onSilence: () => send({ type: 'silence' }),
    onTest: (on) => send({ type: 'test', on }),
    onCfg: (patch) => send({ type: 'setAlarm', patch }),
  });
  const camView = cameraView();
  const settings = settingsView();

  function setTab(t) {
    const prev = C.tab;
    C.tab = t;
    save();
    if (prev === 'camera' && t !== 'camera') { link?.send({ type: 'camera', on: false }); cam?.close(); }
    if (t === 'camera' && prev !== 'camera') link?.send({ type: 'camera', on: true });
    for (const b of $$('[data-tab]', shell)) b.classList.toggle('active', b.dataset.tab === t);
    content.replaceChildren({ level: lv.root, camera: camView.root, alarm: av.root, settings }[t]);
    shell.dataset.tab = t;
    rerender();
  }

  rerender = () => {
    const ls = link?.status || 'off';
    const vs = vanStatus && Date.now() - vanStatus.at < 5000 ? vanStatus : null;
    const linkLabel = {
      connected: 'Van linked', connecting: 'Connecting…', reconnecting: 'Reconnecting…',
      'van-offline': 'Van not online', offline: 'No signal', starting: 'Starting…', off: 'Not paired',
    }[ls] || ls;
    const chips = [{ label: linkLabel + (ls === 'connected' && link.rtt != null ? ` ${link.rtt} ms` : ''), state: ls === 'connected' ? 'ok' : 'bad' }];
    if (vs) {
      chips.push({ label: vs.sensors ? 'Van sensors' : 'Van sensors off', state: vs.sensors ? 'ok' : 'bad' });
      chips.push({ label: vs.wake ? 'Van awake' : 'Van may sleep', state: vs.wake ? 'ok' : 'warn' });
      const st = vs.alarm.state;
      chips.push({ label: st === 'triggered' ? 'ALARM' : st.toUpperCase(), state: st === 'triggered' ? 'bad' : st === 'armed' ? 'ok' : 'off' });
    }
    renderChips($('[data-k=chips]', shell), chips);

    const w = [];
    if (ls !== 'connected') {
      w.push({ id: 'link', text: ls === 'van-offline'
        ? 'Van unit not reachable. Is it open on screen with signal?'
        : ls === 'offline' ? 'No signal on this phone.' : 'Connecting to the van unit…', level: 'warn' });
    }
    if (vs && !vs.sensors) w.push({ id: 'vs', text: vs.started ? 'Van motion sensors lost.' : 'Van unit needs a tap on its screen to start sensors.' });
    else if (vs && !vs.started) w.push({ id: 'vt', text: 'Van unit is waiting for a tap on its screen: siren sound is off until then.', level: 'warn' });
    if (vs && vs.started && !vs.wake) w.push({ id: 'vw', text: 'Van screen wake lock lost.', level: 'warn' });
    if (vs && vs.queued) w.push({ id: 'vq', text: `Van has ${vs.queued} alert(s) waiting for signal.`, level: 'warn' });
    if (vs && vs.cameraError && C.tab === 'camera') w.push({ id: 'ce', text: vs.cameraError });
    renderWarnings($('[data-k=warn]', shell), w);
    shell.dataset.alarm = vs?.alarm?.state || 'unknown';

    const t = C.tab;
    const lvData = () => {
      if (!vs) return { message: ls === 'connected' ? 'Waiting for the van…' : 'No link to van' };
      if (!vs.calibrated) return { message: 'Van unit not calibrated' };
      if (!level) return { message: 'Waiting for level data' };
      return { pitch: level.p, roll: level.r, dims: vs.dims, hitchPitch: vs.hitchPitch, stale: Date.now() - level.at > 2000 };
    };
    if (t === 'level') lv.update(lvData());
    else if (t === 'alarm') av.update(vs ? vs.alarm : null);
    else if (t === 'camera') camView.update(lvData());
    else if (t === 'settings') {
      const topic = $('[data-k=topic]', settings);
      if (topic) topic.textContent = vs?.topic || '(connect to the van to see it)';
    }
  };

  setTab(C.tab || 'level');
}

function cameraView() {
  const root = el(`<section class="camera">
    <div class="cam-frame" data-k="frame">
      <video playsinline muted autoplay data-k="video"></video>
      <svg class="guides" viewBox="0 0 100 100" preserveAspectRatio="none" data-k="guides" aria-hidden="true"></svg>
      <div class="cam-msg" data-k="msg">Starting camera…</div>
      <div class="cam-frozen" data-k="frozen" hidden>FEED FROZEN</div>
      <div class="cam-info" data-k="info"></div>
    </div>
    <div class="cam-level" data-k="lvl"></div>
    <div class="row wrap cam-ctl">
      <label class="switch"><input type="checkbox" data-k="mirror" ${C.mirror ? 'checked' : ''}><span>Mirror</span></label>
      <label class="switch"><input type="checkbox" data-k="gl" ${C.guides ? 'checked' : ''}><span>Guide lines</span></label>
      <label class="slider grow">Guide width<input type="range" min="30" max="95" step="1" value="${C.guideWidth}" data-k="gw"></label>
      <button class="btn ghost" data-k="retry">Restart feed</button>
    </div>
  </section>`);
  const k = (n) => $(`[data-k=${n}]`, root);
  const video = k('video');
  cam = new CabCamera(video);

  const drawGuides = () => {
    const w = C.guideWidth / 2;
    const top = 42;
    const at = (y) => { const f = (y - top) / (100 - top); return w * (0.35 + 0.65 * f); };
    const line = (y, cls) => `<line x1="${50 - at(y)}" y1="${y}" x2="${50 + at(y)}" y2="${y}" class="${cls}"/>`;
    k('guides').innerHTML = `
      <polyline points="${50 - at(top)},${top} ${50 - at(100)},100" class="g-side"/>
      <polyline points="${50 + at(top)},${top} ${50 + at(100)},100" class="g-side"/>
      ${line(88, 'g-red')}${line(70, 'g-amber')}${line(52, 'g-green')}`;
    k('guides').style.display = C.guides ? '' : 'none';
    video.style.transform = C.mirror ? 'scaleX(-1)' : '';
  };
  drawGuides();
  k('mirror').addEventListener('change', (e) => { C.mirror = e.target.checked; save(); drawGuides(); });
  k('gl').addEventListener('change', (e) => { C.guides = e.target.checked; save(); drawGuides(); });
  k('gw').addEventListener('input', (e) => { C.guideWidth = Number(e.target.value); save(); drawGuides(); });
  k('retry').addEventListener('click', () => {
    cam.close();
    link?.send({ type: 'camera', on: false });
    setTimeout(() => link?.send({ type: 'camera', on: true }), 600);
  });
  cam.addEventListener('change', () => rerender());

  function update(lv) {
    const live = !!cam.call && !!video.srcObject;
    k('msg').hidden = live;
    k('msg').textContent = link?.connected ? 'Waiting for the van camera…' : 'No link to van';
    k('frozen').hidden = !cam.frozen;
    k('info').textContent = live ? `${cam.delayMs != null ? `≈${cam.delayMs} ms delay · ` : ''}${cam.fps} fps` : '';
    k('info').classList.toggle('bad', live && (cam.delayMs > 400 || cam.fps < 10));
    if (lv && lv.pitch != null) {
      const sideTxt = Math.abs(lv.roll) <= lv.dims.tol ? 'Side level' : `${lv.roll > 0 ? 'Right' : 'Left'} high ${Math.abs(lv.roll).toFixed(1)}°`;
      const frontTxt = Math.abs(lv.pitch) <= lv.dims.tol ? 'Front level' : `Hitch ${lv.pitch > 0 ? 'high' : 'low'} ${Math.abs(lv.pitch).toFixed(1)}°`;
      k('lvl').textContent = `${sideTxt} · ${frontTxt}`;
    } else k('lvl').textContent = '';
  }
  return { root, update };
}

function settingsView() {
  const root = el(`<section class="settings">
    <div class="card">
      <h3>Pairing</h3>
      <div class="code small">${formatCode(state.link.code)}</div>
      <button class="btn" data-act="pair">Change pairing code</button>
    </div>
    <div class="card">
      <h3>Push alerts (ntfy)</h3>
      <p>Topic set on the van unit: <code data-k="topic"></code></p>
      <ol class="steps">
        <li>Install the free <b>ntfy</b> app from the App Store.</li>
        <li>Tap <b>+</b>, enter the topic above exactly, server ntfy.sh, and Subscribe.</li>
        <li>Allow notifications. In iPhone Settings &gt; Notifications &gt; ntfy, turn on Time Sensitive and Critical if offered.</li>
        <li>On the van unit, Setup &gt; Change topic or PIN &gt; Send a test push.</li>
      </ol>
    </div>
    <details class="card">
      <summary>Advanced: own TURN relay</summary>
      <p class="hint">Only if the live link won't connect on mobile data. Must match the van unit.</p>
      <label class="field">TURN URL(s)<input data-t="turnUrl" value="${esc(state.link.turnUrl)}" placeholder="turn:example.com:3478" autocapitalize="off"></label>
      <label class="field">Username<input data-t="turnUser" value="${esc(state.link.turnUser)}" autocapitalize="off"></label>
      <label class="field">Password<input data-t="turnPass" type="password" value="${esc(state.link.turnPass)}"></label>
      <button class="btn" data-act="saveturn">Save and reload</button>
    </details>
    <div class="card">
      <button class="btn danger" data-act="reset">Change role / reset this phone</button>
    </div>
  </section>`);
  $('[data-act=pair]', root).addEventListener('click', pairScreen);
  $('[data-act=saveturn]', root).addEventListener('click', () => {
    for (const i of $$('[data-t]', root)) state.link[i.dataset.t] = i.value.trim();
    save();
    location.reload();
  });
  $('[data-act=reset]', root).addEventListener('click', () => {
    if (!confirm('Erase settings on this phone?')) return;
    localStorage.clear();
    location.reload();
  });
  return root;
}

export function startCab(appEl) {
  app = appEl;
  if (!state.setupDone || !state.link.code) { pairScreen(); return; }
  startLink();
  main();
  setInterval(() => rerender(), 150);
}
