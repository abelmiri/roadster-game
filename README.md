# Roadster

A side-view city runner built with Vite, TypeScript, Three.js, and Rapier 2D, with original synthesized sound effects and English/Farsi interfaces.

## Run locally

```sh
npm install
npm run dev
```

Open the URL Vite prints. For a production bundle, run `npm run build`. Run the simulation checks with `npm test`.

## Controls

| Action | Keyboard | Landscape touch |
| --- | --- | --- |
| Jump / long jump | Tap or hold Space, Up, or W | Tap or hold Jump |
| Double jump | Press jump once more in the air | Tap Jump again |
| Road suction | Hold Down or S | Hold Suction |
| Ground / air boost | Hold Shift or X | Hold Boost |
| Fire | Hold F | Hold Fire |
| Aim front / rear | Right / D, Left / A; Q toggles | Aim toggle (↔) |
| Choose weapon | Armory button in the header | Armory button in the header |
| Pause / resume | P or Escape | Pause button |
| Mute / unmute | M | Sound button |

The car drives automatically, starting at 14 m/s (about 50 km/h) and building toward 18 m/s. Boost works on the road and in the air, produces white nozzle smoke, and recharges when released. An exhausted boost needs a button release before it can fire again. Your best distance is stored in this browser.

The car starts with 100% health. Each obstacle or police impact takes 25%, plays a metallic crash sound, and freezes the scene for 500 ms. The car then flashes for 1.5 seconds of driving time and is protected from further hits during that period. One collision counts once even if multiple wheels and the chassis touch. The fourth hit ends the run after its impact freeze. A restart restores full health. Falls and roof-first landings also end a run.

After 10 seconds without an active boost, red/blue police lights begin to appear behind the car; after 12 seconds the patrol closes the gap. Each new chase starts 30 meters behind, including after loops taken while the patrol was absent. Boost pushes it back. The warning, edge lights, and siren grow as it approaches. Police contact at road height uses the same health and protection rules as obstacles. Starting cruise speed is 14 m/s (about 50 km/h).

The black-and-white wedge patrol has a POLICE door marking, shield/star badge, eight-spoke wheels, front push bar, and blue/red roof lights. It drives forward along the ordinary road while the player circles a loop. Whenever it passes the player, including during or after an abandoned loop, it brakes smoothly to 35% of the player's speed (limited to 4–8 m/s). It stays slow until the player has overtaken it with at least eight meters of clearance, then resumes pursuit. Police motion stays continuous through these transitions. Any actual collision while overtaking costs 25% health; a completed lap itself awards XP without automatic damage. After a hit, the patrol gives the player room to escape.

Optional circular roads appear with procedural spacing of 200–400 meters. Hold suction at the entrance and throughout a full lap to take the loop; otherwise continue along the ordinary road. Releasing suction detaches the car and forfeits that lap's reward. Entries and exits have no hazards or gaps. Every completed loop earns **25 XP**, once only. Destroying any road hazard with a weapon earns **10 XP**; destroying a patrol earns **20 XP**. Partial hits and ramming award no combat XP. Each destroyed target pays once, including splash damage or streamed chunks revisited near loops; a replacement patrol is a new target. Rewards appear with their source, count toward the run total and weapon unlocks, and are saved in `roadster-xp`. Each 100 XP advances a level. XP persists across crashes, restarts, and reloads.

Use the language button to switch between English and فارسی. The Farsi interface uses the bundled Vazirmatn variable font, right-to-left text, and Persian digits. Physical key names such as Space, Shift, P, and Esc stay in English. Health and boost are at the top; XP and speed are at the bottom. The font's SIL Open Font License is included in `public/fonts/OFL-Vazirmatn.txt`. Language and mute preferences are saved locally. Sound starts after your first interaction and fades when the game is paused or loses focus.

## Weapons

The roof turret turns through 180° before firing in the new direction. Turning takes 550–950 ms depending on the weapon and uses simulation time, so pause and impact freeze preserve it. Small automatic elevation adjustments help target road hazards and drones. Bullets use swept collision checks; terrain blocks shots. Weapon recoil is visual and cannot upset the suspension.

