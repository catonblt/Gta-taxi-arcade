import type { ShiftSummary } from '../game/shift';

const rows = (summary: ShiftSummary, careerCash: number): [string, string][] => {
  const list: [string, string][] = [
    ['Jobs run', `${summary.jobs} delivered${summary.blown > 0 ? `, ${summary.blown} blown` : ''}`],
    ['Time on shift', `${Math.floor(summary.seconds / 60)}m ${Math.floor(summary.seconds % 60)}s`],
  ];
  if (summary.lost > 0) list.push(['Lost to the impound', `-$${summary.lost.toLocaleString('en-US')}`]);
  list.push(['Banked', `$${careerCash.toLocaleString('en-US')} all in`]);
  return list;
};

/**
 * The shift boundary is where progression is felt, so this screen answers one question first —
 * what did tonight actually earn you — and only then explains itself.
 */
export function showSummary(summary: ShiftSummary, careerCash: number): void {
  const panel = document.getElementById('summary');
  const reason = document.getElementById('sum-reason');
  const cash = document.getElementById('sum-cash');
  const detail = document.getElementById('sum-detail');
  const list = document.getElementById('sum-rows');
  if (!panel || !reason || !cash || !detail || !list) return;

  reason.textContent = summary.reason;
  cash.textContent = `$${summary.banked.toLocaleString('en-US')}`;
  cash.classList.toggle('busted', summary.banked === 0);
  detail.textContent = summary.detail;

  list.replaceChildren();
  for (const [label, value] of rows(summary, careerCash)) {
    const row = document.createElement('div');
    row.className = 'control';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    list.append(row);
  }

  panel.removeAttribute('hidden');
}

export function hideSummary(): void {
  document.getElementById('summary')?.setAttribute('hidden', '');
}
