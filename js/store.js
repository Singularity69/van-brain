// Settings live only on this phone (localStorage). Nothing private is in the code.
const KEY = 'vanbrain.v1';

export const DEFAULTS = {
  role: null, // 'van' | 'cab'
  setupDone: false,
  van: {
    track: 2000, // wheel centre to wheel centre, mm
    jockey: 3500, // axle centre to jockey wheel, mm
    tol: 0.3, // degrees
    mount: 'upright-face-hitch',
    cal: null,
    invertPitch: false,
    invertRoll: false,
    hitchPitch: null,
    cameraOn: true,
  },
  alarm: {
    topic: '',
    pinHash: '',
    armDelay: 20,
    tiltOn: true,
    tiltDeg: 0.5,
    tiltSecs: 3,
    moveOn: true,
    moveRms: 0.6,
    gpsOn: true,
    gpsMetres: 50,
    // runtime state that must survive a reload
    armed: false,
    triggered: false,
    reasons: [],
    kinds: [],
    base: null, // { pitch, roll, lat, lon }
  },
  link: { code: '', turnUrl: '', turnUser: '', turnPass: '' },
  cab: { mirror: false, guides: true, guideWidth: 60, tab: 'level' },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return merge(structuredClone(DEFAULTS), raw ? JSON.parse(raw) : {});
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export function resetAll() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashPin = (pin) => sha256('vanbrain-pin:' + pin);

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return s;
}
export const formatCode = (c) => (c || '').replace(/(.{5})(?=.)/g, '$1-');
export const cleanCode = (c) => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
