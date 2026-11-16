// Findings live in localStorage so the report page can read them.
const KEY = 'inspecto.findings.v1';

export function loadFindings() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function saveFindings(findings) {
  // Storage can be full or blocked (private windows); the app then just works in memory.
  try { localStorage.setItem(KEY, JSON.stringify(findings)); } catch { /* keep going */ }
}

// One real wall photo waiting to be (or already) hung in the 3D home: {image, widthM, aspect, pos?, normal?}.
const WALL_KEY = 'inspecto.wallphoto.v1';

export function loadWallPhoto() {
  try { return JSON.parse(localStorage.getItem(WALL_KEY)); } catch { return null; }
}

/** `null` forgets it. -> false when storage is full or blocked. */
export function saveWallPhoto(photo) {
  try {
    if (photo) localStorage.setItem(WALL_KEY, JSON.stringify(photo)); else localStorage.removeItem(WALL_KEY);
    return true;
  } catch { return false; }
}
