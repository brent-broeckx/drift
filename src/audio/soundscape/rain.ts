import * as Tone from 'tone';
import { BaseLayer, lerp, poissonGap, rand, VoicePool, type LayerContext, type LayerDef } from './layer';

/** Normalization: equal slider levels across layers should sound roughly equally loud. */
const GAIN = 1.8;

/**
 * Rain, from far to near:
 * - a bright pink-noise hiss (highpass + wide drifting bandpass) plus a fine white-noise spray,
 * - a soft low body that only appears in heavy rain,
 * - dense tiny ticks (patter on surfaces) and sparser resonant "plip" drops that chirp upward,
 * - now and then a gutter drip: a run of same-pitched drops at a steady-ish pace.
 * A slow random "weather" value makes the whole shower swell and ease, so it never sits still.
 * Intensity scales hiss, body and drop density.
 */
class Rain extends BaseLayer {
  private intensity: number;
  private weather = 1;
  private readonly hiss: Tone.Gain;
  private readonly gust: Tone.Gain;
  private readonly swell: Tone.Gain;
  private readonly spray: Tone.Gain;
  private readonly body: Tone.Gain;
  private readonly highpass: Tone.Filter;
  private readonly band: Tone.Filter;
  private readonly ticks: VoicePool;
  private readonly drops: VoicePool;
  private drip = { until: 0, freq: 2000, pan: 0, gap: 1 };

  constructor(ctx: LayerContext, intensity: number) {
    super(ctx, GAIN);
    this.intensity = intensity;
    const own = this.own;
    const pink = ctx.noise('pink');
    const white = ctx.noise('white');

    // Everything except the close drops rides on the weather swell.
    this.swell = own(new Tone.Gain(1)).connect(this.out);

    this.hiss = own(new Tone.Gain(0)).connect(this.swell);
    // Shorter-term surges in the sheet of rain, on top of the slow weather swell.
    this.gust = own(new Tone.Gain(1)).connect(this.hiss);
    this.band = own(new Tone.Filter({ type: 'bandpass', frequency: 3200, Q: 0.45 })).connect(this.gust);
    this.highpass = own(new Tone.Filter({ type: 'highpass', frequency: 900, Q: 0.5 })).connect(this.band);
    pink.connect(this.highpass);

    this.spray = own(new Tone.Gain(0)).connect(this.swell);
    const sprayBand = own(new Tone.Filter({ type: 'highpass', frequency: 7000, Q: 0.4 })).connect(this.spray);
    white.connect(sprayBand);

    this.body = own(new Tone.Gain(0)).connect(this.swell);
    const low = own(new Tone.Filter({ type: 'lowpass', frequency: 500, Q: 0.4 })).connect(this.body);
    pink.connect(low);

    this.ticks = new VoicePool(10, white, this.swell, 'bandpass', own);
    this.drops = new VoicePool(5, white, this.out, 'bandpass', own);
    this.applyIntensity(0.01);
  }

  setParam(name: string, value: number): void {
    if (name !== 'intensity') return;
    this.intensity = value;
    this.applyIntensity(1);
  }

  protected onStart(): void {
    const i = () => this.intensity;
    // Weather: the shower eases and builds every few seconds.
    this.loop(
      () => rand(3, 9),
      (t) => {
        this.weather = rand(0.35, 1.6);
        this.swell.gain.setTargetAtTime(Math.sqrt(this.weather), t, rand(0.8, 2.5));
      },
      0,
    );
    this.wander(this.gust.gain, 0.45, 1.15, 0.5, 2.2);
    this.wander(this.band.detune, -700, 700, 1.5, 5);
    this.wander(this.band.Q, 0.25, 0.7, 3, 8);

    this.loop(
      () => poissonGap(lerp(12, 140, Math.pow(i(), 1.2)) * this.weather),
      (t) => this.tick(t),
    );
    this.loop(
      () => poissonGap(lerp(1.2, 7, i()) * this.weather),
      (t) => this.drop(t, rand(1400, 4200), rand(-0.85, 0.85), rand(0.35, 1)),
    );
    // Gutter drips come and go in runs.
    this.loop(
      () => this.drip.gap * rand(0.85, 1.2),
      (t) => {
        if (t > this.drip.until) {
          if (Math.random() < 0.08) {
            this.drip = { until: t + rand(12, 40), freq: rand(1500, 3200), pan: rand(-0.7, 0.7), gap: rand(0.45, 1.6) };
          }
          return;
        }
        this.drop(t, this.drip.freq * rand(0.97, 1.03), this.drip.pan, rand(0.6, 1), true);
      },
      rand(3, 10),
    );
  }

  private applyIntensity(ramp: number): void {
    const i = this.intensity;
    this.hiss.gain.rampTo(lerp(0.25, 1, i), ramp);
    this.spray.gain.rampTo(lerp(0.02, 0.1, i), ramp);
    this.body.gain.rampTo(lerp(0.05, 0.5, i * i), ramp);
    this.highpass.frequency.rampTo(lerp(1200, 400, i), ramp);
  }

  /** A tiny, bright tick: one drop hitting a leaf or the ground. */
  private tick(time: number): void {
    const freq = rand(2500, 9000);
    this.ticks.play(time, {
      freq,
      q: rand(0.8, 2.5),
      peak: (0.04 + 0.22 * Math.random() ** 3) * Math.sqrt(9000 / freq),
      attack: 0.0006,
      decay: rand(0.002, 0.007),
      pan: rand(-0.9, 0.9),
    });
  }

  /** A close, resonant drop: a narrow band that chirps upward as the bubble rings. */
  private drop(time: number, freq: number, pan: number, size: number, drip = false): void {
    const voice = this.drops.take(time);
    if (!voice) return;
    const decay = rand(0.025, 0.06);
    voice.trigger(time, {
      freq,
      q: rand(10, 22),
      // Narrow bands pass little noise energy, so these need a lot of gain.
      peak: size * (drip ? 2.4 : 1.6) * Math.sqrt(3000 / freq),
      attack: 0.001,
      decay,
      pan,
    });
    voice.filter.frequency.exponentialRampToValueAtTime(freq * rand(1.25, 1.8), time + decay);
  }
}

export const rain: LayerDef = {
  id: 'rain',
  name: 'Rain',
  icon: 'M6.5 14.5h11a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 7.2 8.6a3 3 0 0 0-.7 5.9zM8 17.5 7 20M12 17.5 11 20M16 17.5 15 20',
  level: 0.5,
  param: { name: 'intensity', label: 'Intensity', default: 0.5 },
  create: (ctx, intensity) => new Rain(ctx, intensity),
};
