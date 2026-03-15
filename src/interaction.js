// ============================================================
// interaction.js — Mouse/keyboard event handling
// ============================================================

import { state, createNode, createConnection, createGroup, markDirty } from './store.js';
import { screenToWorld, applyZoom, rebuildSpatialGrid, addNodeToGrid,
         removeNodeFromGrid, updateNodeInGrid, fitToScreen } from './canvas.js';
import { hitTestNodeBody, hitTestPort, getPortPositions, getNodeSize } from './nodes.js';
import { hitTestGroup } from './groups.js';
import { pushSnapshot } from './history.js';
import { mixColors, generateUUID, dist } from './utils.js';
import { openNodePanel, closeNodePanel, showConnectionPopup,
         hideConnectionPopup, showContextMenu, hideContextMenu } from './ui.js';

const PAN_THRESHOLD = 4; // pixels before right-click becomes pan

let canvasEl = null;

// Pending connection target (set when drag-release creates a new node)
let pendingConnectionFrom = null; // { fromNodeId, fromPort }

export function initInteraction(canvas) {
  canvasEl = canvas;

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);

  window.addEventListener('keydown', onKeyDown);
}

// ── Mouse State ──────────────────────────────────────────────

let mouseDownPos = null;   // screen coords at mousedown
let mouseDownButton = -1;
let rightPanActive = false;
let rightMoved = false;

function onMouseDown(e) {
  e.preventDefault();
  const wx = e.offsetX, wy = e.offsetY;
  const world = screenToWorld(wx, wy);
  mouseDownPos = { sx: wx, sy: wy };
  mouseDownButton = e.button;

  if (e.button === 2) {
    // Right click — start tracking for pan vs context menu
    rightPanActive = false;
    rightMoved = false;
    return;
  }

  if (e.button === 1) {
    // Middle mouse — start pan
    state.dragging = { type: 'canvas', startPanX: state.viewport.x, startPanY: state.viewport.y, startSX: wx, startSY: wy };
    canvasEl.classList.add('panning');
    return;
  }

  if (e.button !== 0) return;

  hideContextMenu();
  hideConnectionPopup();

  // Hit test order: ports → node body → group resize → group label/border → canvas
  const hit = hitTestAll(world.x, world.y);

  if (hit.type === 'port') {
    // Start connection drag
    pushSnapshot();
    state.connecting = {
      fromNodeId: hit.nodeId,
      fromPort: hit.port,
      currentX: world.x,
      currentY: world.y,
    };
    canvasEl.classList.add('connecting');
    state.dirty = true;
    return;
  }

  if (hit.type === 'node') {
    const node = state.nodes.get(hit.nodeId);
    if (!state.selection.nodeIds.has(hit.nodeId)) {
      if (!e.shiftKey) {
        clearSelection();
      }
      state.selection.nodeIds.add(hit.nodeId);
    }
    // Start drag
    pushSnapshot();
    const selectedNodes = [...state.selection.nodeIds].map(id => state.nodes.get(id)).filter(Boolean);
    state.dragging = {
      type: 'node',
      startWorld: { x: world.x, y: world.y },
      nodeStarts: new Map(selectedNodes.map(n => [n.id, { x: n.x, y: n.y }])),
    };
    state.dirty = true;
    return;
  }

  if (hit.type === 'groupResize') {
    state.dragging = {
      type: 'groupResize',
      groupId: hit.groupId,
      startWorld: { x: world.x, y: world.y },
      startW: hit.group.width,
      startH: hit.group.height,
    };
    state.dirty = true;
    return;
  }

  if (hit.type === 'group') {
    if (!state.selection.groupIds.has(hit.groupId)) {
      if (!e.shiftKey) clearSelection();
      state.selection.groupIds.add(hit.groupId);
    }
    state.dragging = {
      type: 'group',
      groupId: hit.groupId,
      startWorld: { x: world.x, y: world.y },
      groupStart: { x: hit.group.x, y: hit.group.y },
    };
    state.dirty = true;
    return;
  }

  // Canvas — start lasso or clear selection
  if (!e.shiftKey) clearSelection();
  state.lasso = { points: [world], additive: e.shiftKey };
  state.dirty = true;
}

