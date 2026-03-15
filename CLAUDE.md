# UnityDiagram — Claude Code Build Plan

## What This Is
A local HTML/JS diagramming tool for visualizing Unity system architecture. Think Twine's node editor but purpose-built for planning classes, components, characters, and their relationships. Runs as a local file in Chrome — no server needed.

---

## Tech Stack & Constraints

- **Pure HTML + JS ES Modules** — no frameworks, no build step. `index.html` loads `src/*.js` as `<script type="module">`.
- **HTML5 Canvas API** — all diagram rendering happens on a `<canvas>`. No DOM nodes for diagram elements. This is non-negotiable for performance at 1000+ nodes.
- **File System Access API** (`window.showDirectoryPicker`) — Chrome/Edge only. Works on `file://`. Persisted in IndexedDB so the folder is remembered between sessions.
- **IndexedDB** — for persisting the directory handle and any app settings.
- **No external dependencies** — zero npm, zero CDN.

---

## File Structure

```
index.html
src/
  main.js           ← entry point, wires everything together
  canvas.js         ← Canvas renderer, pan/zoom, viewport culling
  nodes.js          ← Node data model + rendering logic
  connections.js    ← Connection data model + rendering logic
  groups.js         ← Group data model + rendering logic
  interaction.js    ← Mouse/keyboard event handling (drag, select, connect)
  ui.js             ← Sidebar panels, modals, toolbar (HTML/DOM, not canvas)
  filesystem.js     ← File System Access API: folder pick, list, save, load
  store.js          ← Central state object (diagram data, selection, viewport)
  history.js        ← Undo stack (last 10 node creation/deletion actions)
  utils.js          ← Color mixing, math helpers, UUID generation
style.css
```

---

## Visual Design

**Theme:** Dark industrial. Not "VS Code dark" — more like a dark workshop.
- Background: `#1a1a1f`
- Canvas: `#16161a`
- Grid dots: subtle `#2a2a32`
- Panel/sidebar: `#1f1f26`
- Accent: `#4a9eff` (selection highlight)
- Text: `#c8c8d4`
- Borders: `#2e2e3a`

**Font:** `JetBrains Mono` (load from Google Fonts in `<head>`) for node names and labels. Clean monospace fits the dev tool aesthetic.

---

## State Shape (`store.js`)

```js
const state = {
  // Viewport
  viewport: { x: 0, y: 0, zoom: 1 },

  // Diagram data
  nodes: Map<id, Node>,
  connections: Map<id, Connection>,
  groups: Map<id, Group>,

  // Interaction state
  selection: { nodeIds: Set, connectionIds: Set, groupIds: Set },
  dragging: null,       // { type: 'node'|'group'|'canvas', ... }
  connecting: null,     // { fromNodeId, fromPort, currentX, currentY }
  editingNode: null,    // id of node open in edit panel

  // Undo
  undoStack: [],        // last 10 snapshots, each is { nodes, connections } plain objects

  // File system
  dirHandle: null,      // FileSystemDirectoryHandle (also in IndexedDB)
  currentFile: null,    // filename of loaded project
};
```

---

## Canvas System (`canvas.js`)

### Pan & Zoom
- Pan: **hold right-click + drag** (right mousedown → mousemove → mouseup). Cursor changes to `grabbing` while panning. This replaces the old space+drag behavior entirely.
- Middle mouse drag also pans (bonus convenience)
- Zoom: scroll wheel, clamped to `[0.05, 4]`
- Transform all draws with `ctx.setTransform(zoom, 0, 0, zoom, panX, panY)`
- **Important:** right-click pan must be distinguished from right-click context menu. Rule: if the mouse moved more than 4px during the right mousedown → it was a pan, suppress the context menu (`contextmenu` event → `preventDefault()`). If it didn't move → it was a right-click, show context menu.

### Viewport Culling
Every frame, before drawing nodes/connections/groups:
1. Compute world-space viewport rect: `{ x: -panX/zoom, y: -panY/zoom, w: canvas.width/zoom, h: canvas.height/zoom }`
2. Only iterate and draw nodes whose bounding box intersects this rect
3. For connections: only draw if either endpoint node is visible (or the line passes through viewport — use line-AABB intersection)
4. Groups: same AABB check

Use a **spatial index** (simple grid bucketing, 200×200 world units per cell) to avoid iterating all nodes every frame. Update a node's bucket when it moves. On each frame, only check buckets that overlap the viewport.

