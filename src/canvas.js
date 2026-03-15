// ============================================================
// canvas.js — Canvas renderer, pan/zoom, viewport culling
// ============================================================

import { state } from './store.js';
import { aabbIntersects } from './utils.js';
import { drawNode, getNodeSize, getPortPositions } from './nodes.js';
import { drawConnections, drawInProgressConnection } from './connections.js';
import { drawGroup } from './groups.js';

const GRID_SPACING = 30;     // world units between grid dots
const CELL_SIZE = 200;       // spatial grid cell size (world units)

// Spatial index: Map<cellKey, Set<nodeId>>
const spatialGrid = new Map();

function cellKey(cx, cy) { return `${cx},${cy}`; }

function worldToCell(x, y) {
  return {
    cx: Math.floor(x / CELL_SIZE),
    cy: Math.floor(y / CELL_SIZE),
  };
}

function getCellsForAABB(x, y, w, h) {
  const x0 = Math.floor(x / CELL_SIZE);
  const y0 = Math.floor(y / CELL_SIZE);
  const x1 = Math.floor((x + w) / CELL_SIZE);
  const y1 = Math.floor((y + h) / CELL_SIZE);
  const cells = [];
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      cells.push({ cx, cy });
    }
  }
  return cells;
}

export function addNodeToGrid(node) {
  const sz = getNodeSize(node);
  const cells = getCellsForAABB(node.x, node.y, sz.w, sz.h);
  for (const { cx, cy } of cells) {
    const k = cellKey(cx, cy);
    if (!spatialGrid.has(k)) spatialGrid.set(k, new Set());
    spatialGrid.get(k).add(node.id);
  }
}

export function removeNodeFromGrid(node) {
  const sz = getNodeSize(node);
  const cells = getCellsForAABB(node.x, node.y, sz.w, sz.h);
  for (const { cx, cy } of cells) {
    const k = cellKey(cx, cy);
    const bucket = spatialGrid.get(k);
    if (bucket) bucket.delete(node.id);
  }
}

export function updateNodeInGrid(node, oldX, oldY) {
  // Remove from old position buckets
  const sz = getNodeSize(node);
  const oldCells = getCellsForAABB(oldX, oldY, sz.w, sz.h);
  for (const { cx, cy } of oldCells) {
    const bucket = spatialGrid.get(cellKey(cx, cy));
    if (bucket) bucket.delete(node.id);
  }
  addNodeToGrid(node);
}

export function rebuildSpatialGrid() {
  spatialGrid.clear();
  for (const node of state.nodes.values()) {
    addNodeToGrid(node);
  }
}

// Get viewport rect in world space
export function getViewportRect(canvas) {
  const { x, y, zoom } = state.viewport;
  return {
    x: -x / zoom,
    y: -y / zoom,
    w: canvas.width / zoom,
    h: canvas.height / zoom,
  };
}

// Get node IDs visible in the current viewport
function getVisibleNodeIds(canvas) {
  const vp = getViewportRect(canvas);
  const cells = getCellsForAABB(vp.x, vp.y, vp.w, vp.h);
  const visible = new Set();
  for (const { cx, cy } of cells) {
    const bucket = spatialGrid.get(cellKey(cx, cy));
    if (bucket) {
      for (const id of bucket) {
        const node = state.nodes.get(id);
        if (node) {
          const sz = getNodeSize(node);
          if (aabbIntersects(node.x, node.y, sz.w, sz.h, vp.x, vp.y, vp.w, vp.h)) {
            visible.add(id);
          }
        }
      }
    }
  }
  return visible;
}

// ── Render loop ──────────────────────────────────────────────

let canvas, ctx;
let animId = null;
let signalDashOffset = 0;

export function initCanvas(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); state.dirty = true; });
  startLoop();
}

function resizeCanvas() {
  // Don't scale by DPR here — setTransform in render will handle it
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  state.dirty = true;
}

