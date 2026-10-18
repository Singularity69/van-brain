import { state, save } from './store.js';
import { el } from './ui.js';

const app = document.getElementById('app');

// The offline cache is skipped on a local dev server (add ?sw to test it there).
const devHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw');
if (devHost && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
if ('serviceWorker' in navigator && !devHost) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const b = el('<button class="update-banner">New version ready. Tap to reload.</button>');
          b.addEventListener('click', () => location.reload());
          document.body.append(b);
        }
      });
    });
  }).catch(() => { /* file:// or unsupported */ });
}

function chooseRole() {
  const s = el(`<div class="screen wizard role">
    <main class="wiz-body">
      <div class="brand"><img src="icons/icon-192.png" alt="" width="72" height="72"><h1>Van Brain</h1></div>
      <p>Which phone is this?</p>
      <button class="role-card" data-role="van">
        <b>Van unit</b>
        <span>The old iPhone fixed in the caravan. Reads the level, runs the alarm, streams the camera.</span>
      </button>
      <button class="role-card" data-role="cab">
        <b>Cab display</b>
        <span>Your main phone. Shows the level and camera live, arms and disarms the alarm.</span>
      </button>
      <p class="hint">Tip: add this page to the Home Screen first (Share &gt; Add to Home Screen), then open it from there. Settings are kept separately for Safari and the Home Screen app.</p>
    </main>
  </div>`);
  app.replaceChildren(s);
  s.addEventListener('click', (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    state.role = b.dataset.role;
    save();
    boot();
  });
}

async function boot() {
  if (!state.role) return chooseRole();
  document.body.dataset.role = state.role;
  if (location.search.includes('sim')) await import('./dev-sim.js');
  if (state.role === 'van') {
    const { startVan } = await import('./van.js');
    startVan(app);
  } else {
    const { startCab } = await import('./cab.js');
    startCab(app);
  }
}

if (!window.Peer) console.warn('PeerJS did not load: live link disabled');
boot();
