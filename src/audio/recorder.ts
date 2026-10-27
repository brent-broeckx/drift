import * as Tone from 'tone';
import { encodeWav } from './wav';

export const RECORD_SECONDS = 30;

export function recordingSupported(): boolean {
  return Tone.Recorder.supported && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/**
 * Captures a Tone node (the master output, after the limiter) with Tone.Recorder.
 * The time limit runs on the audio clock via the context's worker-driven setTimeout,
 * so it stays accurate in background tabs.
 */
export class MasterRecorder {
  private recorder: Tone.Recorder | null = null;
  private source: Tone.ToneAudioNode | null = null;
  private limitId: number | null = null;
  private startedAt = 0;

  constructor(readonly maxSeconds = RECORD_SECONDS) {}

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  /** Seconds captured so far, measured on the Web Audio clock. */
  get elapsed(): number {
    return this.recorder ? Math.min(this.maxSeconds, Math.max(0, Tone.now() - this.startedAt)) : 0;
  }

  async start(source: Tone.ToneAudioNode, onLimit: () => void): Promise<void> {
    if (this.recorder) throw new Error('Already recording');
    const recorder = new Tone.Recorder();
    source.connect(recorder);
    try {
      await recorder.start();
    } catch (err) {
      source.disconnect(recorder);
      recorder.dispose();
      throw err;
    }
    this.recorder = recorder;
    this.source = source;
    this.startedAt = Tone.now();
    this.limitId = Tone.getContext().setTimeout(onLimit, this.maxSeconds);
  }

  /** Stops capturing and returns the encoded media (webm/ogg/mp4), or null if not recording. */
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) return null;
    this.recorder = null;
    if (this.limitId !== null) Tone.getContext().clearTimeout(this.limitId);
    this.limitId = null;
    try {
      return recorder.state === 'stopped' ? null : await recorder.stop();
    } finally {
      try {
        this.source?.disconnect(recorder);
      } catch {
        // Source may already be disposed.
      }
      this.source = null;
      recorder.dispose();
    }
  }
}

/** Decode the recorder's compressed output and re-encode it as 16-bit stereo WAV. */
export async function toWav(media: Blob, maxSeconds = RECORD_SECONDS): Promise<Blob> {
  if (media.size === 0) throw new Error('Nothing was captured');
  const audio = await Tone.getContext().decodeAudioData(await media.arrayBuffer());
  if (audio.length === 0) throw new Error('Nothing was captured');
  return encodeWav(audio, maxSeconds);
}
