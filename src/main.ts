import './style.css';
import { AudioEngine, type EngineParams } from './audio/engine';
import { randomSeed } from './audio/generator';
import { getMood, MOODS, type MoodPreset } from './audio/moods';
import { Controls, type ParamKey } from './ui/controls';
import { Visualizer } from './ui/visualizer';
import { SleepTimer } from './audio/sleepTimer';
import { RecorderControl } from './ui/recorderControl';
import { SleepTimerControl } from './ui/sleepTimerControl';
import { createToolsRow } from './ui/tools';
import {
  LAYERS,
  PRESETS,
  Soundscape,
  cloneMix,
  defaultMix,
  loadMix,
  mixFromHash,
  mixToHash,
  presetLayers,
  saveMix,
  type Mix,
} from './audio/soundscape/soundscape';
import { SoundscapePanel } from './ui/soundscape';

/* ---------------- state & URL hash ---------------- */

interface AppState {
  mood: MoodPreset;
  seed: string;
  params: EngineParams;
  /** Soundscape layers plus the music/soundscape balance. */
  mix: Mix;
}

/** Params stored in the shareable hash (volume is a personal preference, so it's left out). */
const HASH_PARAMS: ParamKey[] = ['tempo', 'density', 'brightness', 'reverb', 'randomness'];
const SEED_PATTERN = /^[a-z0-9-]{1,32}$/i;
const DEFAULT_VOLUME = 0.7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function moodDefaults(mood: MoodPreset, volume: number): EngineParams {
  return {
    tempo: mood.tempo.default,
    density: mood.defaults.density,
    brightness: mood.defaults.brightness,
    reverb: mood.reverb.wet,
    randomness: mood.defaults.randomness,
    volume,
  };
}

/** `fallbackMix` is used when the hash doesn't specify a soundscape. */
function stateFromHash(hash: string, volume: number, fallbackMix: () => Mix): AppState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const mood = getMood(q.get('mood'));
  const rawSeed = q.get('seed');
  const seed = rawSeed && SEED_PATTERN.test(rawSeed) ? rawSeed : randomSeed();
  const params = moodDefaults(mood, volume);
  for (const key of HASH_PARAMS) {
    const raw = q.get(key);
    const v = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(v)) continue;
    params[key] = key === 'tempo' ? clamp(Math.round(v), mood.tempo.min, mood.tempo.max) : clamp(v, 0, 1);
  }
  return { mood, seed, params, mix: mixFromHash(q) ?? fallbackMix() };
}

function hashFromState(s: AppState): string {
  const q = new URLSearchParams({ mood: s.mood.id, seed: s.seed });
  for (const key of HASH_PARAMS) {
    q.set(key, key === 'tempo' ? String(Math.round(s.params.tempo)) : s.params[key].toFixed(2));
  }
  // The soundscape part only uses URL-safe characters, so it's appended unescaped to keep commas readable.
  return `#${q.toString()}&${mixToHash(s.mix)}`;
}

let state = stateFromHash(location.hash, DEFAULT_VOLUME, () => loadMix() ?? defaultMix());
let hashTimer: ReturnType<typeof setTimeout> | undefined;

function writeHash(immediate = false): void {
  clearTimeout(hashTimer);
  const write = () => history.replaceState(null, '', hashFromState(state));
  if (immediate) write();
  else hashTimer = setTimeout(write, 250);
}

/* ---------------- wiring ---------------- */

const engine = new AudioEngine(state.mood, state.seed, { ...state.params });
const visualizer = new Visualizer(
  document.querySelector<HTMLCanvasElement>('#visualizer')!,
  () => engine.analyser,
  state.mood.palette,
);
engine.onNote = (e) => visualizer.spawn(e);
engine.setMusicLevel(state.mix.music);

const soundscape = new Soundscape();
soundscape.setLevel(state.mix.soundscape);
soundscape.apply(state.mix.layers);

let pending: Promise<void> | null = null;

/** Single path for starting/stopping, shared by the play button, recorder and sleep timer. */
async function setPlayback(play: boolean): Promise<void> {
  while (pending) await pending;
  if (play === engine.isPlaying) return;
  controls.setPlaying(play, true);
  pending = (async () => {
    try {
      if (play) {
        await engine.start();
        const input = engine.mixInput;
        if (engine.isPlaying && input) soundscape.attach(input);
        sleepTimer.sync();
      } else {
        await recorderControl.finish();
        await engine.stop();
        soundscape.detach();
      }
    } catch (err) {
      console.error(err);
      controls.flash('Audio could not start in this browser');
    }
  })();
  try {
    await pending;
  } finally {
    pending = null;
    controls.setPlaying(engine.isPlaying);
  }
}

