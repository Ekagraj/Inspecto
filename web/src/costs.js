// Severity and repair-cost estimates from the hand-built table in costs.json.
import table from './costs.json';

export const DEFECTS = table.labels;
export const COST_NOTE = table.note;
export const nameOf = (label) => DEFECTS[label]?.name ?? label;
export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Severity from real-world size in metres: cracks by length, the rest by area. */
export function severityOf(label, w, h) {
  const byLength = DEFECTS[label]?.measure === 'length';
  const x = byLength ? Math.max(w, h) : w * h;
  const [a, b] = byLength ? [0.3, 1.0] : [0.1, 0.5];
  return x < a ? 'minor' : x < b ? 'moderate' : 'major';
}

export function costOf(label, severity) {
  const [low, high] = DEFECTS[label]?.[severity] ?? [0, 0];
  return { low, high };
}

/** Sum of ranges; headline = midpoint rounded to $50. */
export function totals(findings) {
  const low = findings.reduce((s, f) => s + f.cost.low, 0), high = findings.reduce((s, f) => s + f.cost.high, 0);
  return { low, high, mid: Math.round((low + high) / 2 / 50) * 50 };
}
