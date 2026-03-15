// ============================================================
// ui.js — Sidebar panels, modals, toolbar (HTML/DOM)
// ============================================================

import { state, createNode, markDirty } from './store.js';
import { NODE_COLORS } from './utils.js';
import { updateNodeInGrid } from './canvas.js';
import { getNodeSize } from './nodes.js';

// ── Side Panel ────────────────────────────────────────────────

const sidePanel = document.getElementById('side-panel');
const sidePanelTitle = document.getElementById('side-panel-title');
const sidePanelContent = document.getElementById('side-panel-content');
const sidePanelClose = document.getElementById('side-panel-close');

sidePanelClose.addEventListener('click', closeNodePanel);

export function openNodePanel(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  state.editingNode = nodeId;
  sidePanel.classList.remove('hidden');
  sidePanelTitle.textContent = node.type === 'text' ? 'Edit Text Node' : 'Edit Node';
  renderNodePanel(node);
  state.dirty = true;
}

export function closeNodePanel() {
  state.editingNode = null;
  sidePanel.classList.add('hidden');
  state.dirty = true;
}

function renderNodePanel(node) {
  sidePanelContent.innerHTML = '';

  if (node.type === 'text') {
    renderTextNodePanel(node);
  } else {
    renderStandardNodePanel(node);
  }
}

function renderStandardNodePanel(node) {
  // Name
  sidePanelContent.appendChild(createField('Name',
    createInput('text', node.name, (v) => {
      node.name = v;
      state.dirty = true;
      markDirty();
    })
  ));

  // Description
  sidePanelContent.appendChild(createField('Description',
    createTextarea(node.description, (v) => {
      node.description = v;
      state.dirty = true;
      markDirty();
    })
  ));

  // Show description toggle
  const toggleRow = document.createElement('label');
  toggleRow.className = 'panel-checkbox-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = node.descriptionVisible;
  cb.addEventListener('change', () => {
    node.descriptionVisible = cb.checked;
    state.dirty = true;
    markDirty();
  });
  toggleRow.appendChild(cb);
  toggleRow.appendChild(Object.assign(document.createTextNode(' Show description on node')));
  sidePanelContent.appendChild(toggleRow);

  // Color picker
  sidePanelContent.appendChild(createField('Color', createColorPicker(node.color, (c) => {
    node.color = c;
    // Update connection colors
    for (const conn of state.connections.values()) {
      if (conn.fromNodeId === node.id || conn.toNodeId === node.id) {
        const other = state.nodes.get(conn.fromNodeId === node.id ? conn.toNodeId : conn.fromNodeId);
        if (other) {
          const { mixColors } = await_import_mixColors();
          conn.color = mixColors(
            conn.fromNodeId === node.id ? node.color : other.color,
            conn.fromNodeId === node.id ? other.color : node.color
          );
        }
      }
    }
    state.dirty = true;
    markDirty();
  })));

  // Size selector
  sidePanelContent.appendChild(createField('Size', createSizeSelector(node.size, (s) => {
    node.size = s;
    updateNodeInGrid(node, node.x, node.y);
    state.dirty = true;
    markDirty();
  })));

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.textContent = 'Delete Node';
  delBtn.addEventListener('click', () => {
    showConfirm('Delete this node?', () => {
      import('./interaction.js').then(m => {
        m.clearSelection();
        state.selection.nodeIds.add(node.id);
        m.deleteSelected();
        closeNodePanel();
      });
    });
  });
  sidePanelContent.appendChild(delBtn);
}

function renderTextNodePanel(node) {
  // Text content
  sidePanelContent.appendChild(createField('Content',
    createTextarea(node.description || node.name, (v) => {
      node.description = v;
      node.name = v.split('\n')[0].slice(0, 40) || 'Text';
      state.dirty = true;
      markDirty();
    })
  ));

  // Color picker
  sidePanelContent.appendChild(createField('Color', createColorPicker(node.color, (c) => {
    node.color = c;
    state.dirty = true;
    markDirty();
  })));

  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.textContent = 'Delete Node';
  delBtn.addEventListener('click', () => {
    showConfirm('Delete this node?', () => {
      import('./interaction.js').then(m => {
        m.clearSelection();
        state.selection.nodeIds.add(node.id);
        m.deleteSelected();
        closeNodePanel();
      });
    });
  });
  sidePanelContent.appendChild(delBtn);
}

