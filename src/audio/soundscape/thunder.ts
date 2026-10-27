import * as Tone from 'tone';
import { BaseLayer, rand, type LayerContext, type LayerDef } from './layer';

/** Kept deliberately low: thunder is a distant rumble, never a startling crack. */
const GAIN = 1.7;

/**
 * Thunder: rare (20–90 s apart), randomized distant rumbles. Brown noise through a lowpass that
 * sweeps down over the event, with a soft attack, a few rolling swells, an irregular rumbling
 * flutter and a long tail.
 */
class Thunder extends BaseLayer {
  private readonly env: Tone.Gain;
  private readonly lowpass: Tone.Filter;
  private readonly panner: Tone.Panner;
  private readonly flutter: Tone.Gain;

  constructor(ctx: LayerContext) {
    super(ctx, GAIN);
    const own = this.own;
    this.panner = own(new Tone.Panner({ pan: 0, channelCount: 2 }));
    this.panner.connect(this.out);
    this.flutter = own(new Tone.Gain(1)).connect(this.panner);
    this.env = own(new Tone.Gain(0)).connect(this.flutter);
    this.lowpass = own(new Tone.Filter({ type: 'lowpass', frequency: 300, Q: 0.4, rolloff: -24 })).connect(this.env);
    ctx.noise('brown').connect(this.lowpass);
    const grit = own(new Tone.Gain(0.25)).connect(this.lowpass);
    ctx.noise('pink').connect(grit);
  }

  protected onStart(): void {
    this.wander(this.flutter.gain, 0.3, 1, 0.07, 0.35, { tau: 0.05 });
    this.loop(
      () => rand(20, 90),
      (t) => this.strike(t),
      rand(8, 25),
    );
  }

  private strike(t: number): void {
    const g = this.env.gain;
    const f = this.lowpass.frequency;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    f.setValueAtTime(rand(1200, 2200), t);
    this.panner.pan.setValueAtTime(rand(-0.6, 0.6), t);

    // Soft onset, then a few rolling swells of decreasing strength.
    let level = rand(0.55, 1);
    let at = t + rand(0.35, 1.4);
    g.linearRampToValueAtTime(level, at);
    const rolls = 1 + Math.floor(Math.random() * 3);
    for (let r = 0; r < rolls; r++) {
      const dip = at + rand(0.4, 1.2);
      g.linearRampToValueAtTime(level * rand(0.35, 0.6), dip);
      level *= rand(0.6, 0.95);
      at = dip + rand(0.3, 0.9);
      g.linearRampToValueAtTime(level, at);
    }
    const end = Math.max(t + rand(6, 11), at + 3);
    g.exponentialRampToValueAtTime(0.0001, end);
    g.setValueAtTime(0, end + 0.01);
    f.exponentialRampToValueAtTime(rand(60, 110), end);
  }
}

export const thunder: LayerDef = {
  id: 'thunder',
  name: 'Thunder',
  icon: 'M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z',
  level: 0.5,
  create: (ctx) => new Thunder(ctx),
};