function onMouseMove(e) {
  const wx = e.offsetX, wy = e.offsetY;
  const world = screenToWorld(wx, wy);

  // Right-click pan
  if (mouseDownButton === 2 && mouseDownPos) {
    const dx = wx - mouseDownPos.sx;
    const dy = wy - mouseDownPos.sy;
    if (!rightPanActive && Math.sqrt(dx*dx+dy*dy) > PAN_THRESHOLD) {
      rightPanActive = true;
      rightMoved = true;
      canvasEl.classList.add('panning');
      state._panStart = { panX: state.viewport.x, panY: state.viewport.y, sx: mouseDownPos.sx, sy: mouseDownPos.sy };
    }
    if (rightPanActive && state._panStart) {
      state.viewport.x = state._panStart.panX + (wx - state._panStart.sx);
      state.viewport.y = state._panStart.panY + (wy - state._panStart.sy);
      state.dirty = true;
    }
    return;
  }

  // Middle mouse pan
  if (mouseDownButton === 1 && state.dragging?.type === 'canvas') {
    state.viewport.x = state.dragging.startPanX + (wx - state.dragging.startSX);
    state.viewport.y = state.dragging.startPanY + (wy - state.dragging.startSY);
    state.dirty = true;
    return;
  }

  // Connection drag
  if (state.connecting) {
    state.connecting.currentX = world.x;
    state.connecting.currentY = world.y;
    state.dirty = true;
    return;
  }

  // Node drag
  if (state.dragging?.type === 'node') {
    const dx = world.x - state.dragging.startWorld.x;
    const dy = world.y - state.dragging.startWorld.y;
    for (const [id, start] of state.dragging.nodeStarts) {
      const node = state.nodes.get(id);
      if (!node) continue;
      const oldX = node.x, oldY = node.y;
      node.x = start.x + dx;
      node.y = start.y + dy;
      updateNodeInGrid(node, oldX, oldY);
    }
    state.dirty = true;
    markDirty();
    return;
  }

  // Group drag
  if (state.dragging?.type === 'group') {
    const dx = world.x - state.dragging.startWorld.x;
    const dy = world.y - state.dragging.startWorld.y;
    const group = state.groups.get(state.dragging.groupId);
    if (group) {
      group.x = state.dragging.groupStart.x + dx;
      group.y = state.dragging.groupStart.y + dy;
      state.dirty = true;
      markDirty();
    }
    return;
  }

  // Group resize
  if (state.dragging?.type === 'groupResize') {
    const dx = world.x - state.dragging.startWorld.x;
    const dy = world.y - state.dragging.startWorld.y;
    const group = state.groups.get(state.dragging.groupId);
    if (group) {
      group.width  = Math.max(100, state.dragging.startW + dx);
      group.height = Math.max(60,  state.dragging.startH + dy);
      state.dirty = true;
      markDirty();
    }
    return;
  }

  // Lasso sweep
  if (state.lasso) {
    state.lasso.points.push(world);
    // Paint-over: add nodes whose bounding box the cursor passed over
    for (const node of state.nodes.values()) {
      if (!state.selection.nodeIds.has(node.id)) {
        const sz = getNodeSize(node);
        if (world.x >= node.x && world.x <= node.x + sz.w &&
            world.y >= node.y && world.y <= node.y + sz.h) {
          state.selection.nodeIds.add(node.id);
        }
      }
    }
    state.dirty = true;
    return;
  }

  // Hover: update port hover state
  updateHover(world.x, world.y);
}