// ── Form helpers ─────────────────────────────────────────────

function createField(label, control) {
  const wrap = document.createElement('div');
  const lbl = document.createElement('label');
  lbl.className = 'panel-label';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(control);
  return wrap;
}

function createInput(type, value, onChange) {
  const el = document.createElement('input');
  el.type = type;
  el.className = 'panel-input';
  el.value = value;
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function createTextarea(value, onChange) {
  const el = document.createElement('textarea');
  el.className = 'panel-textarea';
  el.value = value;
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function createColorPicker(current, onChange) {
  const wrap = document.createElement('div');

  const grid = document.createElement('div');
  grid.className = 'color-grid';

  for (const color of NODE_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (color === current ? ' selected' : '');
    swatch.style.background = color;
    swatch.addEventListener('click', () => {
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      hexInput.value = color;
      onChange(color);
    });
    grid.appendChild(swatch);
  }
  wrap.appendChild(grid);

  const hexInput = document.createElement('input');
  hexInput.className = 'color-hex-input';
  hexInput.placeholder = '#rrggbb';
  hexInput.value = current;
  hexInput.maxLength = 7;
  hexInput.addEventListener('input', () => {
    const v = hexInput.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      onChange(v);
    }
  });
  wrap.appendChild(hexInput);

  return wrap;
}

function createSizeSelector(current, onChange) {
  const grid = document.createElement('div');
  grid.className = 'size-grid';
  const sizes = ['normal', 'large', 'wide', 'xlarge'];
  const labels = { normal: 'Normal', large: 'Large', wide: 'Wide', xlarge: 'X-Large' };

  for (const s of sizes) {
    const btn = document.createElement('button');
    btn.className = 'size-btn' + (s === current ? ' active' : '');
    btn.textContent = labels[s];
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(s);
    });
    grid.appendChild(btn);
  }
  return grid;
}

// Lazy import workaround for mixColors (avoid circular deps)
function await_import_mixColors() {
  // Inline the mix since we can't await here
  return {
    mixColors(a, b) {
      const h = hex => {
        const n = parseInt(hex.replace('#',''), 16);
        return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
      };
      const ra = h(a), rb = h(b);
      const to2 = n => n.toString(16).padStart(2,'0');
      return '#' + to2(Math.round((ra.r+rb.r)/2)) + to2(Math.round((ra.g+rb.g)/2)) + to2(Math.round((ra.b+rb.b)/2));
    }
  };
}

// ── Context Menu ──────────────────────────────────────────────

const ctxMenu = document.getElementById('context-menu');
const ctxList = document.getElementById('context-menu-list');
let ctxCloseHandler = null;

export function showContextMenu(x, y, items) {
  ctxList.innerHTML = '';

  for (const item of items) {
    if (item.separator) {
      const li = document.createElement('li');
      li.className = 'ctx-item separator';
      ctxList.appendChild(li);
      continue;
    }
    const li = document.createElement('li');
    li.className = 'ctx-item' + (item.danger ? ' danger' : '');
    li.textContent = item.label;
    li.addEventListener('click', () => {
      hideContextMenu();
      item.action?.();
    });
    ctxList.appendChild(li);
  }

  // Position — keep on screen
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top  = `${y}px`;
  ctxMenu.classList.remove('hidden');

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = ctxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth)  ctxMenu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) ctxMenu.style.top = `${y - rect.height}px`;
  });

  if (ctxCloseHandler) document.removeEventListener('mousedown', ctxCloseHandler);
  ctxCloseHandler = (e) => {
    if (!ctxMenu.contains(e.target)) hideContextMenu();
  };
  setTimeout(() => document.addEventListener('mousedown', ctxCloseHandler), 0);
}

export function hideContextMenu() {
  ctxMenu.classList.add('hidden');
  if (ctxCloseHandler) {
    document.removeEventListener('mousedown', ctxCloseHandler);
    ctxCloseHandler = null;
  }
}

