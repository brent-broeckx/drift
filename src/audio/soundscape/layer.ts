import * as Tone from 'tone';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** What the manager hands a layer when it is created. */
export interface LayerContext {
  /** Connect the layer's output here (the manager's per-layer fader, which feeds the soundscape bus). */
  readonly output: Tone.InputNode;
  /**
   * A tap on a shared, already-running noise source. Noise is stereo with decorrelated channels.
   * The manager owns the tap and disconnects it when the layer is disposed.
   */
  noise(color: NoiseColor): Tone.ToneAudioNode;
}

/** Common interface for every ambient layer. */
export interface SoundscapeLayer {
  /** Start sources and scheduled events. */
  start(): void;
  /** Stop sources and clear every scheduled event. */
  stop(): void;
  /** 0..1 slider value. */
  setLevel(level: number): void;
  /** Optional extra control (see `LayerDef.param`), value 0..1. */
  setParam?(name: string, value: number): void;
  /** Stop and dispose every node. */
  dispose(): void;
}

export interface LayerParam {
  name: string;
  label: string;
  /** 0..1 */
  default: number;
}

/** Registry entry: everything the manager and UI need to know about a layer. */
export interface LayerDef {
  /** Lowercase letters only; used in the URL hash. */
  id: string;
  name: string;
  /** SVG path data for a 24x24 stroked icon. */
  icon: string;
  /** Default slider level, 0..1. */
  level: number;
  param?: LayerParam;
  /** `param` is the initial value of the extra control (its default if the layer has none). */
  create(ctx: LayerContext, param: number): SoundscapeLayer;
}

interface Disposable {
  dispose(): unknown;
}

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Seconds until the next event of a Poisson process with the given rate (events/s). */
export const poissonGap = (rate: number) => -Math.log(1 - Math.random()) / Math.max(rate, 1e-3);
/** Perceptual slider curve, shared by every soundscape level control. */
export const levelToGain = (v: number) => clamp01(v) * clamp01(v);

/** How far ahead (s) events are placed on the audio clock, and how often the scheduler wakes. */
const LOOKAHEAD = 0.25;
const TICK = 0.1;
const SILENT = 0.0001;

/** A short percussive envelope (linear attack, exponential decay) on an otherwise silent gain. */
export function blip(gain: Tone.Param<'gain'>, time: number, peak: number, attack: number, decay: number): void {
  gain.setValueAtTime(0, time);
  gain.linearRampToValueAtTime(peak, time + attack);
  gain.exponentialRampToValueAtTime(SILENT, time + attack + decay);
  gain.setValueAtTime(0, time + attack + decay + 0.002);
}

export interface VoiceHit {
  freq: number;
  q: number;
  peak: number;
  attack: number;
  decay: number;
  pan: number;
}

/**
 * A reusable one-shot voice: filter -> envelope gain -> mono panner. Shared noise feeds the
 * filter; each event only retunes and triggers it with automation, so no nodes are created per event.
 */
export class Voice {
  readonly filter: Tone.Filter;
  readonly env: Tone.Gain;
  readonly pan: Tone.Panner;
  busyUntil = 0;

  constructor(
    input: Tone.ToneAudioNode,
    output: Tone.InputNode,
    type: BiquadFilterType,
    own: <T extends Disposable>(n: T) => T,
  ) {
    this.pan = own(new Tone.Panner(0));
    this.pan.connect(output);
    this.env = own(new Tone.Gain(0)).connect(this.pan);
    this.filter = own(new Tone.Filter({ type, frequency: 2000, Q: 1, rolloff: -12 })).connect(this.env);
    input.connect(this.filter);
  }

  trigger(time: number, hit: VoiceHit): void {
    this.filter.frequency.setValueAtTime(hit.freq, time);
    this.filter.Q.setValueAtTime(hit.q, time);
    this.pan.pan.setValueAtTime(hit.pan, time);
    blip(this.env.gain, time, hit.peak, hit.attack, hit.decay);
    this.busyUntil = time + hit.attack + hit.decay + 0.005;
  }
}