### Render Order (back to front)
1. Grid dots
2. Groups (filled rect + label)
3. Connections (lines)
4. Nodes
5. In-progress connection drag line
6. Selection highlight overlays

### Grid
Infinite dot grid. Dot spacing = 30 world units. Scale dot density with zoom (at zoom < 0.3, switch to larger spacing to avoid visual noise).

---

## Node System (`nodes.js`)

### Node Data Model
```js
{
  id: string,           // UUID
  type: 'standard' | 'text',
  x: number, y: number, // world position (top-left)
  size: 'normal' | 'large' | 'wide' | 'xlarge',
  color: string,        // hex, e.g. '#4a7fc1'
  name: string,
  description: string,  // hidden by default, shown when node is "open"
  descriptionVisible: boolean,
  groupId: string|null,
}
```

### Size Dimensions (world units)
| Size    | Width | Height |
|---------|-------|--------|
| normal  | 180   | 80     |
| large   | 180   | 160    |
| wide    | 320   | 80     |
| xlarge  | 320   | 160    |

Text nodes ignore size — they resize based on content (min 120×40).

### Node Rendering (Canvas)
- Rounded rect fill with node color (alpha ~0.85 so it has slight transparency)
- Slightly lighter top edge for depth
- Name text centered, truncated with ellipsis if too long
- Description text shown below name if `descriptionVisible === true` — wrap text to node width
- Small colored dot in top-right indicating the node type (optional, can be toggle)
- When selected: 2px bright blue glow (`ctx.shadowBlur`, `ctx.shadowColor`)
- **Port balls**: always-visible small filled circles (radius ~6 world units) centered on the left and right edges of every node. Color: slightly lighter than the node color. On hover: scale up to radius 9, add a white ring. These are the only valid drag-start points for creating connections — clicking the node body itself does NOT start a connection.

### Port Ball Hit Testing
Port balls are small so hit detection uses a generous radius (12 world units from center). Check ports before checking the node body in the hit-test order.

### Text Node Rendering
- No border radius — slightly angled look (skewed box or parallelogram, subtle)
- Just text content, color-tinted background
- Resize handle in bottom-right corner

---

## Connection System (`connections.js`)

### Connection Data Model
```js
{
  id: string,
  fromNodeId: string,
  toNodeId: string,
  type: 'hard' | 'assign' | 'signal',
  color: string,   // computed: mix of from/to node colors, cached here
}
```

### Connection Types — Visual Differentiation
| Type     | Meaning in Unity                    | Line Style           |
|----------|-------------------------------------|----------------------|
| `hard`   | Singleton / direct code reference   | Solid line, 2px      |
| `assign` | Editor-assigned reference (Inspector)| Dashed: `[8, 4]`    |
| `signal` | Event/signal emission & catching    | Dot-dash: `[2, 6]` + animated offset each frame |

The `signal` type gets an animated marching ants effect (increment dash offset in `requestAnimationFrame`).

### Color Mixing
`utils.js` → `mixColors(hexA, hexB)`: parse both to RGB, average, return hex. Store on the connection so it doesn't recompute every frame.

### Drawing Connections
Use **cubic bezier curves** (not straight lines):
- Control points: offset horizontally from the from/to ports by ~80 world units
- Makes curved "flow" between nodes feel natural

When a node is selected:
- All connections to/from that node: increase line width to 3px, increase opacity
- All other connections: reduce opacity to 0.2

### Creating Connections
- Hover over a node → port balls on left/right edges scale up (always visible, but visually respond to hover)
- Click+drag from a **port ball** → draws a live bezier preview line from that port to the cursor
- Release on another node's port ball or body → opens a small popup: "What type of connection?" (3 buttons: Hard / Assign / Signal)
- **Release on empty space → creates a new standard node** at the drop location, then immediately opens the "What type of connection?" popup to connect from the original node to the new one. The new node gets a default name ("New Node") and the same color as the source node as a starting point.
- Release back on the source node → cancel

---

## Group System (`groups.js`)

### Group Data Model
```js
{
  id: string,
  x: number, y: number,
  width: number, height: number,
  name: string,
  color: string,   // hex, used at low alpha for fill
}
```

### Group Rendering
- Filled rect with `color` at 15% alpha
- 1px border with `color` at 60% alpha
- Name label in top-left corner, slightly larger font, same color
- Rendered behind all nodes — drawn first in render order

