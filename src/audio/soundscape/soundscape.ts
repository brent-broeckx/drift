import * as Tone from 'tone';
import { clamp01, levelToGain, type LayerContext, type LayerDef, type NoiseColor, type SoundscapeLayer } from './layer';
import { rain } from './rain';
import { wind } from './wind';
import { ocean } from './ocean';
import { fire } from './fire';
import { crickets } from './crickets';
import { thunder } from './thunder';

/** The layer registry. To add a layer, write one file exporting a `LayerDef` and list it here. */
export const LAYERS: readonly LayerDef[] = [rain, wind, ocean, fire, crickets, thunder];

export const FADE_SECONDS = 1.5;
export const DEFAULT_SOUNDSCAPE_LEVEL = 0.8;

/** Layers are calibrated 6 dB hot into the peak catcher, then trimmed back after it (avoids compressor makeup gain). */
const GLUE_TRIM = 0.5;
export const DEFAULT_MUSIC_LEVEL = 1;

export interface LayerSetting {
  on: boolean;
  /** 0..1 */
  level: number;
  /** 0..1, the layer's extra control (unused if it has none) */
  param: number;
}

export type LayerSettings = Record<string, LayerSetting>;

/** Everything in the Soundscape panel: layer settings plus the soundscape and music levels. */
export interface Mix {
  layers: LayerSettings;
  soundscape: number;
  music: number;
}

export interface Preset {
  id: string;
  name: string;
  layers: Record<string, { level: number; param?: number }>;
}

export const PRESETS: readonly Preset[] = [
  { id: 'rainy-window', name: 'Rainy Window', layers: { rain: { level: 0.55, param: 0.35 }, thunder: { level: 0.4 } } },
  { id: 'seaside', name: 'Seaside', layers: { ocean: { level: 0.55, param: 0.4 }, wind: { level: 0.35, param: 0.3 } } },
  { id: 'campfire', name: 'Campfire', layers: { fire: { level: 0.55, param: 0.5 }, crickets: { level: 0.4 } } },
  {
    id: 'forest-night',
    name: 'Forest Night',
    layers: { crickets: { level: 0.5 }, wind: { level: 0.35, param: 0.15 } },
  },
  {
    id: 'storm',
    name: 'Storm',
    layers: { rain: { level: 0.5, param: 0.95 }, wind: { level: 0.5, param: 0.8 }, thunder: { level: 0.55 } },
  },
];

const paramDefault = (def: LayerDef) => def.param?.default ?? 0;

export function defaultLayers(): LayerSettings {
  const out: LayerSettings = {};
  for (const def of LAYERS) out[def.id] = { on: false, level: def.level, param: paramDefault(def) };
  return out;
}

export function defaultMix(): Mix {
  return { layers: defaultLayers(), soundscape: DEFAULT_SOUNDSCAPE_LEVEL, music: DEFAULT_MUSIC_LEVEL };
}

export function cloneMix(mix: Mix): Mix {
  const layers: LayerSettings = {};
  for (const [id, s] of Object.entries(mix.layers)) layers[id] = { ...s };
  return { layers, soundscape: mix.soundscape, music: mix.music };
}

