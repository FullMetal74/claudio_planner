// ============================================================
// history.js — Undo stack (last 10 node creation/deletion actions)
// ============================================================

import { state } from './store.js';
import { rebuildSpatialGrid } from './canvas.js';
import { closeNodePanel } from './ui.js';

const MAX_UNDO = 10;

function serializeNodes(nodes) {
  return [...nodes.values()].map(n => ({ ...n }));
}

function serializeConnections(connections) {
  return [...connections.values()].map(c => ({ ...c }));
}

export function pushSnapshot() {
  const snapshot = {
    nodes: serializeNodes(state.nodes),
    connections: serializeConnections(state.connections),
  };
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
}

export function undo() {
  if (state.undoStack.length === 0) return;
  const snapshot = state.undoStack.pop();
  restoreSnapshot(snapshot);
  state.dirty = true;
}

function restoreSnapshot(snapshot) {
  state.nodes.clear();
  for (const n of snapshot.nodes) {
    state.nodes.set(n.id, { ...n });
  }

  state.connections.clear();
  for (const c of snapshot.connections) {
    state.connections.set(c.id, { ...c });
  }

  // Clear selection if selected nodes no longer exist
  for (const id of [...state.selection.nodeIds]) {
    if (!state.nodes.has(id)) state.selection.nodeIds.delete(id);
  }
  for (const id of [...state.selection.connectionIds]) {
    if (!state.connections.has(id)) state.selection.connectionIds.delete(id);
  }

  if (state.editingNode && !state.nodes.has(state.editingNode)) {
    closeNodePanel();
  }

  rebuildSpatialGrid();
}
