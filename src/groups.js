// ============================================================
// groups.js — Group data model + rendering logic
// ============================================================

import { hexToRgba, lightenColor } from './utils.js';

const RESIZE_HANDLE_SIZE = 14;
const BORDER_HIT = 8; // pixels for border/label hit detection

export function drawGroup(ctx, group, selected, zoom) {
  const { x, y, width: w, height: h, color, name } = group;

  ctx.save();

  // Fill (very translucent)
  ctx.fillStyle = hexToRgba(color, 0.1);
  ctx.fillRect(x, y, w, h);

  // Border
  ctx.strokeStyle = selected
    ? '#4a9eff'
    : hexToRgba(color, 0.55);
  ctx.lineWidth = selected ? 2 / zoom : 1.5 / zoom;
  if (selected) {
    ctx.shadowColor = '#4a9eff';
    ctx.shadowBlur = 8 / zoom;
  }
  ctx.strokeRect(x, y, w, h);
  ctx.shadowBlur = 0;

  // Name label — top left
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.font = `500 13px JetBrains Mono, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(name, x + 8, y + 6);

  // Resize handle — bottom right corner
  ctx.fillStyle = hexToRgba(color, 0.5);
  ctx.beginPath();
  ctx.moveTo(x + w - RESIZE_HANDLE_SIZE, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - RESIZE_HANDLE_SIZE);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Hit test for group interaction zones
// Returns 'resize' | 'label' | 'body' | null
export function hitTestGroup(group, wx, wy) {
  const { x, y, width: w, height: h } = group;

  // Resize handle
  if (wx >= x + w - RESIZE_HANDLE_SIZE && wx <= x + w &&
      wy >= y + h - RESIZE_HANDLE_SIZE && wy <= y + h) {
    return 'resize';
  }

  // Label area (top strip)
  if (wx >= x && wx <= x + w && wy >= y && wy <= y + BORDER_HIT + 14) {
    return 'label';
  }

  // Border strips
  const onLeft   = wx >= x && wx <= x + BORDER_HIT;
  const onRight  = wx >= x + w - BORDER_HIT && wx <= x + w;
  const onTop    = wy >= y && wy <= y + BORDER_HIT;
  const onBottom = wy >= y + h - BORDER_HIT && wy <= y + h;
  if ((onLeft || onRight || onTop || onBottom) &&
      wx >= x && wx <= x + w && wy >= y && wy <= y + h) {
    return 'border';
  }

  return null;
}

export { RESIZE_HANDLE_SIZE };
