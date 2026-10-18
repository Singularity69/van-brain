// Motion sensor, GPS and screen wake lock wrappers.
import { GravityFilter, len, sub, norm, dot } from './level-math.js';

export class Sensors extends EventTarget {
  constructor() {
    super();
    this.filter = new GravityFilter();
    this.lastAt = 0;
    this.gravity = null; // filtered, raw device units
    this.raw = null;
    this.rms = 0; // linear acceleration RMS over the last second, m/s²
    this.listening = false;
    this.permission = Sensors.needsPermission() ? 'unknown' : 'granted';
    this._lin = [];
    this._collect = null;
    this._on = this._on.bind(this);
  }

  static needsPermission() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  // Must be called from a tap on iPhone. Call it before any other await in the handler.
  requestPermission() {
    if (!Sensors.needsPermission()) return Promise.resolve('granted');
    return DeviceMotionEvent.requestPermission().then((r) => {
      this.permission = r;
      return r;
    }).catch((e) => {
      this.permission = 'error';
      throw e;
    });
  }

  start() {
    if (this.listening) return;
    window.addEventListener('devicemotion', this._on);
    this.listening = true;
  }

  get alive() {
    return this.lastAt > 0 && performance.now() - this.lastAt < 2000;
  }

  _on(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    const now = performance.now();
    const dt = this.lastAt ? (now - this.lastAt) / 1000 : 1 / 60;
    this.lastAt = now;
    const raw = [g.x, g.y, g.z];
    this.raw = raw;
    this.gravity = this.filter.update(raw, dt);

    const a = e.acceleration;
    const lin = a && a.x != null ? Math.hypot(a.x, a.y, a.z) : len(sub(raw, this.gravity));
    this._lin.push([now, lin * lin]);
    while (this._lin.length && this._lin[0][0] < now - 1000) this._lin.shift();
    this.rms = Math.sqrt(this._lin.reduce((s, x) => s + x[1], 0) / this._lin.length);

    if (this._collect) this._collect.push(raw);
    this.dispatchEvent(new Event('sample'));
  }

  // Average the raw gravity vector for ms milliseconds. Rejects if the phone wasn't still.
  async average(ms = 2500) {
    if (!this.alive) throw new Error('Motion sensors are not reporting. Tap "Enable sensors" first.');
    this._collect = [];
    await new Promise((r) => setTimeout(r, ms));
    const samples = this._collect;
    this._collect = null;
    if (samples.length < 10) throw new Error('Not enough sensor readings. Try again.');
    const sum = samples.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
    const avg = sum.map((x) => x / samples.length);
    const mean = norm(avg);
    const worst = Math.max(...samples.map((v) => Math.acos(Math.min(1, dot(norm(v), mean))) * 180 / Math.PI));
    if (worst > 3) throw new Error('The phone moved during calibration. Keep the van still and try again.');
    return avg;
  }
}

export class Gps extends EventTarget {
  constructor() {
    super();
    this.pos = null; // { lat, lon, acc, at }
    this.error = null;
    this.watchId = null;
  }
  get supported() { return 'geolocation' in navigator; }
  start() {
    if (!this.supported || this.watchId != null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
        this.error = null;
        this.dispatchEvent(new Event('fix'));
      },
      (err) => {
        this.error = err.code === 1 ? 'Location permission denied' : 'No GPS fix';
        this.dispatchEvent(new Event('fix'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }
  get fresh() { return this.pos && Date.now() - this.pos.at < 120000; }
}

export class Wake extends EventTarget {
  constructor() {
    super();
    this.lock = null;
    this.wanted = false;
    this.error = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted && !this.active) this.request();
    });
  }
  get supported() { return 'wakeLock' in navigator; }
  get active() { return !!this.lock && !this.lock.released; }
  async request() {
    this.wanted = true;
    if (!this.supported) {
      this.error = 'Wake lock not supported on this browser';
      this.dispatchEvent(new Event('change'));
      return false;
    }
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.error = null;
      this.lock.addEventListener('release', () => this.dispatchEvent(new Event('change')));
    } catch (e) {
      this.error = e.message || 'Wake lock refused';
    }
    this.dispatchEvent(new Event('change'));
    return this.active;
  }
}