/** A small round-robin pool of voices; events are dropped (not cut off) when all are busy. */
export class VoicePool {
  private readonly voices: Voice[] = [];
  private cursor = 0;

  constructor(count: number, input: Tone.ToneAudioNode, output: Tone.InputNode, type: BiquadFilterType, own: <T extends Disposable>(n: T) => T) {
    for (let i = 0; i < count; i++) this.voices.push(new Voice(input, output, type, own));
  }

  /** Idle voice at `time`, or null. */
  take(time: number): Voice | null {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[(this.cursor + i) % this.voices.length];
      if (time >= v.busyUntil) {
        this.cursor = (this.cursor + i + 1) % this.voices.length;
        return v;
      }
    }
    return null;
  }

  play(time: number, hit: VoiceHit): Voice | null {
    const v = this.take(time);
    v?.trigger(time, hit);
    return v;
  }
}

/**
 * Base class for layers: owns a level gain, tracks nodes for disposal and runs randomized event
 * loops on the Web Audio clock (Tone's worker-driven context timer, so background tabs are fine).
 */
export abstract class BaseLayer implements SoundscapeLayer {
  /** Final gain of the layer (normalization x slider level). */
  protected readonly out: Tone.Gain;
  private readonly nodes: Disposable[] = [];
  private readonly loops: number[] = [];
  private running = false;

  /** @param baseGain normalization so that equal slider levels sound roughly equally loud */
  constructor(
    protected readonly ctx: LayerContext,
    private readonly baseGain: number,
  ) {
    this.out = this.own(new Tone.Gain(0));
    this.out.connect(ctx.output);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.onStart();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const context = this.out.context;
    for (const id of this.loops) context.clearInterval(id);
    this.loops.length = 0;
    this.onStop();
  }

  setLevel(level: number): void {
    this.out.gain.rampTo(this.baseGain * levelToGain(level), 0.15);
  }

  dispose(): void {
    this.stop();
    for (let i = this.nodes.length - 1; i >= 0; i--) this.nodes[i].dispose();
    this.nodes.length = 0;
  }

  /** Start sources and loops. */
  protected abstract onStart(): void;
  /** Stop sources (loops are cleared automatically). */
  protected onStop(): void {}

  /** Register a node for disposal. */
  protected readonly own = <T extends Disposable>(node: T): T => {
    this.nodes.push(node);
    return node;
  };

  protected now(): number {
    return this.out.context.now();
  }

  /**
   * Random walk: every `minGap`..`maxGap` seconds, glide `param` toward a new random value in
   * `lo`..`hi` (smoothing time constant `tau`, defaulting to a third of the gap). Use `curve` > 1 to
   * favour low values (rarer peaks).
   */
  protected wander(
    param: { setTargetAtTime(value: number, time: number, tau: number): unknown },
    lo: number,
    hi: number,
    minGap: number,
    maxGap: number,
    { tau, curve = 1 }: { tau?: number; curve?: number } = {},
  ): void {
    this.loop(
      () => rand(minGap, maxGap),
      (t) => param.setTargetAtTime(lo + (hi - lo) * Math.pow(Math.random(), curve), t, tau ?? rand(minGap, maxGap) / 3),
      0,
    );
  }

  /**
   * Call `fire(time)` repeatedly, `gap()` seconds apart, placed slightly ahead on the audio clock.
   * Runs only between start() and stop().
   */
  protected loop(gap: () => number, fire: (time: number) => void, firstDelay = gap()): void {
    const context = this.out.context;
    let next = this.now() + firstDelay;
    const pump = () => {
      const now = this.now();
      // After a stall (e.g. a suspended context) skip ahead instead of firing a burst of missed events.
      if (next < now - 0.5) next = now + gap();
      while (next < now + LOOKAHEAD) {
        fire(Math.max(next, now));
        next += Math.max(0.004, gap());
      }
    };
    pump();
    this.loops.push(context.setInterval(pump, TICK));
  }
}
