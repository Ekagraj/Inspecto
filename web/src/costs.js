// Severity and repair-cost estimates from the hand-built table in costs.json.
import table from './costs.json';

export const DEFECTS = table.labels;
export const COST_NOTE = table.note;
export const SEVERITY_COLOR = { minor: '#ffb224', moderate: '#ff7a2f', major: '#ff4d4d' };
export const nameOf = (label) => DEFECTS[label]?.name ?? label;
export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Severity from real-world size in metres: cracks by length, the rest by area. */
export function severityOf(label, w, h) {
  const byLength = DEFECTS[label]?.measure === 'length';
  const x = byLength ? Math.max(w, h) : w * h;
  const [a, b] = byLength ? [0.3, 1.0] : [0.1, 0.5];
  return x < a ? 'minor' : x < b ? 'moderate' : 'major';
}

/** `factor` scales the US-average table to a local labour market (see AREAS). */
export function costOf(label, severity, factor = 1) {
  const [low, high] = DEFECTS[label]?.[severity] ?? [0, 0];
  return { low: Math.round((low * factor) / 5) * 5, high: Math.round((high * factor) / 5) * 5 }; // to $5: the table has $75 rows
}

// Location pricing: three test areas plus the US average. factor = local painter wage / US wage.
// shortcut: wages are only the labour part of a repair price, and only three areas exist;
// load the full metro table (same BLS series) once the three-level test is accepted.
export const AREA_NOTE = table.areas.source;
export const AREAS = [{ id: 'us', name: 'US average', tier: 'Baseline', factor: 1, also: 'usa national united states' },
  ...table.areas.list.map((a) => ({ ...a, factor: a.wage / table.areas.usWage }))];
const AREA_KEY = 'inspecto.area.v1';
export function loadArea() {
  try { return AREAS.find((a) => a.id === localStorage.getItem(AREA_KEY)) ?? AREAS[0]; } catch { return AREAS[0]; }
}
export function saveArea(area) {
  try { localStorage.setItem(AREA_KEY, area.id); } catch { /* storage blocked: fine */ }
}
/** Findings are stored with US-average costs; this prices them for the chosen location. */
export const localized = (findings, area = loadArea()) => findings.map((f) => ({ ...f, cost: costOf(f.label, f.severity, area.factor) }));
/** Typed text -> area, by name or by a known place inside it. */
export function findArea(text) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return null;
  return AREAS.find((a) => a.name.toLowerCase() === q) ?? AREAS.find((a) => `${a.name} ${a.also}`.toLowerCase().includes(q)) ?? null;
}
/** The test area closest to a position -> {area, km}. */
export function nearestArea(lat, lon) {
  const rad = Math.PI / 180;
  const km = (a) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin(((a.lat - lat) * rad) / 2) ** 2
    + Math.cos(lat * rad) * Math.cos(a.lat * rad) * Math.sin(((a.lon - lon) * rad) / 2) ** 2));
  return AREAS.filter((a) => a.lat).map((area) => ({ area, km: km(area) })).sort((a, b) => a.km - b.km)[0];
}

/** Sum of ranges; headline = midpoint rounded to $50. */
export function totals(findings) {
  const low = findings.reduce((s, f) => s + f.cost.low, 0), high = findings.reduce((s, f) => s + f.cost.high, 0);
  return { low, high, mid: Math.round((low + high) / 2 / 50) * 50 };
}
