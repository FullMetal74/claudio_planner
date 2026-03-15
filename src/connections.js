// ============================================================
// connections.js — Connection data model + rendering logic
// ============================================================

import { getPortPositions, getNodeSize } from './nodes.js';
import { hexToRgba, lineIntersectsRect, mixColors } from './utils.js';

const BEZIER_CTRL_OFFSET = 80; // horizontal control point offset

// Draw all connections
export function drawConnections(ctx, state, visibleNodeIds, signalDashOffset, zoom) {
  const { nodes, connections, selection } = state;
  const hasSelection = selection.nodeIds.size > 0 || selection.connectionIds.size > 0;
  const vp = getViewportRectFromState(state, ctx);

  for (const conn of connections.values()) {
    const fromNode = nodes.get(conn.fromNodeId);
    const toNode   = nodes.get(conn.toNodeId);
    if (!fromNode || !toNode) continue;

    // Culling: skip if neither endpoint is near viewport and line doesn't cross it
    const fromSz = getNodeSize(fromNode);
    const toSz   = getNodeSize(toNode);
    const fromInView = aabbOverlapsViewport(fromNode.x, fromNode.y, fromSz.w, fromSz.h, vp);
    const toInView   = aabbOverlapsViewport(toNode.x,   toNode.y,   toSz.w,   toSz.h,   vp);

    if (!fromInView && !toInView) {
      // Check if the bezier endpoints cross viewport (rough line check)
      const fromPorts = getPortPositions(fromNode);
      const toPorts   = getPortPositions(toNode);
      const fp = fromPorts.right;
      const tp = toPorts.left;
      if (!lineIntersectsRect(fp.x, fp.y, tp.x, tp.y, vp.x, vp.y, vp.w, vp.h)) continue;
    }

    // Determine opacity based on selection
    let alpha = 1;
    if (hasSelection) {
      const connSelected = selection.connectionIds.has(conn.id);
      const endpointSelected = selection.nodeIds.has(conn.fromNodeId) || selection.nodeIds.has(conn.toNodeId);
      if (!connSelected && !endpointSelected) alpha = 0.15;
      else alpha = 1;
    }

    // Determine line width
    const connSelected = selection.connectionIds.has(conn.id);
    const endpointSelected = selection.nodeIds.has(conn.fromNodeId) || selection.nodeIds.has(conn.toNodeId);
    const lineWidth = (connSelected || endpointSelected) ? 3 : 2;

    drawConnection(ctx, conn, fromNode, toNode, alpha, lineWidth, signalDashOffset, zoom);
  }
}

function drawConnection(ctx, conn, fromNode, toNode, alpha, lineWidth, signalDashOffset, zoom) {
  const fromPorts = getPortPositions(fromNode);
  const toPorts   = getPortPositions(toNode);

  // Choose best ports: if from is to the right of to, use left/right accordingly
  let fp, tp;
  const fromCenterX = fromNode.x + getNodeSize(fromNode).w / 2;
  const toCenterX   = toNode.x   + getNodeSize(toNode).w   / 2;
  if (fromCenterX <= toCenterX) {
    fp = fromPorts.right;
    tp = toPorts.left;
  } else {
    fp = fromPorts.left;
    tp = toPorts.right;
  }

  const dx = Math.abs(tp.x - fp.x);
  const ctrl = Math.max(BEZIER_CTRL_OFFSET, dx * 0.4);

  const cp1x = fp.x + ctrl;
  const cp1y = fp.y;
  const cp2x = tp.x - ctrl;
  const cp2y = tp.y;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = hexToRgba(conn.color, 1);
  ctx.lineWidth = lineWidth / zoom;
  ctx.lineCap = 'round';

  switch (conn.type) {
    case 'hard':
      ctx.setLineDash([]);
      break;
    case 'assign':
      ctx.setLineDash([8 / zoom, 4 / zoom]);
      break;
    case 'signal':
      ctx.setLineDash([2 / zoom, 6 / zoom]);
      ctx.lineDashOffset = -signalDashOffset / zoom;
      break;
  }

  ctx.beginPath();
  ctx.moveTo(fp.x, fp.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tp.x, tp.y);
  ctx.stroke();

  // Arrow head at destination
  drawArrow(ctx, cp2x, cp2y, tp.x, tp.y, lineWidth / zoom, conn.color, alpha, zoom);

  ctx.setLineDash([]);
  ctx.restore();
}

function drawArrow(ctx, fromX, fromY, toX, toY, lineWidth, color, alpha, zoom) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = Math.max(8, lineWidth * 4) / zoom;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.translate(toX, toY);
  ctx.rotate(angle);
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.45);
  ctx.lineTo(-size, -size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw the in-progress connection drag line
export function drawInProgressConnection(ctx, state, zoom) {
  const { connecting, nodes } = state;
  if (!connecting) return;

  const fromNode = nodes.get(connecting.fromNodeId);
  if (!fromNode) return;

  const ports = getPortPositions(fromNode);
  const fp = connecting.fromPort === 'left' ? ports.left : ports.right;

  const tx = connecting.currentX;
  const ty = connecting.currentY;

  const dx = Math.abs(tx - fp.x);
  const ctrl = Math.max(BEZIER_CTRL_OFFSET, dx * 0.4);

  const cp1x = fp.x + (connecting.fromPort === 'right' ? ctrl : -ctrl);
  const cp1y = fp.y;
  const cp2x = tx - (connecting.fromPort === 'right' ? ctrl : -ctrl);
  const cp2y = ty;

  ctx.save();
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.7)';
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fp.x, fp.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // Target circle
  ctx.beginPath();
  ctx.arc(tx, ty, 5 / zoom, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(74, 158, 255, 0.8)';
  ctx.fill();
  ctx.restore();
}

// Helper: does AABB overlap viewport?
function aabbOverlapsViewport(x, y, w, h, vp) {
  return x < vp.x + vp.w && x + w > vp.x && y < vp.y + vp.h && y + h > vp.y;
}

function getViewportRectFromState(state, ctx) {
  const { x, y, zoom } = state.viewport;
  const canvas = ctx.canvas;
  return {
    x: -x / zoom,
    y: -y / zoom,
    w: canvas.width / zoom,
    h: canvas.height / zoom,
  };
}
