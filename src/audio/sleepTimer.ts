import * as Tone from 'tone';

export const SLEEP_OPTIONS_MIN = [15, 30, 45, 60, 90] as const;
export const FADE_SECONDS = 60;
const CANCEL_RAMP = 2;
const CURVE_STEP = 0.25;
const CHECK_INTERVAL_MS = 1000;

export interface SleepTimerHooks {
  /** The dedicated fade gain on the master chain, or null when nothing is playing. */
  getFadeGain(): Tone.Param<'gain'> | null;
  /** Stop playback; resolves when the transport is stopped and voices are disposed. */
  onExpire(): Promise<void>;
}

/** Perceptually smooth fade level for the fraction of the fade still remaining (1 -> 0). */
const fadeLevel = (remaining: number) => Math.pow(Math.max(0, Math.min(1, remaining)), 2);

/**
 * Sleep timer with a fade-out over the final minute.
 *
 * The end is stored as a wall-clock timestamp, so the remaining time is always recomputed rather
 * than counted. While audio runs, the fade is a sample-accurate automation curve and the expiry is
 * scheduled on the Web Audio clock (Tone's worker-driven context timeout), both unaffected by
 * background-tab throttling. A coarse interval and `visibilitychange` act as a fallback for when
 * the AudioContext is suspended.
 */
export class SleepTimer {
  /** Called roughly once per second (and on any state change) while active. */
  onChange: (() => void) | null = null;

  private endAt: number | null = null;
  private expireId: number | null = null;
  private checkId: ReturnType<typeof setInterval> | null = null;
  private fadeParam: Tone.Param<'gain'> | null = null;
  /** Audio-clock time the current schedule expects to end, or null if not scheduled on the audio clock. */
  private audioEnd: number | null = null;

  constructor(private readonly hooks: SleepTimerHooks) {}

  get active(): boolean {
    return this.endAt !== null;
  }

  get remainingMs(): number {
    return this.endAt === null ? 0 : Math.max(0, this.endAt - Date.now());
  }

  get fading(): boolean {
    return this.active && this.remainingMs <= FADE_SECONDS * 1000;
  }

  start(minutes: number): void {
    this.cancel();
    this.endAt = Date.now() + minutes * 60_000;
    this.checkId = setInterval(this.check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.check);
    Tone.getContext().on('statechange', this.sync);
    this.sync();
  }

  /** Cancel the timer. Mid-fade, the volume ramps smoothly back up. */
  cancel(): void {
    if (this.endAt === null) return;
    const param = this.hooks.getFadeGain();
    if (param) {
      const now = Tone.now();
      param.cancelAndHoldAtTime(now);
      param.linearRampToValueAtTime(1, now + CANCEL_RAMP);
    }
    this.teardown();
    this.onChange?.();
  }

  /**
   * (Re)schedule the fade curve and expiry on the audio clock. Call after playback starts,
   * since each start builds a fresh fade gain.
   */
  readonly sync = (): void => {
    if (this.endAt === null) return;
    const ctx = Tone.getContext();
    if (this.expireId !== null) ctx.clearTimeout(this.expireId);
    this.expireId = null;

    const remaining = this.remainingMs / 1000;
    if (remaining <= 0) {
      void this.expire();
      return;
    }
    if (ctx.state === 'running') {
      this.expireId = ctx.setTimeout(() => void this.expire(), remaining);
      this.audioEnd = Tone.now() + remaining;
    } else {
      this.audioEnd = null;
    }

    const param = this.hooks.getFadeGain();
    this.fadeParam = param;
    if (param) {
      const now = Tone.now();
      const fadeStart = remaining - FADE_SECONDS;
      const from = fadeStart > 0 ? now + fadeStart : now;
      const duration = Math.min(remaining, FADE_SECONDS);
      const steps = Math.max(2, Math.ceil(duration / CURVE_STEP) + 1);
      const curve = Array.from({ length: steps }, (_, i) =>
        fadeLevel((duration * (1 - i / (steps - 1))) / FADE_SECONDS),
      );
      param.cancelScheduledValues(now);
      param.setValueAtTime(fadeStart > 0 ? 1 : curve[0], now);
      param.setValueCurveAtTime(curve, from, duration);
    }
    this.onChange?.();
  };

  private readonly check = (): void => {
    if (this.endAt === null) return;
    if (this.remainingMs <= 0) void this.expire();
    else if (this.hooks.getFadeGain() !== this.fadeParam || this.drifted()) this.sync();
    else this.onChange?.();
  };

  /** True if the audio-clock schedule no longer matches the stored end timestamp (e.g. after device sleep). */
  private drifted(): boolean {
    if (this.audioEnd === null) return Tone.getContext().state === 'running';
    return Math.abs(this.audioEnd - Tone.now() - this.remainingMs / 1000) > 1;
  }

  private async expire(): Promise<void> {
    if (this.endAt === null) return;
    this.teardown();
    this.onChange?.();
    try {
      await this.hooks.onExpire();
    } finally {
      // Normally the graph is gone after stopping; if one remains, make sure it is audible again.
      const param = this.hooks.getFadeGain();
      if (param) {
        param.cancelScheduledValues(0);
        param.setValueAtTime(1, Tone.now());
      }
    }
  }

  private teardown(): void {
    const ctx = Tone.getContext();
    if (this.expireId !== null) ctx.clearTimeout(this.expireId);
    if (this.checkId !== null) clearInterval(this.checkId);
    document.removeEventListener('visibilitychange', this.check);
    ctx.off('statechange', this.sync);
    this.expireId = null;
    this.checkId = null;
    this.fadeParam = null;
    this.audioEnd = null;
    this.endAt = null;
  }
}
