// Findings live in localStorage so the report page can read them.
const KEY = 'inspecto.findings.v1';

export function loadFindings() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function saveFindings(findings) {
  // Storage can be full or blocked (private windows); the app then just works in memory.
  try { localStorage.setItem(KEY, JSON.stringify(findings)); } catch { /* keep going */ }
}

// Real wall photos waiting to be (or already) hung in the 3D home: [{image, widthM, aspect, pos?, normal?}].
const WALL_KEY = 'inspecto.wallphoto.v1';

export function loadWallPhotos() {
  try {
    const v = JSON.parse(localStorage.getItem(WALL_KEY));
    return Array.isArray(v) ? v : v ? [v] : []; // before several photos were allowed, one object was stored
  } catch { return []; }
}

/** -> false when storage is full or blocked. */
export function saveWallPhotos(photos) {
  try {
    if (photos.length) localStorage.setItem(WALL_KEY, JSON.stringify(photos)); else localStorage.removeItem(WALL_KEY);
    return true;
  } catch { return false; }
}
