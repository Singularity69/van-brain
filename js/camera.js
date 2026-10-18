// Reversing camera over WebRTC. Tuned for low delay rather than picture quality.

export class VanCamera {
  constructor(link) {
    this.link = link;
    this.stream = null;
    this.calls = new Map(); // cab peer id -> MediaConnection
    this.error = null;
  }

  static constraints() {
    return {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    };
  }

  // Ask for the camera once during the start tap, so later requests don't stop on a prompt.
  static async prime() {
    const s = await navigator.mediaDevices.getUserMedia(VanCamera.constraints());
    s.getTracks().forEach((t) => t.stop());
  }

  get active() { return this.calls.size > 0; }

  async startFor(cabPeerId) {
    if (this.calls.has(cabPeerId)) return;
    try {
      if (!this.stream || this.stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
        this.stream = await navigator.mediaDevices.getUserMedia(VanCamera.constraints());
        this.stream.getVideoTracks().forEach((t) => { try { t.contentHint = 'motion'; } catch { /* ignore */ } });
      }
      this.error = null;
    } catch (e) {
      this.error = e.name === 'NotAllowedError' ? 'Camera permission refused on the van phone' : (e.message || 'Camera failed');
      throw new Error(this.error);
    }
    const call = this.link.call(cabPeerId, this.stream);
    this.calls.set(cabPeerId, call);
    const tune = () => {
      const pc = call.peerConnection;
      if (!pc) return;
      for (const s of pc.getSenders()) {
        if (!s.track || s.track.kind !== 'video') continue;
        const p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = 600_000;
        p.encodings[0].maxFramerate = 30;
        p.degradationPreference = 'maintain-framerate';
        s.setParameters(p).catch(() => {});
      }
    };
    setTimeout(tune, 500);
    setTimeout(tune, 3000);
    const end = () => { if (this.calls.get(cabPeerId) === call) this.stopFor(cabPeerId); };
    call.on('close', end);
    call.on('error', end);
  }

  stopFor(cabPeerId) {
    const call = this.calls.get(cabPeerId);
    this.calls.delete(cabPeerId);
    if (call) { try { call.close(); } catch { /* ignore */ } }
    if (!this.calls.size && this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}

export class CabCamera extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.call = null;
    this.lastFrameAt = 0;
    this.delayMs = null;
    this.frozen = false;
    this.fps = 0;
    this._frames = 0;
    setInterval(() => this._check(), 500);
    setInterval(() => this._stats(), 1000);
  }

  attach(call) {
    if (this.call && this.call !== call) { try { this.call.close(); } catch { /* ignore */ } }
    this.call = call;
    call.answer(); // receive only
    call.on('stream', (remote) => {
      this.video.srcObject = remote;
      this.video.play().catch(() => {});
      this.lastFrameAt = performance.now();
      this._watchFrames();
      this.dispatchEvent(new Event('change'));
    });
    const end = () => {
      if (this.call === call) { this.call = null; this.video.srcObject = null; this.dispatchEvent(new Event('change')); }
    };
    call.on('close', end);
    call.on('error', end);
  }

  close() {
    if (this.call) { try { this.call.close(); } catch { /* ignore */ } }
    this.call = null;
    this.video.srcObject = null;
  }

  _watchFrames() {
    const v = this.video;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const cb = () => {
        this.lastFrameAt = performance.now();
        this._frames++;
        if (v.srcObject) v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
    } else {
      let last = -1;
      const poll = () => {
        if (!v.srcObject) return;
        if (v.currentTime !== last) { last = v.currentTime; this.lastFrameAt = performance.now(); this._frames++; }
        requestAnimationFrame(poll);
      };
      poll();
    }
  }

  _check() {
    const frozen = !!this.call && !!this.video.srcObject && performance.now() - this.lastFrameAt > 1000;
    if (frozen !== this.frozen) { this.frozen = frozen; this.dispatchEvent(new Event('change')); }
  }

  async _stats() {
    this.fps = this._frames;
    this._frames = 0;
    const pc = this.call?.peerConnection;
    if (!pc) { this.delayMs = null; return; }
    try {
      const stats = await pc.getStats();
      let jb = null, rtt = null;
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video' && r.jitterBufferEmittedCount) {
          const prev = this._jbPrev;
          const d = prev ? r.jitterBufferDelay - prev.d : r.jitterBufferDelay;
          const n = prev ? r.jitterBufferEmittedCount - prev.n : r.jitterBufferEmittedCount;
          if (n > 0) jb = (d / n) * 1000;
          this._jbPrev = { d: r.jitterBufferDelay, n: r.jitterBufferEmittedCount };
        }
        if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
      });
      // Rough glass-to-glass estimate: network one-way + jitter buffer + ~50 ms capture/decode.
      this.delayMs = jb != null || rtt != null ? Math.round((rtt || 0) / 2 + (jb || 0) + 50) : null;
    } catch { this.delayMs = null; }
    this.dispatchEvent(new Event('change'));
  }
}
