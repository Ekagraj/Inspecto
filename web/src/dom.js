/** Tiny DOM helper. Text always goes in as text nodes, never as HTML. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

/** Stored image sources are only ever used if they are inline images. */
export const safeImg = (src) => (typeof src === 'string' && src.startsWith('data:image/') ? src : '');
