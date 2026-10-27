/**
 * Mood presets are plain data. To add a mood, append one object to `MOODS`.
 * Everything else (UI buttons, URL hash, audio, colours) picks it up automatically.
 */

export type OscType =
  | 'sine'
  | 'triangle'
  | 'sawtooth'
  | 'square'
  | 'fatsine'
  | 'fattriangle'
  | 'fatsawtooth'
  | 'fatsquare';

export interface PadTimbre {
  oscillator: OscType;
  /** Detune spread in cents (only used by `fat*` oscillators). */
  spread: number;
  attack: number;
  release: number;
  /** dB */
  volume: number;
}

export interface LeadTimbre {
  /** `synth` = simple subtractive voice, `fm` = bell-like, `am` = soft/hollow. */
  kind: 'synth' | 'fm' | 'am';
  oscillator: OscType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** dB */
  volume: number;
  harmonicity?: number;
  modulationIndex?: number;
}

export interface MoodPreset {
  id: string;
  name: string;
  description: string;
  /** MIDI note of the tonic (50 = D3). */
  root: number;
  /** Scale as semitone offsets from the root. */
  scale: number[];
  /** Relative melodic weight for each scale degree (same length as `scale`). */
  degreeWeights: number[];
  /** Chord roots (scale-degree indices) the progression drifts between. */
  chords: { degree: number; weight: number }[];
  /** How long each chord lasts, in bars [min, max]. */
  barsPerChord: [number, number];
  /** Melody register, in semitones above the root [low, high]. */
  leadRange: [number, number];
  tempo: { min: number; max: number; default: number };
  /** `decay` = reverb size in seconds, `wet` = default Reverb slider value. */
  reverb: { decay: number; wet: number };
  defaults: { density: number; brightness: number; randomness: number };
  timbre: {
    pad: PadTimbre;
    lead: LeadTimbre;
    bass: { oscillator: OscType; volume: number };
    delay: { time: string; feedback: number; wet: number };
  };
  palette: {
    /** Background colour as [hue, saturation %, lightness %]. */
    background: [number, number, number];
    /** Glow hues (0-360). Use 4 for smooth transitions between moods. */
    hues: number[];
    saturation: number;
    lightness: number;
  };
}

