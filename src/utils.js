// ============================================================
// utils.js — Color mixing, math helpers, UUID generation
// ============================================================

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Parse hex color (#rrggbb or #rgb) → { r, g, b }
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// { r, g, b } → '#rrggbb'
export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Mix two hex colors by averaging RGB channels
export function mixColors(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: Math.round((a.r + b.r) / 2),
    g: Math.round((a.g + b.g) / 2),
    b: Math.round((a.b + b.b) / 2),
  });
}

// Lighten a hex color by a factor (0-1)
export function lightenColor(hex, factor = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.min(255, Math.round(r + (255 - r) * factor)),
    g: Math.min(255, Math.round(g + (255 - g) * factor)),
    b: Math.min(255, Math.round(b + (255 - b) * factor)),
  });
}

// Darken a hex color by a factor (0-1)
export function darkenColor(hex, factor = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.round(r * (1 - factor)),
    g: Math.round(g * (1 - factor)),
    b: Math.round(b * (1 - factor)),
  });
}

// Convert hex to rgba string
export function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Clamp a value between min and max
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// AABB intersection test
export function aabbIntersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Check if a point is inside an AABB
export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

// Distance between two points
export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// Line segment–AABB intersection (for connection culling)
// Checks if the line from (x1,y1)-(x2,y2) intersects rect (rx,ry,rw,rh)
export function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  // Cohen-Sutherland clip
  const LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
  function code(x, y) {
    let c = 0;
    if (x < rx) c |= LEFT;
    else if (x > rx + rw) c |= RIGHT;
    if (y < ry) c |= TOP;
    else if (y > ry + rh) c |= BOTTOM;
    return c;
  }
  let c1 = code(x1, y1), c2 = code(x2, y2);
  for (let i = 0; i < 10; i++) {
    if (!(c1 | c2)) return true;   // both inside
    if (c1 & c2) return false;     // both outside same region
    const c = c1 || c2;
    let x, y;
    if (c & BOTTOM) { x = x1 + (x2-x1)*(ry+rh-y1)/(y2-y1); y = ry+rh; }
    else if (c & TOP) { x = x1 + (x2-x1)*(ry-y1)/(y2-y1); y = ry; }
    else if (c & RIGHT) { y = y1 + (y2-y1)*(rx+rw-x1)/(x2-x1); x = rx+rw; }
    else { y = y1 + (y2-y1)*(rx-x1)/(x2-x1); x = rx; }
    if (c === c1) { x1=x; y1=y; c1=code(x,y); }
    else { x2=x; y2=y; c2=code(x,y); }
  }
  return false;
}

// Preset node colors
export const NODE_COLORS = [
  '#4a7fc1', '#5a9a5a', '#9a5a5a', '#9a7a3a',
  '#6a5a9a', '#3a9a8a', '#9a4a7a', '#4a8a7a',
  '#7a5a3a', '#5a6a9a', '#8a6a3a', '#3a6a4a',
];
