import './style.css';
import { AudioEngine, type EngineParams } from './audio/engine';
import { randomSeed } from './audio/generator';
import { getMood, MOODS, type MoodPreset } from './audio/moods';
import { Controls, type ParamKey } from './ui/controls';
import { Visualizer } from './ui/visualizer';

/* ---------------- state & URL hash ---------------- */

interface AppState {
  mood: MoodPreset;
  seed: string;
  params: EngineParams;
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

function stateFromHash(hash: string, volume: number): AppState {
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
  return { mood, seed, params };
}

function hashFromState(s: AppState): string {
  const q = new URLSearchParams({ mood: s.mood.id, seed: s.seed });
  for (const key of HASH_PARAMS) {
    q.set(key, key === 'tempo' ? String(Math.round(s.params.tempo)) : s.params[key].toFixed(2));
  }
  return `#${q.toString()}`;
}

let state = stateFromHash(location.hash, DEFAULT_VOLUME);
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

let busy = false;

async function togglePlay(): Promise<void> {
  if (busy) return;
  busy = true;
  const willPlay = !engine.isPlaying;
  controls.setPlaying(willPlay, true);
  try {
    if (willPlay) await engine.start();
    else await engine.stop();
  } catch (err) {
    console.error(err);
    controls.flash('Audio could not start in this browser');
  } finally {
    busy = false;
    controls.setPlaying(engine.isPlaying);
  }
}

function applyState(next: AppState): void {
  state = next;
  engine.setParams(state.params);
  engine.configure(state.mood, state.seed);
  visualizer.setPalette(state.mood.palette);
  controls.setMood(state.mood);
  controls.setValues(state.params);
  controls.setSeed(state.seed);
}

const controls = new Controls(document.querySelector<HTMLElement>('#app')!, MOODS, {
  onTogglePlay: () => void togglePlay(),
  onMood(id) {
    const mood = getMood(id);
    if (mood === state.mood) return;
    applyState({ mood, seed: state.seed, params: moodDefaults(mood, state.params.volume) });
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

applyState(state);
writeHash(true);

// Pasting a shared link into an open tab.
window.addEventListener('hashchange', () => {
  if (location.hash === hashFromState(state)) return;
  applyState(stateFromHash(location.hash, state.params.volume));
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (target && (target.tagName === 'BUTTON' || target.tagName === 'INPUT') && e.code === 'Space') return;
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
