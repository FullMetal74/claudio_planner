// ============================================================
// store.js — Central state object
// ============================================================

import { generateUUID, mixColors } from './utils.js';

// Node size dimensions (world units)
export const NODE_SIZES = {
  normal: { w: 180, h: 80 },
  large:  { w: 180, h: 160 },
  wide:   { w: 320, h: 80 },
  xlarge: { w: 320, h: 160 },
};

// Create a new node object
export function createNode(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    type: opts.type || 'standard',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    size: opts.size || 'normal',
    color: opts.color || '#4a7fc1',
    name: opts.name || 'New Node',
    description: opts.description || '',
    descriptionVisible: opts.descriptionVisible ?? false,
    groupId: opts.groupId || null,
  };
}

// Create a new connection object
export function createConnection(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    fromNodeId: opts.fromNodeId,
    toNodeId: opts.toNodeId,
    type: opts.type || 'hard',
    color: opts.color || '#888888',
  };
}

// Create a new group object
export function createGroup(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? 300,
    height: opts.height ?? 200,
    name: opts.name || 'Group',
    color: opts.color || '#4a7fc1',
  };
}

// Central application state
export const state = {
  // Viewport
  viewport: { x: 0, y: 0, zoom: 1 },

  // Diagram data
  nodes: new Map(),
  connections: new Map(),
  groups: new Map(),

  // Interaction state
  selection: {
    nodeIds: new Set(),
    connectionIds: new Set(),
    groupIds: new Set(),
  },
  dragging: null,     // { type: 'node'|'group'|'canvas', ... }
  connecting: null,   // { fromNodeId, fromPort, currentX, currentY }
  editingNode: null,  // id of node open in edit panel

  // Lasso
  lasso: null,        // { points: [{x,y}], additive: bool }

  // Undo
  undoStack: [],      // last 10 snapshots

  // Clipboard
  clipboard: null,    // { nodes, connections, offsetApplied }

  // File system
  dirHandle: null,
  currentFile: null,

  // Render control
  dirty: true,

  // Auto-save debounce timer
  _saveTimer: null,
};

// markDirty: schedules auto-save and flags canvas re-render
// Filesystem module registers the scheduler to avoid circular imports
let _scheduleSaveFn = null;

export function setScheduleSave(fn) {
  _scheduleSaveFn = fn;
}

export function markDirty() {
  state.dirty = true;
  _scheduleSaveFn?.();
}

// Seed with a few test nodes for development
export function seedTestData() {
  const n1 = createNode({ id: 'n1', x: 200, y: 200, color: '#4a7fc1', name: 'GameManager', size: 'normal' });
  const n2 = createNode({ id: 'n2', x: 480, y: 160, color: '#5a9a5a', name: 'PlayerController', size: 'large' });
  const n3 = createNode({ id: 'n3', x: 480, y: 360, color: '#9a5a5a', name: 'EnemySpawner', size: 'normal', description: 'Spawns enemies on wave start', descriptionVisible: true });
  const n4 = createNode({ id: 'n4', x: 760, y: 240, color: '#9a7a3a', name: 'UIManager', size: 'wide' });

  state.nodes.set(n1.id, n1);
  state.nodes.set(n2.id, n2);
  state.nodes.set(n3.id, n3);
  state.nodes.set(n4.id, n4);

  const c1 = createConnection({ fromNodeId: 'n1', toNodeId: 'n2', type: 'hard', color: mixColors(n1.color, n2.color) });
  const c2 = createConnection({ fromNodeId: 'n1', toNodeId: 'n3', type: 'assign', color: mixColors(n1.color, n3.color) });
  const c3 = createConnection({ fromNodeId: 'n2', toNodeId: 'n4', type: 'signal', color: mixColors(n2.color, n4.color) });

  state.connections.set(c1.id, c1);
  state.connections.set(c2.id, c2);
  state.connections.set(c3.id, c3);

  const g1 = createGroup({ x: 160, y: 140, width: 320, height: 320, name: 'Core Systems', color: '#4a7fc1' });
  state.groups.set(g1.id, g1);
}
