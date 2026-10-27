import * as Tone from 'tone';
import { BaseLayer, lerp, rand, type LayerContext, type LayerDef } from './layer';

const GAIN = 1.2;
const SILENT = 0.0001;

/**
 * Ocean, one wave every 8–14 s (slightly randomized), in three parts:
 * - swell: brown + pink noise through a lowpass whose cutoff and level rise as the wave builds,
 * - crash: brighter pink noise that bursts in at the crest and drains away over several seconds
 *   as its lowpass closes (the receding "shhh"), sometimes with a smaller second break,
 * - fizz: fluttering high white noise riding the crash, like foam on sand.
 * A quiet, wandering distant-surf bed keeps the troughs from going silent. Each wave lands at a
 * slightly different place in the stereo field.
 */
class Ocean extends BaseLayer {
  private speed: number;
  private period = 10;
  private trough = 0.12;
  private floor = 350;
  private first = true;
  private readonly bed: Tone.Gain;
  private readonly swell: Tone.Gain;
  private readonly cutoff: Tone.Filter;
  private readonly crash: Tone.Gain;
  private readonly crashTone: Tone.Filter;
  private readonly flutter: Tone.Gain;
  private readonly panner: Tone.Panner;

  constructor(ctx: LayerContext, speed: number) {
    super(ctx, GAIN);
    this.speed = speed;
    const own = this.own;
    const brown = ctx.noise('brown');
    const pink = ctx.noise('pink');

    this.bed = own(new Tone.Gain(0.25)).connect(this.out);
    const bedTone = own(new Tone.Filter({ type: 'lowpass', frequency: 450, Q: 0.3 })).connect(this.bed);
    brown.connect(bedTone);

    this.panner = own(new Tone.Panner({ pan: 0, channelCount: 2 }));
    this.panner.connect(this.out);

    this.swell = own(new Tone.Gain(0)).connect(this.panner);
    this.cutoff = own(new Tone.Filter({ type: 'lowpass', frequency: this.floor, Q: 0.3, rolloff: -24 })).connect(this.swell);
    brown.connect(this.cutoff);
    const pinkGain = own(new Tone.Gain(0.5)).connect(this.cutoff);
    pink.connect(pinkGain);

    this.crash = own(new Tone.Gain(0)).connect(this.panner);
    this.crashTone = own(new Tone.Filter({ type: 'lowpass', frequency: 3000, Q: 0.4 })).connect(this.crash);
    const crashHigh = own(new Tone.Filter({ type: 'highpass', frequency: 300, Q: 0.4 })).connect(this.crashTone);
    pink.connect(crashHigh);

    const fizzLevel = own(new Tone.Gain(0.3)).connect(this.crash);
    this.flutter = own(new Tone.Gain(0.5)).connect(fizzLevel);
    const fizz = own(new Tone.Filter({ type: 'highpass', frequency: 4500, Q: 0.4 })).connect(this.flutter);
    ctx.noise('white').connect(fizz);
  }

  setParam(name: string, value: number): void {
    if (name === 'speed') this.speed = value; // takes effect from the next wave
  }

  protected onStart(): void {
    this.first = true;
    this.wander(this.bed.gain, 0.12, 0.35, 3, 9);
    this.wander(this.flutter.gain, 0.1, 1, 0.03, 0.12, { tau: 0.02 });
    this.loop(
      () => this.period,
      (t) => this.wave(t),
      0,
    );
  }

  private wave(t: number): void {
    const P = Math.min(14, Math.max(8, lerp(13, 8.5, this.speed) * rand(0.88, 1.12)));
    this.period = P;
    const crest = t + P * rand(0.35, 0.5);
    const peak = rand(0.55, 1);
    const nextTrough = rand(0.08, 0.18);
    const nextFloor = rand(280, 450);
    const g = this.swell.gain;
    const f = this.cutoff.frequency;
    const c = this.crash.gain;
    const tone = this.crashTone.frequency;
    const p = this.panner.pan;

    if (this.first) {
      this.first = false;
      for (const param of [g, f, c, tone, p]) param.cancelScheduledValues(t);
      g.setValueAtTime(this.trough, t);
      f.setValueAtTime(this.floor, t);
      c.setValueAtTime(0, t);
      p.setValueAtTime(0, t);
    }

    // Swell: slow build to the crest, then a long drain back to the trough.
    g.exponentialRampToValueAtTime(peak * 0.7, crest);
    g.exponentialRampToValueAtTime(nextTrough, t + P);
    f.exponentialRampToValueAtTime(rand(900, 1700), crest);
    f.exponentialRampToValueAtTime(nextFloor, t + P);
    const side = rand(-0.45, 0.45);
    p.linearRampToValueAtTime(side, crest);
    p.linearRampToValueAtTime(-side * 0.4, t + P);

    // Crash: bursts in at the crest, then recedes as the lowpass closes.
    const start = crest - rand(0.2, 0.5);
    const hit = crest + rand(0.1, 0.3);
    const end = crest + P * rand(0.45, 0.6);
    c.setValueAtTime(SILENT, start);
    c.exponentialRampToValueAtTime(peak * rand(0.7, 1), hit);
    tone.setValueAtTime(rand(2000, 3500), start);
    tone.exponentialRampToValueAtTime(rand(6000, 9500), hit);
    if (Math.random() < 0.3) {
      // A second, smaller break as the wave collapses.
      const again = crest + P * rand(0.16, 0.26);
      c.exponentialRampToValueAtTime(peak * 0.22, again);
      c.exponentialRampToValueAtTime(peak * rand(0.35, 0.6), again + rand(0.2, 0.45));
    }
    c.exponentialRampToValueAtTime(SILENT, end);
    c.setValueAtTime(0, end + 0.01);
    tone.exponentialRampToValueAtTime(rand(800, 1400), end);

    this.trough = nextTrough;
    this.floor = nextFloor;
  }
}

export const ocean: LayerDef = {
  id: 'ocean',
  name: 'Ocean',
  icon: 'M2 9c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  level: 0.5,
  param: { name: 'speed', label: 'Wave speed', default: 0.4 },
  create: (ctx, speed) => new Ocean(ctx, speed),
};
