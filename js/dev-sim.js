// Desktop test harness, loaded only with ?sim in the URL.
// Fakes an iPhone motion sensor (mounted upright, screen facing the hitch) and GPS.
//   __sim(frontHighMm, rightHighMm, shake)   e.g. __sim(60, -35)  or  __sim(0, 0, 1.5)
//   __gps(lat, lon, accuracyMetres)
const s = { front: 0, right: 0, shake: 0, noise: 0.02, track: 2000, jockey: 3500 };
window.__sim = (front, right, shake = 0) => Object.assign(s, { front, right, shake });

setInterval(() => {
  const sp = Math.sin(Math.atan(s.front / s.jockey));
  const sr = Math.sin(Math.atan(s.right / s.track));
  const up = [sr, sp, Math.sqrt(1 - sp * sp - sr * sr)]; // van frame: right, forward, up
  const dev = [-up[0], up[2], up[1]]; // upright, screen facing hitch
  const n = () => (Math.random() - 0.5) * s.noise * 2;
  const lin = [0, 1, 2].map(() => (s.shake ? (Math.random() - 0.5) * s.shake * 3 : n()));
  const g = dev.map((v, i) => -9.81 * v + lin[i]); // iPhone sign convention
  window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
    accelerationIncludingGravity: { x: g[0], y: g[1], z: g[2] },
    acceleration: { x: lin[0], y: lin[1], z: lin[2] },
    interval: 16,
  }));
}, 16);

const watchers = new Set();
let pos = { latitude: -31.95, longitude: 115.86, accuracy: 8 };
const emit = () => watchers.forEach((cb) => cb({ coords: { ...pos }, timestamp: Date.now() }));
window.__gps = (lat, lon, acc = 8) => { pos = { latitude: lat, longitude: lon, accuracy: acc }; emit(); };
Object.defineProperty(navigator, 'geolocation', {
  value: {
    watchPosition(cb) { watchers.add(cb); setTimeout(() => cb({ coords: { ...pos }, timestamp: Date.now() }), 200); return 1; },
    clearWatch() {},
    getCurrentPosition(cb) { cb({ coords: { ...pos }, timestamp: Date.now() }); },
  },
});
setInterval(emit, 3000);
console.info('Van Brain simulator on: __sim(frontMm, rightMm, shake), __gps(lat, lon, acc)');
