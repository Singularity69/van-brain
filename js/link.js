// Phone-to-phone link over WebRTC using PeerJS and its free public signalling server.
// The van unit's peer ID is derived from the pairing code; the cab must also send the
// full code before the van will accept any commands from it.
import { sha256 } from './store.js';

const Peer = window.Peer;

export async function peerIdFor(code) {
  return 'vanbrain-' + (await sha256('vanbrain-peer:' + code)).slice(0, 24);
}

function peerOptions(link) {
  const def = window.peerjs?.util?.defaultConfig || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const iceServers = [...def.iceServers];
  if (link.turnUrl) {
    iceServers.push({ urls: link.turnUrl.split(',').map((s) => s.trim()), username: link.turnUser, credential: link.turnPass });
  }
  return { config: { iceServers }, debug: 1 };
}

const RETRY_ERRORS = ['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

export class VanLink extends EventTarget {
  constructor(code, linkSettings) {
    super();
    this.code = code;
    this.settings = linkSettings;
    this.cabs = new Set();
    this.status = 'starting'; // starting | waiting | connected | reconnecting | offline
    this.peer = null;
  }

  async start() {
    this.id = await peerIdFor(this.code);
    this._open();
    setInterval(() => this._reap(), 3000);
  }

  _set(s) {
    if (this.cabs.size) s = 'connected';
    if (s !== this.status) {
      this.status = s;
      this.dispatchEvent(new Event('status'));
    }
  }

  _open() {
    clearTimeout(this._retry);
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    const peer = new Peer(this.id, peerOptions(this.settings));
    this.peer = peer;
    peer.on('open', () => this._set('waiting'));
    peer.on('connection', (conn) => this._onConn(conn));
    peer.on('disconnected', () => {
      // Lost the signalling server; existing phone-to-phone links keep working.
      this._set('reconnecting');
      clearTimeout(this._retry);
      this._retry = setTimeout(() => {
        if (peer.destroyed) return this._open();
        try { peer.reconnect(); } catch { this._open(); }
      }, 3000);
    });
    peer.on('error', (err) => {
      this.lastError = err.type || err.message;
      if (RETRY_ERRORS.includes(err.type)) {
        this._set(navigator.onLine ? 'reconnecting' : 'offline');
        clearTimeout(this._retry);
        // 'unavailable-id' happens after a reload while the server still remembers the old socket.
        this._retry = setTimeout(() => this._open(), err.type === 'unavailable-id' ? 5000 : 4000);
      }
      this.dispatchEvent(new Event('status'));
    });
  }

  _onConn(conn) {
    conn.on('data', (d) => {
      if (!conn.vbAuth) {
        if (d && d.type === 'hello' && d.key === this.code) {
          conn.vbAuth = true;
          conn.vbLastSeen = Date.now();
          this.cabs.add(conn);
          conn.send({ type: 'welcome' });
          this._set('connected');
          this.dispatchEvent(new CustomEvent('cab', { detail: conn }));
        } else {
          conn.close();
        }
        return;
      }
      conn.vbLastSeen = Date.now();
      if (d.type === 'ping') { conn.send({ type: 'pong', t: d.t }); return; }
      this.dispatchEvent(new CustomEvent('message', { detail: { conn, msg: d } }));
    });
    const drop = () => {
      if (this.cabs.delete(conn)) {
        this.dispatchEvent(new CustomEvent('cabgone', { detail: conn }));
        this._set(this.peer?.open ? 'waiting' : 'reconnecting');
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _reap() {
    for (const c of [...this.cabs]) {
      if (!c.open || Date.now() - c.vbLastSeen > 9000) {
        try { c.close(); } catch { /* ignore */ }
        this.cabs.delete(c);
        this.dispatchEvent(new CustomEvent('cabgone', { detail: c }));
      }
    }
    if (!this.cabs.size && this.status === 'connected') this._set(this.peer?.open ? 'waiting' : 'reconnecting');
  }

  get connected() { return this.cabs.size > 0; }

  broadcast(msg) {
    for (const c of this.cabs) if (c.open) { try { c.send(msg); } catch { /* channel closing */ } }
  }

  call(peerId, stream) { return this.peer.call(peerId, stream); }
}

export class CabLink extends EventTarget {
  constructor(code, linkSettings) {
    super();
    this.code = code;
    this.settings = linkSettings;
    this.status = 'starting'; // starting | connecting | connected | van-offline | reconnecting | offline
    this.conn = null;
    this.rtt = null;
    this.lastData = 0;
  }

  async start() {
    this.vanId = await peerIdFor(this.code);
    this._open();
    setInterval(() => this._tick(), 2000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._tick(true);
    });
    window.addEventListener('online', () => this._tick(true));
  }

  _set(s) {
    if (s !== this.status) {
      this.status = s;
      this.dispatchEvent(new Event('status'));
    }
  }

  _open() {
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    const peer = new Peer(undefined, peerOptions(this.settings));
    this.peer = peer;
    peer.on('open', () => this._connect());
    peer.on('call', (call) => this.dispatchEvent(new CustomEvent('call', { detail: call })));
    peer.on('disconnected', () => {
      if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { this._open(); } }, 2000);
    });
    peer.on('error', (err) => {
      this.lastError = err.type || err.message;
      if (err.type === 'peer-unavailable') this._set('van-offline');
      else if (RETRY_ERRORS.includes(err.type)) {
        this._set(navigator.onLine ? 'reconnecting' : 'offline');
        clearTimeout(this._reopen);
        this._reopen = setTimeout(() => this._open(), 4000);
      }
    });
  }

  _connect() {
    if (!this.peer || !this.peer.open) return;
    if (this.conn) { try { this.conn.close(); } catch { /* ignore */ } }
    this._set(this.status === 'connected' ? 'reconnecting' : 'connecting');
    const conn = this.peer.connect(this.vanId, { serialization: 'json', reliable: true });
    this.conn = conn;
    this.connStartedAt = Date.now();
    conn.on('open', () => conn.send({ type: 'hello', key: this.code }));
    conn.on('data', (d) => {
      this.lastData = Date.now();
      if (d.type === 'welcome') { this._set('connected'); return; }
      if (d.type === 'pong') { this.rtt = Date.now() - d.t; return; }
      this.dispatchEvent(new CustomEvent('message', { detail: d }));
    });
    conn.on('close', () => { if (this.conn === conn) this._set('reconnecting'); });
    conn.on('error', () => { if (this.conn === conn) this._set('reconnecting'); });
  }

  _tick(force) {
    if (!this.peer || this.peer.destroyed) return this._open();
    if (!this.peer.open) return;
    const c = this.conn;
    const ok = c && c.open && this.status === 'connected' && Date.now() - this.lastData < 6000;
    if (ok) { c.send({ type: 'ping', t: Date.now() }); return; }
    // Give a fresh attempt 8 seconds before trying again.
    if (force || !c || Date.now() - this.connStartedAt > 8000) {
      if (this.status === 'connected') this._set('reconnecting');
      this._connect();
    }
  }

  get connected() { return this.status === 'connected'; }

  send(msg) {
    if (this.conn && this.conn.open) { this.conn.send(msg); return true; }
    return false;
  }
}
