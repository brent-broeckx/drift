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
- Master limiter and fade in/out; all Tone nodes are disposed when you press Stop.

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
  ui/
    controls.ts        play button, mood buttons, sliders, seed/share row
    visualizer.ts      canvas particles + analyser-driven background pulse
```

Signal chain:

```
pad -> pad filter (slow LFO) ┐
lead -> feedback delay ──────┼─> brightness low-pass -> reverb -> master gain -> limiter -> speakers
bass ────────────────────────┘                                                      └─> AnalyserNode
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