### Group Interaction
- Click+drag on group border/label area → move group (does NOT move contained nodes automatically — groups are purely visual)
- Resize handle in bottom-right corner
- Double-click label → inline rename (DOM input overlay, positioned over canvas coords)
- Right-click → context menu: Rename / Change Color / Delete

---

## Undo System (`history.js`)

Tracks the last 10 **node-level** actions only (not viewport changes, not connection type edits). This keeps it simple and covers the most painful mistakes.

### What gets tracked
| Action | Snapshot timing |
|--------|----------------|
| Create node | push before creation |
| Delete node(s) | push before deletion |
| Move node(s) | push on mousedown (before drag starts) |
| Paste nodes | push before paste |
| Drag-to-create node (from port) | push before the new node is added |

### Implementation
```js
// history.js
const MAX_UNDO = 10;

function pushSnapshot(state) {
  const snapshot = {
    nodes: serializeNodes(state.nodes),       // plain JSON-safe array
    connections: serializeConnections(state.connections),
  };
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
}

function undo(state) {
  if (state.undoStack.length === 0) return;
  const snapshot = state.undoStack.pop();
  restoreSnapshot(state, snapshot);
  state.dirty = true;
}
```

Undo does NOT track: viewport pan/zoom, group moves, description text edits (those are auto-saved immediately).

---

## Copy/Paste System

### Copy
- Ctrl+C (or right-click → Copy) on selected nodes → store copies in `state.clipboard`:
```js
state.clipboard = {
  nodes: selectedNodes.map(n => ({ ...n })),   // deep copy
  connections: connectionsWithBothEndsSelected, // only internal connections
  offsetApplied: false,
};
```

### Paste
- Ctrl+V (or right-click empty space → Paste) → paste nodes with a **+20/+20 world-unit offset** from originals so they don't land exactly on top
- Each pasted node gets a new UUID
- Internal connections between the pasted nodes are re-created with new UUIDs pointing to the new node IDs
- Connections to external (non-copied) nodes are **not** duplicated
- Pasted nodes become the new selection immediately
- Push undo snapshot before pasting

---



### Mouse Event Handling
All events on the canvas element. Convert screen coords to world coords:
```js
function screenToWorld(sx, sy, viewport) {
  return {
    x: (sx - viewport.x) / viewport.zoom,
    y: (sy - viewport.y) / viewport.zoom,
  };
}
```

**Hit testing order** (top to bottom, stop at first hit):
1. **Port balls** (left/right edge circles on nodes, ~12wu hit radius) — LEFT click only → start connection drag
2. Node body — LEFT click → select/drag node body
3. Group resize handles
4. Group label areas — LEFT click → drag group
5. Groups body — LEFT click → drag group
6. Canvas — LEFT click+drag → lasso sweep selection; RIGHT click+drag → pan

### Selection
- **Left-click on a node body** → select it (deselect others unless Shift held)
- **Left-click on empty space** → clear selection
- **Left-click + drag on empty space** → lasso/sweep selection: as the mouse moves, any node whose bounding box the cursor passes over gets added to the selection in real time. Draw a subtle trailing highlight line to show the sweep path. On mouseup, all touched nodes are selected. This is intentionally "paint over" behavior, not a rubber-band rectangle.
- **Left-click + drag on empty space with Shift held** → additive lasso (adds to existing selection)
- Selected nodes can be moved together or deleted — but **not** edited in bulk (editing opens the panel for a single node only)

### Node Drag
- Mousedown on **node body** (not port balls) → mark as dragging
- Mousemove → update all selected node positions by delta
- Mouseup → commit and **push undo snapshot**

### Context Menu
Right-click on node (no movement, see pan rule above) → DOM context menu:
- Edit node (open side panel)
- Duplicate / Copy
- Delete
- Change size (submenu: Normal / Large / Wide / X-Large)

Right-click on empty space:
- Add Standard Node (placed at click position)
- Add Text Node (placed at click position)
- Add Group
- Paste (if clipboard has copied nodes)

---

## UI System (`ui.js`)

All UI panels are DOM elements overlaid on top of the canvas.

### Layout
```
┌──────────────────────────────────────────────┐
│  Toolbar (top bar, ~40px tall)               │
├────────────────────────┬─────────────────────┤
│                        │                     │
│   Canvas (full area)   │  Side Panel (280px) │
│                        │  shown when editing │
│                        │                     │
└────────────────────────┴─────────────────────┘
```

### Toolbar
- App name/logo left
- Center: current project filename
- Right: Save button | New button | zoom % display | fit-to-screen button