function onMouseUp(e) {
  const wx = e.offsetX, wy = e.offsetY;
  const world = screenToWorld(wx, wy);

  // Right click release
  if (e.button === 2) {
    canvasEl.classList.remove('panning');
    state._panStart = null;
    // If didn't move much → context menu
    if (!rightMoved) {
      showContextMenuAt(e.clientX, e.clientY, world.x, world.y);
    }
    mouseDownButton = -1;
    mouseDownPos = null;
    rightPanActive = false;
    rightMoved = false;
    return;
  }

  // Middle mouse release
  if (e.button === 1) {
    canvasEl.classList.remove('panning');
    state.dragging = null;
    mouseDownButton = -1;
    return;
  }

  // Connection release
  if (state.connecting) {
    canvasEl.classList.remove('connecting');
    finishConnection(world.x, world.y, e.clientX, e.clientY);
    state.connecting = null;
    state.dirty = true;
    mouseDownButton = -1;
    return;
  }

  // Node / group drag release
  if (state.dragging) {
    state.dragging = null;
    markDirty();
  }

  // Lasso release
  if (state.lasso) {
    state.lasso = null;
    state.dirty = true;
  }

  mouseDownButton = -1;
  mouseDownPos = null;
}

function onContextMenu(e) {
  e.preventDefault();
  // Context menu is shown in onMouseUp for right-click without movement
}

function onWheel(e) {
  e.preventDefault();
  applyZoom(e.deltaY, e.offsetX, e.offsetY);
}

function onDblClick(e) {
  const world = screenToWorld(e.offsetX, e.offsetY);
  // Double-click on node → open edit panel
  for (const node of [...state.nodes.values()].reverse()) {
    if (hitTestNodeBody(node, world.x, world.y)) {
      openNodePanel(node.id);
      return;
    }
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────

function onKeyDown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    if (state.connecting) {
      state.connecting = null;
      canvasEl.classList.remove('connecting');
      state.dirty = true;
    } else if (state.editingNode) {
      closeNodePanel();
    } else {
      clearSelection();
      state.dirty = true;
    }
    hideContextMenu();
    hideConnectionPopup();
  } else if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    import('./filesystem.js').then(m => m.saveCurrentFile());
  } else if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    import('./history.js').then(m => m.undo());
  } else if (e.ctrlKey && e.key === 'c') {
    copySelected();
  } else if (e.ctrlKey && e.key === 'v') {
    pasteClipboard();
  } else if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    copySelected();
    pasteClipboard();
  } else if (e.key === 'f' || e.key === 'F') {
    fitToScreen();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    cycleSelection();
  }
}

// ── Hit Testing ──────────────────────────────────────────────

function hitTestAll(wx, wy) {
  // 1. Ports (left-click only creates connections)
  for (const node of [...state.nodes.values()].reverse()) {
    const port = hitTestPort(node, wx, wy);
    if (port) return { type: 'port', nodeId: node.id, port };
  }

  // 2. Node body
  for (const node of [...state.nodes.values()].reverse()) {
    if (hitTestNodeBody(node, wx, wy)) return { type: 'node', nodeId: node.id };
  }

  // 3. Group resize handles
  for (const group of [...state.groups.values()].reverse()) {
    const zone = hitTestGroup(group, wx, wy);
    if (zone === 'resize') return { type: 'groupResize', groupId: group.id, group };
    if (zone === 'label' || zone === 'border') return { type: 'group', groupId: group.id, group };
  }

  return { type: 'canvas' };
}

// ── Hover update ─────────────────────────────────────────────

function updateHover(wx, wy) {
  let changed = false;
  for (const node of state.nodes.values()) {
    const port = hitTestPort(node, wx, wy);
    if (node._hoveredPort !== (port || null)) {
      node._hoveredPort = port || null;
      changed = true;
    }
  }
  if (changed) state.dirty = true;
}

// ── Connection finishing ──────────────────────────────────────

