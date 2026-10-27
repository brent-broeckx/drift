import { SLEEP_OPTIONS_MIN, type SleepTimer } from '../audio/sleepTimer';
import { formatClock } from './tools';

/** Sleep timer picker (Off / 15–90 min) with live countdown and Cancel. */
export class SleepTimerControl {
  private readonly select: HTMLSelectElement;
  private readonly countdown: HTMLSpanElement;
  private readonly cancelButton: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly timer: SleepTimer,
  ) {
    const wrap = document.createElement('div');
    wrap.className = 'tool tool-sleep';

    const label = document.createElement('label');
    label.className = 'tool-label';
    label.htmlFor = 'sleep-timer';
    label.textContent = 'Sleep';

    this.select = document.createElement('select');
    this.select.id = 'sleep-timer';
    this.select.className = 'tool-select';
    this.select.title = 'Fade out over the last minute, then stop';
    this.select.append(new Option('Off', '0'));
    for (const m of SLEEP_OPTIONS_MIN) this.select.append(new Option(`${m} min`, String(m)));
    this.select.addEventListener('change', () => {
      const minutes = Number(this.select.value);
      if (minutes > 0) this.timer.start(minutes);
      else this.timer.cancel();
    });

    this.countdown = document.createElement('span');
    this.countdown.className = 'sleep-left';
    this.countdown.setAttribute('role', 'timer');
    this.countdown.setAttribute('aria-live', 'off');

    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.className = 'ghost tool-btn';
    this.cancelButton.textContent = 'Cancel';
    this.cancelButton.addEventListener('click', () => this.timer.cancel());

    wrap.append(label, this.select, this.countdown, this.cancelButton);
    root.append(wrap);

    timer.onChange = () => this.render();
    this.render();
  }

  private render(): void {
    const active = this.timer.active;
    this.countdown.hidden = !active;
    this.cancelButton.hidden = !active;
    if (!active) {
      this.select.value = '0';
      return;
    }
    const left = formatClock(this.timer.remainingMs / 1000);
    const fading = this.timer.fading;
    this.countdown.textContent = fading ? `fading · ${left}` : left;
    this.countdown.classList.toggle('fading', fading);
  }
}