// ── Connection Type Popup ─────────────────────────────────────

const connPopup = document.getElementById('connection-popup');
const connBtns = document.querySelectorAll('.conn-btn');
const connCancel = document.getElementById('conn-cancel');
let connCallback = null;

connBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    hideConnectionPopup();
    connCallback?.(type);
    connCallback = null;
  });
});

connCancel.addEventListener('click', () => {
  hideConnectionPopup();
  connCallback?.(null);
  connCallback = null;
});

export function showConnectionPopup(x, y, callback) {
  connCallback = callback;
  connPopup.style.left = `${x + 8}px`;
  connPopup.style.top  = `${y - 20}px`;
  connPopup.classList.remove('hidden');
  connPopup.style.pointerEvents = 'auto';
}

export function hideConnectionPopup() {
  connPopup.classList.add('hidden');
}

// ── Toolbar ───────────────────────────────────────────────────

const zoomDisplay = document.getElementById('zoom-display');
const saveIndicator = document.getElementById('save-indicator');
const projectNameEl = document.getElementById('project-name');

export function updateZoomDisplay(zoom) {
  zoomDisplay.textContent = Math.round(zoom * 100) + '%';
}

export function showSaveIndicator() {
  saveIndicator.textContent = '✓ Saved';
  saveIndicator.classList.add('visible');
  setTimeout(() => saveIndicator.classList.remove('visible'), 2000);
}

export function setProjectName(name) {
  projectNameEl.textContent = name || 'Untitled';
}

// ── Confirm Dialog ────────────────────────────────────────────

export function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';

  const box = document.createElement('div');
  box.className = 'confirm-box';

  const p = document.createElement('p');
  p.textContent = message;

  const btns = document.createElement('div');
  btns.className = 'confirm-box-btns';

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());

  const confirm = document.createElement('button');
  confirm.textContent = 'Delete';
  confirm.className = 'danger';
  confirm.addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });

  btns.appendChild(cancel);
  btns.appendChild(confirm);
  box.appendChild(p);
  box.appendChild(btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Startup Modal ─────────────────────────────────────────────

const startupModal = document.getElementById('startup-modal');
const btnPickFolder = document.getElementById('btn-pick-folder');
const projectGrid = document.getElementById('project-grid');
const startupActions = document.getElementById('startup-actions');

// Button is wired once; callback is set externally before any async work
let _pickFolderCb = null;
btnPickFolder.addEventListener('click', () => _pickFolderCb?.());

export function setPickFolderCallback(cb) {
  _pickFolderCb = cb;
}

export function showStartupModal() {
  startupModal.classList.remove('hidden');
}

export function hideStartupModal() {
  startupModal.classList.add('hidden');
}

export function showProjectGrid(projects, onSelect, onNew, onPickFolder) {
  projectGrid.innerHTML = '';
  projectGrid.classList.remove('hidden');

  // "Change folder" option
  if (onPickFolder) {
    const changeFolderBtn = document.createElement('button');
    changeFolderBtn.className = 'toolbar-btn';
    changeFolderBtn.textContent = 'Change Folder';
    changeFolderBtn.style.marginBottom = '12px';
    changeFolderBtn.style.display = 'block';
    changeFolderBtn.addEventListener('click', onPickFolder);
    startupActions.appendChild(changeFolderBtn);
  }

  // New project card
  const newCard = document.createElement('div');
  newCard.className = 'project-card new-card';
  newCard.textContent = '+';
  newCard.title = 'New Project';
  newCard.addEventListener('click', onNew);
  projectGrid.appendChild(newCard);

  for (const proj of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'project-card-name';
    nameEl.textContent = proj.name.replace('.json', '');

    const dateEl = document.createElement('div');
    dateEl.className = 'project-card-date';
    dateEl.textContent = new Date(proj.lastModified).toLocaleDateString();

    card.appendChild(nameEl);
    card.appendChild(dateEl);
    card.addEventListener('click', () => onSelect(proj));
    projectGrid.appendChild(card);
  }
}

// ── Zoom display loop hook ────────────────────────────────────
// Called from main.js render loop
export function tickUI() {
  updateZoomDisplay(state.viewport.zoom);
}
