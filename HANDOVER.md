# Van Brain: test version handover

**Live app:** https://singularity69.github.io/van-brain/

One web app, two roles. The old iPhone in the caravan is the **van unit**. Your main phone is the **cab display**.

---

## 1. Set up the van unit (old iPhone)

1. Charge it and keep it on a charger in the van. Turn the volume all the way up (Settings > Sounds). Turn the ring/silent switch to ring.
2. Settings > Display & Brightness > **Auto-Lock > Never**.
3. Open the live app link in **Safari**. Tap Share > **Add to Home Screen**. From now on, always open Van Brain from the Home Screen icon (Safari and the Home Screen app keep separate settings).
4. Open it from the Home Screen and choose **Van unit**.
5. Tap **Enable sensors, sound & location**. Allow Motion & Orientation, Location and Camera when asked.
6. Enter the van measurements:
   - wheel track width: centre of left wheel to centre of right wheel, in mm
   - axle centre to jockey wheel, in mm
   - tolerance (leave at 0.3 degrees to start)
7. Pick how the phone is mounted. For the reversing camera, mount it **upright on the inside of the rear window, screen facing the hitch**, so the rear camera looks out the back.
8. **Calibrate**: level the van with a spirit level on the floor (side to side and front to back), make sure nobody is moving inside, tap Calibrate and wait 3 seconds.
9. **Check direction**: wind the jockey up a little: it should read "hitch high". Put a block under the right wheel: it should read "right high". If either is backwards, tick the flip switch on that screen.
10. Alarm: the app makes up a hard-to-guess ntfy topic. Leave it, or type your own. Set a 4 to 8 digit PIN.
11. Note the 10-character **pairing code** on the last screen.
12. Turn on Guided Access (Settings > Accessibility > Guided Access), open Van Brain, triple-click the side button and start Guided Access. That stops the phone leaving the app.

After any reload or restart the van unit shows a big **Tap to start** button. iPhone needs that one tap to turn the motion sensors and siren sound back on. If it reloads while the alarm is armed, it stays armed (GPS keeps working), the cab shows a warning, and if nobody taps within 2 minutes it sends you an ntfy push saying it needs a tap.

## 2. Set up the cab display (your main phone)

1. Install the free **ntfy** app from the App Store.
2. In ntfy, tap **+**, type the topic shown on the van unit (Setup tab), leave the server as ntfy.sh, and Subscribe. Allow notifications. In iPhone Settings > Notifications > ntfy, turn on Time Sensitive.
3. On the van unit, Setup > Change topic or PIN > **Send a test push**. Check it arrives.
4. Open the live app link in Safari, Add to Home Screen, open it from there, choose **Cab display** and enter the pairing code.
5. The top bar should say **Van linked**. Tap the screen once so the cab can beep and stay awake.

## 3. Using it

- **Level tab** (both phones): big instructions like "Raise LEFT side 35 mm" and "Lower jockey 60 mm". The badge turns green at LEVEL. The van picture shows a bubble that moves to the high side.
- **Save hitch**: while hitched to the car, tap Save hitch. Next time you unhitch and re-hitch, it shows how far to wind the jockey to match.
- **Camera tab** (cab): live rear view. Mirror and guide line switches underneath. A red FEED FROZEN banner shows if frames stop, and the corner shows an estimated delay and frame rate.
- **Alarm tab**: Arm / Disarm. From the cab no PIN is needed; on the van unit it asks for the PIN. There's an arming delay (default 20 s) so you can get out. When triggered: siren on the van phone, an urgent ntfy push with what tripped it and a map link, then a position update every 2 minutes until disarmed. "Silence siren" stops the noise but keeps the alarm and updates going.
- **Test mode** (Alarm tab, while disarmed): live readings against each threshold and a count of how often it *would* have triggered, with a short beep instead of the siren. Use it on a windy or rainy night to tune the Sensitivity sliders.

## 4. Van test checklist