function startLoop() {
  function loop() {
    animId = requestAnimationFrame(loop);
    // Always advance signal offset for animation
    signalDashOffset = (signalDashOffset + 0.5) % 24;
    if (!state.dirty && !hasSignals()) return;
    state.dirty = false;
    render();
  }
  loop();
}

function hasSignals() {
  for (const c of state.connections.values()) {
    if (c.type === 'signal') return true;
  }
  return false;
}

function render() {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const { x: panX, y: panY, zoom } = state.viewport;

  // Clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#16161a';
  ctx.fillRect(0, 0, W, H);

  // Apply pan/zoom transform
  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

  const vp = getViewportRect(canvas);
  const visibleNodeIds = getVisibleNodeIds(canvas);

  // 1. Grid dots
  drawGrid(ctx, vp, zoom);

  // 2. Groups (behind everything)
  for (const group of state.groups.values()) {
    if (aabbIntersects(group.x, group.y, group.width, group.height, vp.x, vp.y, vp.w, vp.h)) {
      drawGroup(ctx, group, state.selection.groupIds.has(group.id), zoom);
    }
  }

  // 3. Connections
  drawConnections(ctx, state, visibleNodeIds, signalDashOffset, zoom);

  // 4. Nodes
  for (const id of visibleNodeIds) {
    const node = state.nodes.get(id);
    if (node) {
      const selected = state.selection.nodeIds.has(id);
      drawNode(ctx, node, selected, state.editingNode === id, zoom, state.connecting);
    }
  }

  // 5. In-progress connection
  if (state.connecting) {
    drawInProgressConnection(ctx, state, zoom);
  }

  // 6. Lasso
  if (state.lasso && state.lasso.points.length > 1) {
    drawLasso(ctx, state.lasso.points);
  }

  ctx.restore();
}

function drawGrid(ctx, vp, zoom) {
  let spacing = GRID_SPACING;
  if (zoom < 0.3) spacing = GRID_SPACING * 4;
  else if (zoom < 0.6) spacing = GRID_SPACING * 2;

  const dotR = Math.max(0.5, 1 / zoom);
  const startX = Math.floor(vp.x / spacing) * spacing;
  const startY = Math.floor(vp.y / spacing) * spacing;

  ctx.fillStyle = '#2a2a32';
  for (let x = startX; x < vp.x + vp.w + spacing; x += spacing) {
    for (let y = startY; y < vp.y + vp.h + spacing; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLasso(ctx, points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Coordinate conversion ────────────────────────────────────

export function screenToWorld(sx, sy) {
  const { x, y, zoom } = state.viewport;
  return {
    x: (sx - x) / zoom,
    y: (sy - y) / zoom,
  };
}

export function worldToScreen(wx, wy) {
  const { x, y, zoom } = state.viewport;
  return {
    x: wx * zoom + x,
    y: wy * zoom + y,
  };
}

// ── Pan & Zoom ───────────────────────────────────────────────

export function applyZoom(delta, screenX, screenY) {
  const oldZoom = state.viewport.zoom;
  const newZoom = Math.max(0.05, Math.min(4, oldZoom * (1 - delta * 0.001)));
  const wx = (screenX - state.viewport.x) / oldZoom;
  const wy = (screenY - state.viewport.y) / oldZoom;
  state.viewport.zoom = newZoom;
  state.viewport.x = screenX - wx * newZoom;
  state.viewport.y = screenY - wy * newZoom;
  state.dirty = true;
}

export function fitToScreen() {
  if (state.nodes.size === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of state.nodes.values()) {
    const sz = getNodeSize(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + sz.w);
    maxY = Math.max(maxY, node.y + sz.h);
  }
  const padding = 80;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const dw = maxX - minX + padding * 2;
  const dh = maxY - minY + padding * 2;
  const zoom = Math.max(0.05, Math.min(4, Math.min(W / dw, H / dh)));
  state.viewport.zoom = zoom;
  state.viewport.x = (W - (minX + maxX) * zoom) / 2;
  state.viewport.y = (H - (minY + maxY) * zoom) / 2;
  state.dirty = true;
}

export { canvas, ctx };
