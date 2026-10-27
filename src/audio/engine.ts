import * as Tone from 'tone';
import { Generator, type NoteEvent } from './generator';
import type { LeadTimbre, MoodPreset, PadTimbre } from './moods';

export interface EngineParams {
  /** BPM */
  tempo: number;
  /** 0..1 */
  density: number;
  /** 0..1 — mapped exponentially to a low-pass cutoff */
  brightness: number;
  /** 0..1 — reverb wet */
  reverb: number;
  /** 0..1 */
  randomness: number;
  /** 0..1 — master volume */
  volume: number;
}

/** Shared effects chain: bus (brightness filter) -> reverb -> master gain -> limiter -> out. */
interface Graph {
  bus: Tone.Filter;
  reverb: Tone.Reverb;
  master: Tone.Gain;
  limiter: Tone.Limiter;
  analyser: AnalyserNode;
}

/** Per-mood instruments; rebuilt when the mood changes. */
interface Voices {
  pad: Tone.PolySynth;
  padFilter: Tone.Filter;
  padLfo: Tone.LFO;
  lead: Tone.PolySynth;
  leadDelay: Tone.FeedbackDelay;
  bass: Tone.Synth;
}

const FADE_IN = 2;
const FADE_OUT = 0.6;

export const brightnessToHz = (b: number) => 220 * Math.pow(60, b); // 220 Hz .. 13.2 kHz
/** Perceptual curve plus make-up gain; the limiter catches any peaks. */
const volumeToGain = (v: number) => v * v * 4;
const reverbToWet = (r: number) => r * 0.95;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function oscillatorOptions(type: string, spread: number) {
  return (type.startsWith('fat') ? { type, count: 3, spread } : { type }) as Tone.OmniOscillatorOptions;
}

function makePad(t: PadTimbre): Tone.PolySynth {
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: oscillatorOptions(t.oscillator, t.spread),
    envelope: { attack: t.attack, decay: 1.5, sustain: 0.8, release: t.release },
    volume: t.volume,
  });
  pad.maxPolyphony = 16;
  return pad;
}

function makeLead(t: LeadTimbre): Tone.PolySynth {
  const envelope = { attack: t.attack, decay: t.decay, sustain: t.sustain, release: t.release };
  const oscillator = oscillatorOptions(t.oscillator, 12);
  let lead: Tone.PolySynth;
  if (t.kind === 'fm') {
    lead = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: t.harmonicity ?? 3,
      modulationIndex: t.modulationIndex ?? 4,
      oscillator,
      envelope,
      modulationEnvelope: { attack: t.attack, decay: t.decay * 0.8, sustain: 0, release: t.release },
      volume: t.volume,
    }) as unknown as Tone.PolySynth;
  } else if (t.kind === 'am') {
    lead = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: t.harmonicity ?? 2,
      oscillator,
      envelope,
      volume: t.volume,
    }) as unknown as Tone.PolySynth;
  } else {
    lead = new Tone.PolySynth(Tone.Synth, { oscillator, envelope, volume: t.volume });
  }
  lead.maxPolyphony = 12;
  return lead;
}

/**
 * Owns the Tone.js transport, instruments and effects.
 * Nodes only exist while playing; `stop()` fades out and disposes everything.
 */
export class AudioEngine {
  /** Called (on the animation frame closest to the audible time) for every note played. */
  onNote: ((e: NoteEvent) => void) | null = null;

  private graph: Graph | null = null;
  private voices: Voices | null = null;
  private retired = new Map<Voices, ReturnType<typeof setTimeout>>();
  private generator: Generator | null = null;
  private loopId: number | null = null;
  private runId = 0;
  private stopping: Promise<void> | null = null;

  constructor(
    private mood: MoodPreset,
    private seed: string,
    private params: EngineParams,
  ) {}

  get isPlaying(): boolean {
    return this.graph !== null;
  }

  /** Native AnalyserNode tapped after the limiter, or null when stopped. */
  get analyser(): AnalyserNode | null {
    return this.graph?.analyser ?? null;
  }

  /** Must be called from a user gesture (click/keypress) the first time, for autoplay policy. */
  async start(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.graph) return;
    const id = ++this.runId;

    await Tone.start();
    const graph = await this.createGraph();
    if (id !== this.runId) {
      // stop() was requested while we were building.
      this.disposeGraph(graph);
      return;
    }

    this.graph = graph;
    this.voices = this.createVoices(this.mood, graph.bus);
    this.generator = new Generator(this.mood, this.seed);

