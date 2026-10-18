// Loud siren played through an <audio> element (the "playback" audio category on iPhone,
// so it isn't silenced by the ring/silent switch the way Web Audio can be).
// The sound is synthesised here as a WAV, so it works with no signal.

function makeWav({ seconds, rate = 22050, fn }) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const { freq, amp } = fn(t, seconds);
    phase += (2 * Math.PI * freq) / rate;
    // Soft-clipped sine: louder and harsher than a plain sine, still not painful to the speaker.
    const s = Math.tanh(3 * Math.sin(phase)) * amp;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Siren {
  constructor() {
    // Two-second wail: 650 Hz up to 1500 Hz and back.
    this.wailUrl = makeWav({
      seconds: 2,
      fn: (t, T) => ({ freq: 650 + 850 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / T)), amp: 0.95 }),
    });
    this.beepUrl = makeWav({
      seconds: 0.25,
      fn: (t) => ({ freq: 1000, amp: t < 0.22 ? 0.6 : 0 }),
    });
    this.audio = new Audio(this.wailUrl);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.beepAudio = new Audio(this.beepUrl);
    this.unlocked = false;
    this.sounding = false;
  }

  // Call synchronously inside a tap handler.
  unlock() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* older Safari */ }
    const a = this.audio;
    a.muted = true;
    const p = a.play();
    const done = () => {
      if (!this.sounding) { a.pause(); a.currentTime = 0; }
      a.muted = false;
      this.unlocked = true;
    };
    const b = this.beepAudio;
    b.muted = true;
    const pb = b.play();
    return Promise.all([
      Promise.resolve(p).then(done),
      Promise.resolve(pb).then(() => { b.pause(); b.muted = false; }),
    ]).catch(() => { a.muted = false; b.muted = false; });
  }

  start() {
    this.sounding = true;
    this.audio.currentTime = 0;
    this.audio.muted = false;
    return this.audio.play().catch(() => { /* not unlocked: needs a tap */ });
  }

  stop() {
    this.sounding = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  beep() {
    this.beepAudio.currentTime = 0;
    return this.beepAudio.play().catch(() => {});
  }
}
