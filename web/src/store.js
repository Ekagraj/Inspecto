// Findings live in localStorage so the report page can read them.
const KEY = 'inspecto.findings.v1';

export function loadFindings() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function saveFindings(findings) {
  // Storage can be full or blocked (private windows); the app then just works in memory.
  try { localStorage.setItem(KEY, JSON.stringify(findings)); } catch { /* keep going */ }
}