    const transport = Tone.getTransport();
    transport.bpm.value = this.params.tempo;
    transport.position = 0;
    this.loopId = transport.scheduleRepeat((time) => this.tick(time), '8n', 0);
    transport.start('+0.05');
    graph.master.gain.rampTo(volumeToGain(this.params.volume), FADE_IN);
  }

  async stop(): Promise<void> {
    this.runId++;
    const graph = this.graph;
    if (!graph) return this.stopping ?? undefined;
    const voices = this.voices;
    this.graph = null;
    this.voices = null;
    this.generator = null;

    this.stopping = (async () => {
      const now = Tone.now();
      graph.master.gain.cancelScheduledValues(now);
      graph.master.gain.setValueAtTime(graph.master.gain.value, now);
      graph.master.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      await sleep(FADE_OUT * 1000 + 100);

      const transport = Tone.getTransport();
      transport.stop();
      if (this.loopId !== null) transport.clear(this.loopId);
      this.loopId = null;
      transport.cancel(0);
      Tone.getDraw().cancel(0);

      if (voices) this.disposeVoices(voices);
      for (const [v, timer] of this.retired) {
        clearTimeout(timer);
        this.disposeVoices(v);
      }
      this.retired.clear();
      this.disposeGraph(graph);
    })();

    await this.stopping;
    this.stopping = null;
  }

  setParams(p: Partial<EngineParams>): void {
    Object.assign(this.params, p);
    const g = this.graph;
    if (!g) return;
    if (p.tempo !== undefined) Tone.getTransport().bpm.rampTo(p.tempo, 1.5);
    if (p.brightness !== undefined) g.bus.frequency.rampTo(brightnessToHz(p.brightness), 0.25);
    if (p.reverb !== undefined) g.reverb.wet.rampTo(reverbToWet(p.reverb), 0.25);
    if (p.volume !== undefined) g.master.gain.rampTo(volumeToGain(p.volume), 0.1);
  }

  /** Switch mood and/or seed. While playing, the music restarts its sequence from the new seed. */
  configure(mood: MoodPreset, seed: string): void {
    const moodChanged = mood !== this.mood;
    this.mood = mood;
    this.seed = seed;
    const g = this.graph;
    if (!g || !this.voices) return;

    if (moodChanged) {
      g.reverb.decay = mood.reverb.decay;
      this.retire(this.voices);
      this.voices = this.createVoices(mood, g.bus);
    } else {
      this.voices.pad.releaseAll();
      this.voices.bass.triggerRelease();
    }
    this.generator = new Generator(mood, seed);
  }

  private tick(time: number): void {
    const v = this.voices;
    const gen = this.generator;
    if (!v || !gen) return;

    const stepSec = Tone.Time('8n').toSeconds();
    for (const e of gen.next(this.params)) {
      const at = time + e.offset * stepSec;
      const dur = Math.max(0.05, e.steps * stepSec);
      const freq = Tone.Frequency(e.midi, 'midi').toFrequency();
      if (e.voice === 'bass') v.bass.triggerAttackRelease(freq, dur, at, e.velocity);
      else v[e.voice].triggerAttackRelease(freq, dur, at, e.velocity);
      Tone.getDraw().schedule(() => this.onNote?.(e), at);
    }
  }

  private async createGraph(): Promise<Graph> {
    const limiter = new Tone.Limiter(-1).toDestination();
    const master = new Tone.Gain(0).connect(limiter);
    const reverb = new Tone.Reverb({
      decay: this.mood.reverb.decay,
      preDelay: 0.04,
      wet: reverbToWet(this.params.reverb),
    }).connect(master);
    const bus = new Tone.Filter({
      type: 'lowpass',
      frequency: brightnessToHz(this.params.brightness),
      rolloff: -12,
      Q: 0.3,
    }).connect(reverb);

    const analyser = Tone.getContext().createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    Tone.connect(limiter, analyser);

    await reverb.ready;
    return { bus, reverb, master, limiter, analyser };
  }

  private createVoices(mood: MoodPreset, bus: Tone.Filter): Voices {
    const t = mood.timbre;

    const padFilter = new Tone.Filter({ type: 'lowpass', frequency: 1200, Q: 0.6, rolloff: -24 }).connect(bus);
    const padLfo = new Tone.LFO({ frequency: 0.031, min: 450, max: 2600 }).connect(padFilter.frequency).start();
    const pad = makePad(t.pad).connect(padFilter);

    const leadDelay = new Tone.FeedbackDelay({
      maxDelay: 4,
      delayTime: t.delay.time,
      feedback: t.delay.feedback,
      wet: t.delay.wet,
    }).connect(bus);
    const lead = makeLead(t.lead).connect(leadDelay);

    const bass = new Tone.Synth({
      oscillator: oscillatorOptions(t.bass.oscillator, 0),
      envelope: { attack: 1.5, decay: 1, sustain: 0.8, release: 3 },
      volume: t.bass.volume,
    }).connect(bus);

    return { pad, padFilter, padLfo, lead, leadDelay, bass };
  }

  /** Let old voices ring out, then dispose them. */
  private retire(v: Voices): void {
    v.pad.releaseAll();
    v.lead.releaseAll();
    v.bass.triggerRelease();
    const timer = setTimeout(() => {
      this.retired.delete(v);
      this.disposeVoices(v);
    }, 10_000);
    this.retired.set(v, timer);
  }

  private disposeVoices(v: Voices): void {
    v.pad.dispose();
    v.lead.dispose();
    v.bass.dispose();
    v.padLfo.dispose();
    v.padFilter.dispose();
    v.leadDelay.dispose();
  }

  private disposeGraph(g: Graph): void {
    g.bus.dispose();
    g.reverb.dispose();
    g.master.dispose();
    g.limiter.dispose();
    g.analyser.disconnect();
  }
}
