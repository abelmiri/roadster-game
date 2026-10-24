# Roadster

A side-view city runner built with Vite, TypeScript, Three.js, and Rapier 2D, with original synthesized sound effects and English/Farsi interfaces.

By [abelmiri](https://github.com/abelmiri) · [miri1888@gmail.com](mailto:miri1888@gmail.com)

Copyright © 2026 abelmiri. All rights reserved for original project materials; see [LICENSE](LICENSE). Third-party libraries and the bundled font retain their own licenses. The application includes a [credits and licenses page](public/legal/index.html) at `/legal/index.html`, with the unmodified third-party license texts listed in [THIRD_PARTY_NOTICES.txt](public/legal/THIRD_PARTY_NOTICES.txt).

The supplied app artwork is preserved in `assets/branding/roadster-icon.png`. Standard PNG renditions (16, 32, 48, 180, 192, and 512 px), a multi-size favicon, and `public/site.webmanifest` provide the browser, home-screen, and web-app icons. The original artwork is resized without redrawing or cropping.

## Run locally

```sh
npm install
npm run dev
```

Open the URL Vite prints. Development mode shows a small translucent FPS counter at the top, refreshed twice per second. It is omitted from production. For a production bundle, run `npm run build`. Run the simulation checks with `npm test`.

## Controls

| Action | Keyboard | Landscape touch |
| --- | --- | --- |
| Jump / long jump | Tap or hold Space, Up, or W | Tap or hold Jump |
| Double jump | Press jump once more in the air | Tap Jump again |
| Road suction | Hold Down or S | Hold Suction |
| Ground / air boost | Hold Shift or X | Hold Boost |
| Fire | Hold F | Hold Fire |
| Aim front / rear | Right / D, Left / A; Q toggles | Aim toggle (↔) |
| Choose weapon | 1–8 (number row or numpad), or Armory | Armory button in the header |
| Pause / resume | P or Escape | Pause button |
| Mute / unmute | M | Sound button |

The car drives automatically, starting at 60 km/h (16.67 m/s) and building toward 18 m/s. Boost adds 9 m/s to the target speed, accelerates at 18 m/s², and reaches up to 27 m/s (97 km/h). It works on the road and in the air, produces white nozzle smoke, and recharges when released. An exhausted boost needs a button release before it can fire again. Your best distance is stored in this browser.

The car starts with 100% health. Each obstacle or police impact takes 25% and plays a metallic crash sound. Nonfatal hits freeze the scene for 500 ms, followed by 1.5 seconds of flashing protection during driving time. One collision counts once even if multiple wheels and the chassis touch. Body damage progresses through 25%, 50%, 75%, and 100%: scratches, dents, branching cracks, a crumpled hood, and finally a darkened wreck emitting black engine smoke. Ramming a barrier, pulse obstacle, or drone shatters it into forward-moving fragments and disables its collision immediately, including while the car is protected. Ramming grants no weapon XP; shattered obstacles stay gone for that run.

The fatal hit opens the restart menu immediately over a blurred scene, without an impact freeze. Restart controls stay locked for three real seconds while the wreck plays; a localized countdown disables the restart button, then a fresh key press or click is required. Early or held input cannot queue a restart. The chassis and both wheels separate into independent Rapier bodies, retaining momentum and colliding with solid roads and remaining obstacles. This scene continues at 25% simulation speed behind the menu; driving, combat rewards, and distance scoring have ended. Falls and roof-first landings also produce a loose wreck. Restart restores the undamaged body, attached wheels, full health, and clean smoke/debris pools.

After collision hit stop, simulation speed eases from zero to normal over 800 ms. Weapon explosions never freeze the scene: speed eases down to 25% over 200 ms, then returns to normal over 1000 ms. Further explosions begin from the current time scale without snapping back to full speed. Physics, camera movement, smoke, fragments, and sparks share this time scale. Each obstacle or police collision throws a large shower of hot yellow sparks, including impacts during flashing protection. The particles fall under gravity, bounce and skid along the road, cool toward orange, and fade over 1.3–2.4 seconds. Crashed chassis contacts also produce sparks behind the restart menu. Gaps let particles fall freely.

After 12 seconds without an active boost, red/blue police lights begin to appear behind the car; after 14 seconds the patrol closes the gap at 2.2 m/s. Each new chase starts 30 meters behind, including after loops taken while the patrol was absent. The later warning and slower closing rate give roughly four more seconds before contact. Boost pushes it back. The warning, edge lights, and siren grow as it approaches. Police contact at road height uses the same health and protection rules as obstacles. Starting cruise speed is 60 km/h.

The black-and-white wedge patrol has a POLICE door marking, shield/star badge, eight-spoke wheels, front push bar, and blue/red roof lights. It drives forward along the ordinary road while the player circles a loop. Whenever it passes the player, including during or after an abandoned loop, it brakes smoothly to 35% of the player's speed (limited to 4–8 m/s). It stays slow until the player has overtaken it with at least eight meters of clearance, then resumes pursuit. Police motion stays continuous through these transitions. Any actual collision while overtaking costs 25% health; a completed lap itself awards XP without automatic damage. After a hit, the patrol gives the player room to escape.

Optional circular roads appear with procedural spacing of 200–400 meters. Hold suction at the entrance and throughout a full lap to take the loop; otherwise continue along the ordinary road. Releasing suction detaches the car and forfeits that lap's reward. Entries and exits have no hazards or gaps. Every completed loop earns **25 XP**, once only. Destroying any road hazard with a weapon earns **10 XP**; destroying a patrol earns **20 XP**. Partial hits and ramming award no combat XP. Each destroyed target pays once, including splash damage or streamed chunks revisited near loops; a replacement patrol is a new target. Rewards appear with their source, count toward the run total and weapon unlocks, and are saved in `roadster-xp`. Each 100 XP advances a level. XP persists across crashes, restarts, and reloads.

Use the language button to switch between English and فارسی. The Farsi interface uses the bundled Vazirmatn variable font, right-to-left text, and Persian digits. Physical key names such as Space, Shift, P, and Esc stay in English. Health and boost are at the top; XP and speed are at the bottom. The font's SIL Open Font License is included in `public/fonts/OFL-Vazirmatn.txt`. Language and mute preferences are saved locally. Sound starts after your first interaction and fades when the game is paused or loses focus.

HUD readouts and meters are 25% larger across desktop and landscape mobile layouts. Health loss has a short red kick and a delayed trail showing the lost segment; recovery glows green. Air use and refill have distinct colors, with a quiet refill sweep. Speed digits ease toward the current speed, score milestones and new records pulse, and ammunition reacts to firing. XP gains glow, with a gold level-up pulse and a fill-to-full/reset sequence at level boundaries. Meter values remain exact for accessibility. Feedback is throttled during continuous changes, uses transform animations, and respects reduced-motion preferences.

## Weapons

The roof turret turns through 180° before firing in the new direction. Turning takes 550–950 ms depending on the weapon and uses simulation time, so pause and impact freeze preserve it. Small automatic elevation adjustments help target road hazards and drones. Bullets use swept collision checks; terrain blocks shots. Weapon recoil is visual and cannot upset the suspension.

Lifetime XP unlocks equipment without being spent: Machine Gun (0 XP, 80 rounds), Twin Gun (50 XP, 100 rounds), Gatling Gun (125 XP, 150 rounds), Cannon (225 XP, 16 rounds), Rocket Launcher (350 XP, 12 rounds), Missile Launcher (500 XP, 10 rounds), Laser Gun (700 XP, 50 charges), and Plasma Cannon (950 XP, 18 rounds). Twin volleys spend two rounds. Heavy weapons deal splash damage, missiles track their target, and the laser hits instantly. Models, icons, projectiles, muzzle flashes, impacts, and firing sounds are original.

The armory pauses an active run and resumes it on closing. Unlocked weapons can be equipped immediately; each weapon retains its own remaining ammunition for that run, so switching cannot refill it. A new run refills all weapons. Selection persists in `roadster-weapon`; corrupt, unavailable, or XP-locked saved selections fall back to the Machine Gun.

Road hazards take 2–4 damage to destroy and stop colliding once destroyed. Weapon destruction scatters fragments in all directions, including from the patrol, with continuous explosion slow motion independent of collision damage and protection. Bullet sparks launch in a cone opposite the actual incoming shot direction, including rear fire and laser beams. Surviving police hits also spark; terrain impacts produce only seven smaller sparks. Terrain hit points are refined along the swept shot and gaps do not block fire.

The patrol has 12 combat health; destroying it disables contact damage and releases its crumpled body and both wheels into independent terrain physics, with black engine smoke following the body. Wreck parts do not cause player damage or award extra XP. There is at most one police wreck, removed after ten simulation seconds or once far behind the player. A replacement gets eight seconds before its new warning timer starts and approaches from behind. Shooting does not consume boost or change the player's health rules, and loops still award 25 XP.

## Project structure

- `src/game/track.ts` generates deterministic road chunks, gaps, hazards, and district progress. Rendering and physics share its road profile.
- `src/game/pursuit.ts` controls the police warning, chase distance, and boost escape timing.
- `src/game/policeWreck.ts` simulates the destroyed patrol's independent body and wheels.
- `src/game/experience.ts` awards loop XP, deduplicates rewards, and persists level progress.
- `src/game/physics.ts` owns the fixed-step Rapier simulation, controls, and collision rules.
- `src/game/wheelContact.ts` integrates independent tire contacts, suspension forces, impact energy loss, chassis momentum, and finite road suction.
- `src/game/damage.ts` controls health, temporary protection, damage stages, hit stop, and the wreck time scale.
- `src/game/carBodyDamage.ts` deforms the body and adds progressive dents, panel fractures, and broken glass only on damage transitions.
- `src/game/vehicle.ts` shares the car dimensions between rendering and tire support.
- `src/game/roadsterModel.ts` shares the wedge silhouette and wheel geometry between the player and patrol car.
- `src/game/suspension.ts` supplies the additional sprung-body motion inside magnetic loops.
- `src/game/audio.ts` synthesizes the motor, road, wind, jump, landing, boost, suction, warning, crash, and interface sounds.
- `src/game/smoke.ts` draws pooled white jet exhaust and rising black smoke from the destroyed engine in one instanced draw. Downward jet emission follows the actual held-jump thrust state. Effects pause with the run, continue during the slow-motion wreck, and reset on restart.
- `src/game/visuals.ts` renders the orthographic 3D scene, parallax city, and district palettes.
- `src/game/terrain.ts` extends the ground to -90 m with continuous procedural rock strata and a separate narrow asphalt cap. Terrain textures use world coordinates across streamed chunk boundaries.
- `src/game/startDepot.ts` turns the start boundary into a neon garage exit with a solid launch apron, tunnel ribs, direction arrows, caution strips, and an industrial retaining wall. Repeated details are instanced; the depot stops drawing once it leaves the camera view.
- `src/game/cityBuildings.ts` batches the skyline and windows into five instanced draws, updating buffers only when buildings wrap.
- `src/game/obstacleDebris.ts` renders at most 192 pooled fragments with radial explosion impulses or forward ramming momentum, gravity, ground bounces, and pause/reset support.
- `src/game/impactSparks.ts` renders up to 512 pooled spark streaks in one draw, with terrain bounces, cooling, and pause/reset support.
- `src/game/impactCamera.ts` widens the ordinary view by 20% and frames car collisions with a temporary 1.7× zoom. Camera motion continues through hit stop, eases back, and respects manual pause; bullet impacts do not repeatedly retrigger it.
- `src/game/backdropBlur.ts` softly blurs the half-resolution city and adds slow, theme-colored atmospheric haze before drawing the sharp road, car, hazards, police, and loops.
- `src/game/policeVisual.ts` draws the original patrol car and alternating red/blue beacons.
- `src/game/weapons.ts` defines eight XP unlocks, per-run ammunition, turret rotation, projectiles, targeting, and combat hits.
- `src/game/weaponVisual.ts` draws the eight roof turrets and pooled projectile/impact effects; `weaponIcon.ts` supplies armory silhouettes.
- `src/main.ts` owns the game loop, input, overlays, HUD, pause, and local best score.
- `src/game/hudFeedback.ts` animates changes to HUD values, smooths speed digits, and bounds animation work per indicator; `src/hud.css` contains the 1.25× indicator sizing and responsive meter styling.
- `src/i18n.ts` contains both languages and localized number formatting.

The game runs at a fixed 120 Hz physics step and interpolates the visible car between steps. A wider orthographic view shows more of the road, while the city is blurred separately from gameplay objects. Rendering uses a three-million-pixel budget with a 1.5× pixel-ratio cap, reducing to 1.8 million pixels after sustained slow frames. Camera projection updates are skipped when unchanged. The HUD only writes changed values; the fixed-step loop checks lightweight impact state instead of building extra render snapshots. Contact samples reuse storage and sample height/slope together, and unloaded suspension stops skip redundant solver passes. Hit stops and speed recovery use wall-clock time independently of the capped simulation timestep. The recovery curve is integrated analytically for consistent timing at different refresh rates; manual pause preserves freeze, recovery, and protection time. The impact pose is held until the first resumed physics step to avoid a backward interpolation jump.

Ordinary camera framing looks ahead by 26.4% of the viewport width, keeping the player near the left quarter and showing more upcoming road. The extended ground prevents its lower boundary appearing in the wider view while retaining real gaps. Subtle stone grain, fractures, and strata are generated in the material without texture uploads. Drifting haze softens the city colors and contrast in the existing background pass; gameplay objects are drawn afterward and stay clear.

The road emerges from a launch garage behind the starting car. Its level apron extends from -64 m to the ordinary road at zero, with matching visual and physical surfaces. A deep concrete retaining wall and service structures replace the exposed cut at the beginning. Detached wheels and wrecks can land on the apron, while the normal start position and first challenges stay the same.

On the ordinary road, the chassis is a free body supported by two independent spring-and-damper tire contacts. Tire clearance follows the continuous surface normal. Neither tire can pull on the road, so fast crests unload the suspension and launch the car naturally. One axle can stay on the road while the other lifts off or hangs over a gap. Natural hops retain angular momentum. While jump is held, Space jumps and double jumps cancel inherited takeoff spin and use damped attitude control to ease the body toward horizontal. This assistance only runs during the 190 ms upward-thrust budget for that jump. Releasing jump or exhausting this budget stops both extra lift and attitude correction; existing angular momentum then carries the car freely. A double jump starts a fresh budget. Assistance also yields to the first loaded tire on landing. The body is never snapped to a supported height or road tangent.

Each axle transmits its own spring force and normal collision impulse at its lever arm. The second tire receives its own impact even if the first is already grounded. Dampers and inelastic stops absorb vertical impact energy. Clean, road-aligned landings preserve forward speed; tilted or very hard landings have a small tire scrub and a forward-speed loss budget of 0.8 m/s during the 280 ms settling stroke. Rolling grip restores momentum along the road tangent, retaining the separate axle reactions and chassis rotation. A fresh departure ends that settling assistance, and releasing boost can still decelerate the car normally. Four contact substeps per 120 Hz game step and independent stroke stops prevent fast drops from tunnelling through the road. An undershot gap hits the far lip instead of teleporting onto it.

Suction applies up to 68 m/s² of additional acceleration toward the sampled road normals, with a 2.4 m range and distance falloff, plus limited pitch assistance. It loads the suspension and holds high-speed crests through force, while leaving gaps and distant jumps outside its reach. Each wheel has 7.5 cm of droop and up to 16.5 cm of compression, with progressive bump stops preserving tire-to-fender clearance. Wheels retain their own spin in flight. Magnetic loops keep their circular branch and local sprung-body animation. Rapier detects obstacle overlaps for the independently positioned chassis and tire sensors. Starting or restarting a run does not trigger a jump.