- [ ] **Level at a real site.** Calibrate on known-level ground first. Then at a site, follow the instructions and check against a spirit level on the floor. Note any mm error over the track and the jockey distance.
- [ ] **Packing test.** On level ground, put known packing (e.g. 35 mm) under one wheel. The app should say "Raise [other] side 35 mm" within about 5 mm. Repeat with the jockey wound up a measured amount.
- [ ] **Hitch height.** Hitch up, Save hitch, unhitch, then re-hitch using the jockey instruction. Check the coupling lines up.
- [ ] **Reverse using the camera.** Check the delay feels acceptable and the guide lines are useful. Try Mirror on and off and leave it how you prefer.
- [ ] **Alarm, real tow test.** Arm from the cab, hitch up (should trigger on tilt within a few seconds), then tow 50 m (movement and GPS). Confirm the ntfy push arrives and the map link opens at the right spot. Disarm from the cab.
- [ ] **Overnight in wind.** Leave it armed overnight with Test mode results noted beforehand. Any false alarm: raise the tilt or movement number a step and try again.
- [ ] **Reload recovery.** With it armed, force-close and reopen the van app. It should come back ARMED, the cab should warn it needs a tap, and after 2 minutes without a tap you should get an ntfy push.
- [ ] **Signal loss.** Leveller on the van unit works in flight mode. Alarm pushes made with no signal send when signal comes back (marked "Delayed").

## 5. What was tested before handover

| Check | Result |
|---|---|
| Leveller maths: all 8 mount options, both gravity sign conventions (spec and iPhone), phone up to 4° crooked in its mount, packing test cases (35, 50, 60, 120 mm and combined) | Passed: 393 automated checks, all within 5 mm (`npm test`) |
| Setup flow, live level, alarm, camera screens at iPhone portrait size (375 x 812) | Checked in a desktop browser |
| Pairing and live level between two app instances via the PeerJS server | Worked on desktop (same network, not mobile data) |
| Alarm triggers on tilt, movement and GPS separately; light rocking doesn't trigger | Passed with a simulated sensor and GPS |
| ntfy push with map link | Arrived on ntfy.sh with working Apple and Google Maps links |
| Armed / triggered state survives a reload, link reconnects | Passed |
| Camera stream, delay estimate, FEED FROZEN warning | Passed with a synthetic video feed |
| **Two real iPhones on mobile data, real camera, real motion sensors, siren volume, wake lock** | **Not yet tested. This is the first thing to do with the van test checklist.** |

Developer note: open the app with `?sim` on the end of the URL on a computer to get a fake motion sensor and GPS (`__sim(frontMm, rightMm, shake)`, `__gps(lat, lon, acc)` in the browser console).

## 6. What this web version can't do (and what a native app would add)

**Known gaps in the web version**
- **Only works while the app is open on screen.** If the van phone locks, sleeps, or the app is swapped out, the alarm stops. Hence Guided Access and Auto-Lock Never.
- **Needs a tap after every reload** to turn motion sensors and sound back on (an iPhone Safari rule).
- **The phone-to-phone link needs signal on both phones.** It goes through the internet (PeerJS server plus a relay if mobile networks block a direct link). No signal at the van means no live level or camera on the cab, though the van's own leveller still works and alarm pushes queue until signal returns.
- **No phone temperature or battery level.** Safari can't read either. A van phone in a hot caravan in summer could overheat or the charger could fail without warning.
- The siren volume follows the phone's volume setting; the app can't turn it up.
- Camera permission may be asked again after the app restarts; the start tap asks for it so later camera requests don't stop on a prompt.
- Uses free public services (PeerJS signalling and relay, ntfy.sh). Fine for testing, no uptime guarantee. If the link won't connect on mobile data, there's an Advanced setting for your own TURN relay on both phones.

**What a native iPhone app would add**
- Direct phone-to-phone link with no signal (Bluetooth / local Wi-Fi), so the cab works in remote camps.
- Alarm keeps running with the screen off and in the background, with no Guided Access needed.
- Restarts itself and resumes sensors without a tap.
- Battery level, charging state and heat monitoring with alerts ("van phone hot", "charger unplugged").
- Critical Alerts that sound on your main phone even on silent.
- Better motion fusion (gyro plus accelerometer) for steadier readings while moving.
