// Pure leveller maths. No DOM, so it can be unit tested in Node.
//
// Device axes follow the W3C DeviceMotion convention:
//   +x = right edge of the screen, +y = top edge of the screen, +z = out of the screen.
// accelerationIncludingGravity points UP (the reaction to gravity) under that spec,
// but iPhone Safari reports it pointing DOWN. Calibration works out which one we have
// by comparing the reading with the "up" axis of the mount the user picked.

export const MOUNTS = {
  'flat-top-hitch': {
    label: 'Lying flat, screen up, top edge towards the hitch',
    up: [0, 0, 1], fwd: [0, 1, 0],
  },
  'flat-top-rear': {
    label: 'Lying flat, screen up, top edge towards the rear',
    up: [0, 0, 1], fwd: [0, -1, 0],
  },
  'flat-top-left': {
    label: 'Lying flat, screen up, top edge towards the LEFT side',
    up: [0, 0, 1], fwd: [1, 0, 0],
  },
  'flat-top-right': {
    label: 'Lying flat, screen up, top edge towards the RIGHT side',
    up: [0, 0, 1], fwd: [-1, 0, 0],
  },
  'upright-face-hitch': {
    label: 'Upright (portrait), screen facing the hitch, rear camera looking out the back',
    up: [0, 1, 0], fwd: [0, 0, 1],
  },
  'upright-face-rear': {
    label: 'Upright (portrait), screen facing the rear',
    up: [0, 1, 0], fwd: [0, 0, -1],
  },
  'upright-face-right': {
    label: 'Upright (portrait) on the left wall, screen facing the RIGHT side',
    up: [0, 1, 0], fwd: [1, 0, 0],
  },
  'upright-face-left': {
    label: 'Upright (portrait) on the right wall, screen facing the LEFT side',
    up: [0, 1, 0], fwd: [-1, 0, 0],
  },
};

const DEG = 180 / Math.PI;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a) => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Build a calibration from an averaged gravity reading taken while the van is level.
 * Returns { sign, up, fwd, right } or throws if the phone doesn't match the chosen mount.
 */
export function calibrate(avgGravity, mountKey) {
  const mount = MOUNTS[mountKey];
  if (!mount) throw new Error('Unknown mount');
  const g = norm(avgGravity);
  if (len(avgGravity) === 0) throw new Error('No sensor reading');
  const d = dot(g, mount.up);
  if (Math.abs(d) < 0.7) {
    throw new Error('The phone is not sitting the way the chosen mount says. Check the mount option and try again.');
  }
  const sign = d > 0 ? 1 : -1;
  const up = scale(g, sign);
  const fwd = norm(sub(mount.fwd, scale(up, dot(mount.fwd, up))));
  const right = cross(fwd, up);
  return { sign, up, fwd, right };
}

/**
 * Angles from a (filtered) gravity reading.
 * pitch: + means FRONT (hitch end) is high. roll: + means RIGHT side is high. Degrees.
 */
export function angles(gravity, cal, flips = {}) {
  const n = norm(scale(gravity, cal.sign));
  let pitch = Math.asin(clamp(dot(n, cal.fwd), -1, 1)) * DEG;
  let roll = Math.asin(clamp(dot(n, cal.right), -1, 1)) * DEG;
  if (flips.invertPitch) pitch = -pitch;
  if (flips.invertRoll) roll = -roll;
  return { pitch, roll };
}

export const round5 = (mm) => Math.round(mm / 5) * 5;
const tan = (deg) => Math.tan(deg / DEG);

/**
 * Plain-English levelling instructions.
 * track: wheel centre to wheel centre (mm). jockey: axle centre to jockey wheel (mm).
 */
export function instructions(pitch, roll, { track, jockey, tol }) {
  const sideMm = round5(track * tan(Math.abs(roll)));
  const frontMm = round5(jockey * tan(Math.abs(pitch)));
  const sideLevel = Math.abs(roll) <= tol || sideMm === 0;
  const frontLevel = Math.abs(pitch) <= tol || frontMm === 0;
  return {
    sideLevel,
    frontLevel,
    level: sideLevel && frontLevel,
    sideMm,
    frontMm,
    lowSide: roll > 0 ? 'LEFT' : 'RIGHT',
    side: sideLevel ? 'Side to side LEVEL' : `Raise ${roll > 0 ? 'LEFT' : 'RIGHT'} side ${sideMm} mm`,
    front: frontLevel ? 'Front to back LEVEL' : `${pitch > 0 ? 'Lower' : 'Raise'} jockey ${frontMm} mm`,
  };
}

/** How far to wind the jockey to get back to the saved hitch angle. + = wind UP. */
export function hitchInstruction(pitch, hitchPitch, { jockey }, tolMm = 5) {
  const mm = jockey * (tan(hitchPitch) - tan(pitch));
  const r = round5(Math.abs(mm));
  if (Math.abs(mm) <= tolMm || r === 0) return { matched: true, mm: 0, text: 'Hitch height MATCHED' };
  return { matched: false, mm: Math.sign(mm) * r, text: `${mm > 0 ? 'Raise' : 'Lower'} jockey ${r} mm to match hitch` };
}

/**
 * Adaptive low-pass filter for the gravity vector.
 * Slow (smooth) while the reading is steady, faster when it genuinely changes,
 * so the numbers don't jitter but still follow the van while it's moving slowly.
 */
export class GravityFilter {
  constructor({ slowTau = 0.6, fastTau = 0.12, jumpDeg = 0.6 } = {}) {
    this.slowTau = slowTau;
    this.fastTau = fastTau;
    this.jumpCos = Math.cos(jumpDeg / DEG);
    this.v = null;
  }
  update(sample, dtSec) {
    if (!this.v) {
      this.v = sample.slice();
      return this.v;
    }
    const c = dot(norm(sample), norm(this.v));
    const tau = c < this.jumpCos ? this.fastTau : this.slowTau;
    const a = 1 - Math.exp(-Math.max(0.001, Math.min(dtSec, 0.5)) / tau);
    this.v = [
      this.v[0] + a * (sample[0] - this.v[0]),
      this.v[1] + a * (sample[1] - this.v[1]),
      this.v[2] + a * (sample[2] - this.v[2]),
    ];
    return this.v;
  }
  reset() { this.v = null; }
}

/** Great-circle distance in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d / DEG;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
