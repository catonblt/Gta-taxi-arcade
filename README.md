# Getaway

A top-down Android arcade game about driving for the wrong people: **Crazy Taxi's** fare loop,
**Hill Climb Racing 2's** upgrade spine, and **GTA 1/2's** wanted-level ladder welded at one joint —
*accepting a job is accepting heat.*

Built web-first in TypeScript on a plain 2D canvas, so it runs in a phone browser today and wraps
into a Play Store APK via Capacitor without a gameplay rewrite.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm test           # physics, collision and determinism specs
npm run harness    # headless Chromium play-through: perf budget + regression screenshots
npm run genmap     # regenerate every district's street grid
npm run balance    # run the economy through many headless shifts and chart the curve
npm run sync       # build, then copy dist/ into the native Android project
npm run apk        # assemble a debug APK
```

## Controls

The car drives itself. **Left half of the screen steers left, right half steers right.** Drift is
the bottom-right thumb pad, brake/reverse the bottom-left. On desktop: arrow keys, space to drift,
`R` to respawn, `F` for the frame counter.

Three things are never explained in game and always available: a **launch tap** (flick the drift pad
from a standstill), a **drift-cancel** (release drift at the apex for exit speed), and **contact
steer** (a glancing wall hit redirects you instead of stopping you).

Pause is top-left, and doubles as the settings screen: steering sensitivity, a left-handed layout
swap, and sound. On desktop, `Esc` or `P`.

## Sound

Everything is synthesised at runtime, so there are no audio files to download or decode. The engine
shifts through five gears — revs climbing through each and dropping as it changes — sirens wail and
get louder as they close, and a step-sequenced score adds layers as the wanted level climbs: bass
throughout, a kick once anyone is looking for you, hats as it worsens, and a lead only at the rung
where the helicopter is.

Audio is driven from the render loop, never the simulation loop. That is deliberate: pausing stops
the simulation, and an engine voice updated from there holds its last note indefinitely.

## On a phone

`npm run sync && npm run apk` produces `android/app/build/outputs/apk/debug/app-debug.apk`
(4.2 MB) via Capacitor, wrapping the same `dist/` the browser runs. The build also ships a web
manifest and icons, so served over HTTPS it installs straight from Chrome's **Add to home screen**
without any store at all. See [docs/ANDROID.md](docs/ANDROID.md) for the SDK requirements and what
a Play Store release additionally needs.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Fixed-timestep loop, input abstraction, procedural audio, seeded RNG, math |
| `src/sim/` | Car physics, tile collision, the map, ambient traffic |
| `src/render/` | Camera, canvas renderer, particles, HUD, minimap |
| `src/data/` | Vehicles, parts, districts, and the authored maps (`.city` text grids) |
| `src/game/` | Shift clock, jobs, style multiplier, garage and save |
| `src/screens/` | Garage and shift-summary overlays |
| `tools/` | Map generator, icon renderer, headless play harness, economy simulator |

## How it fits together

The three source games are welded at one joint: **taking a job is taking the heat.** A pin's colour
is at once its distance, its payout and the wanted level it puts on you the moment you accept, so
choosing work is choosing how much police attention to take on.

Skill and money are split deliberately. **Upgrades buy access** — harder districts, hotter work,
survivability. **Skill buys income** — the style multiplier scales every payout, so arriving
mid-combo is worth multiples of arriving cold.

Heat is two facts kept apart: what they want you for, which never decays on its own, and whether
they can currently see you, which the badge shows by pulsing. Each rung of the ladder adds a
tactic rather than another car — a car that cuts ahead, then roadblocks, then spike strips, then a
helicopter that holds you through walls.

Design decisions and the milestone plan live in the build plan that seeded this repo.
