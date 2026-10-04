# Canyon Circuit — todo

## Done
- [x] Deterministic sim: track/gates, arcade car (drift tiers, boost, pads, ramps, air tricks, recovery), race rules, drafting, fair items (warned seekers, blinking mines, shields), AI
- [x] Procedural canyon world, 7 chassis × 8 liveries (incl. Stingbolt + Stingbolt Yellow, Scorchquill + Quill Violet), chase camera, particles, synthesized audio
- [x] Modes: Solo (2 AI), Split-Screen (2 players + 1 AI), Track Lab (custom layouts, share codes, test drive), Online Ghosts (≤3)
- [x] Garage, HUD (position, lap, gates, timer, speed, boost/drift meters, item, warnings, minimap), pause/retry, results with instant rematch
- [x] Ghost service (server/), deployed on Cloud Computer as canyon-ghost-v1 behind HTTPS/WSS
- [x] OG cover, favicon, sharing metadata

- [x] "Golden Hour" upgrade: genre research, concept proposal and art (docs/), photoreal cars/props, PBR canyon, generous VFX + HUD/menu particles, redesigned HUD, Lyria music + ElevenLabs SFX, staged loading, new loading art, favicon and OG card
- [x] Crash & roller-coaster pass: floating stone arches removed, solid full-body canyon/barrier collision, hills/crests/dips + 2 mega ramps (11 m), damage (smoke 35 % / fire 70 % / wreck 100 %), on-the-spot respawn + 3 s hold, R reset with 3 s hold, hull gauge + hold overlay HUD, wreck/crunch/ignite SFX; ghost service redeployed (release r2) and verified over public WSS
- [x] Banked walls & twists: 6 corners banked 32°–64° with speed-anchored centripetal grip (slide/peel below anchor speed), S-bend twists, 88 m elevation range, 19 m mega ramps, WALL RIDE HUD gauge + style bonus, camera bank roll, paved aprons, Track Lab banks/twists

- [x] Corkscrews & nitro: two boost-fed 360° corkscrews (lap opener at ~170 m, desert corkscrew at ~2330 m) with centripetal anchoring and ceiling drop-offs, rolled chase camera, steel gantries and struts; Shift nitro for every car (1.4 s blue-flame burst, 8 s cooldown, NITRO gauge READY/FIRING/seconds), new nitro/nitro-ready/corkscrew SFX, CORKSCREW style action

- [x] Durability & clear-view VFX: cars 2x tougher (shared DURABILITY divisor), smoke/fire fade near the camera and when a sprite would cover much of the screen, time-based damage emission

- [x] Corner assist: on by default, Settings toggle, deterministic input shaper (sim/assist.ts), HUD chip, stale menu pause latch cleared at race start
- [x] Corner assist Off/Light/Strong per player (P1 solo/online/test, P2 split), save migration from the on/off flag, per-view HUD mode chip
- [x] ASSIST tags: results table, lap splits, best badges, garage personal bests, Track Lab list; bests persist totalAssist/lapAssist
- [x] Sharing re-prepared for https://canyon-circuit.manustest.game (OG/favicon preserved; build tags verified)
- [ ] Checkpoint push blocked until Dashboard auto-publish is turned off (user asked not to publish)
- [ ] Optional: separate assisted vs unassisted leaderboards; assist tag in online lobby 'Last race' table

## Next
- [ ] Balance pass: AI wreck frequency and damage thresholds after real playtests (wall damage starts at 14 m/s normal impact)
- [ ] Track Lab: a dedicated 'Mega ramps' slider (currently every second ramp is a mega ramp)
- [ ] Visual damage stages on the body (dents / loose panels) in addition to the scorch shader
- [ ] Wheel spin/steer on photoreal cars (baked into single mesh: split wheels or add overlay wheel meshes)
- [ ] Real-GPU performance capture (frame time with 3 photoreal cars + particles on a mid-range laptop and phone)
- [ ] Publish (user-authorized) and re-run the two-browser online test from the published URL
- [ ] Unit tests for save sanitization and tuning manager
- [ ] Host "Ready" button is redundant for the host — hide or relabel
- [ ] Online: optional per-track online best-time board (would need server-side result storage)
- [ ] Touch: test on a real phone (landscape layout, button sizes)
- [ ] Performance pass on low-end GPUs (shadow map size, prop instancing counts)

- [x] PASS 8: hot hatch chassis (now Stingbolt) (GPT Image 2.5 → Tripo H3.1 → glTF-Transform), real-dimension scaling, solid-paint yellow livery, ghost server r6 (6 chassis / 7 liveries)
- [x] PASS 9: open-wheel chassis, now Scorchquill (GPT Image 2.5 → Tripo H3.1 → glTF-Transform), single-seater proportions, solid house livery, 8 swatches on one row, ghost server r7 (7 chassis / 8 liveries), size budget excludes dist/share (link-preview only)
- [ ] Optional: separate wheel meshes for the Stingbolt and Scorchquill so wheels spin/steer (needs a body-only + wheel generation)
- [ ] Optional: Scorchquill number/nose decal option
- [x] PASS 10: original names for all cars (Sandvane GT, Talusfin, Gullyjack, Basaltback GT, Nightmesa, Stingbolt, Scorchquill) and liveries; badge-free Stingbolt model regenerated; real-car photos removed from docs
- [ ] Optional: redesign Gullyjack and Nightmesa silhouettes further from classic real race cars
- [x] PASS 11: magnetic banked roads (`car.bankMagnet`): no slide/peel at any speed on banks and twists; corkscrews and roller-coaster segments unchanged; ghost server r8 packaged (includes r7 car limits)
- [x] PASS 12: IP audit of all cars — no logos/text in any texture; Sandvane GT, Gullyjack, Basaltback GT, Nightmesa and Stingbolt regenerated from original briefs (no resemblance to real cars); Scorchquill house livery changed to Quill Violet; real-car photo copies deleted
