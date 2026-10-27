import type { MoodPreset } from './moods';

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

/** Hash any string to a 32-bit unsigned integer (cyrb53 variant). */
export function hashString(str: string): number {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Small, fast, deterministic PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number, r = this.next()): number {
    return min + Math.floor(r * (max - min + 1));
  }
}

/** Pick an index according to `weights`, using a pre-drawn random value `r` in [0, 1). */
export function weightedIndex(weights: number[], r: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

const SEED_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomSeed(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('');
}

/* ------------------------------------------------------------------ */
/* Music generation                                                    */
/* ------------------------------------------------------------------ */

export const STEPS_PER_BAR = 8; // eighth notes in 4/4

export type Voice = 'pad' | 'lead' | 'bass';

export interface NoteEvent {
  voice: Voice;
  midi: number;
  /** 0..1 */
  velocity: number;
  /** Duration in steps (eighth notes). */
  steps: number;
  /** Delay from the step start, in steps (humanisation). Always >= 0. */
  offset: number;
}

export interface GeneratorParams {
  /** 0..1 — how many melody notes. */
  density: number;
  /** 0..1 — leap size, chord-tone bias, timing/velocity variance, progression unpredictability. */
  randomness: number;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

function nearestOctave(midi: number, target: number): number {
  return midi + 12 * Math.round((target - midi) / 12);
}

function clampByOctaves(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

/**
 * Deterministic, never-ending ambient note generator.
 * Call `next()` once per eighth-note step; it returns the notes to play on that step.
 *
 * Separate RNG streams are used for harmony and melody, and each step always consumes the
 * same number of random values, so slider changes don't scramble the rest of the sequence.
 */
export class Generator {
  private readonly chordRng: Rng;
  private readonly melodyRng: Rng;
  private readonly len: number;
  private readonly leadLo: number;
  private readonly leadHi: number;
  private readonly padCenter: number;
  private readonly breathPeriod: number;
  private readonly breathPhase: number;

  private step = 0;
  private nextChordStep = 0;
  private chordDegree = 0;
  private chordsSinceTonic = 0;
  private chordTones = new Set<number>();
  private voicing: number[] = [];
  private leadIdx: number;

  constructor(
    private readonly mood: MoodPreset,
    seed: string,
  ) {
    this.chordRng = new Rng(hashString(`${seed}|${mood.id}|chords`));
    this.melodyRng = new Rng(hashString(`${seed}|${mood.id}|melody`));
    this.len = mood.scale.length;
    this.leadLo = this.indexAtOrAbove(mood.leadRange[0]);
    this.leadHi = this.indexAtOrAbove(mood.leadRange[1]);
    this.padCenter = mood.root + 7;
    this.leadIdx = Math.round((this.leadLo + this.leadHi) / 2);
    // Melody "breathes": activity rises and falls over a seeded 6-12 bar cycle.
    this.breathPeriod = STEPS_PER_BAR * this.melodyRng.int(6, 12);
    this.breathPhase = this.melodyRng.next() * Math.PI * 2;
  }

  /** MIDI note for a (possibly negative or multi-octave) scale index. */
  degreeToMidi(index: number): number {
    const octave = Math.floor(index / this.len);
    return this.mood.root + 12 * octave + this.mood.scale[mod(index, this.len)];
  }

  private indexAtOrAbove(semitones: number): number {
    let i = 0;
    while (this.degreeToMidi(i) - this.mood.root < semitones) i++;
    return i;
  }

  next(params: GeneratorParams): NoteEvent[] {
    const events: NoteEvent[] = [];
    if (this.step >= this.nextChordStep) events.push(...this.advanceChord(params));
    const lead = this.melodyStep(params);
    if (lead) events.push(lead);
    this.step++;
    return events;
  }

  private advanceChord({ randomness }: GeneratorParams): NoteEvent[] {
    const rng = this.chordRng;
    const rPick = rng.next();
    const rBars = rng.next();
    const rColor = rng.next();
    const rVel = rng.next();
    const { chords, barsPerChord } = this.mood;

    let degree: number;
    if (this.step === 0) {
      degree = 0; // always begin at home
    } else {
      const weights = chords.map((c) => {
        let w = c.weight;
        if (c.degree === this.chordDegree) w *= 0.12;
        const d = Math.abs(c.degree - this.chordDegree);
        const dist = Math.min(d, this.len - d);
        w *= 1 / (1 + dist * 0.35 * (1 - randomness)); // prefer gentle moves
        if (c.degree === 0) w *= 1 + this.chordsSinceTonic * 0.4 * (1 - randomness * 0.5); // gravity home
        return Math.pow(w, 1 - 0.6 * randomness); // randomness flattens the distribution
      });
      degree = chords[weightedIndex(weights, rPick)].degree;
    }
    this.chordsSinceTonic = degree === 0 ? 0 : this.chordsSinceTonic + 1;
    this.chordDegree = degree;

    const bars = Math.round(barsPerChord[0] + rBars * (barsPerChord[1] - barsPerChord[0]));
    const steps = bars * STEPS_PER_BAR;
    this.nextChordStep = this.step + steps;

    // Stack scale-thirds; occasionally add a colour tone (7th / 9th).
    const indices = [degree, degree + 2, degree + 4];
    if (rColor < 0.25 + 0.35 * randomness) indices.push(degree + 6);
    this.chordTones = new Set(indices.map((i) => mod(i, this.len)));

    // Smooth voice-leading: keep each voice close to where it was.
    const prev = this.voicing;
    const placed = indices.map((idx, i) => {
      const target = prev.length ? prev[Math.min(i, prev.length - 1)] : this.padCenter - 5 + i * 4;
      return clampByOctaves(nearestOctave(this.degreeToMidi(idx), target), this.padCenter - 9, this.padCenter + 12);
    });
    this.voicing = [...new Set(placed)].sort((a, b) => a - b);

    const padVel = 0.28 + rVel * 0.15;
    const events: NoteEvent[] = this.voicing.map((midi) => ({ voice: 'pad', midi, velocity: padVel, steps, offset: 0 }));
    const bass = clampByOctaves(this.degreeToMidi(degree) - 12, this.mood.root - 17, this.mood.root - 6);
    events.push({ voice: 'bass', midi: bass, velocity: 0.55, steps, offset: 0 });
    return events;
  }

  private melodyStep({ density, randomness }: GeneratorParams): NoteEvent | null {
    const rng = this.melodyRng;
    const rPlay = rng.next();
    const rPitch = rng.next();
    const rVel = rng.next();
    const rDur = rng.next();
    const rTime = rng.next();

    const pos = this.step % STEPS_PER_BAR;
    const beat = pos === 0 ? 1.6 : pos === 4 ? 1.3 : pos % 2 === 0 ? 1 : 0.45 + 0.5 * randomness;
    const breath = 0.5 + 0.5 * Math.sin((this.step / this.breathPeriod) * Math.PI * 2 + this.breathPhase);
    const probability = Math.pow(density, 1.2) * 0.9 * beat * (0.35 + 0.65 * breath);
    if (rPlay >= probability) return null;

    const sigma = 1.2 + randomness * 3.5;
    const center = (this.leadLo + this.leadHi) / 2;
    const span = (this.leadHi - this.leadLo) / 2;
    const candidates: number[] = [];
    const weights: number[] = [];
    for (let i = this.leadLo; i <= this.leadHi; i++) {
      const deg = mod(i, this.len);
      const d = i - this.leadIdx;
      let w = Math.exp(-(d * d) / (2 * sigma * sigma)); // stepwise motion
      if (d === 0) w *= 0.35; // avoid too many repeats
      if (this.chordTones.has(deg)) w *= 1 + 2.5 * (1 - randomness); // consonance
      w *= Math.pow(this.mood.degreeWeights[deg] ?? 1, 1 - randomness * 0.7);
      w *= Math.exp(-((i - center) ** 2) / (2 * (span * 1.1) ** 2)); // gently pull to the middle
      candidates.push(i);
      weights.push(w);
    }
    this.leadIdx = candidates[weightedIndex(weights, rPitch)];

    const accent = pos === 0 ? 0.1 : 0;
    const velocity = Math.min(1, 0.35 + accent + rVel * 0.4 * (0.5 + randomness));
    const steps = [1, 2, 3, 4, 6][weightedIndex([2, 3, 2, 2, 1], rDur)];
    const offset = rTime * randomness * 0.25;
    return { voice: 'lead', midi: this.degreeToMidi(this.leadIdx), velocity, steps, offset };
  }
}