function finishConnection(wx, wy, clientX, clientY) {
  const { connecting } = state;
  if (!connecting) return;

  // Cancel if released on source node
  if (hitTestNodeBody(state.nodes.get(connecting.fromNodeId), wx, wy)) return;

  // Find target node
  for (const node of [...state.nodes.values()].reverse()) {
    if (node.id === connecting.fromNodeId) continue;
    const port = hitTestPort(node, wx, wy);
    const onBody = hitTestNodeBody(node, wx, wy);
    if (port || onBody) {
      // Show connection type popup
      showConnectionPopup(clientX, clientY, (type) => {
        if (!type) return;
        const fromNode = state.nodes.get(connecting.fromNodeId);
        const toNode = node;
        const conn = createConnection({
          fromNodeId: connecting.fromNodeId,
          toNodeId: node.id,
          type,
          color: mixColors(fromNode?.color || '#888', toNode.color),
        });
        state.connections.set(conn.id, conn);
        state.dirty = true;
        markDirty();
      });
      return;
    }
  }

  // Released on empty space → create new node then connect
  const fromNode = state.nodes.get(connecting.fromNodeId);
  const newNode = createNode({
    x: wx - 90, y: wy - 40,
    color: fromNode?.color || '#4a7fc1',
    name: 'New Node',
  });
  state.nodes.set(newNode.id, newNode);
  addNodeToGrid(newNode);
  state.dirty = true;

  showConnectionPopup(clientX, clientY, (type) => {
    if (!type) return;
    const conn = createConnection({
      fromNodeId: connecting.fromNodeId,
      toNodeId: newNode.id,
      type,
      color: mixColors(fromNode?.color || '#888', newNode.color),
    });
    state.connections.set(conn.id, conn);
    state.dirty = true;
    markDirty();
  });
}

// ── Selection helpers ────────────────────────────────────────

export function clearSelection() {
  state.selection.nodeIds.clear();
  state.selection.connectionIds.clear();
  state.selection.groupIds.clear();
}

function deleteSelected() {
  if (state.selection.nodeIds.size === 0 && state.selection.connectionIds.size === 0) return;
  pushSnapshot();

  for (const id of state.selection.nodeIds) {
    const node = state.nodes.get(id);
    if (node) removeNodeFromGrid(node);
    state.nodes.delete(id);
    // Remove all connections to/from this node
    for (const [cid, conn] of state.connections) {
      if (conn.fromNodeId === id || conn.toNodeId === id) {
        state.connections.delete(cid);
      }
    }
  }
  for (const id of state.selection.connectionIds) {
    state.connections.delete(id);
  }

  clearSelection();
  if (state.editingNode && !state.nodes.has(state.editingNode)) {
    closeNodePanel();
  }
  state.dirty = true;
  markDirty();
}

// ── Copy / Paste ──────────────────────────────────────────────

function copySelected() {
  if (state.selection.nodeIds.size === 0) return;
  const selectedIds = new Set(state.selection.nodeIds);
  const nodes = [...selectedIds].map(id => ({ ...state.nodes.get(id) })).filter(Boolean);
  const connections = [...state.connections.values()].filter(
    c => selectedIds.has(c.fromNodeId) && selectedIds.has(c.toNodeId)
  ).map(c => ({ ...c }));
  state.clipboard = { nodes, connections, offsetApplied: false };
}

function pasteClipboard() {
  if (!state.clipboard) return;
  pushSnapshot();
  const OFFSET = 20;
  const idMap = new Map();
  const newNodes = [];

  for (const node of state.clipboard.nodes) {
    const newId = generateUUID();
    idMap.set(node.id, newId);
    const newNode = { ...node, id: newId, x: node.x + OFFSET, y: node.y + OFFSET };
    state.nodes.set(newId, newNode);
    addNodeToGrid(newNode);
    newNodes.push(newNode);
  }

  for (const conn of state.clipboard.connections) {
    const newConn = {
      ...conn,
      id: generateUUID(),
      fromNodeId: idMap.get(conn.fromNodeId),
      toNodeId: idMap.get(conn.toNodeId),
    };
    if (newConn.fromNodeId && newConn.toNodeId) {
      state.connections.set(newConn.id, newConn);
    }
  }

  clearSelection();
  for (const n of newNodes) state.selection.nodeIds.add(n.id);
  state.dirty = true;
  markDirty();
}