### Side Panel — Node Edit
Opens when double-clicking a node or right-click → Edit.
Contains:
- Name field (text input)
- Description textarea
- Toggle: Show description on node (checkbox)
- Color picker (a grid of preset colors + one custom hex input)
- Size selector (4 buttons: Normal / Large / Wide / XL)
- "Delete Node" button at bottom (red, confirmation required)

For text nodes: just text content textarea + color picker.

### Startup Modal — Project Picker
On load, before anything else:
1. Check IndexedDB for saved `dirHandle`
2. If found: call `dirHandle.queryPermission()` — if granted, list `.json` files, show project picker modal
3. If not found or permission denied: show "Select your diagrams folder" button
4. Project picker shows: grid of project cards (name + last modified date), + "New Project" card
5. Click a project → load it, close modal
6. "New Project" → ask for name → create empty JSON → load it

---

## File System (`filesystem.js`)

### Folder Setup
```js
// On first launch:
const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
// Persist to IndexedDB (use idb-keyval pattern — inline it, no library)
await saveToIndexedDB('dirHandle', dirHandle);

// On subsequent launches:
const dirHandle = await loadFromIndexedDB('dirHandle');
const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
if (perm !== 'granted') await dirHandle.requestPermission({ mode: 'readwrite' });
```

### Listing Projects
```js
async function listProjects(dirHandle) {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.endsWith('.json')) {
      const file = await handle.getFile();
      files.push({ name, lastModified: file.lastModified, handle });
    }
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}
```

### Save Format (JSON)
```json
{
  "version": 1,
  "name": "My Unity Project",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [ ...array of node objects ],
  "connections": [ ...array of connection objects ],
  "groups": [ ...array of group objects ]
}
```

### Auto-save
Debounced: any state change → wait 2 seconds of inactivity → auto-save to current file. Show a small "Saved" indicator in toolbar that fades out.

---

## Performance Notes

- **RequestAnimationFrame loop**: always running, but only re-renders when `state.dirty = true`. Set dirty on any interaction.
- **Spatial grid**: 200×200 world-unit cells. `Map<cellKey, Set<nodeId>>`. On node move: remove from old cell, add to new. On render: compute which cells overlap viewport, only draw those nodes.
- **Text rendering**: Cache node label layouts. Only re-measure text when name/description changes.
- **Connection culling**: Skip drawing connections where both endpoints are outside viewport.
- **Zoom-based LOD**: At zoom < 0.3, don't render description text or port circles. Just draw colored rects with names.

---

## Build Order for Claude Code

Implement in this exact order — each phase should be testable before moving on:

1. **`index.html` + `style.css`** — layout shell, canvas element, sidebar placeholder, toolbar
2. **`store.js`** — state object with a few test nodes/connections hardcoded
3. **`canvas.js`** — render loop, pan/zoom, grid dots, draw placeholder colored rects for nodes
4. **`nodes.js`** — full node rendering (all types, sizes, selection highlight)
5. **`connections.js`** — draw bezier connections with type styles, color mixing, selection dimming
6. **`groups.js`** — group rendering behind nodes
7. **`interaction.js`** — node drag, canvas right-click pan, lasso sweep select, port ball hover, connection drawing, drag-to-empty-space creates node
8. **`history.js`** — undo stack, copy/paste clipboard
9. **`ui.js`** — side panel (node edit), context menus, toolbar
10. **`filesystem.js`** — folder picker, project listing modal, save/load
11. **Polish pass** — animated signals, auto-save indicator, zoom LOD, keyboard shortcuts

---

## Keyboard Shortcuts
| Key                | Action                                        |
|--------------------|-----------------------------------------------|
| Delete / Backspace | Delete selected nodes/connections             |
| Escape             | Cancel connection drag / close panel / deselect |
| Ctrl+S             | Save                                          |
| Ctrl+Z             | Undo (last 10 node actions)                   |
| Ctrl+C             | Copy selected nodes                           |
| Ctrl+V             | Paste (offset +20/+20 from originals)         |
| Ctrl+D             | Duplicate selected (shortcut for copy+paste)  |
| F                  | Fit all nodes to screen                       |
| Ctrl+scroll        | Zoom (alternative to scroll wheel)            |
| Tab                | Cycle selection to next node                  |
| Right-click + drag | Pan canvas                                    |

---

## What NOT to Build
- No redo (undo only, can add later)
- No export to image (can add later)
- No collaboration/cloud
- No play/run mode
- No node templates library (yet)