Lifetime XP unlocks equipment without being spent: Machine Gun (0 XP, 80 rounds), Twin Gun (50 XP, 100 rounds), Gatling Gun (125 XP, 150 rounds), Cannon (225 XP, 16 rounds), Rocket Launcher (350 XP, 12 rounds), Missile Launcher (500 XP, 10 rounds), Laser Gun (700 XP, 50 charges), and Plasma Cannon (950 XP, 18 rounds). Twin volleys spend two rounds. Heavy weapons deal splash damage, missiles track their target, and the laser hits instantly. Models, icons, projectiles, muzzle flashes, impacts, and firing sounds are original.

The armory pauses an active run and resumes it on closing. Unlocked weapons can be equipped immediately; each weapon retains its own remaining ammunition for that run, so switching cannot refill it. A new run refills all weapons. Selection persists in `roadster-weapon`; corrupt, unavailable, or XP-locked saved selections fall back to the Machine Gun.

Road hazards take 2–4 damage to destroy and stop colliding once destroyed. The patrol has 12 combat health; destroying it disables contact damage, fades it out, and grants eight seconds before a new warning timer starts. The next patrol approaches from behind. Shooting does not consume boost or change the player's health rules, and loops still award 25 XP.

## Project structure

- `src/game/track.ts` generates deterministic road chunks, gaps, hazards, and district progress. Rendering and physics share its road profile.
- `src/game/pursuit.ts` controls the police warning, chase distance, and boost escape timing.
- `src/game/experience.ts` awards loop XP, deduplicates rewards, and persists level progress.
- `src/game/physics.ts` owns the fixed-step Rapier simulation, controls, and collision rules.
- `src/game/damage.ts` controls health, temporary protection, car flashing, and the 500 ms impact pause.
- `src/game/vehicle.ts` shares the car dimensions between rendering and tire support.
- `src/game/roadsterModel.ts` shares the wedge silhouette and wheel geometry between the player and patrol car.
- `src/game/suspension.ts` models front/rear body springs, weight transfer, progressive bump stops, and compression/rebound damping.
- `src/game/audio.ts` synthesizes the motor, road, wind, jump, landing, boost, suction, warning, crash, and interface sounds.
- `src/game/smoke.ts` draws pooled white smoke from the rear boost ports and downward jump nozzles, including double jumps. Effects pause with the run and reset on restart.
- `src/game/visuals.ts` renders the orthographic 3D scene, parallax city, and district palettes.
- `src/game/backdropBlur.ts` softly blurs a half-resolution city render before drawing the sharp road, car, hazards, police, and loops.
- `src/game/policeVisual.ts` draws the original patrol car and alternating red/blue beacons.
- `src/game/weapons.ts` defines eight XP unlocks, per-run ammunition, turret rotation, projectiles, targeting, and combat hits.
- `src/game/weaponVisual.ts` draws the eight roof turrets and pooled projectile/impact effects; `weaponIcon.ts` supplies armory silhouettes.
- `src/main.ts` owns the game loop, input, overlays, HUD, pause, and local best score.
- `src/i18n.ts` contains both languages and localized number formatting.

The game runs at a fixed 120 Hz physics step and interpolates the visible car between steps. A wider orthographic view shows more of the road, while the city is blurred separately from gameplay objects. Rendering resolution drops automatically after sustained slow frames. Impact freezes use wall-clock time independently of the capped simulation timestep; manual pause preserves the remaining freeze and protection time.

Tire support follows the continuous road profile. The first tire to touch catches a tilted landing; a damped contact frame then rolls the other axle toward the road instead of snapping the car flat. Loop releases can land immediately, and brief crest hops have only a three-step takeoff guard, preventing short hops from falling through the road.

Separate front and rear body springs react to road loads, acceleration, and the normal/angular momentum of a landing. There is 17 cm of travel per axle, gentler compression, controlled rebound, droop in flight, and progressive stops near full travel. Hard landings compress farther than light landings. Suspension movement follows the car's local normal, including when inverted in a loop. The raised ride height and enlarged fender openings provide a 22 cm neutral tire gap and at least 4 cm throughout the stroke. Rapier integrates the airborne chassis and jointed wheels and detects hazard hits. Starting or restarting a run does not trigger a jump.
