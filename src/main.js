// ============================================================
// main.js — Entry point, wires everything together
// ============================================================

import { state, seedTestData, setScheduleSave } from './store.js';
import { initCanvas, rebuildSpatialGrid, fitToScreen } from './canvas.js';
import { initInteraction } from './interaction.js';
import { initFilesystem, saveCurrentFile, scheduleSave } from './filesystem.js';
import { updateZoomDisplay } from './ui.js';

const canvas = document.getElementById('diagram-canvas');

// Wire auto-save scheduler into store (avoids circular deps)
setScheduleSave(scheduleSave);

// ── Boot ─────────────────────────────────────────────────────

async function boot() {
  // Init canvas renderer
  initCanvas(canvas);

  // Init interactions
  initInteraction(canvas);

  // Wire toolbar buttons
  document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
  document.getElementById('btn-new').addEventListener('click', async () => {
    if (!state.dirHandle) return;
    const { createNewProject } = await import('./filesystem.js');
    const name = prompt('New project name:');
    if (!name) return;
    await createNewProject(name);
  });
  document.getElementById('btn-fit').addEventListener('click', fitToScreen);

  // Tick UI (zoom display)
  function uiLoop() {
    updateZoomDisplay(state.viewport.zoom);
    requestAnimationFrame(uiLoop);
  }
  requestAnimationFrame(uiLoop);

  // Try to restore file system session, otherwise show startup modal
  try {
    await initFilesystem();
  } catch (e) {
    console.warn('Filesystem init failed:', e);
    // Fallback: hide modal, seed test data
    document.getElementById('startup-modal').classList.add('hidden');
    seedTestData();
    rebuildSpatialGrid();
    fitToScreen();
  }
}

// ── Start ────────────────────────────────────────────────────

boot().catch(console.error);
