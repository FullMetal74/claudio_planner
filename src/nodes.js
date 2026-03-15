// ============================================================
// nodes.js — Node data model + rendering logic
// ============================================================

import { NODE_SIZES } from './store.js';
import { lightenColor, hexToRgba, clamp } from './utils.js';

const PORT_RADIUS = 6;
const PORT_RADIUS_HOVER = 9;
const PORT_HIT_RADIUS = 12;
const TEXT_NODE_MIN_W = 120;
const TEXT_NODE_MIN_H = 40;
const CORNER_RADIUS = 6;

// Get size dimensions for a node
export function getNodeSize(node) {
  if (node.type === 'text') {
    return { w: node._tw || TEXT_NODE_MIN_W, h: node._th || TEXT_NODE_MIN_H };
  }
  return NODE_SIZES[node.size] || NODE_SIZES.normal;
}

// Get world-space port positions (left, right) for a node
export function getPortPositions(node) {
  const sz = getNodeSize(node);
  const midY = node.y + sz.h / 2;
  return {
    left:  { x: node.x,          y: midY },
    right: { x: node.x + sz.w,   y: midY },
  };
}

// Hit test: which port was clicked? Returns 'left'|'right'|null
export function hitTestPort(node, wx, wy) {
  const ports = getPortPositions(node);
  for (const side of ['left', 'right']) {
    const p = ports[side];
    const dx = wx - p.x, dy = wy - p.y;
    if (dx * dx + dy * dy <= PORT_HIT_RADIUS * PORT_HIT_RADIUS) {
      return side;
    }
  }
  return null;
}

// Hit test: is point inside node body?
export function hitTestNodeBody(node, wx, wy) {
  const sz = getNodeSize(node);
  return wx >= node.x && wx <= node.x + sz.w && wy >= node.y && wy <= node.y + sz.h;
}

// Measure text node size based on content
export function measureTextNode(ctx, node) {
  ctx.save();
  ctx.font = '12px JetBrains Mono, monospace';
  const lines = wrapText(ctx, node.description || node.name, TEXT_NODE_MIN_W + 40);
  const w = Math.max(TEXT_NODE_MIN_W, Math.min(320, lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width + 24), 0)));
  const h = Math.max(TEXT_NODE_MIN_H, lines.length * 18 + 24);
  ctx.restore();
  node._tw = w;
  node._th = h;
}

// ── Main Draw Function ───────────────────────────────────────

export function drawNode(ctx, node, selected, editing, zoom, connecting) {
  if (node.type === 'text') {
    drawTextNode(ctx, node, selected, editing, zoom);
  } else {
    drawStandardNode(ctx, node, selected, editing, zoom, connecting);
  }
}

function drawStandardNode(ctx, node, selected, editing, zoom, connecting) {
  const sz = getNodeSize(node);
  const { x, y } = node;
  const w = sz.w, h = sz.h;
  const lowZoom = zoom < 0.3;

  ctx.save();

  // Shadow/glow when selected
  if (selected || editing) {
    ctx.shadowColor = '#4a9eff';
    ctx.shadowBlur = 12 / zoom;
  }

  // Main fill
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, CORNER_RADIUS);
  ctx.fillStyle = hexToRgba(node.color, 0.85);
  ctx.fill();

  // Top edge highlight (depth effect)
  ctx.beginPath();
  roundRect(ctx, x, y, w, 4, CORNER_RADIUS);
  ctx.fillStyle = hexToRgba(lightenColor(node.color, 0.3), 0.6);
  ctx.fill();

  // Border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected
    ? '#4a9eff'
    : hexToRgba(lightenColor(node.color, 0.2), 0.5);
  ctx.lineWidth = selected ? 2 / zoom : 1 / zoom;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, CORNER_RADIUS);
  ctx.stroke();

  if (!lowZoom) {
    // Node name
    ctx.fillStyle = '#e8e8f0';
    ctx.font = `500 12px JetBrains Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let nameY = y + h / 2;
    if (node.descriptionVisible && node.description) {
      nameY = y + h * 0.3;
    }
    const maxW = w - 24;
    ctx.fillText(truncateText(ctx, node.name, maxW), x + w / 2, nameY);

    // Description text
    if (node.descriptionVisible && node.description) {
      ctx.fillStyle = 'rgba(200,200,212,0.7)';
      ctx.font = `400 10px JetBrains Mono, monospace`;
      const lines = wrapText(ctx, node.description, w - 24);
      const lineH = 14;
      const totalH = lines.length * lineH;
      let descY = y + h * 0.55 - totalH / 2;
      for (const line of lines.slice(0, 4)) {
        ctx.fillText(line, x + w / 2, descY);
        descY += lineH;
      }
    }

    // Type dot (top-right)
    const dotColor = typeColor(node.type);
    ctx.beginPath();
    ctx.arc(x + w - 12, y + 12, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Port balls
    drawPorts(ctx, node, zoom, connecting);
  }

  ctx.restore();
}

function drawPorts(ctx, node, zoom, connecting) {
  const ports = getPortPositions(node);
  const lightColor = lightenColor(node.color, 0.35);

  for (const side of ['left', 'right']) {
    const p = ports[side];
    const isHovered = node._hoveredPort === side;
    const r = isHovered ? PORT_RADIUS_HOVER : PORT_RADIUS;

    ctx.save();
    if (isHovered) {
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 6 / zoom;
    }

    // White ring on hover
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = lightColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    ctx.restore();
  }
}

function drawTextNode(ctx, node, selected, editing, zoom) {
  if (!node._tw) {
    node._tw = TEXT_NODE_MIN_W;
    node._th = TEXT_NODE_MIN_H;
  }
  const w = node._tw, h = node._th;
  const { x, y } = node;

  ctx.save();

  if (selected) {
    ctx.shadowColor = '#4a9eff';
    ctx.shadowBlur = 10 / zoom;
  }

  // Slightly skewed look for text nodes
  ctx.beginPath();
  ctx.moveTo(x + 6, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - 6, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(node.color, 0.25);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#4a9eff' : hexToRgba(node.color, 0.6);
  ctx.lineWidth = selected ? 2 / zoom : 1 / zoom;
  ctx.stroke();

  // Text content
  ctx.fillStyle = '#e8e8f0';
  ctx.font = `400 11px JetBrains Mono, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const text = node.description || node.name;
  const lines = wrapText(ctx, text, w - 16);
  let ty = y + 10;
  for (const line of lines) {
    ctx.fillText(line, x + 10, ty);
    ty += 16;
  }

  // Resize handle
  ctx.fillStyle = hexToRgba(node.color, 0.5);
  ctx.beginPath();
  ctx.moveTo(x + w - 12, y + h);
  ctx.lineTo(x + w - 4, y + h);
  ctx.lineTo(x + w - 4, y + h - 12);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ── Text helpers ─────────────────────────────────────────────

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// ── Helpers ──────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function typeColor(type) {
  switch (type) {
    case 'text': return '#aaaacc';
    default: return 'rgba(200,200,220,0.4)';
  }
}

export { PORT_HIT_RADIUS };
