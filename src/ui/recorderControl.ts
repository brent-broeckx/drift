import type * as Tone from 'tone';
import { MasterRecorder, RECORD_SECONDS, recordingSupported, toWav } from '../audio/recorder';
import { formatClock } from './tools';

export interface RecorderControlDeps {
  /** Start playback if needed; resolves true once audio is running. */
  ensurePlaying(): Promise<boolean>;
  /** Post-limiter master output, or null when stopped. */
  getOutput(): Tone.ToneAudioNode | null;
  getSeed(): string;
}

type Phase = 'idle' | 'starting' | 'recording' | 'encoding';

const pad2 = (n: number) => String(n).padStart(2, '0');
const timestamp = (d: Date) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
  `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** "Record 30s" button with progress bar, early stop and WAV download. */
export class RecorderControl {
  private readonly recorder = new MasterRecorder(RECORD_SECONDS);
  private readonly button: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly progress: HTMLDivElement;
  private readonly bar: HTMLSpanElement;
  private readonly time: HTMLSpanElement;
  private readonly message: HTMLSpanElement;
  private phase: Phase = 'idle';
  private stopRequested = false;
  private saving: Promise<void> | null = null;
  private filename = '';
  private frame = 0;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    root: HTMLElement,
    private readonly deps: RecorderControlDeps,
  ) {
    const wrap = document.createElement('div');
    wrap.className = 'tool tool-record';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ghost tool-btn record-btn';
    this.button.title = `Record ${RECORD_SECONDS} seconds of the master output to a WAV file`;
    this.button.addEventListener('click', () => void this.record());

    this.progress = document.createElement('div');
    this.progress.className = 'rec-progress';
    this.progress.setAttribute('role', 'progressbar');
    this.progress.setAttribute('aria-label', 'Recording progress');
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', String(RECORD_SECONDS));
    const track = document.createElement('span');
    track.className = 'rec-track';
    this.bar = document.createElement('span');
    this.bar.className = 'rec-bar';
    track.append(this.bar);
    this.time = document.createElement('span');
    this.time.className = 'rec-time';
    this.progress.append(track, this.time);

    this.stopButton = document.createElement('button');
    this.stopButton.type = 'button';
    this.stopButton.className = 'ghost tool-btn';
    this.stopButton.textContent = 'Stop';
    this.stopButton.title = 'Stop early and save what was captured';
    this.stopButton.addEventListener('click', () => void this.finish());

    this.message = document.createElement('span');
    this.message.className = 'tool-msg';
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');

    wrap.append(this.button, this.progress, this.stopButton, this.message);
    root.append(wrap);
    this.render();
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  async record(): Promise<void> {
    if (this.phase !== 'idle') return;
    this.say('');
    if (!recordingSupported()) {
      this.say('Recording isn’t supported in this browser', true);
      return;
    }
    this.phase = 'starting';
    this.stopRequested = false;
    this.render();
    try {
      const playing = await this.deps.ensurePlaying();
      const output = this.deps.getOutput();
      if (!playing || !output) throw new Error('Audio is not running');
      this.filename = `drift-${this.deps.getSeed()}-${timestamp(new Date())}.wav`;
      await this.recorder.start(output, () => void this.finish());
    } catch (err) {
      console.error(err);
      this.phase = 'idle';
      this.render();
      this.say('Could not start recording', true);
      return;
    }
    this.phase = 'recording';
    this.render();
    this.loop();
    if (this.stopRequested) await this.finish();
  }

  /** Stop (early or at the limit) and save whatever was captured. Safe to call at any time. */
  finish(): Promise<void> {
    if (this.phase === 'starting') {
      this.stopRequested = true;
      return Promise.resolve();
    }
    if (this.phase !== 'recording') return this.saving ?? Promise.resolve();

    this.phase = 'encoding';
    cancelAnimationFrame(this.frame);
    this.render();
    this.saving = (async () => {
      try {
        const media = await this.recorder.stop();
        if (!media) throw new Error('Nothing was captured');
        download(await toWav(media, this.recorder.maxSeconds), this.filename);
        this.say('Saved WAV');
      } catch (err) {
        console.error(err);
        this.say(err instanceof Error && err.message === 'Nothing was captured' ? 'Nothing was captured' : 'Recording failed', true);
      } finally {
        this.phase = 'idle';
        this.saving = null;
        this.render();
      }
    })();
    return this.saving;
  }

  private loop = (): void => {
    if (this.phase !== 'recording') return;
    this.renderProgress();
    this.frame = requestAnimationFrame(this.loop);
  };

  private renderProgress(): void {
    const elapsed = this.recorder.elapsed;
    this.bar.style.transform = `scaleX(${elapsed / RECORD_SECONDS})`;
    this.time.textContent = formatClock(RECORD_SECONDS - elapsed);
    this.progress.setAttribute('aria-valuenow', String(Math.floor(elapsed)));
  }

  private render(): void {
    const recording = this.phase === 'recording';
    const labels: Record<Phase, string> = {
      idle: `● Record ${RECORD_SECONDS}s`,
      starting: '● Starting…',
      recording: '● Recording',
      encoding: 'Encoding…',
    };
    this.button.textContent = labels[this.phase];
    this.button.disabled = this.phase !== 'idle';
    this.button.classList.toggle('is-recording', recording);
    this.progress.hidden = !recording;
    this.stopButton.hidden = !recording;
    if (recording) this.renderProgress();
  }

  private say(text: string, error = false): void {
    clearTimeout(this.messageTimer);
    this.message.textContent = text;
    this.message.classList.toggle('error', error);
    if (text) this.messageTimer = setTimeout(() => (this.message.textContent = ''), error ? 6000 : 3000);
  }
}
