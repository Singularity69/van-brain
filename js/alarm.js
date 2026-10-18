// Tow-away and movement alarm logic for the van unit.
// Fed with level angles, movement RMS and GPS fixes; decides when to trigger.
import { haversine } from './level-math.js';

export class Alarm extends EventTarget {
  /** cfg is state.alarm (persisted); save() persists it. */
  constructor(cfg, save) {
    super();
    this.cfg = cfg;
    this.save = save;
    this.armingUntil = 0;
    this.test = false;
    this.testBase = null;
    this.metrics = { tilt: 0, tiltFor: 0, move: 0, movePeak: 0, gpsDist: null, gpsAcc: null };
    this.would = { tilt: 0, move: 0, gps: 0 }; // test mode: times each trigger would have fired
    this._tiltSince = null;
    this._gpsHits = 0;
    this._wouldLatch = { tilt: false, move: false, gps: false };
    this._timer = setInterval(() => this._tickArming(), 250);
    this.latest = { pitch: null, roll: null, pos: null };
  }

  get armed() { return this.cfg.armed; }
  get triggered() { return this.cfg.triggered; }
  get arming() { return this.armingUntil > Date.now() ? Math.ceil((this.armingUntil - Date.now()) / 1000) : 0; }

  get state() {
    if (this.cfg.triggered) return 'triggered';
    if (this.cfg.armed) return 'armed';
    if (this.arming) return 'arming';
    return 'disarmed';
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new Event('change'));
  }

  arm(source = 'van') {
    if (this.cfg.armed || this.arming) return;
    const delay = Math.max(0, Number(this.cfg.armDelay) || 0);
    this.armingUntil = Date.now() + delay * 1000;
    this.armSource = source;
    if (!delay) this._tickArming();
    this._emit('arming', { source, delay });
  }

  _tickArming() {
    if (this.armingUntil && Date.now() >= this.armingUntil && !this.cfg.armed) {
      this.armingUntil = 0;
      this.cfg.armed = true;
      this.cfg.triggered = false;
      this.cfg.reasons = [];
      this.cfg.kinds = [];
      this.cfg.base = this._snapshot();
      this.metrics.movePeak = 0;
      this._resetTrackers();
      this.save();
      this._emit('armed', { source: this.armSource });
    }
  }

  disarm(source = 'van') {
    const was = this.state;
    this.armingUntil = 0;
    this.cfg.armed = false;
    this.cfg.triggered = false;
    this.cfg.reasons = [];
    this.cfg.kinds = [];
    this.cfg.base = null;
    this._resetTrackers();
    this.save();
    this._emit('disarmed', { source, was });
  }

  setTest(on) {
    this.test = !!on;
    this.testBase = on ? this._snapshot() : null;
    this.would = { tilt: 0, move: 0, gps: 0 };
    this._wouldLatch = { tilt: false, move: false, gps: false };
    this.metrics.movePeak = 0;
    this._resetTrackers();
    this.dispatchEvent(new Event('change'));
  }

  _snapshot() {
    const { pitch, roll, pos } = this.latest;
    return {
      pitch, roll,
      lat: pos && pos.acc <= 100 ? pos.lat : null,
      lon: pos && pos.acc <= 100 ? pos.lon : null,
    };
  }

  _resetTrackers() {
    this._tiltSince = null;
    this._gpsHits = 0;
  }

  get _base() {
    if (this.cfg.armed) return this.cfg.base;
    if (this.test) return this.testBase;
    return null;
  }

  _hit(kind, text) {
    if (this.cfg.armed) {
      this.trigger(kind, text);
    } else if (this.test && !this._wouldLatch[kind]) {
      this._wouldLatch[kind] = true;
      this.would[kind]++;
      this._emit('would', { kind, text });
    }
  }

  _clear(kind) { this._wouldLatch[kind] = false; }

  // One reason per kind (tilt / move / gps); only the first of each kind raises an alert.
  trigger(kind, reason) {
    const kinds = this.cfg.kinds || (this.cfg.kinds = []);
    const i = kinds.indexOf(kind);
    if (this.cfg.triggered && i >= 0) {
      this.cfg.reasons[i] = reason; // keep the latest figure, no new alert
      return;
    }
    if (this.cfg.triggered) {
      kinds.push(kind);
      this.cfg.reasons.push(reason);
      this.save();
      this._emit('reason', { reason });
      return;
    }
    this.cfg.triggered = true;
    this.cfg.kinds = [kind];
    this.cfg.reasons = [reason];
    this.save();
    this._emit('trigger', { reason });
  }

  feedLevel(pitch, roll) {
    this.latest.pitch = pitch;
    this.latest.roll = roll;
    const b = this._base;
    if (!b) return;
    if (b.pitch == null) { b.pitch = pitch; b.roll = roll; if (this.cfg.armed) this.save(); return; }
    const d = Math.max(Math.abs(pitch - b.pitch), Math.abs(roll - b.roll));
    this.metrics.tilt = d;
    const now = Date.now();
    if (this.cfg.tiltOn && d > this.cfg.tiltDeg) {
      if (!this._tiltSince) this._tiltSince = now;
      this.metrics.tiltFor = (now - this._tiltSince) / 1000;
      if (this.metrics.tiltFor >= this.cfg.tiltSecs) {
        const which = Math.abs(pitch - b.pitch) >= Math.abs(roll - b.roll) ? 'front to back (hitching / jockey?)' : 'side to side (jacking / wheel?)';
        this._hit('tilt', `Tilt changed ${d.toFixed(1)}° ${which}`);
      }
    } else {
      this._tiltSince = null;
      this.metrics.tiltFor = 0;
      this._clear('tilt');
    }
  }

  feedMove(rms) {
    this.metrics.move = rms;
    if (!this._base) return;
    this.metrics.movePeak = Math.max(this.metrics.movePeak, rms);
    if (this.cfg.moveOn && rms > this.cfg.moveRms) {
      this._hit('move', `Strong movement (${rms.toFixed(2)} m/s²)`);
    } else if (rms < this.cfg.moveRms * 0.7) {
      this._clear('move');
    }
  }

  feedGps(pos) {
    this.latest.pos = pos;
    const b = this._base;
    if (!b || !pos) return;
    if (b.lat == null) {
      if (pos.acc <= 50) { b.lat = pos.lat; b.lon = pos.lon; if (this.cfg.armed) this.save(); }
      return;
    }
    const dist = haversine(b.lat, b.lon, pos.lat, pos.lon);
    this.metrics.gpsDist = dist;
    this.metrics.gpsAcc = pos.acc;
    // Only trust the distance when the fix is better than the trigger distance.
    if (this.cfg.gpsOn && dist > this.cfg.gpsMetres && pos.acc < this.cfg.gpsMetres) {
      this._gpsHits++;
      if (this._gpsHits >= 2) this._hit('gps', `GPS moved ${Math.round(dist)} m`);
    } else {
      this._gpsHits = 0;
      if (dist < this.cfg.gpsMetres * 0.7) this._clear('gps');
    }
  }
}
