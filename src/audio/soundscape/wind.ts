import * as Tone from 'tone';
import { BaseLayer, lerp, rand, type LayerContext, type LayerDef } from './layer';

const GAIN = 1.9;

/**
 * Wind: pink noise through two bandpasses (a broad "rush" and a higher "air" band) plus a little
 * brown-noise rumble. Slow LFOs keep the bands drifting, and random gusts swell the level while
 * bending the bands up to an octave higher and sweeping them across the stereo field. A faint
 * high-Q whistle rises with strong gusts. Gustiness sets how deep, frequent and fast gusts are.
 */
class Wind extends BaseLayer {
  private gustiness: number;
  private readonly gust: Tone.Gain;
  private readonly whistle: Tone.Gain;
  private readonly panner: Tone.Panner;
  private readonly bands: Tone.Filter[];
  private readonly lfos: Tone.LFO[];

  constructor(ctx: LayerContext, gustiness: number) {
    super(ctx, GAIN);
    this.gustiness = gustiness;
    const own = this.own;
    const pink = ctx.noise('pink');

    this.panner = own(new Tone.Panner({ pan: 0, channelCount: 2 }));
    this.panner.connect(this.out);
    this.gust = own(new Tone.Gain(0.6)).connect(this.panner);

    const rush = own(new Tone.Filter({ type: 'bandpass', frequency: 650, Q: 0.9 })).connect(this.gust);
    pink.connect(rush);

    const airGain = own(new Tone.Gain(0.45)).connect(this.gust);
    const air = own(new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 1.4 })).connect(airGain);
    pink.connect(air);

    const rumbleGain = own(new Tone.Gain(0.35)).connect(this.gust);
    const rumble = own(new Tone.Filter({ type: 'lowpass', frequency: 220, Q: 0.5 })).connect(rumbleGain);
    ctx.noise('brown').connect(rumble);

    this.whistle = own(new Tone.Gain(0)).connect(this.panner);
    const whistleBand = own(new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 28 })).connect(this.whistle);
    pink.connect(whistleBand);

    this.bands = [rush, air, whistleBand];
    const lfo = (min: number, max: number, lo: number, hi: number) =>
      own(new Tone.LFO({ frequency: rand(lo, hi), min, max, phase: rand(0, 360) }));
    this.lfos = [
      lfo(450, 900, 0.03, 0.07).connect(rush.frequency),
      lfo(0.6, 1.4, 0.02, 0.05).connect(rush.Q),
      lfo(1400, 2600, 0.04, 0.09).connect(air.frequency),
      lfo(850, 1500, 0.05, 0.11).connect(whistleBand.frequency),
    ];
  }

  setParam(name: string, value: number): void {
    if (name === 'gustiness') this.gustiness = value;
  }

  protected onStart(): void {
    for (const l of this.lfos) l.start();
    this.loop(
      () => rand(1.5, 5) * lerp(1.6, 0.6, this.gustiness),
      (t) => this.gustAt(t),
      0,
    );
  }

  protected onStop(): void {
    for (const l of this.lfos) l.stop();
  }

  private gustAt(time: number): void {
    const g = this.gustiness;
    // Lulls and surges around a steady base; gustier wind swings further and moves faster.
    const surge = Math.random() < lerp(0.25, 0.55, g);
    const swing = lerp(0.2, 0.75, g);
    const level = surge ? 0.6 + swing * rand(0.5, 1.1) : 0.6 - swing * 0.7 * Math.random();
    const dur = rand(1.2, 3.5) * lerp(1.4, 0.7, g);
    const glide = dur / 3;

    this.gust.gain.setTargetAtTime(Math.max(0.08, level), time, glide);
    // Gusts are brighter: bend every band with the level (up to about an octave).
    const cents = (level - 0.6) * 1500;
    for (const band of this.bands) band.detune.setTargetAtTime(cents + rand(-120, 120), time, glide);
    this.panner.pan.setTargetAtTime(rand(-0.6, 0.6) * (0.4 + g), time, dur / 2);
    const whistle = surge ? lerp(0.02, 0.22, g) * rand(0.4, 1) : 0.01;
    this.whistle.gain.setTargetAtTime(whistle, time, glide * 1.5);
  }
}

export const wind: LayerDef = {
  id: 'wind',
  name: 'Wind',
  icon: 'M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h6',
  level: 0.5,
  param: { name: 'gustiness', label: 'Gustiness', default: 0.45 },
  create: (ctx, gustiness) => new Wind(ctx, gustiness),
};
