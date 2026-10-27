import * as Tone from 'tone';
import { BaseLayer, lerp, poissonGap, rand, VoicePool, type LayerContext, type LayerDef } from './layer';

const GAIN = 2.6;

/**
 * Fire:
 * - a soft low rumble and a flickering mid "breath" of burning (both brown/pink noise),
 * - crackles: very short bandpassed white-noise bursts with random pitch, level and spacing, often
 *   in small clusters,
 * - pops: rarer, lower and longer, usually followed by a little shower of sparks,
 * - now and then a faint, wavering sap hiss.
 * A slowly wandering "activity" value makes the fire flare up and settle, so the crackle rate
 * and the flame level never sit still. Crackle density sets the average rate.
 */
class Fire extends BaseLayer {
  private density: number;
  private activity = 1;
  private readonly flame: Tone.Gain;
  private readonly breath: Tone.Gain;
  private readonly hiss: Tone.Gain;
  private readonly hissBand: Tone.Filter;
  private readonly crackles: VoicePool;

  constructor(ctx: LayerContext, density: number) {
    super(ctx, GAIN);
    this.density = density;
    const own = this.own;

    this.flame = own(new Tone.Gain(1)).connect(this.out);

    const rumbleGain = own(new Tone.Gain(0.2)).connect(this.flame);
    const rumble = own(new Tone.Filter({ type: 'lowpass', frequency: 180, Q: 0.6 })).connect(rumbleGain);
    ctx.noise('brown').connect(rumble);

    this.breath = own(new Tone.Gain(0.2)).connect(this.flame);
    const breathBand = own(new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 0.6 })).connect(this.breath);
    ctx.noise('pink').connect(breathBand);

    const white = ctx.noise('white');
    this.hiss = own(new Tone.Gain(0)).connect(this.out);
    this.hissBand = own(new Tone.Filter({ type: 'bandpass', frequency: 6000, Q: 4 })).connect(this.hiss);
    white.connect(this.hissBand);

    this.crackles = new VoicePool(10, white, this.out, 'bandpass', own);
  }

  setParam(name: string, value: number): void {
    if (name === 'density') this.density = value;
  }

  protected onStart(): void {
    this.loop(
      () => rand(2, 7),
      (t) => {
        this.activity = rand(0.35, 1.7) ** 1.2;
        this.flame.gain.setTargetAtTime(lerp(0.7, 1.2, Math.min(1, this.activity / 1.7)), t, rand(0.8, 2));
      },
      0,
    );
    // Flicker: quick random breaths of the flames.
    this.wander(this.breath.gain, 0.04, 0.4, 0.06, 0.35, { tau: 0.05 });

    this.loop(
      () => poissonGap(lerp(3, 30, this.density) * this.activity),
      (t) => {
        const count = Math.random() < 0.4 ? 2 + Math.floor(Math.random() * 4) : 1;
        let at = t;
        for (let k = 0; k < count; k++) {
          this.crackle(at, 0.45 + 0.55 * Math.random());
          at += rand(0.006, 0.05);
        }
      },
    );
    this.loop(
      () => poissonGap(lerp(0.08, 0.5, this.density) * this.activity),
      (t) => this.pop(t),
      rand(1, 5),
    );
    this.loop(
      () => rand(12, 40),
      (t) => this.sap(t),
      rand(6, 20),
    );
  }

  private crackle(time: number, size: number): void {
    const freq = rand(1500, 8000);
    const q = rand(0.7, 2.5);
    this.crackles.play(time, {
      freq,
      q,
      // Narrow and low bands pass less noise; compensate so all crackles cut through.
      peak: size * (0.12 + 0.6 * Math.random() ** 2) * Math.min(2.2, Math.sqrt((q * 3000) / freq)),
      attack: 0.0004,
      decay: rand(0.002, 0.014),
      pan: rand(-0.6, 0.6),
    });
  }

  /** A louder, lower knock with a short spray of sparks after it. */
  private pop(time: number): void {
    const pan = rand(-0.5, 0.5);
    const freq = rand(500, 1600);
    this.crackles.play(time, {
      freq,
      q: rand(1.5, 4),
      peak: rand(0.6, 1) * Math.sqrt(3000 / freq),
      attack: 0.0006,
      decay: rand(0.03, 0.08),
      pan,
    });
    let at = time + rand(0.02, 0.06);
    for (let k = 0, n = 2 + Math.floor(Math.random() * 6); k < n; k++) {
      this.crackle(at, rand(0.3, 0.7));
      at += rand(0.01, 0.07);
    }
  }

  /** Steam escaping from a log: a faint, wavering hiss for a second or three. */
  private sap(time: number): void {
    const dur = rand(1, 3);
    const g = this.hiss.gain;
    const f = this.hissBand.frequency;
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(rand(0.04, 0.09), time + dur * 0.3);
    g.linearRampToValueAtTime(rand(0.02, 0.06), time + dur * 0.7);
    g.linearRampToValueAtTime(0, time + dur);
    f.setValueAtTime(rand(4500, 7500), time);
    f.linearRampToValueAtTime(rand(4500, 7500), time + dur);
  }
}

export const fire: LayerDef = {
  id: 'fire',
  name: 'Fire',
  icon: 'M12 21c-3.6 0-6-2.5-6-5.8 0-3.4 2.6-5.2 3.4-8.2 1 1.4 1.6 2.8 1.6 4 1.2-.8 2.4-3.4 2-7 2.8 2 5 5.6 5 9.6 0 4.6-2.6 7.4-6 7.4z',
  level: 0.5,
  param: { name: 'density', label: 'Crackle', default: 0.5 },
  create: (ctx, density) => new Fire(ctx, density),
};