const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const MOODS: MoodPreset[] = [
  {
    id: 'calm',
    name: 'Calm',
    description: 'D minor pentatonic, unhurried and open',
    root: 50, // D3
    scale: MINOR_PENTATONIC,
    degreeWeights: [3, 1.5, 2, 2.5, 1.2],
    chords: [
      { degree: 0, weight: 4 },
      { degree: 1, weight: 2 },
      { degree: 2, weight: 2.5 },
      { degree: 3, weight: 3 },
      { degree: 4, weight: 1.5 },
    ],
    barsPerChord: [2, 4],
    leadRange: [12, 31],
    tempo: { min: 56, max: 84, default: 68 },
    reverb: { decay: 7, wet: 0.45 },
    defaults: { density: 0.35, brightness: 0.5, randomness: 0.3 },
    timbre: {
      pad: { oscillator: 'fattriangle', spread: 24, attack: 2.5, release: 5, volume: -17 },
      lead: { kind: 'synth', oscillator: 'triangle', attack: 0.02, decay: 0.6, sustain: 0.2, release: 2.5, volume: -12 },
      bass: { oscillator: 'sine', volume: -15 },
      delay: { time: '4n.', feedback: 0.35, wet: 0.25 },
    },
    palette: { background: [222, 45, 7], hues: [185, 200, 215, 170], saturation: 70, lightness: 60 },
  },
  {
    id: 'dreamy',
    name: 'Dreamy',
    description: 'F lydian, floating bells and long tails',
    root: 53, // F3
    scale: LYDIAN,
    degreeWeights: [3, 1.5, 2.5, 1.8, 2.5, 1.5, 1.2],
    chords: [
      { degree: 0, weight: 4 },
      { degree: 1, weight: 3 },
      { degree: 2, weight: 2 },
      { degree: 4, weight: 2 },
      { degree: 5, weight: 2.5 },
    ],
    barsPerChord: [3, 5],
    leadRange: [12, 33],
    tempo: { min: 48, max: 72, default: 58 },
    reverb: { decay: 12, wet: 0.6 },
    defaults: { density: 0.28, brightness: 0.6, randomness: 0.35 },
    timbre: {
      pad: { oscillator: 'fatsine', spread: 30, attack: 4, release: 8, volume: -15 },
      lead: {
        kind: 'fm', oscillator: 'sine', attack: 0.01, decay: 1.2, sustain: 0, release: 3, volume: -15,
        harmonicity: 3.01, modulationIndex: 5,
      },
      bass: { oscillator: 'sine', volume: -17 },
      delay: { time: '4n', feedback: 0.45, wet: 0.35 },
    },
    palette: { background: [265, 40, 8], hues: [280, 300, 250, 320], saturation: 65, lightness: 66 },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'A phrygian, low drones and slow motion',
    root: 45, // A2
    scale: PHRYGIAN,
    degreeWeights: [3, 1.4, 1.8, 1.5, 2.5, 1.5, 1.2],
    chords: [
      { degree: 0, weight: 4 },
      { degree: 1, weight: 2 },
      { degree: 3, weight: 2.5 },
      { degree: 5, weight: 3 },
      { degree: 6, weight: 1.5 },
    ],
    barsPerChord: [4, 6],
    leadRange: [7, 24],
    tempo: { min: 40, max: 60, default: 48 },
    reverb: { decay: 10, wet: 0.5 },
    defaults: { density: 0.22, brightness: 0.3, randomness: 0.25 },
    timbre: {
      pad: { oscillator: 'fatsawtooth', spread: 18, attack: 5, release: 8, volume: -22 },
      lead: { kind: 'synth', oscillator: 'sine', attack: 0.05, decay: 1, sustain: 0.3, release: 4, volume: -10 },
      bass: { oscillator: 'triangle', volume: -14 },
      delay: { time: '2n', feedback: 0.4, wet: 0.3 },
    },
    palette: { background: [350, 35, 5], hues: [345, 0, 262, 15], saturation: 62, lightness: 48 },
  },
  {
    id: 'hopeful',
    name: 'Hopeful',
    description: 'G major, warm and gently moving',
    root: 55, // G3
    scale: MAJOR,
    // Favour pentatonic tones; 4th and 7th are passing colours.
    degreeWeights: [3, 1.8, 2.5, 0.6, 2.5, 2, 0.5],
    chords: [
      { degree: 0, weight: 4 },
      { degree: 1, weight: 1.2 },
      { degree: 3, weight: 3 },
      { degree: 4, weight: 2.5 },
      { degree: 5, weight: 2.5 },
    ],
    barsPerChord: [2, 3],
    leadRange: [12, 31],
    tempo: { min: 70, max: 100, default: 84 },
    reverb: { decay: 4.5, wet: 0.35 },
    defaults: { density: 0.45, brightness: 0.7, randomness: 0.3 },
    timbre: {
      pad: { oscillator: 'fattriangle', spread: 20, attack: 1.5, release: 4, volume: -18 },
      lead: { kind: 'am', oscillator: 'triangle', attack: 0.005, decay: 0.4, sustain: 0.1, release: 1.8, volume: -11, harmonicity: 2 },
      bass: { oscillator: 'sine', volume: -15 },
      delay: { time: '8n.', feedback: 0.3, wet: 0.25 },
    },
    palette: { background: [30, 40, 8], hues: [40, 25, 55, 190], saturation: 85, lightness: 62 },
  },
];

export const DEFAULT_MOOD_ID = 'calm';

export function getMood(id: string | null | undefined): MoodPreset {
  return MOODS.find((m) => m.id === id) ?? MOODS.find((m) => m.id === DEFAULT_MOOD_ID) ?? MOODS[0];
}
