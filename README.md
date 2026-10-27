# DRIFT

**Endless generative ambient music in your browser.**

## Live demo

`https://<username>.github.io/DRIFT/` (replace `<username>` with the GitHub account that hosts the repo)

## About

A static, browser-only ambient music generator. No backend and no audio files: every sound is
synthesized live with [Tone.js](https://tonejs.github.io/) on top of the Web Audio API.

- Never-ending music: a slowly drifting chord progression, a sparse melody drawn from the current
  scale with weighted randomness, a soft pad, and a low drone.
- Four moods (Calm, Dreamy, Dark, Hopeful), each with its own scale, tempo range, reverb size,
  timbre and colours.
- Live sliders: Tempo, Density, Brightness, Reverb, Randomness, Volume.
- Seeded and shareable: the URL hash holds the mood, seed and slider values, so a link reproduces
  the same piece from the start.
- Full-screen canvas visuals: glowing circles per note (height = pitch, size = velocity) and a
  background pulse driven by an `AnalyserNode`.
- Soundscape: optional synthesized ambient layers (rain, wind, ocean, fire, crickets,
  thunder) that play alongside or instead of the music.
- Master limiter and fade in/out; all Tone nodes are disposed when you press Stop.

## Features

### Record 30 seconds to WAV

Press **● Record 30s** in the Tools row to capture the master output (after the limiter) while the
music plays; if it isn't playing yet, it starts first. A progress bar counts down the remaining
seconds, and **Stop** ends the take early and keeps whatever was captured. Pressing the main Stop
button while recording also saves the take.

The capture uses `Tone.Recorder` (MediaRecorder), then decodes it with `decodeAudioData` and
re-encodes it as 16-bit PCM stereo WAV (`src/audio/wav.ts`), so you always get a `.wav`, never
webm/ogg. The file downloads automatically as `drift-<seed>-<yyyymmdd-hhmmss>.wav`. The 30-second
limit runs on the Web Audio clock, so it stays accurate in a background tab. Browsers without
MediaRecorder show a short inline message instead.

### Sleep timer

Pick **15, 30, 45, 60 or 90 min** from the Sleep menu. A countdown shows the time left, and
**Cancel** (or choosing **Off**) turns it off. During the final 60 seconds the music fades smoothly
to silence on a dedicated fade gain, so the Volume slider doesn't move. When the fade ends, playback
stops and all voices are disposed, so the next Play starts at full volume. Cancelling during the
fade ramps the volume back up over about 2 seconds.

The end time is stored as a timestamp, and the remaining time is recalculated from it rather than
counted down. The fade curve and stop time are scheduled on the Web Audio clock, so the timer stays
accurate when the tab is in the background or throttled.

### Soundscape

Open the **Soundscape** section of the panel to add ambient texture layers. Each layer has an on/off
switch and a level slider; layers with an extra control show a tune button that reveals it. Like the
music, every layer is synthesized live from Tone.js noise sources, filters, oscillators, LFOs and
gain automation. No samples are used, and nothing runs per sample in JavaScript. Timing, pitch, pan
and level are randomized throughout, so nothing audibly loops.

| Layer    | How it's made                                                                                   | Extra control |
| -------- | ----------------------------------------------------------------------------------------------- | ------------- |
| Rain     | Surging pink-noise hiss and fine spray, a low "body" for heavy rain, dense tiny ticks, resonant drops that chirp upward and occasional gutter-drip runs; a slow "weather" swell keeps it moving | Intensity (drizzle to downpour) |
| Wind     | Pink + brown noise through a "rush" and an "air" bandpass with LFO-drifting frequency and Q; random gusts swell the level, raise the pitch, sweep the stereo position and bring up a faint whistle | Gustiness |
| Ocean    | A low swell that rises and drains on a randomized 8-14 s cycle, a bright breaking crash at each crest that decays into fizzing foam, and an occasional second smaller break | Wave speed |
| Fire     | A soft rumble and flickering "breath" of flames, clustered crackles, occasional pops with spark showers and a rare sap hiss; the fire flares up and settles at random | Crackle density |
| Crickets | Several ~4-5 kHz sine chirps with slightly different pulse rates and slow random volume drift (subtle by default) | - |
| Thunder  | Rare low rumbles (every 20-90 s) with a soft attack, long tail and lowpass sweep, at a capped level | - |

**Presets** set the layer switches and levels in one click (you can tweak afterwards):
Rainy Window (rain + soft thunder), Seaside (ocean + wind), Campfire (fire + crickets),
Forest Night (crickets + light wind) and Storm (heavy rain + wind + thunder).

**Music / Soundscape** sliders balance the two. Set Music to 0 for a soundscape-only mix; the
generator then stops producing notes entirely. Play/Stop starts and stops everything that's enabled.
Toggling a layer fades it in or out over 1.5 s, so there are no clicks.

**Routing.** All layers feed one soundscape bus, which joins the master chain at the master gain,
after the music's Brightness filter and reverb. The Volume slider, the limiter, the sleep-timer fade
and the WAV recorder all apply to the soundscape exactly as you hear it. Brightness and Reverb only
shape the music, so the textures stay crisp and dry rather than muffled and washed out. A peak catcher
on the bus keeps any combination of layers from overloading the master.

**Sharing.** The mix is stored in the URL hash next to the seed. The format is `sc=` followed by
`id.level[.param]` entries, with levels as compact percentages (`6` = 60 %, `65` = 65 %,
`100` = 100 %). `sv`/`mv` hold the Soundscape/Music levels when they differ from their defaults, for
example `#mood=calm&seed=abc&...&sc=rain.6.8,ocean.4&mv=0`. The last mix is also remembered in
`localStorage` and restored on your next visit, unless the link specifies one.

**Performance.** Only enabled layers exist. When a layer finishes fading out, its scheduled events
are cleared and its nodes are disposed. Layers share one running noise source per colour
(white/pink/brown), and a noise source is stopped once no layer uses it. Default levels are
normalized so that layers at their default slider positions sound roughly equally loud, and sit
well below the music (about 12 dB) so a texture never drowns it out.

#### How to add a soundscape layer

1. Create `src/audio/soundscape/<id>.ts` and export a `LayerDef` (see `layer.ts`):

   ```ts
   import * as Tone from 'tone';
   import { BaseLayer, rand, type LayerContext, type LayerDef } from './layer';

   const GAIN = 1; // normalization, so the default level sounds as loud as the other layers

   class Hum extends BaseLayer {
     constructor(ctx: LayerContext, amount: number) {
       super(ctx, GAIN);
       const filter = this.own(new Tone.Filter(120, 'lowpass')).connect(this.out);
       ctx.noise('brown').connect(filter); // shared noise tap, released by the manager
     }
     protected onStart(): void {
       // Optional randomized events on the audio clock, cleared automatically on stop().
       this.loop(() => rand(2, 6), (time) => { /* schedule automation at `time` */ });
     }
   }

   export const hum: LayerDef = {
     id: 'hum',                         // lowercase letters, used in the URL hash
     name: 'Hum',
     icon: 'M4 12h16',                  // SVG path data for a 24x24 stroked icon
     level: 0.5,                        // default slider position
     param: { name: 'amount', label: 'Amount', default: 0.5 }, // optional extra control
     create: (ctx, amount) => new Hum(ctx, amount),
   };
   ```

2. Add it to the `LAYERS` registry in `src/audio/soundscape/soundscape.ts`.

That's all: the UI row, URL hash, storage and fades come from the registry. Connect everything to
`this.out` (never to `Tone.Destination`), register nodes with `this.own()` so they're disposed,
and implement `setParam()` if the layer has an extra control. Optionally add the layer to a preset in `PRESETS`.

## Run

Requires Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

`dist/` is a plain static site (relative paths), so it can be dropped onto any static host,
including a sub-path such as GitHub Pages.

Keyboard: **Space** = play/stop, **R** = reseed.

## Deployment

Every push to `main` automatically builds and deploys the site to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (it can also be run manually from
the Actions tab). One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**.

The build uses a relative base path (`base: './'`) and all state lives in the URL hash
(`#mood=...&seed=...`), so no server-side routing is needed.

## Project layout

```
index.html
src/
  main.ts              wiring: state, URL hash, engine <-> UI <-> visualizer
  style.css            dark theme, responsive layout
  audio/
    engine.ts          Tone transport, instruments, effects chain, start/stop/dispose
    generator.ts       seeded RNG, scale/chord/melody logic (pure, no audio)
    moods.ts           mood presets (data only)
    recorder.ts        Tone.Recorder capture of the master output, 30 s limit on the audio clock
    wav.ts             AudioBuffer -> 16-bit PCM stereo WAV encoder
    sleepTimer.ts      sleep timer: end timestamp, fade-out automation, expiry
    soundscape/
      layer.ts         shared layer interface, BaseLayer, voice pool, helpers
      soundscape.ts    layer registry, presets, hash/storage format, bus + fades manager
      rain.ts, wind.ts, ocean.ts, fire.ts, crickets.ts, thunder.ts   one file per layer
  ui/
    controls.ts        play button, mood buttons, sliders, seed/share row
    visualizer.ts      canvas particles + analyser-driven background pulse
    tools.ts           "Tools" row container + clock formatting
    recorderControl.ts Record 30s button, progress bar, Stop, download
    sleepTimerControl.ts sleep timer menu, countdown, Cancel
    soundscape.ts      Soundscape panel: presets, Music/Soundscape balance, layer rows
```

Signal chain:

```
pad -> pad filter (slow LFO) ┐
lead -> feedback delay ──────┼─> music gain -> brightness low-pass -> reverb ┐
bass ────────────────────────┘                                              ├─> master gain -> fade gain -> limiter -> speakers
soundscape layers -> faders -> peak catcher -> soundscape gain ─────────────┘     (volume)   (sleep timer)     ├─> AnalyserNode
                                                                                                               └─> Recorder (while recording)
```

### How the music is generated

`Generator.next()` is called once per eighth note. It uses separate seeded RNG streams
(mulberry32) for harmony and melody, and always draws the same number of random values per step,
so the same seed + mood + settings always produce the same sequence.

- **Chords** are stacked scale-thirds built on a scale degree. The next chord is a weighted choice
  from the mood's `chords` list, favouring small moves and gradually pulling back to the tonic.
  The pad is voice-led so each note moves as little as possible.
- **Melody** notes are chosen with weights for stepwise motion, chord tones, per-degree
  `degreeWeights` and a pull toward the middle of the register. Note probability follows the
  Density slider, the beat position and a slow seeded "breathing" curve.
- **Randomness** widens leaps, weakens the chord-tone bias, flattens the chord choice and adds
  timing/velocity variation.

## How to add a mood

Moods are data. Add one object to the `MOODS` array in `src/audio/moods.ts`; the button, URL
hash support, audio and colours all pick it up automatically.

```ts
{
  id: 'nocturne',                 // used in the URL: #mood=nocturne
  name: 'Nocturne',               // button label
  description: 'E dorian, hushed and slow',
  root: 52,                       // MIDI tonic (52 = E3)
  scale: [0, 2, 3, 5, 7, 9, 10],  // semitones from the root
  degreeWeights: [3, 1.5, 2, 1.5, 2.5, 1.5, 1], // melodic preference per scale degree
  chords: [                       // chord roots as scale-degree indices
    { degree: 0, weight: 4 },
    { degree: 3, weight: 3 },
    { degree: 6, weight: 2 },
  ],
  barsPerChord: [3, 5],
  leadRange: [12, 29],            // melody register, semitones above root
  tempo: { min: 50, max: 70, default: 58 },
  reverb: { decay: 9, wet: 0.5 }, // decay = reverb size (s), wet = default slider value
  defaults: { density: 0.3, brightness: 0.45, randomness: 0.3 },
  timbre: {
    pad:  { oscillator: 'fatsine', spread: 25, attack: 3, release: 6, volume: -16 },
    lead: { kind: 'fm', oscillator: 'sine', attack: 0.01, decay: 1, sustain: 0, release: 3,
            volume: -14, harmonicity: 2, modulationIndex: 3 },
    bass: { oscillator: 'sine', volume: -16 },
    delay: { time: '4n.', feedback: 0.4, wet: 0.3 },
  },
  palette: { background: [210, 40, 6], hues: [200, 230, 260, 180], saturation: 60, lightness: 60 },
},
```

Tips:

- Keep `degreeWeights` the same length as `scale`. Give the root and fifth the highest weights for
  a stable, consonant sound.
- `lead.kind` is `'synth'` (plain), `'fm'` (bell-like) or `'am'` (soft and hollow).
- Use four `hues` so colour transitions between moods stay smooth.

## Notes

- Browsers block audio until the user interacts with the page, so the engine (and the
  `AudioContext`) only starts when you press Play.
- A shared link reproduces the piece from its beginning. Changing sliders while it plays changes
  the music from that point on.
