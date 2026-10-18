// Push alerts through ntfy.sh. The topic is entered on the phone during setup.
// Messages queue while there's no signal and retry every 15 seconds.

export const TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;

export function mapLinks(pos) {
  if (!pos) return { apple: null, google: null };
  const ll = `${pos.lat.toFixed(6)},${pos.lon.toFixed(6)}`;
  return {
    apple: `https://maps.apple.com/?ll=${ll}&q=Van`,
    google: `https://www.google.com/maps/search/?api=1&query=${ll}`,
  };
}

export async function ntfySend(topic, { title, message, priority = 3, tags = [], click }) {
  if (!TOPIC_RE.test(topic || '')) throw new Error('No valid ntfy topic set');
  const body = { topic, title, message, priority, tags };
  if (click) body.click = click;
  // Plain string body = "simple" request, so no CORS preflight is needed.
  const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`ntfy replied ${r.status}`);
  return true;
}

export class Notifier extends EventTarget {
  constructor(getTopic) {
    super();
    this.getTopic = getTopic;
    this.queue = [];
    this.lastError = null;
    this.lastSentAt = null;
    setInterval(() => this.flush(), 15000);
    window.addEventListener('online', () => this.flush());
  }
  send(msg) {
    this.queue.push({ ...msg, queuedAt: Date.now() });
    return this.flush();
  }
  async flush() {
    if (this._busy) return;
    this._busy = true;
    try {
      while (this.queue.length) {
        const m = this.queue[0];
        const queuedFor = Date.now() - m.queuedAt;
        const msg = queuedFor > 30000
          ? { ...m, message: `${m.message}\n(Delayed ${Math.round(queuedFor / 60000)} min: no signal at the van)` }
          : m;
        await ntfySend(this.getTopic(), msg);
        this.queue.shift();
        this.lastError = null;
        this.lastSentAt = Date.now();
      }
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this._busy = false;
      this.dispatchEvent(new Event('change'));
    }
  }
}
