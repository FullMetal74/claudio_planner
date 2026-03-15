// ============================================================
// main.js — Entry point, wires everything together
// ============================================================

import { state, seedTestData, setScheduleSave } from './store.js';
import { initCanvas, rebuildSpatialGrid, fitToScreen } from './canvas.js';
import { initInteraction } from './interaction.js';
import { initFilesystem, saveCurrentFile, createNewProject, scheduleSave } from './filesystem.js';
import { updateZoomDisplay, hideStartupModal } from './ui.js';

const canvas = document.getElementById('diagram-canvas');

// Wire auto-save scheduler into store (avoids circular deps)
setScheduleSave(scheduleSave);

// ── Boot ─────────────────────────────────────────────────────

async function boot() {
  initCanvas(canvas);
  initInteraction(canvas);

  // Toolbar buttons
  document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
  document.getElementById('btn-new').addEventListener('click', async () => {
    const name = prompt('New project name:');
    if (!name?.trim()) return;
    await createNewProject(name.trim());
  });
  document.getElementById('btn-fit').addEventListener('click', fitToScreen);

  // Zoom display tick
  function uiLoop() {
    updateZoomDisplay(state.viewport.zoom);
    requestAnimationFrame(uiLoop);
  }
  requestAnimationFrame(uiLoop);

  // Load projects from IndexedDB and show picker
  try {
    await initFilesystem();
  } catch (e) {
    console.warn('Storage init failed:', e);
    hideStartupModal();
    seedTestData();
    rebuildSpatialGrid();
    fitToScreen();
  }
}

boot().catch(console.error);