// ── Context Menu ──────────────────────────────────────────────

function showContextMenuAt(clientX, clientY, worldX, worldY) {
  const hit = hitTestAll(worldX, worldY);

  if (hit.type === 'node') {
    const nodeId = hit.nodeId;
    showContextMenu(clientX, clientY, [
      { label: 'Edit', action: () => openNodePanel(nodeId) },
      { label: 'Duplicate', action: () => duplicateNode(nodeId) },
      { label: 'Copy', action: () => {
        clearSelection();
        state.selection.nodeIds.add(nodeId);
        copySelected();
      }},
      { separator: true },
      { label: 'Size: Normal', action: () => setNodeSize(nodeId, 'normal') },
      { label: 'Size: Large',  action: () => setNodeSize(nodeId, 'large') },
      { label: 'Size: Wide',   action: () => setNodeSize(nodeId, 'wide') },
      { label: 'Size: X-Large',action: () => setNodeSize(nodeId, 'xlarge') },
      { separator: true },
      { label: 'Delete', danger: true, action: () => {
        clearSelection();
        state.selection.nodeIds.add(nodeId);
        deleteSelected();
      }},
    ]);
    return;
  }

  if (hit.type === 'group') {
    const groupId = hit.groupId;
    showContextMenu(clientX, clientY, [
      { label: 'Rename', action: () => startRenameGroup(groupId, clientX, clientY) },
      { label: 'Delete', danger: true, action: () => {
        state.groups.delete(groupId);
        state.dirty = true;
        markDirty();
      }},
    ]);
    return;
  }

  // Empty space
  const items = [
    { label: 'Add Standard Node', action: () => addNodeAt(worldX, worldY, 'standard') },
    { label: 'Add Text Node',     action: () => addNodeAt(worldX, worldY, 'text') },
    { label: 'Add Group',         action: () => addGroupAt(worldX, worldY) },
  ];
  if (state.clipboard) {
    items.push({ separator: true });
    items.push({ label: 'Paste', action: pasteClipboard });
  }
  showContextMenu(clientX, clientY, items);
}

function addNodeAt(wx, wy, type) {
  pushSnapshot();
  const node = createNode({ x: wx - 90, y: wy - 40, type });
  state.nodes.set(node.id, node);
  addNodeToGrid(node);
  clearSelection();
  state.selection.nodeIds.add(node.id);
  state.dirty = true;
  markDirty();
}

function addGroupAt(wx, wy) {
  const group = createGroup({ x: wx - 100, y: wy - 80 });
  state.groups.set(group.id, group);
  state.dirty = true;
  markDirty();
}

function duplicateNode(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  pushSnapshot();
  const newNode = { ...node, id: generateUUID(), x: node.x + 20, y: node.y + 20 };
  state.nodes.set(newNode.id, newNode);
  addNodeToGrid(newNode);
  clearSelection();
  state.selection.nodeIds.add(newNode.id);
  state.dirty = true;
  markDirty();
}

function setNodeSize(nodeId, size) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  node.size = size;
  updateNodeInGrid(node, node.x, node.y);
  state.dirty = true;
  markDirty();
}

function startRenameGroup(groupId, clientX, clientY) {
  const group = state.groups.get(groupId);
  if (!group) return;
  const name = prompt('Rename group:', group.name);
  if (name !== null) {
    group.name = name;
    state.dirty = true;
    markDirty();
  }
}

function cycleSelection() {
  const ids = [...state.nodes.keys()];
  if (ids.length === 0) return;
  if (state.selection.nodeIds.size === 0) {
    clearSelection();
    state.selection.nodeIds.add(ids[0]);
  } else {
    const currentId = [...state.selection.nodeIds][0];
    const idx = ids.indexOf(currentId);
    const nextId = ids[(idx + 1) % ids.length];
    clearSelection();
    state.selection.nodeIds.add(nextId);
  }
  state.dirty = true;
}

export { deleteSelected, copySelected, pasteClipboard, addNodeAt };