/** Layer settings for a preset: its layers on at its levels, every other layer off (levels kept). */
export function presetLayers(preset: Preset, current: LayerSettings): LayerSettings {
  const out: LayerSettings = {};
  for (const def of LAYERS) {
    const p = preset.layers[def.id];
    out[def.id] = p
      ? { on: true, level: p.level, param: p.param ?? paramDefault(def) }
      : { ...(current[def.id] ?? { level: def.level, param: paramDefault(def) }), on: false };
  }
  return out;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The preset these settings currently match exactly, if any. */
export function matchingPreset(layers: LayerSettings): Preset | null {
  return (
    PRESETS.find((preset) =>
      LAYERS.every((def) => {
        const s = layers[def.id];
        const p = preset.layers[def.id];
        if (!p) return !s?.on;
        return !!s?.on && near(s.level, p.level) && (!def.param || near(s.param, p.param ?? def.param.default));
      }),
    ) ?? null
  );
}

/* ---------------- URL hash & storage ---------------- */

/**
 * 0..1 as compact decimal digits: "6" = 0.6, "65" = 0.65, "05" = 0.05, "100" = 1.
 * Combined per layer as `id.level[.param]`, e.g. `sc=rain.6.8,ocean.4`.
 */
export function encodeAmount(v: number): string {
  const p = Math.round(clamp01(v) * 100);
  if (p === 100) return '100';
  return p % 10 === 0 ? String(p / 10) : String(p).padStart(2, '0');
}

export function decodeAmount(s: string | null | undefined): number | null {
  if (!s || !/^(\d{1,2}|100)$/.test(s)) return null;
  return s === '100' ? 1 : Number(`0.${s}`);
}

/** Hash fragment (without `#` or leading `&`) describing a mix. Characters are all URL-safe. */
export function mixToHash(mix: Mix): string {
  const entries = LAYERS.filter((def) => mix.layers[def.id]?.on).map((def) => {
    const s = mix.layers[def.id];
    let entry = `${def.id}.${encodeAmount(s.level)}`;
    if (def.param && !near(s.param, def.param.default)) entry += `.${encodeAmount(s.param)}`;
    return entry;
  });
  let out = `sc=${entries.join(',')}`;
  if (!near(mix.soundscape, DEFAULT_SOUNDSCAPE_LEVEL)) out += `&sv=${encodeAmount(mix.soundscape)}`;
  if (!near(mix.music, DEFAULT_MUSIC_LEVEL)) out += `&mv=${encodeAmount(mix.music)}`;
  return out;
}

/** The mix described by a hash, or null if the hash doesn't specify one. */
export function mixFromHash(q: URLSearchParams): Mix | null {
  const raw = q.get('sc');
  if (raw === null) return null;
  const mix = defaultMix();
  for (const entry of raw.split(',')) {
    const [id, level, param] = entry.split('.');
    const def = LAYERS.find((d) => d.id === id);
    if (!def) continue;
    mix.layers[def.id] = {
      on: true,
      level: decodeAmount(level) ?? def.level,
      param: (def.param && decodeAmount(param)) ?? paramDefault(def),
    };
  }
  mix.soundscape = decodeAmount(q.get('sv')) ?? DEFAULT_SOUNDSCAPE_LEVEL;
  mix.music = decodeAmount(q.get('mv')) ?? DEFAULT_MUSIC_LEVEL;
  return mix;
}

const STORAGE_KEY = 'drift.soundscape.v1';
const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback);

export function loadMix(): Mix | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Mix> | null;
    if (!data || typeof data !== 'object') return null;
    const mix = defaultMix();
    for (const def of LAYERS) {
      const s = (data.layers as Record<string, Partial<LayerSetting>> | undefined)?.[def.id];
      if (!s || typeof s !== 'object') continue;
      mix.layers[def.id] = {
        on: s.on === true,
        level: unit(s.level, def.level),
        param: unit(s.param, paramDefault(def)),
      };
    }
    mix.soundscape = unit(data.soundscape, DEFAULT_SOUNDSCAPE_LEVEL);
    mix.music = unit(data.music, DEFAULT_MUSIC_LEVEL);
    return mix;
  } catch {
    return null;
  }
}

export function saveMix(mix: Mix): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mix));
  } catch {
    // Storage may be unavailable (private mode, quota); the URL hash still works.
  }
}

/* ---------------- audio ---------------- */

interface Tap {
  node: Tone.Gain;
  release(): void;
}

/** Refcounted shared noise sources; each user gets its own tap so it can be cleanly disconnected. */
class NoisePool {
  private readonly sources = new Map<NoiseColor, { noise: Tone.Noise; users: number }>();

  tap(color: NoiseColor): Tap {
    let source = this.sources.get(color);
    if (!source) {
      source = { noise: new Tone.Noise(color).start(), users: 0 };
      this.sources.set(color, source);
    }
    const s = source;
    s.users++;
    const node = new Tone.Gain(1);
    s.noise.connect(node);
    let released = false;
    return {
      node,
      release: () => {
        if (released) return;
        released = true;
        s.noise.disconnect(node);
        node.dispose();
        if (--s.users === 0) {
          s.noise.stop();
          s.noise.dispose();
          this.sources.delete(color);
        }
      },
    };
  }

  dispose(): void {
    for (const s of this.sources.values()) s.noise.dispose();
    this.sources.clear();
  }
}

interface Slot {
  layer: SoundscapeLayer;
  fader: Tone.Gain;
  taps: Tap[];
  retireTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Soundscape manager. Holds the layer settings at all times; audio nodes exist only while attached
 * to a running master chain, and only for enabled layers (plus layers still fading out).
 *
 *   layer -> fader (1.5 s on/off fade) ┐
 *   layer -> fader ────────────────────┼─> glue compressor -> trim -> soundscape bus (level) -> destination (the master gain)
 *
 * The compressor only engages when many loud layers are stacked, so no combination can slam the master limiter.
 */
export class Soundscape {
  private layers: LayerSettings = defaultLayers();
  private level = DEFAULT_SOUNDSCAPE_LEVEL;
  private bus: Tone.Gain | null = null;
  private glue: Tone.Compressor | null = null;
  private trim: Tone.Gain | null = null;
  private readonly slots = new Map<string, Slot>();
  private readonly pool = new NoisePool();

