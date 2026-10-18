// Run: node tests/level-math.test.mjs
// Simulates every mount orientation, both gravity sign conventions (spec and iPhone),
// a few degrees of sloppy mounting, and checks the angles and mm instructions.
import {
  MOUNTS, calibrate, angles, instructions, hitchInstruction, GravityFilter,
  cross, dot, norm, haversine,
} from '../js/level-math.js';

let fails = 0;
let passes = 0;
const check = (cond, msg) => {
  if (cond) passes++;
  else { fails++; console.error('FAIL:', msg); }
};
const near = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ±${tol})`);

const DEG = Math.PI / 180;

// Rotate vector v about unit axis k by angle a (Rodrigues).
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kxv[i] * s + k[i] * kdv * (1 - c));
}

// World "up" expressed in the van frame (X right, Y forward, Z up) for a van that is
// tilted so the front is h_front mm high over the jockey distance and the right is
// h_right mm high over the track.
function upInVan(frontHighMm, rightHighMm, track, jockey) {
  const sp = Math.sin(Math.atan(frontHighMm / jockey));
  const sr = Math.sin(Math.atan(rightHighMm / track));
  return norm([sr, sp, Math.sqrt(Math.max(0, 1 - sp * sp - sr * sr))]);
}

// Convert a van-frame vector into device coordinates for a mount, with misalignment.
function vanToDevice(vVan, mountKey, misalign) {
  const m = MOUNTS[mountKey];
  const right = cross(m.fwd, m.up);
  // device vector = X*right + Y*fwd + Z*up
  let d = [0, 1, 2].map((i) => vVan[0] * right[i] + vVan[1] * m.fwd[i] + vVan[2] * m.up[i]);
  // Phone not perfectly square in its mount: small tilt about the device's own axes.
  d = rot(d, [1, 0, 0], misalign[0] * DEG);
  d = rot(d, [0, 1, 0], misalign[1] * DEG);
  return d;
}

const dims = { track: 2000, jockey: 3500, tol: 0.3 };

for (const mountKey of Object.keys(MOUNTS)) {
  for (const sign of [1, -1]) { // 1 = W3C spec, -1 = iPhone Safari
    for (const misalign of [[0, 0], [4, -3]]) {
      const reading = (frontMm, rightMm) =>
        vanToDevice(upInVan(frontMm, rightMm, dims.track, dims.jockey), mountKey, misalign)
          .map((x) => x * 9.81 * sign);
      const tag = `${mountKey} sign=${sign} mis=${misalign}`;

      const cal = calibrate(reading(0, 0), mountKey);
      check(cal.sign === sign, `${tag}: detected sign convention`);

      const lvl = angles(reading(0, 0), cal);
      near(lvl.pitch, 0, 1e-6, `${tag}: level pitch`);
      near(lvl.roll, 0, 1e-6, `${tag}: level roll`);

      // Tray test: left side raised 35 mm -> right is low -> "Raise RIGHT side 35 mm"
      let a = angles(reading(0, -35), cal);
      let ins = instructions(a.pitch, a.roll, dims);
      check(ins.side === 'Raise RIGHT side 35 mm', `${tag}: left raised 35 -> "${ins.side}"`);
      check(ins.frontLevel, `${tag}: front stays level when only side tilted`);

      // Right side raised 50 mm -> "Raise LEFT side 50 mm"
      a = angles(reading(0, 50), cal);
      ins = instructions(a.pitch, a.roll, dims);
      check(ins.side === 'Raise LEFT side 50 mm', `${tag}: right raised 50 -> "${ins.side}"`);

      // Front (jockey) 60 mm high -> "Lower jockey 60 mm"
      a = angles(reading(60, 0), cal);
      ins = instructions(a.pitch, a.roll, dims);
      check(ins.front === 'Lower jockey 60 mm', `${tag}: front high 60 -> "${ins.front}"`);
      check(ins.sideLevel, `${tag}: side stays level when only front tilted`);

      // Front 120 mm low -> "Raise jockey 120 mm"
      a = angles(reading(-120, 0), cal);
      ins = instructions(a.pitch, a.roll, dims);
      check(ins.front === 'Raise jockey 120 mm', `${tag}: front low 120 -> "${ins.front}"`);

      // Combined: within 5 mm on both axes (misalignment adds a little cross-talk).
      a = angles(reading(80, -40), cal);
      ins = instructions(a.pitch, a.roll, dims);
      near(ins.frontMm, 80, 5, `${tag}: combined front mm`);
      near(ins.sideMm, 40, 5, `${tag}: combined side mm`);
      check(ins.lowSide === 'RIGHT', `${tag}: combined low side`);
    }
  }
}

// Wrong mount picked -> calibration refuses.
let threw = false;
try { calibrate([0, 9.81, 0], 'flat-top-hitch'); } catch { threw = true; }
check(threw, 'calibrate rejects a reading that does not match the mount');

// Tolerance: 0.2 deg is LEVEL with default 0.3 tolerance; 0.5 is not.
check(instructions(0.2, -0.2, dims).level, '0.2 deg within tolerance is LEVEL');
check(!instructions(0.5, 0, dims).level, '0.5 deg is not LEVEL');

// Hitch height: saved 1.5 deg nose-down while hitched; now 0 deg -> lower jockey.
const h = hitchInstruction(0, -1.5, dims);
check(!h.matched && h.text.startsWith('Lower jockey'), `hitch instruction "${h.text}"`);
near(Math.abs(h.mm), 90, 5, 'hitch mm');
check(hitchInstruction(-1.5, -1.5, dims).matched, 'hitch matched');

// Filter: settles on a steady value and follows a step.
const f = new GravityFilter();
for (let i = 0; i < 200; i++) f.update([0, 0, 9.81 + (i % 2 ? 0.05 : -0.05)], 1 / 60);
near(f.v[2], 9.81, 0.03, 'filter smooths jitter');
for (let i = 0; i < 60; i++) f.update([0, 1, 9.76], 1 / 60);
near(f.v[1], 1, 0.05, 'filter follows a real change within 1 s');

near(haversine(-31.95, 115.86, -31.95045, 115.86), 50, 0.5, 'haversine 50 m');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
