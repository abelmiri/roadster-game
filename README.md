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
| Air boost | Hold Shift or X | Hold Boost |
| Pause / resume | P or Escape | Pause button |
| Mute / unmute | M | Sound button |

The car drives automatically. Boost recharges over time. A barrier or drone hit, a fall, or a roof-first landing ends the run. Your best distance is stored in this browser.

Use the language button to switch between English and فارسی. The Farsi interface uses right-to-left text and Persian digits. Language and mute preferences are saved locally. Sound starts after your first interaction and fades when the game is paused or loses focus.

## Project structure

- `src/game/track.ts` generates deterministic road chunks, gaps, hazards, and district progress. Rendering and physics share its road profile.
- `src/game/physics.ts` owns the fixed-step Rapier simulation, controls, and collision rules.
- `src/game/vehicle.ts` shares the car dimensions between rendering and tire support.
- `src/game/suspension.ts` models front/rear body springs, weight transfer, progressive bump stops, and compression/rebound damping.
- `src/game/audio.ts` synthesizes the motor, road, wind, jump, landing, boost, suction, warning, crash, and interface sounds.
- `src/game/smoke.ts` draws pooled white smoke from the rear boost ports and downward jump nozzles, including double jumps. Effects pause with the run and reset on restart.
- `src/game/visuals.ts` renders the orthographic 3D scene, parallax city, and district palettes.
- `src/main.ts` owns the game loop, input, overlays, HUD, pause, and local best score.
- `src/i18n.ts` contains both languages and localized number formatting.

The game runs at a fixed 120 Hz physics step and interpolates the visible car between steps. Rendering resolution drops automatically after sustained slow frames.

Tire support follows the continuous road profile and removes downward landing velocity, keeping automatic driving and jump landings stable. Separate front and rear body springs react to road loads and acceleration, with gentler compression, slower rebound, wheel droop in flight, and progressive stops at full travel. The fender openings preserve tire clearance throughout the stroke. Rapier integrates the airborne chassis and jointed wheels and detects hazard hits. Starting or restarting a run does not trigger a jump.
