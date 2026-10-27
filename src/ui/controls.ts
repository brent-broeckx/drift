import type { EngineParams } from '../audio/engine';
import type { MoodPreset } from '../audio/moods';

export type ParamKey = keyof EngineParams;

export interface ControlsHandlers {
  onTogglePlay(): void;
  onMood(id: string): void;
  onParam(key: ParamKey, value: number): void;
  onReseed(): void;
  onShare(): void;
}

interface SliderDef {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const SLIDERS: SliderDef[] = [
  { key: 'tempo', label: 'Tempo', min: 40, max: 120, step: 1, format: (v) => `${Math.round(v)} bpm` },
  { key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01, format: pct },
];

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Controls {
  private readonly playButton: HTMLButtonElement;
  private readonly moodButtons = new Map<string, HTMLButtonElement>();
  private readonly moodDescription: HTMLParagraphElement;
  private readonly inputs = new Map<ParamKey, { input: HTMLInputElement; output: HTMLOutputElement; def: SliderDef }>();
  private readonly seedLabel: HTMLElement;
  private readonly toast: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, moods: MoodPreset[], h: ControlsHandlers) {
    const header = el('header', 'brand');
    header.append(el('h1', '', 'Drift'), el('p', 'tagline', 'generative ambient · synthesized live'));

    const stage = el('section', 'stage');
    this.playButton = el('button', 'play');
    this.playButton.type = 'button';
    this.playButton.addEventListener('click', () => h.onTogglePlay());
    this.moodDescription = el('p', 'mood-description');
    stage.append(this.playButton, this.moodDescription);

    const panel = el('section', 'panel');
    panel.setAttribute('aria-label', 'Controls');

    const moodRow = el('div', 'moods');
    moodRow.setAttribute('role', 'radiogroup');
    moodRow.setAttribute('aria-label', 'Mood');
    for (const mood of moods) {
      const b = el('button', 'mood', mood.name);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.title = mood.description;
      b.addEventListener('click', () => h.onMood(mood.id));
      this.moodButtons.set(mood.id, b);
      moodRow.append(b);
    }

    const sliders = el('div', 'sliders');
    for (const def of SLIDERS) {
      const id = `slider-${def.key}`;
      const wrap = el('div', 'slider');
      const label = el('label', '', def.label);
      label.htmlFor = id;
      const output = el('output');
      output.htmlFor.add(id);
      const input = el('input');
      Object.assign(input, { type: 'range', id, min: String(def.min), max: String(def.max), step: String(def.step) });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        output.textContent = def.format(v);
        this.paintTrack(input);
        h.onParam(def.key, v);
      });
      const top = el('div', 'slider-top');
      top.append(label, output);
      wrap.append(top, input);
      sliders.append(wrap);
      this.inputs.set(def.key, { input, output, def });
    }

    const seedRow = el('div', 'seed-row');
    const seedInfo = el('div', 'seed');
    seedInfo.append(el('span', 'seed-label', 'seed'));
    this.seedLabel = el('code');
    seedInfo.append(this.seedLabel);
    const reseed = el('button', 'ghost', 'Reseed');
    reseed.type = 'button';
    reseed.title = 'New random seed, same mood (R)';
    reseed.addEventListener('click', () => h.onReseed());
    const share = el('button', 'ghost', 'Copy link');
    share.type = 'button';
    share.title = 'Copy a link that reproduces this sound';
    share.addEventListener('click', () => h.onShare());
    const actions = el('div', 'seed-actions');
    actions.append(reseed, share);
    seedRow.append(seedInfo, actions);

    panel.append(moodRow, sliders, seedRow);

    this.toast = el('div', 'toast');
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');

    root.append(header, stage, panel, this.toast);
    this.setPlaying(false);
  }

  setPlaying(playing: boolean, busy = false): void {
    this.playButton.innerHTML = playing ? STOP_ICON : PLAY_ICON;
    this.playButton.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    this.playButton.classList.toggle('is-playing', playing);
    this.playButton.disabled = busy;
    document.body.classList.toggle('playing', playing);
  }

  setMood(mood: MoodPreset): void {
    for (const [id, b] of this.moodButtons) {
      const active = id === mood.id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    }
    this.moodDescription.textContent = mood.description;

    const tempo = this.inputs.get('tempo');
    if (tempo) {
      tempo.input.min = String(mood.tempo.min);
      tempo.input.max = String(mood.tempo.max);
    }

    const { hues, saturation, lightness } = mood.palette;
    const root = document.documentElement.style;
    root.setProperty('--accent', `hsl(${hues[0]} ${saturation}% ${lightness}%)`);
    root.setProperty('--accent-2', `hsl(${hues[1] ?? hues[0]} ${saturation}% ${lightness}%)`);
    root.setProperty('--accent-soft', `hsl(${hues[0]} ${saturation}% ${lightness}% / 0.18)`);
  }

  setValues(params: EngineParams): void {
    for (const [key, { input, output, def }] of this.inputs) {
      input.value = String(params[key]);
      output.textContent = def.format(Number(input.value));
      this.paintTrack(input);
    }
  }

  setSeed(seed: string): void {
    this.seedLabel.textContent = seed;
  }

  flash(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 1800);
  }

  private paintTrack(input: HTMLInputElement): void {
    const min = Number(input.min);
    const max = Number(input.max);
    const fill = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${fill}%`);
  }
}
