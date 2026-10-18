# Van Brain (test version)

Caravan leveller, tow-away alarm and reversing camera, as a web app for two iPhones:
an old iPhone fixed in the van (**van unit**) and the main phone (**cab display**).

Live: https://singularity69.github.io/van-brain/ · Setup and test checklist: [HANDOVER.md](HANDOVER.md)

## How it works

- **Leveller**: gravity vector from `DeviceMotionEvent.accelerationIncludingGravity`, adaptive low-pass filtered,
  projected onto the van's forward/right axes found at calibration. The mount the user picks tells us which device axis
  points at the hitch, and also which gravity sign convention the browser uses (iPhone Safari is inverted vs the spec).
  Maths in `js/level-math.js`, tested in `tests/level-math.test.mjs`.
- **Alarm** (`js/alarm.js`): sustained tilt change, 1-second RMS of linear acceleration, and GPS distance from the
  armed position. Pushes go to ntfy.sh (`js/notify.js`), queued and retried while there's no signal.
- **Link** (`js/link.js`): PeerJS (vendored, `vendor/peerjs.min.js` 1.5.4) with its public signalling server and
  default STUN/TURN. Van peer ID is a hash of the pairing code; the cab must also send the full code before the van
  accepts commands.
- **Camera** (`js/camera.js`): van calls the cab with a 640x480 rear camera stream, capped at 600 kbps,
  `maintain-framerate`. Cab shows estimated delay, fps, and a frozen-feed warning.
- **Offline**: `sw.js` caches everything, so the van unit opens and levels with no signal. Bump `VERSION` in `sw.js`
  on every release.

No secrets in the code. The ntfy topic, PIN (stored hashed), pairing code and optional TURN details are entered on
each phone and kept in its `localStorage`.

## Develop

```bash
npm test
```

```bash
npx http-server . -p 8123 -c-1
```

On `localhost` the service worker is skipped (add `?sw` to test it). Add `?sim` for a fake iPhone motion sensor and
GPS: `__sim(frontHighMm, rightHighMm, shake)` and `__gps(lat, lon, accuracy)` in the console. Open the cab on
`127.0.0.1` and the van on `localhost` to run both roles in one browser (separate storage).

Icons: `python tools/make-icons.py`.
