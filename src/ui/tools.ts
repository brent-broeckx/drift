/** Compact "Tools" row appended to the bottom of the control panel. */
export function createToolsRow(panel: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tools';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Tools');
  const label = document.createElement('span');
  label.className = 'tools-label';
  label.textContent = 'tools';
  row.append(label);
  panel.append(row);
  return row;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
