import * as Tone from 'tone';
import { BaseLayer, rand, type LayerContext, type LayerDef } from './layer';

const GAIN = 1.5;
const COUNT = 4;

interface Cricket {
  osc: Tone.Oscillator;
  env: Tone.Gain;
  drift: Tone.Gain;
  pitch: number;
  /** Pulses per second inside a chirp. */
  pulseRate: number;
  /** Seconds between chirps. */
  chirpGap: number;
}

/**
 * Crickets: a few sine oscillators around 4–5 kHz, each gated into short chirps of 2–4 pulses with
 * its own pulse rate, chirp spacing and stereo position. Slow random volume drift and the odd pause
 * keep the chorus from locking into a pattern.
 */
class Crickets extends BaseLayer {
  private readonly crickets: Cricket[] = [];

  constructor(ctx: LayerContext) {
    super(ctx, GAIN);
    const own = this.own;
    for (let i = 0; i < COUNT; i++) {
      const panner = own(new Tone.Panner(rand(-0.75, 0.75)));
      panner.connect(this.out);
      const drift = own(new Tone.Gain(rand(0.4, 1))).connect(panner);
      const env = own(new Tone.Gain(0)).connect(drift);
      const pitch = rand(4200, 4900);
      const osc = own(new Tone.Oscillator({ type: 'sine', frequency: pitch })).connect(env);
      this.crickets.push({ osc, env, drift, pitch, pulseRate: rand(24, 36), chirpGap: rand(0.45, 0.9) });
    }
  }

  protected onStart(): void {
    for (const c of this.crickets) {
      c.osc.start();
      this.loop(
        () => c.chirpGap * rand(0.85, 1.15) + (Math.random() < 0.06 ? rand(2, 7) : 0),
        (t) => this.chirp(c, t),
        rand(0, 1),
      );
      this.loop(
        () => rand(3, 8),
        (t) => c.drift.gain.setTargetAtTime(rand(0.2, 1), t, rand(1, 2.5)),
      );
    }
  }

  protected onStop(): void {
    for (const c of this.crickets) c.osc.stop();
  }

  private chirp(c: Cricket, time: number): void {
    const pulses = 2 + Math.floor(Math.random() * 3);
    const period = 1 / c.pulseRate;
    const peak = rand(0.6, 1);
    c.osc.frequency.setValueAtTime(c.pitch * rand(0.992, 1.008), time);
    const g = c.env.gain;
    for (let k = 0; k < pulses; k++) {
      const t = time + k * period;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + 0.004);
      g.linearRampToValueAtTime(0, t + period * 0.7);
    }
  }
}

export const crickets: LayerDef = {
  id: 'crickets',
  name: 'Crickets',
  icon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10zM17 4v3M15.5 5.5h3',
  level: 0.4,
  create: (ctx) => new Crickets(ctx),
};
