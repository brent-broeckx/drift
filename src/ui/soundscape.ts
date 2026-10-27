import type { LayerDef } from '../audio/soundscape/layer';
import { matchingPreset, type Mix, type Preset } from '../audio/soundscape/soundscape';

export interface SoundscapeHandlers {
  onToggle(id: string, on: boolean): void;
  onLevel(id: string, level: number): void;
  onParam(id: string, value: number): void;
  onSoundscapeLevel(level: number): void;
  onMusicLevel(level: number): void;
  onPreset(id: string): void;
}

interface Row {
  def: LayerDef;
  item: HTMLLIElement;
  toggle: HTMLButtonElement;
  level: HTMLInputElement;
  param: HTMLInputElement | null;
  paramOutput: HTMLOutputElement | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const TUNE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(path: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sc-icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

function range(id: string, label: string): HTMLInputElement {
  const input = el('input');
  Object.assign(input, { type: 'range', id, min: '0', max: '1', step: '0.01' });
  input.setAttribute('aria-label', label);
  return input;
}

function paint(input: HTMLInputElement): void {
  input.style.setProperty('--fill', `${Number(input.value) * 100}%`);
}

function setRange(input: HTMLInputElement, v: number): void {
  input.value = String(v);
  paint(input);
}

/** Collapsible "Soundscape" section: presets, music/soundscape balance and one row per layer. */
export class SoundscapePanel {
  private readonly root: HTMLElement;
  private readonly header: HTMLButtonElement;
  private readonly summary: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly rows = new Map<string, Row>();
  private readonly music: { input: HTMLInputElement; output: HTMLOutputElement };
  private readonly soundscape: { input: HTMLInputElement; output: HTMLOutputElement };

  constructor(
    parent: HTMLElement,
    before: Element | null,
    layers: readonly LayerDef[],
    presets: readonly Preset[],
    private readonly h: SoundscapeHandlers,
  ) {
    this.root = el('section', 'soundscape');
    this.root.setAttribute('aria-label', 'Soundscape');

    this.header = el('button', 'sc-header');
    this.header.type = 'button';
    this.header.setAttribute('aria-expanded', 'false');
    this.header.setAttribute('aria-controls', 'sc-body');
    this.summary = el('span', 'sc-summary');
    const chevron = el('span', 'sc-chevron');
    chevron.innerHTML = CHEVRON;
    this.header.append(el('span', 'tools-label', 'Soundscape'), this.summary, chevron);
    this.header.addEventListener('click', () => this.setOpen(this.header.getAttribute('aria-expanded') !== 'true'));

    this.body = el('div', 'sc-body');
    this.body.id = 'sc-body';
    this.body.hidden = true;

    const presetRow = el('div', 'sc-presets');
    presetRow.setAttribute('role', 'group');
    presetRow.setAttribute('aria-label', 'Soundscape presets');
    for (const preset of presets) {
      const b = el('button', 'ghost sc-preset', preset.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => h.onPreset(preset.id));
      this.presetButtons.set(preset.id, b);
      presetRow.append(b);
    }

    const balance = el('div', 'sc-balance');
    this.music = this.balanceSlider(balance, 'sc-music', 'Music', (v) => h.onMusicLevel(v));
    this.soundscape = this.balanceSlider(balance, 'sc-level', 'Soundscape', (v) => h.onSoundscapeLevel(v));

    const list = el('ul', 'sc-layers');
    for (const def of layers) list.append(this.layerRow(def));

    this.body.append(presetRow, balance, list);
    this.root.append(this.header, this.body);
    parent.insertBefore(this.root, before);
  }

  setOpen(open: boolean): void {
    this.body.hidden = !open;
    this.header.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('open', open);
  }

  /** Reflect a mix in every control. */
  setMix(mix: Mix): void {
    for (const row of this.rows.values()) {
      const s = mix.layers[row.def.id];
      if (!s) continue;
      this.renderToggle(row, s.on);
      setRange(row.level, s.level);
      if (row.param && row.paramOutput) {
        setRange(row.param, s.param);
        row.paramOutput.textContent = pct(s.param);
      }
    }
    setRange(this.music.input, mix.music);
    this.music.output.textContent = pct(mix.music);
    setRange(this.soundscape.input, mix.soundscape);
    this.soundscape.output.textContent = pct(mix.soundscape);
    this.renderSummary(mix);
  }

  /** Update the collapsed summary and preset highlight after any change. */
  renderSummary(mix: Mix): void {
    const active = [...this.rows.values()].filter((r) => mix.layers[r.def.id]?.on).map((r) => r.def.name.toLowerCase());
    const preset = matchingPreset(mix.layers);
    this.summary.textContent = preset ? preset.name.toLowerCase() : active.length ? active.join(' · ') : 'off';
    this.root.classList.toggle('active', active.length > 0);
    for (const [id, b] of this.presetButtons) {
      const on = preset?.id === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  private balanceSlider(
    parent: HTMLElement,
    id: string,
    label: string,
    onInput: (v: number) => void,
  ): { input: HTMLInputElement; output: HTMLOutputElement } {
    const wrap = el('div', 'slider');
    const top = el('div', 'slider-top');
    const lab = el('label', '', label);
    lab.htmlFor = id;
    const output = el('output');
    output.htmlFor.add(id);
    top.append(lab, output);
    const input = range(id, `${label} level`);
    input.removeAttribute('aria-label');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      output.textContent = pct(v);
      paint(input);
      onInput(v);
    });
    wrap.append(top, input);
    parent.append(wrap);
    return { input, output };
  }

  private layerRow(def: LayerDef): HTMLLIElement {
    const item = el('li', 'sc-layer');
    const line = el('div', 'sc-row');

    const name = el('span', 'sc-name', def.name);
    name.id = `sc-name-${def.id}`;

    const toggle = el('button', 'sc-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-labelledby', name.id);

    const level = range(`sc-${def.id}`, `${def.name} level`);
    level.className = 'sc-level';

    line.append(icon(def.icon), name, toggle, level);

    let param: HTMLInputElement | null = null;
    let paramOutput: HTMLOutputElement | null = null;
    if (def.param) {
      const p = def.param;
      const gear = el('button', 'sc-gear');
      gear.type = 'button';
      gear.innerHTML = TUNE;
      gear.title = p.label;
      gear.setAttribute('aria-label', `${def.name} ${p.label.toLowerCase()}`);
      gear.setAttribute('aria-expanded', 'false');
      const extra = el('div', 'sc-extra');
      extra.id = `sc-extra-${def.id}`;
      extra.hidden = true;
      gear.setAttribute('aria-controls', extra.id);
      gear.addEventListener('click', () => {
        extra.hidden = !extra.hidden;
        gear.setAttribute('aria-expanded', String(!extra.hidden));
        gear.classList.toggle('active', !extra.hidden);
      });

      const pid = `sc-${def.id}-${p.name}`;
      const label = el('label', '', p.label);
      label.htmlFor = pid;
      const input = range(pid, '');
      input.removeAttribute('aria-label');
      const output = el('output');
      output.htmlFor.add(pid);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        output.textContent = pct(v);
        paint(input);
        this.h.onParam(def.id, v);
      });
      extra.append(label, input, output);
      line.append(gear);
      item.append(line, extra);
      param = input;
      paramOutput = output;
    } else {
      line.append(el('span', 'sc-gear-spacer'));
      item.append(line);
    }

    const row: Row = { def, item, toggle, level, param, paramOutput };
    toggle.addEventListener('click', () => {
      const on = toggle.getAttribute('aria-checked') !== 'true';
      this.renderToggle(row, on);
      this.h.onToggle(def.id, on);
    });
    level.addEventListener('input', () => {
      paint(level);
      this.h.onLevel(def.id, Number(level.value));
    });
    this.rows.set(def.id, row);
    return item;
  }

  private renderToggle(row: Row, on: boolean): void {
    row.toggle.setAttribute('aria-checked', String(on));
    row.item.classList.toggle('on', on);
  }
}
