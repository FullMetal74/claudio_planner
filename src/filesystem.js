// ============================================================
// filesystem.js — File System Access API: folder pick, list, save, load
// ============================================================

import { state, seedTestData } from './store.js';
import { showSaveIndicator, setProjectName, showStartupModal,
         hideStartupModal, showProjectGrid } from './ui.js';
import { rebuildSpatialGrid, fitToScreen } from './canvas.js';

// ── IndexedDB helpers ─────────────────────────────────────────

const IDB_NAME = 'UnityDiagram';
const IDB_STORE = 'handles';
const IDB_KEY = 'dirHandle';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIDB(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFromIDB(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Directory handle management ───────────────────────────────

export async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.dirHandle = handle;
    await saveToIDB(IDB_KEY, handle);
    return handle;
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Folder picker error:', e);
    return null;
  }
}

export async function loadSavedFolder() {
  try {
    const handle = await loadFromIDB(IDB_KEY);
    if (!handle) return null;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      state.dirHandle = handle;
      return handle;
    }
    // Try to request permission
    const req = await handle.requestPermission({ mode: 'readwrite' });
    if (req === 'granted') {
      state.dirHandle = handle;
      return handle;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Project listing ───────────────────────────────────────────

export async function listProjects(dirHandle) {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.endsWith('.json')) {
      try {
        const file = await handle.getFile();
        files.push({ name, lastModified: file.lastModified, handle });
      } catch { /* skip unreadable */ }
    }
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

// ── Load / Save ───────────────────────────────────────────────

export async function loadProject(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const data = JSON.parse(text);

  // Restore state
  state.nodes.clear();
  state.connections.clear();
  state.groups.clear();
  state.selection.nodeIds.clear();
  state.selection.connectionIds.clear();
  state.selection.groupIds.clear();
  state.undoStack = [];
  state.editingNode = null;

  if (data.viewport) Object.assign(state.viewport, data.viewport);

  for (const n of (data.nodes || [])) {
    state.nodes.set(n.id, n);
  }
  for (const c of (data.connections || [])) {
    state.connections.set(c.id, c);
  }
  for (const g of (data.groups || [])) {
    state.groups.set(g.id, g);
  }

  rebuildSpatialGrid();

  state.currentFile = file.name;
  state.dirHandle = state.dirHandle; // keep
  setProjectName(file.name.replace('.json', ''));
  state.dirty = true;
}

export async function saveCurrentFile() {
  if (!state.dirHandle || !state.currentFile) return;
  try {
    const fileHandle = await state.dirHandle.getFileHandle(state.currentFile, { create: true });
    const writable = await fileHandle.createWritable();
    const data = {
      version: 1,
      name: state.currentFile.replace('.json', ''),
      viewport: { ...state.viewport },
      nodes: [...state.nodes.values()],
      connections: [...state.connections.values()],
      groups: [...state.groups.values()],
    };
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    showSaveIndicator();
  } catch (e) {
    console.error('Save failed:', e);
  }
}

export async function createNewProject(name) {
  if (!state.dirHandle) return;
  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const data = {
    version: 1,
    name,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    connections: [],
    groups: [],
  };

  try {
    const fileHandle = await state.dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();

    // Load it
    state.nodes.clear();
    state.connections.clear();
    state.groups.clear();
    state.currentFile = filename;
    state.viewport = { x: 0, y: 0, zoom: 1 };
    rebuildSpatialGrid();
    setProjectName(name);
    state.dirty = true;
  } catch (e) {
    console.error('Create project failed:', e);
  }
}

// ── Auto-save ─────────────────────────────────────────────────

export function scheduleSave() {
  clearTimeout(state._saveTimer);
  state._saveTimer = setTimeout(() => {
    saveCurrentFile();
  }, 2000);
}

// ── Startup flow ──────────────────────────────────────────────

export async function initFilesystem() {
  if (!window.showDirectoryPicker) {
    // Browser doesn't support File System Access API — use test data
    hideStartupModal();
    seedTestData();
    rebuildSpatialGrid();
    fitToScreen();
    return;
  }

  const handle = await loadSavedFolder();

  if (handle) {
    const projects = await listProjects(handle);
    showProjectGrid(
      projects,
      async (proj) => {
        await loadProject(proj.handle);
        hideStartupModal();
      },
      async () => {
        const name = prompt('New project name:');
        if (!name) return;
        await createNewProject(name);
        hideStartupModal();
      },
      async () => {
        // Change folder
        const newHandle = await pickFolder();
        if (!newHandle) return;
        const projs = await listProjects(newHandle);
        showProjectGrid(
          projs,
          async (proj) => { await loadProject(proj.handle); hideStartupModal(); },
          async () => {
            const name = prompt('New project name:');
            if (!name) return;
            await createNewProject(name);
            hideStartupModal();
          },
          null
        );
      }
    );
  } else {
    // Show startup with pick folder button
    showStartupModal(async () => {
      const newHandle = await pickFolder();
      if (!newHandle) return;
      const projects = await listProjects(newHandle);
      showProjectGrid(
        projects,
        async (proj) => { await loadProject(proj.handle); hideStartupModal(); },
        async () => {
          const name = prompt('New project name:');
          if (!name) return;
          await createNewProject(name);
          hideStartupModal();
        },
        null
      );
    });
  }
}
