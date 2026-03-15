// ============================================================
// filesystem.js — IndexedDB storage (no folder picker)
// Projects are stored directly in IndexedDB as JSON blobs.
// ============================================================

import { state, seedTestData } from './store.js';
import { showSaveIndicator, setProjectName,
         hideStartupModal, showProjectGrid } from './ui.js';
import { rebuildSpatialGrid, fitToScreen } from './canvas.js';

// ── IndexedDB helpers ─────────────────────────────────────────

const IDB_NAME = 'UnityDiagram';
const IDB_VER  = 2;
const STORE    = 'projects';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbGet(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbDelete(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Project list helpers ──────────────────────────────────────

export async function listProjects() {
  const all = await idbGetAll();
  return all.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
}

// ── Load / Save ───────────────────────────────────────────────

export async function loadProject(name) {
  const record = await idbGet(name);
  if (!record) return;

  state.nodes.clear();
  state.connections.clear();
  state.groups.clear();
  state.selection.nodeIds.clear();
  state.selection.connectionIds.clear();
  state.selection.groupIds.clear();
  state.undoStack = [];
  state.editingNode = null;

  const data = record.data || {};
  if (data.viewport) Object.assign(state.viewport, data.viewport);

  for (const n of (data.nodes || []))       state.nodes.set(n.id, n);
  for (const c of (data.connections || [])) state.connections.set(c.id, c);
  for (const g of (data.groups || []))      state.groups.set(g.id, g);

  rebuildSpatialGrid();
  state.currentFile = name;
  setProjectName(name);
  state.dirty = true;
}

export async function saveCurrentFile() {
  if (!state.currentFile) return;
  const data = {
    version: 1,
    viewport: { ...state.viewport },
    nodes:       [...state.nodes.values()],
    connections: [...state.connections.values()],
    groups:      [...state.groups.values()],
  };
  await idbPut({ name: state.currentFile, lastModified: Date.now(), data });
  showSaveIndicator();
}

export async function createNewProject(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  await idbPut({ name: trimmed, lastModified: Date.now(), data: {
    version: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [], connections: [], groups: [],
  }});
  await loadProject(trimmed);
}

export async function deleteProject(name) {
  await idbDelete(name);
}

// ── Auto-save ─────────────────────────────────────────────────

export function scheduleSave() {
  clearTimeout(state._saveTimer);
  state._saveTimer = setTimeout(saveCurrentFile, 2000);
}

// ── Startup flow ──────────────────────────────────────────────

export async function initFilesystem() {
  const projects = await listProjects();

  showProjectGrid(
    projects,
    // onSelect
    async (proj) => {
      await loadProject(proj.name);
      hideStartupModal();
    },
    // onNew
    async () => {
      const name = prompt('Project name:');
      if (!name?.trim()) return;
      await createNewProject(name.trim());
      hideStartupModal();
    },
  );
}