  get attached(): boolean {
    return this.bus !== null;
  }

  /** Create the bus on a running master chain and start every enabled layer. */
  attach(destination: Tone.InputNode): void {
    if (this.bus) this.detach();
    this.bus = new Tone.Gain(levelToGain(this.level)).connect(destination);
    this.trim = new Tone.Gain(GLUE_TRIM).connect(this.bus);
    this.glue = new Tone.Compressor({ threshold: -10, ratio: 12, knee: 6, attack: 0.002, release: 0.25 }).connect(this.trim);
    for (const def of LAYERS) if (this.layers[def.id]?.on) this.fadeIn(def);
  }

  /** Immediately stop and dispose all layer nodes, timers and noise sources. */
  detach(): void {
    for (const slot of this.slots.values()) this.teardown(slot);
    this.slots.clear();
    this.pool.dispose();
    this.glue?.dispose();
    this.glue = null;
    this.trim?.dispose();
    this.trim = null;
    this.bus?.dispose();
    this.bus = null;
  }

  setLevel(v: number): void {
    this.level = v;
    this.bus?.gain.rampTo(levelToGain(v), 0.1);
  }

  /** Replace all layer settings (presets, hash changes), fading layers in or out as needed. */
  apply(layers: LayerSettings): void {
    for (const def of LAYERS) {
      const s = layers[def.id];
      if (s) this.setLayer(def.id, s);
    }
  }

  setLayer(id: string, patch: Partial<LayerSetting>): void {
    const def = LAYERS.find((d) => d.id === id);
    const current = this.layers[id];
    if (!def || !current) return;
    const next = { ...current, ...patch };
    this.layers[id] = next;

    const slot = this.slots.get(id);
    if (slot) {
      if (next.level !== current.level) slot.layer.setLevel(next.level);
      if (def.param && next.param !== current.param) slot.layer.setParam?.(def.param.name, next.param);
    }
    if (!this.bus || next.on === current.on) return;
    if (next.on) this.fadeIn(def);
    else if (slot) this.fadeOut(id, slot);
  }

  private fadeIn(def: LayerDef): void {
    const existing = this.slots.get(def.id);
    if (existing) {
      // Re-enabled while fading out: keep the running layer and fade back up.
      if (existing.retireTimer !== null) clearTimeout(existing.retireTimer);
      existing.retireTimer = null;
      ramp(existing.fader, 1);
      return;
    }
    if (!this.glue) return;
    const setting = this.layers[def.id];
    const fader = new Tone.Gain(0).connect(this.glue);
    const taps = new Map<NoiseColor, Tap>();
    const ctx: LayerContext = {
      output: fader,
      noise: (color) => {
        let tap = taps.get(color);
        if (!tap) {
          tap = this.pool.tap(color);
          taps.set(color, tap);
        }
        return tap.node;
      },
    };
    let layer: SoundscapeLayer;
    try {
      layer = def.create(ctx, setting.param);
      layer.setLevel(setting.level);
      layer.start();
    } catch (err) {
      console.error(`Soundscape layer "${def.id}" failed to start`, err);
      for (const tap of taps.values()) tap.release();
      fader.dispose();
      return;
    }
    this.slots.set(def.id, { layer, fader, taps: [...taps.values()], retireTimer: null });
    ramp(fader, 1);
  }

  private fadeOut(id: string, slot: Slot): void {
    ramp(slot.fader, 0);
    if (slot.retireTimer !== null) clearTimeout(slot.retireTimer);
    slot.retireTimer = setTimeout(() => {
      this.slots.delete(id);
      this.teardown(slot);
    }, (FADE_SECONDS + 0.25) * 1000);
  }

  private teardown(slot: Slot): void {
    if (slot.retireTimer !== null) clearTimeout(slot.retireTimer);
    slot.retireTimer = null;
    slot.layer.dispose();
    slot.fader.dispose();
    for (const tap of slot.taps) tap.release();
  }
}

function ramp(fader: Tone.Gain, target: number): void {
  const g = fader.gain;
  const now = fader.context.now();
  g.cancelAndHoldAtTime(now);
  g.linearRampToValueAtTime(target, now + FADE_SECONDS);
}