async function togglePlay(): Promise<void> {
  if (pending) return;
  await setPlayback(!engine.isPlaying);
}

function applyState(next: AppState): void {
  state = next;
  engine.setParams(state.params);
  engine.configure(state.mood, state.seed);
  visualizer.setPalette(state.mood.palette);
  controls.setMood(state.mood);
  controls.setValues(state.params);
  controls.setSeed(state.seed);
  engine.setMusicLevel(state.mix.music);
  soundscape.setLevel(state.mix.soundscape);
  soundscape.apply(state.mix.layers);
  soundscapePanel.setMix(state.mix);
}

const controls = new Controls(document.querySelector<HTMLElement>('#app')!, MOODS, {
  onTogglePlay: () => void togglePlay(),
  onMood(id) {
    const mood = getMood(id);
    if (mood === state.mood) return;
    applyState({ mood, seed: state.seed, params: moodDefaults(mood, state.params.volume), mix: state.mix });
    writeHash(true);
  },
  onParam(key, value) {
    state.params[key] = value;
    engine.setParams({ [key]: value });
    if (HASH_PARAMS.includes(key)) writeHash();
  },
  onReseed() {
    state.seed = randomSeed();
    engine.configure(state.mood, state.seed);
    controls.setSeed(state.seed);
    writeHash(true);
  },
  async onShare() {
    writeHash(true);
    try {
      await navigator.clipboard.writeText(location.href);
      controls.flash('Link copied');
    } catch {
      controls.flash('Copy the URL from the address bar');
    }
  },
});

/** Persist and share the current mix after any soundscape change. */
function mixChanged(): void {
  soundscapePanel.renderSummary(state.mix);
  saveMix(state.mix);
  writeHash();
}

function hintIfStopped(): void {
  if (!engine.isPlaying && !pending) controls.flash('Press play to listen');
}

const panel = document.querySelector<HTMLElement>('.panel')!;
const soundscapePanel = new SoundscapePanel(panel, panel.querySelector('.seed-row'), LAYERS, PRESETS, {
  onToggle(id, on) {
    state.mix.layers[id].on = on;
    soundscape.setLayer(id, { on });
    mixChanged();
    if (on) hintIfStopped();
  },
  onLevel(id, level) {
    state.mix.layers[id].level = level;
    soundscape.setLayer(id, { level });
    mixChanged();
  },
  onParam(id, param) {
    state.mix.layers[id].param = param;
    soundscape.setLayer(id, { param });
    mixChanged();
  },
  onSoundscapeLevel(level) {
    state.mix.soundscape = level;
    soundscape.setLevel(level);
    mixChanged();
  },
  onMusicLevel(level) {
    state.mix.music = level;
    engine.setMusicLevel(level);
    mixChanged();
  },
  onPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    state.mix.layers = presetLayers(preset, state.mix.layers);
    soundscape.apply(state.mix.layers);
    soundscapePanel.setMix(state.mix);
    mixChanged();
    hintIfStopped();
  },
});

const tools = createToolsRow(document.querySelector<HTMLElement>('.panel')!);
const recorderControl = new RecorderControl(tools, {
  async ensurePlaying() {
    await setPlayback(true);
    return engine.isPlaying;
  },
  getOutput: () => engine.output,
  getSeed: () => state.seed,
});
const sleepTimer = new SleepTimer({
  getFadeGain: () => engine.fadeGain,
  onExpire: () => setPlayback(false),
});
new SleepTimerControl(tools, sleepTimer);

applyState(state);
saveMix(state.mix);
writeHash(true);

// Pasting a shared link into an open tab.
window.addEventListener('hashchange', () => {
  if (location.hash === hashFromState(state)) return;
  const next = stateFromHash(location.hash, state.params.volume, () => cloneMix(state.mix));
  applyState(next);
  saveMix(next.mix);
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (target && ['BUTTON', 'INPUT', 'SELECT'].includes(target.tagName) && e.code === 'Space') return;
  if (e.code === 'Space') {
    e.preventDefault();
    void togglePlay();
  } else if (e.key === 'r' || e.key === 'R') {
    controls.flash('Reseeded');
    state.seed = randomSeed();
    engine.configure(state.mood, state.seed);
    controls.setSeed(state.seed);
    writeHash(true);
  }
});
