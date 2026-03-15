// ============================================================
// app.js — Single-file bundle (no ES modules, works on file://)
// ============================================================

// ── utils ────────────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function mixColors(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex({
    r: Math.round((a.r + b.r) / 2),
    g: Math.round((a.g + b.g) / 2),
    b: Math.round((a.b + b.b) / 2),
  });
}

function lightenColor(hex, factor = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.min(255, Math.round(r + (255 - r) * factor)),
    g: Math.min(255, Math.round(g + (255 - g) * factor)),
    b: Math.min(255, Math.round(b + (255 - b) * factor)),
  });
}

function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function aabbIntersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2-x1)**2 + (y2-y1)**2);
}

function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  const L=1,R=2,B=4,T=8;
  function code(x,y){let c=0;if(x<rx)c|=L;else if(x>rx+rw)c|=R;if(y<ry)c|=T;else if(y>ry+rh)c|=B;return c;}
  let c1=code(x1,y1),c2=code(x2,y2);
  for(let i=0;i<10;i++){
    if(!(c1|c2))return true;
    if(c1&c2)return false;
    const c=c1||c2;let x,y;
    if(c&B){x=x1+(x2-x1)*(ry+rh-y1)/(y2-y1);y=ry+rh;}
    else if(c&T){x=x1+(x2-x1)*(ry-y1)/(y2-y1);y=ry;}
    else if(c&R){y=y1+(y2-y1)*(rx+rw-x1)/(x2-x1);x=rx+rw;}
    else{y=y1+(y2-y1)*(rx-x1)/(x2-x1);x=rx;}
    if(c===c1){x1=x;y1=y;c1=code(x,y);}else{x2=x;y2=y;c2=code(x,y);}
  }
  return false;
}

const NODE_COLORS = [
  '#4a7fc1','#5a9a5a','#9a5a5a','#9a7a3a',
  '#6a5a9a','#3a9a8a','#9a4a7a','#4a8a7a',
  '#7a5a3a','#5a6a9a','#8a6a3a','#3a6a4a',
];

// ── store ────────────────────────────────────────────────────

const NODE_SIZES = {
  normal: { w: 180, h: 80 },
  large:  { w: 180, h: 160 },
  wide:   { w: 320, h: 80 },
  xlarge: { w: 320, h: 160 },
};

function createNode(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    type: opts.type || 'standard',
    x: opts.x ?? 0, y: opts.y ?? 0,
    size: opts.size || 'normal',
    color: opts.color || '#4a7fc1',
    name: opts.name || 'New Node',
    description: opts.description || '',
    descriptionVisible: opts.descriptionVisible ?? false,
    groupId: opts.groupId || null,
  };
}

function createConnection(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    fromNodeId: opts.fromNodeId,
    toNodeId: opts.toNodeId,
    type: opts.type || 'hard',
    color: opts.color || '#888888',
  };
}

function createGroup(opts = {}) {
  return {
    id: opts.id || generateUUID(),
    x: opts.x ?? 0, y: opts.y ?? 0,
    width: opts.width ?? 300, height: opts.height ?? 200,
    name: opts.name || 'Group',
    color: opts.color || '#4a7fc1',
  };
}

const state = {
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: new Map(), connections: new Map(), groups: new Map(),
  selection: { nodeIds: new Set(), connectionIds: new Set(), groupIds: new Set() },
  dragging: null, connecting: null, editingNode: null,
  lasso: null,
  undoStack: [],
  clipboard: null,
  currentFile: null,
  dirty: true,
  _saveTimer: null,
};

let _scheduleSaveFn = null;
function markDirty() { state.dirty = true; _scheduleSaveFn?.(); }

// ── nodes ────────────────────────────────────────────────────

const PORT_RADIUS = 6, PORT_RADIUS_HOVER = 9, PORT_HIT_RADIUS = 12;
const TEXT_NODE_MIN_W = 120, TEXT_NODE_MIN_H = 40;
const CORNER_RADIUS = 6;

function getNodeSize(node) {
  if (node.type === 'text') return { w: node._tw || TEXT_NODE_MIN_W, h: node._th || TEXT_NODE_MIN_H };
  return NODE_SIZES[node.size] || NODE_SIZES.normal;
}

function getPortPositions(node) {
  const sz = getNodeSize(node);
  const midY = node.y + sz.h / 2;
  return { left: { x: node.x, y: midY }, right: { x: node.x + sz.w, y: midY } };
}

function hitTestPort(node, wx, wy) {
  const ports = getPortPositions(node);
  for (const side of ['left', 'right']) {
    const p = ports[side];
    if ((wx-p.x)**2 + (wy-p.y)**2 <= PORT_HIT_RADIUS**2) return side;
  }
  return null;
}

function hitTestNodeBody(node, wx, wy) {
  const sz = getNodeSize(node);
  return wx >= node.x && wx <= node.x + sz.w && wy >= node.y && wy <= node.y + sz.h;
}

function drawNode(ctx, node, selected, editing, zoom) {
  if (node.type === 'text') drawTextNode(ctx, node, selected, zoom);
  else drawStandardNode(ctx, node, selected, editing, zoom);
}

function drawStandardNode(ctx, node, selected, editing, zoom) {
  const sz = getNodeSize(node);
  const { x, y } = node;
  const w = sz.w, h = sz.h;
  const lowZoom = zoom < 0.3;
  ctx.save();
  if (selected || editing) { ctx.shadowColor = '#4a9eff'; ctx.shadowBlur = 12 / zoom; }
  ctx.beginPath(); roundRect(ctx, x, y, w, h, CORNER_RADIUS);
  ctx.fillStyle = hexToRgba(node.color, 0.85); ctx.fill();
  ctx.beginPath(); roundRect(ctx, x, y, w, 4, CORNER_RADIUS);
  ctx.fillStyle = hexToRgba(lightenColor(node.color, 0.3), 0.6); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#4a9eff' : hexToRgba(lightenColor(node.color, 0.2), 0.5);
  ctx.lineWidth = (selected ? 2 : 1) / zoom;
  ctx.beginPath(); roundRect(ctx, x, y, w, h, CORNER_RADIUS); ctx.stroke();
  if (!lowZoom) {
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '500 12px JetBrains Mono, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let nameY = y + h / 2;
    if (node.descriptionVisible && node.description) nameY = y + h * 0.3;
    ctx.fillText(truncateText(ctx, node.name, w - 24), x + w / 2, nameY);
    if (node.descriptionVisible && node.description) {
      ctx.fillStyle = 'rgba(200,200,212,0.7)';
      ctx.font = '400 10px JetBrains Mono, monospace';
      const lines = wrapText(ctx, node.description, w - 24);
      let descY = y + h * 0.55 - lines.length * 7;
      for (const line of lines.slice(0, 4)) { ctx.fillText(line, x + w / 2, descY); descY += 14; }
    }
    ctx.beginPath(); ctx.arc(x + w - 12, y + 12, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,200,220,0.4)'; ctx.fill();
    drawPorts(ctx, node, zoom);
  }
  ctx.restore();
}

function drawPorts(ctx, node, zoom) {
  const ports = getPortPositions(node);
  const lightColor = lightenColor(node.color, 0.35);
  for (const side of ['left', 'right']) {
    const p = ports[side];
    const isHovered = node._hoveredPort === side;
    const r = isHovered ? PORT_RADIUS_HOVER : PORT_RADIUS;
    ctx.save();
    if (isHovered) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 6 / zoom; }
    if (isHovered) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = lightColor; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1 / zoom; ctx.stroke();
    ctx.restore();
  }
}

function drawTextNode(ctx, node, selected, zoom) {
  if (!node._tw) { node._tw = TEXT_NODE_MIN_W; node._th = TEXT_NODE_MIN_H; }
  const w = node._tw, h = node._th;
  const { x, y } = node;
  ctx.save();
  if (selected) { ctx.shadowColor = '#4a9eff'; ctx.shadowBlur = 10 / zoom; }
  ctx.beginPath();
  ctx.moveTo(x+6,y); ctx.lineTo(x+w,y); ctx.lineTo(x+w-6,y+h); ctx.lineTo(x,y+h); ctx.closePath();
  ctx.fillStyle = hexToRgba(node.color, 0.25); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#4a9eff' : hexToRgba(node.color, 0.6);
  ctx.lineWidth = (selected ? 2 : 1) / zoom; ctx.stroke();
  ctx.fillStyle = '#e8e8f0'; ctx.font = '400 11px JetBrains Mono, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const text = node.description || node.name;
  const lines = wrapText(ctx, text, w - 16);
  let ty = y + 10;
  for (const line of lines) { ctx.fillText(line, x + 10, ty); ty += 16; }
  ctx.fillStyle = hexToRgba(node.color, 0.5);
  ctx.beginPath(); ctx.moveTo(x+w-12,y+h); ctx.lineTo(x+w-4,y+h); ctx.lineTo(x+w-4,y+h-12); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = []; let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = word; }
    else current = test;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

// ── connections ───────────────────────────────────────────────

const BEZIER_CTRL = 80;

function drawConnections(ctx, visibleNodeIds, signalDashOffset, zoom) {
  const { nodes, connections, selection } = state;
  const hasSelection = selection.nodeIds.size > 0 || selection.connectionIds.size > 0;
  const vp = getViewportRect();

  for (const conn of connections.values()) {
    const fromNode = nodes.get(conn.fromNodeId);
    const toNode   = nodes.get(conn.toNodeId);
    if (!fromNode || !toNode) continue;

    const fSz = getNodeSize(fromNode), tSz = getNodeSize(toNode);
    const fIn = aabbIntersects(fromNode.x,fromNode.y,fSz.w,fSz.h,vp.x,vp.y,vp.w,vp.h);
    const tIn = aabbIntersects(toNode.x,toNode.y,tSz.w,tSz.h,vp.x,vp.y,vp.w,vp.h);
    if (!fIn && !tIn) {
      const fp = getPortPositions(fromNode).right, tp = getPortPositions(toNode).left;
      if (!lineIntersectsRect(fp.x,fp.y,tp.x,tp.y,vp.x,vp.y,vp.w,vp.h)) continue;
    }

    let alpha = 1;
    if (hasSelection) {
      const connSel = selection.connectionIds.has(conn.id);
      const endpSel = selection.nodeIds.has(conn.fromNodeId) || selection.nodeIds.has(conn.toNodeId);
      if (!connSel && !endpSel) alpha = 0.15;
    }
    const connSel = selection.connectionIds.has(conn.id);
    const endpSel = selection.nodeIds.has(conn.fromNodeId) || selection.nodeIds.has(conn.toNodeId);
    const lw = (connSel || endpSel) ? 3 : 2;
    drawOneConnection(ctx, conn, fromNode, toNode, alpha, lw, signalDashOffset, zoom);
  }
}

function drawOneConnection(ctx, conn, fromNode, toNode, alpha, lineWidth, signalDashOffset, zoom) {
  const fPorts = getPortPositions(fromNode), tPorts = getPortPositions(toNode);
  const fCx = fromNode.x + getNodeSize(fromNode).w / 2;
  const tCx = toNode.x   + getNodeSize(toNode).w   / 2;
  const fp = fCx <= tCx ? fPorts.right : fPorts.left;
  const tp = fCx <= tCx ? tPorts.left  : tPorts.right;
  const dx = Math.abs(tp.x - fp.x);
  const ctrl = Math.max(BEZIER_CTRL, dx * 0.4);
  const cp1x = fp.x + ctrl, cp1y = fp.y, cp2x = tp.x - ctrl, cp2y = tp.y;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = hexToRgba(conn.color, 1);
  ctx.lineWidth = lineWidth / zoom; ctx.lineCap = 'round';
  if      (conn.type === 'hard')   ctx.setLineDash([]);
  else if (conn.type === 'assign') ctx.setLineDash([8/zoom, 4/zoom]);
  else if (conn.type === 'signal') { ctx.setLineDash([2/zoom, 6/zoom]); ctx.lineDashOffset = -signalDashOffset/zoom; }
  ctx.beginPath(); ctx.moveTo(fp.x,fp.y); ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,tp.x,tp.y); ctx.stroke();
  drawArrow(ctx, cp2x, cp2y, tp.x, tp.y, lineWidth/zoom, conn.color, alpha, zoom);
  ctx.setLineDash([]); ctx.restore();
}

function drawArrow(ctx, fx, fy, tx, ty, lw, color, alpha, zoom) {
  const angle = Math.atan2(ty-fy, tx-fx);
  const size = Math.max(8, lw*4) / zoom;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.translate(tx,ty); ctx.rotate(angle);
  ctx.moveTo(0,0); ctx.lineTo(-size,size*0.45); ctx.lineTo(-size,-size*0.45); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawInProgressConnection(ctx, zoom) {
  const { connecting, nodes } = state;
  if (!connecting) return;
  const fromNode = nodes.get(connecting.fromNodeId);
  if (!fromNode) return;
  const ports = getPortPositions(fromNode);
  const fp = connecting.fromPort === 'left' ? ports.left : ports.right;
  const tx = connecting.currentX, ty = connecting.currentY;
  const dx = Math.abs(tx - fp.x);
  const ctrl = Math.max(BEZIER_CTRL, dx * 0.4);
  const dir = connecting.fromPort === 'right' ? 1 : -1;
  ctx.save();
  ctx.strokeStyle = 'rgba(74,158,255,0.7)'; ctx.lineWidth = 2/zoom;
  ctx.setLineDash([6/zoom,4/zoom]); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fp.x,fp.y);
  ctx.bezierCurveTo(fp.x+ctrl*dir,fp.y, tx-ctrl*dir,ty, tx,ty); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(tx,ty,5/zoom,0,Math.PI*2);
  ctx.fillStyle = 'rgba(74,158,255,0.8)'; ctx.fill();
  ctx.restore();
}

// ── groups ────────────────────────────────────────────────────

const RESIZE_HANDLE = 14, GROUP_BORDER_HIT = 8;

function drawGroup(ctx, group, selected, zoom) {
  const { x, y, width: w, height: h, color, name } = group;
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.1); ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = selected ? '#4a9eff' : hexToRgba(color, 0.55);
  ctx.lineWidth = (selected ? 2 : 1.5) / zoom;
  if (selected) { ctx.shadowColor = '#4a9eff'; ctx.shadowBlur = 8/zoom; }
  ctx.strokeRect(x,y,w,h); ctx.shadowBlur = 0;
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.font = '500 13px JetBrains Mono, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(name, x+8, y+6);
  ctx.fillStyle = hexToRgba(color, 0.5);
  ctx.beginPath(); ctx.moveTo(x+w-RESIZE_HANDLE,y+h); ctx.lineTo(x+w,y+h); ctx.lineTo(x+w,y+h-RESIZE_HANDLE); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function hitTestGroup(group, wx, wy) {
  const { x, y, width: w, height: h } = group;
  if (wx>=x+w-RESIZE_HANDLE&&wx<=x+w&&wy>=y+h-RESIZE_HANDLE&&wy<=y+h) return 'resize';
  if (wx>=x&&wx<=x+w&&wy>=y&&wy<=y+GROUP_BORDER_HIT+14) return 'label';
  const onL=wx>=x&&wx<=x+GROUP_BORDER_HIT, onR=wx>=x+w-GROUP_BORDER_HIT&&wx<=x+w;
  const onT=wy>=y&&wy<=y+GROUP_BORDER_HIT, onB=wy>=y+h-GROUP_BORDER_HIT&&wy<=y+h;
  if ((onL||onR||onT||onB)&&wx>=x&&wx<=x+w&&wy>=y&&wy<=y+h) return 'border';
  return null;
}

// ── canvas / render ───────────────────────────────────────────

const GRID_SPACING = 30, CELL_SIZE = 200;
const spatialGrid = new Map();
let canvasEl, ctx;
let signalDashOffset = 0;

function cellKey(cx,cy){ return cx+','+cy; }
function worldToCell(x,y){ return { cx: Math.floor(x/CELL_SIZE), cy: Math.floor(y/CELL_SIZE) }; }
function getCellsForAABB(x,y,w,h){
  const x0=Math.floor(x/CELL_SIZE),y0=Math.floor(y/CELL_SIZE);
  const x1=Math.floor((x+w)/CELL_SIZE),y1=Math.floor((y+h)/CELL_SIZE);
  const cells=[];
  for(let cx=x0;cx<=x1;cx++) for(let cy=y0;cy<=y1;cy++) cells.push({cx,cy});
  return cells;
}

function addNodeToGrid(node){
  const sz=getNodeSize(node);
  for(const{cx,cy}of getCellsForAABB(node.x,node.y,sz.w,sz.h)){
    const k=cellKey(cx,cy);
    if(!spatialGrid.has(k))spatialGrid.set(k,new Set());
    spatialGrid.get(k).add(node.id);
  }
}
function removeNodeFromGrid(node){
  const sz=getNodeSize(node);
  for(const{cx,cy}of getCellsForAABB(node.x,node.y,sz.w,sz.h)){
    const b=spatialGrid.get(cellKey(cx,cy));
    if(b)b.delete(node.id);
  }
}
function updateNodeInGrid(node,oldX,oldY){
  const sz=getNodeSize(node);
  for(const{cx,cy}of getCellsForAABB(oldX,oldY,sz.w,sz.h)){
    const b=spatialGrid.get(cellKey(cx,cy));if(b)b.delete(node.id);
  }
  addNodeToGrid(node);
}
function rebuildSpatialGrid(){
  spatialGrid.clear();
  for(const node of state.nodes.values()) addNodeToGrid(node);
}

function getViewportRect(){
  const {x,y,zoom}=state.viewport;
  return {x:-x/zoom,y:-y/zoom,w:canvasEl.width/zoom,h:canvasEl.height/zoom};
}

function getVisibleNodeIds(){
  const vp=getViewportRect();
  const cells=getCellsForAABB(vp.x,vp.y,vp.w,vp.h);
  const visible=new Set();
  for(const{cx,cy}of cells){
    const bucket=spatialGrid.get(cellKey(cx,cy));
    if(bucket){
      for(const id of bucket){
        const node=state.nodes.get(id);
        if(node){
          const sz=getNodeSize(node);
          if(aabbIntersects(node.x,node.y,sz.w,sz.h,vp.x,vp.y,vp.w,vp.h)) visible.add(id);
        }
      }
    }
  }
  return visible;
}

function initCanvas(el){
  canvasEl=el; ctx=el.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize',()=>{resizeCanvas();state.dirty=true;});
  startLoop();
}

function resizeCanvas(){
  canvasEl.width=canvasEl.clientWidth;
  canvasEl.height=canvasEl.clientHeight;
  state.dirty=true;
}

function startLoop(){
  function loop(){
    requestAnimationFrame(loop);
    signalDashOffset=(signalDashOffset+0.5)%24;
    let hasSignal=false;
    for(const c of state.connections.values()) if(c.type==='signal'){hasSignal=true;break;}
    if(!state.dirty&&!hasSignal)return;
    state.dirty=false;
    render();
  }
  loop();
}

function render(){
  const W=canvasEl.clientWidth, H=canvasEl.clientHeight;
  const {x:panX,y:panY,zoom}=state.viewport;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#16161a'; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.setTransform(zoom,0,0,zoom,panX,panY);
  const vp=getViewportRect();
  const visibleNodeIds=getVisibleNodeIds();
  drawGrid(vp,zoom);
  for(const group of state.groups.values())
    if(aabbIntersects(group.x,group.y,group.width,group.height,vp.x,vp.y,vp.w,vp.h))
      drawGroup(ctx,group,state.selection.groupIds.has(group.id),zoom);
  drawConnections(ctx,visibleNodeIds,signalDashOffset,zoom);
  for(const id of visibleNodeIds){
    const node=state.nodes.get(id);
    if(node) drawNode(ctx,node,state.selection.nodeIds.has(id),state.editingNode===id,zoom);
  }
  if(state.connecting) drawInProgressConnection(ctx,zoom);
  if(state.lasso&&state.lasso.points.length>1) drawLasso(state.lasso.points);
  ctx.restore();
  updateZoomDisplay(zoom);
}

function drawGrid(vp,zoom){
  let sp=GRID_SPACING;
  if(zoom<0.3)sp*=4; else if(zoom<0.6)sp*=2;
  const dotR=Math.max(0.5,1/zoom);
  const sx=Math.floor(vp.x/sp)*sp, sy=Math.floor(vp.y/sp)*sp;
  ctx.fillStyle='#2a2a32';
  for(let x=sx;x<vp.x+vp.w+sp;x+=sp)
    for(let y=sy;y<vp.y+vp.h+sp;y+=sp){
      ctx.beginPath(); ctx.arc(x,y,dotR,0,Math.PI*2); ctx.fill();
    }
}

function drawLasso(points){
  ctx.save();
  ctx.strokeStyle='rgba(74,158,255,0.6)'; ctx.lineWidth=1.5;
  ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
  ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}

function screenToWorld(sx,sy){
  const {x,y,zoom}=state.viewport;
  return {x:(sx-x)/zoom,y:(sy-y)/zoom};
}

function worldToScreen(wx,wy){
  const {x,y,zoom}=state.viewport;
  return {x:wx*zoom+x,y:wy*zoom+y};
}

function applyZoom(delta,sx,sy){
  const old=state.viewport.zoom;
  const nz=Math.max(0.05,Math.min(4,old*(1-delta*0.001)));
  const wx=(sx-state.viewport.x)/old, wy=(sy-state.viewport.y)/old;
  state.viewport.zoom=nz;
  state.viewport.x=sx-wx*nz; state.viewport.y=sy-wy*nz;
  state.dirty=true;
}

function fitToScreen(){
  if(state.nodes.size===0)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of state.nodes.values()){
    const sz=getNodeSize(n);
    minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+sz.w);maxY=Math.max(maxY,n.y+sz.h);
  }
  const pad=80,W=canvasEl.clientWidth,H=canvasEl.clientHeight;
  const zoom=Math.max(0.05,Math.min(4,Math.min(W/(maxX-minX+pad*2),H/(maxY-minY+pad*2))));
  state.viewport.zoom=zoom;
  state.viewport.x=(W-(minX+maxX)*zoom)/2;
  state.viewport.y=(H-(minY+maxY)*zoom)/2;
  state.dirty=true;
}

// ── history ───────────────────────────────────────────────────

const MAX_UNDO=10;

function pushSnapshot(){
  state.undoStack.push({
    nodes:[...state.nodes.values()].map(n=>({...n})),
    connections:[...state.connections.values()].map(c=>({...c})),
  });
  if(state.undoStack.length>MAX_UNDO) state.undoStack.shift();
}

function undo(){
  if(state.undoStack.length===0)return;
  const snap=state.undoStack.pop();
  state.nodes.clear();
  for(const n of snap.nodes) state.nodes.set(n.id,{...n});
  state.connections.clear();
  for(const c of snap.connections) state.connections.set(c.id,{...c});
  for(const id of [...state.selection.nodeIds]) if(!state.nodes.has(id)) state.selection.nodeIds.delete(id);
  for(const id of [...state.selection.connectionIds]) if(!state.connections.has(id)) state.selection.connectionIds.delete(id);
  if(state.editingNode&&!state.nodes.has(state.editingNode)) closeNodePanel();
  rebuildSpatialGrid();
  state.dirty=true;
}

// ── filesystem (IndexedDB) ────────────────────────────────────

const IDB_NAME='UnityDiagram', IDB_VER=2, IDB_STORE='projects';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(IDB_NAME,IDB_VER);
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE,{keyPath:'name'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function idbGetAll(){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readonly');const r=tx.objectStore(IDB_STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
}
async function idbGet(name){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readonly');const r=tx.objectStore(IDB_STORE).get(name);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
}
async function idbPut(record){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(record);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
}
async function idbDelete(name){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).delete(name);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
}

async function listProjects(){
  const all=await idbGetAll();
  return all.sort((a,b)=>(b.lastModified||0)-(a.lastModified||0));
}

async function loadProject(name){
  const record=await idbGet(name);
  if(!record)return;
  state.nodes.clear();state.connections.clear();state.groups.clear();
  state.selection.nodeIds.clear();state.selection.connectionIds.clear();state.selection.groupIds.clear();
  state.undoStack=[];state.editingNode=null;
  const data=record.data||{};
  if(data.viewport) Object.assign(state.viewport,data.viewport);
  for(const n of(data.nodes||[])) state.nodes.set(n.id,n);
  for(const c of(data.connections||[])) state.connections.set(c.id,c);
  for(const g of(data.groups||[])) state.groups.set(g.id,g);
  rebuildSpatialGrid();
  state.currentFile=name;
  setProjectName(name);
  state.dirty=true;
}

async function saveCurrentFile(){
  if(!state.currentFile)return;
  const data={
    version:1,
    viewport:{...state.viewport},
    nodes:[...state.nodes.values()],
    connections:[...state.connections.values()],
    groups:[...state.groups.values()],
  };
  await idbPut({name:state.currentFile,lastModified:Date.now(),data});
  showSaveIndicator();
}

async function createNewProject(name){
  const t=name.trim();if(!t)return;
  await idbPut({name:t,lastModified:Date.now(),data:{version:1,viewport:{x:0,y:0,zoom:1},nodes:[],connections:[],groups:[]}});
  await loadProject(t);
}

function scheduleSave(){
  clearTimeout(state._saveTimer);
  state._saveTimer=setTimeout(saveCurrentFile,2000);
}

// ── ui ────────────────────────────────────────────────────────

// ── Node Editor Panel ─────────────────────────────────────────

const nodeEditorEl   = document.getElementById('node-editor');
const nodeEditorLabel= document.getElementById('node-editor-label');
const nodeEditorCtrl = document.getElementById('node-editor-controls');
const nodeDescArea   = document.getElementById('node-editor-desc');
const nodeEditorActs = document.getElementById('node-editor-actions');
document.getElementById('node-editor-close').addEventListener('click', closeNodePanel);

function openNodePanel(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  state.editingNode = nodeId;
  nodeEditorEl.classList.remove('hidden');
  nodeEditorLabel.textContent = node.type === 'text' ? 'TEXT NODE' : 'EDIT NODE';
  renderEditorTop(node);
  renderEditorBottom(node);
  state.dirty = true;
}

function closeNodePanel() {
  state.editingNode = null;
  nodeEditorEl.classList.add('hidden');
  state.dirty = true;
}

// Top section: name, color swatches, size buttons
function renderEditorTop(node) {
  nodeEditorCtrl.innerHTML = '';

  // Name row
  const nameRow = document.createElement('div');
  nameRow.className = 'editor-name-row';
  const nameIn = document.createElement('input');
  nameIn.className = 'editor-name-input';
  nameIn.type = 'text';
  nameIn.value = node.name;
  nameIn.placeholder = 'Node name';
  nameIn.addEventListener('input', () => { node.name = nameIn.value; state.dirty = true; markDirty(); });
  nameRow.appendChild(nameIn);
  nodeEditorCtrl.appendChild(nameRow);

  // Color row: swatches + hex input
  const colorRow = document.createElement('div');
  colorRow.className = 'editor-color-row';
  let hexIn;
  for (const color of NODE_COLORS) {
    const sw = document.createElement('div');
    sw.className = 'editor-swatch' + (color === node.color ? ' selected' : '');
    sw.style.background = color;
    sw.addEventListener('click', () => {
      colorRow.querySelectorAll('.editor-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      if (hexIn) hexIn.value = color;
      node.color = color; state.dirty = true; markDirty();
    });
    colorRow.appendChild(sw);
  }
  hexIn = document.createElement('input');
  hexIn.className = 'editor-hex-input';
  hexIn.value = node.color;
  hexIn.maxLength = 7;
  hexIn.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexIn.value)) {
      colorRow.querySelectorAll('.editor-swatch').forEach(s => s.classList.remove('selected'));
      node.color = hexIn.value; state.dirty = true; markDirty();
    }
  });
  colorRow.appendChild(hexIn);
  nodeEditorCtrl.appendChild(colorRow);

  // Size row (only for standard nodes)
  if (node.type !== 'text') {
    const sizeRow = document.createElement('div');
    sizeRow.className = 'editor-size-row';
    const sizes = ['normal','large','wide','xlarge'];
    const labels = {normal:'Normal',large:'Large',wide:'Wide',xlarge:'XL'};
    for (const s of sizes) {
      const btn = document.createElement('button');
      btn.className = 'editor-size-btn' + (s === node.size ? ' active' : '');
      btn.textContent = labels[s];
      btn.addEventListener('click', () => {
        sizeRow.querySelectorAll('.editor-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        node.size = s; updateNodeInGrid(node, node.x, node.y); state.dirty = true; markDirty();
      });
      sizeRow.appendChild(btn);
    }
    nodeEditorCtrl.appendChild(sizeRow);
  }
}

// Bottom section: description textarea + toggle + delete
function renderEditorBottom(node) {
  // Description textarea (already in HTML, just wire it up)
  nodeDescArea.value = node.description || '';
  // Remove old listener by cloning
  const fresh = nodeDescArea.cloneNode(true);
  nodeDescArea.parentNode.replaceChild(fresh, nodeDescArea);
  // Re-assign reference via id lookup
  const descEl = document.getElementById('node-editor-desc');
  descEl.value = node.description || '';
  descEl.addEventListener('input', () => {
    node.description = descEl.value;
    if (node.type === 'text') node.name = descEl.value.split('\n')[0].slice(0, 40) || 'Text';
    state.dirty = true; markDirty();
  });

  nodeEditorActs.innerHTML = '';

  // Show-on-node toggle (standard nodes only)
  if (node.type !== 'text') {
    const toggleRow = document.createElement('label');
    toggleRow.className = 'editor-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = node.descriptionVisible;
    cb.addEventListener('change', () => { node.descriptionVisible = cb.checked; state.dirty = true; markDirty(); });
    toggleRow.appendChild(cb);
    toggleRow.appendChild(document.createTextNode(' Show on node'));
    nodeEditorActs.appendChild(toggleRow);
  }

  // Delete button
  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = 'Delete Node';
  del.style.marginTop = '4px';
  del.addEventListener('click', () => showConfirm('Delete this node?', () => {
    clearSelection(); state.selection.nodeIds.add(node.id); deleteSelected(); closeNodePanel();
  }));
  nodeEditorActs.appendChild(del);
}


// Context menu
const ctxMenuEl=document.getElementById('context-menu');
const ctxListEl=document.getElementById('context-menu-list');
let ctxCloseHandler=null;

function showContextMenu(x,y,items){
  ctxListEl.innerHTML='';
  for(const item of items){
    if(item.separator){const li=document.createElement('li');li.className='ctx-item separator';ctxListEl.appendChild(li);continue;}
    const li=document.createElement('li');li.className='ctx-item'+(item.danger?' danger':'');
    li.textContent=item.label;
    li.addEventListener('click',()=>{hideContextMenu();item.action?.();});
    ctxListEl.appendChild(li);
  }
  ctxMenuEl.style.left=x+'px';ctxMenuEl.style.top=y+'px';
  ctxMenuEl.classList.remove('hidden');
  requestAnimationFrame(()=>{
    const r=ctxMenuEl.getBoundingClientRect();
    if(r.right>window.innerWidth)ctxMenuEl.style.left=(x-r.width)+'px';
    if(r.bottom>window.innerHeight)ctxMenuEl.style.top=(y-r.height)+'px';
  });
  if(ctxCloseHandler)document.removeEventListener('mousedown',ctxCloseHandler);
  ctxCloseHandler=e=>{if(!ctxMenuEl.contains(e.target))hideContextMenu();};
  setTimeout(()=>document.addEventListener('mousedown',ctxCloseHandler),0);
}
function hideContextMenu(){
  ctxMenuEl.classList.add('hidden');
  if(ctxCloseHandler){document.removeEventListener('mousedown',ctxCloseHandler);ctxCloseHandler=null;}
}

// Connection popup
const connPopupEl=document.getElementById('connection-popup');
let connCallback=null;
document.querySelectorAll('.conn-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{const t=btn.dataset.type;hideConnectionPopup();connCallback?.(t);connCallback=null;});
});
document.getElementById('conn-cancel').addEventListener('click',()=>{hideConnectionPopup();connCallback?.(null);connCallback=null;});

function showConnectionPopup(x,y,cb){
  connCallback=cb;
  connPopupEl.style.left=(x+8)+'px';connPopupEl.style.top=(y-20)+'px';
  connPopupEl.classList.remove('hidden');
}
function hideConnectionPopup(){connPopupEl.classList.add('hidden');}

// Toolbar display
const zoomDisplayEl=document.getElementById('zoom-display');
const saveIndicatorEl=document.getElementById('save-indicator');
const projectNameEl=document.getElementById('project-name');

function updateZoomDisplay(zoom){zoomDisplayEl.textContent=Math.round(zoom*100)+'%';}
function showSaveIndicator(){
  saveIndicatorEl.textContent='✓ Saved';saveIndicatorEl.classList.add('visible');
  setTimeout(()=>saveIndicatorEl.classList.remove('visible'),2000);
}
function setProjectName(name){projectNameEl.textContent=name||'Untitled';}

// Confirm dialog
function showConfirm(msg,onConfirm){
  const ov=document.createElement('div');ov.className='confirm-overlay';
  const box=document.createElement('div');box.className='confirm-box';
  const p=document.createElement('p');p.textContent=msg;
  const btns=document.createElement('div');btns.className='confirm-box-btns';
  const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.addEventListener('click',()=>ov.remove());
  const ok=document.createElement('button');ok.textContent='Delete';ok.className='danger';
  ok.addEventListener('click',()=>{ov.remove();onConfirm();});
  btns.appendChild(cancel);btns.appendChild(ok);box.appendChild(p);box.appendChild(btns);ov.appendChild(box);
  document.body.appendChild(ov);
}

// Startup modal
const startupModalEl=document.getElementById('startup-modal');
const projectGridEl =document.getElementById('project-grid');

function hideStartupModal(){startupModalEl.classList.add('hidden');}

function showProjectGrid(projects,onSelect,onNew){
  projectGridEl.innerHTML='';
  const newCard=document.createElement('div');newCard.className='project-card new-card';
  newCard.textContent='+';newCard.title='New Project';
  newCard.addEventListener('click',onNew);
  projectGridEl.appendChild(newCard);
  for(const proj of projects){
    const card=document.createElement('div');card.className='project-card';
    const nameEl=document.createElement('div');nameEl.className='project-card-name';nameEl.textContent=proj.name;
    const dateEl=document.createElement('div');dateEl.className='project-card-date';
    dateEl.textContent=proj.lastModified?new Date(proj.lastModified).toLocaleDateString():'';
    card.appendChild(nameEl);card.appendChild(dateEl);
    card.addEventListener('click',()=>onSelect(proj));
    projectGridEl.appendChild(card);
  }
}

// ── interaction ───────────────────────────────────────────────

const PAN_THRESHOLD=4;
let mouseDownPos=null,mouseDownButton=-1,rightPanActive=false,rightMoved=false;

function initInteraction(canvas){
  canvas.addEventListener('mousedown',onMouseDown);
  canvas.addEventListener('mousemove',onMouseMove);
  canvas.addEventListener('mouseup',onMouseUp);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();applyZoom(e.deltaY,e.offsetX,e.offsetY);},{passive:false});
  canvas.addEventListener('dblclick',onDblClick);
  window.addEventListener('keydown',onKeyDown);
}

function onMouseDown(e){
  e.preventDefault();
  const wx=e.offsetX,wy=e.offsetY;
  const world=screenToWorld(wx,wy);
  mouseDownPos={sx:wx,sy:wy};mouseDownButton=e.button;
  if(e.button===2){rightPanActive=false;rightMoved=false;return;}
  if(e.button===1){
    state.dragging={type:'canvas',startPanX:state.viewport.x,startPanY:state.viewport.y,startSX:wx,startSY:wy};
    canvasEl.classList.add('panning');return;
  }
  if(e.button!==0)return;
  hideContextMenu();hideConnectionPopup();
  const hit=hitTestAll(world.x,world.y);
  if(hit.type==='port'){
    pushSnapshot();
    state.connecting={fromNodeId:hit.nodeId,fromPort:hit.port,currentX:world.x,currentY:world.y};
    canvasEl.classList.add('connecting');state.dirty=true;return;
  }
  if(hit.type==='node'){
    if(!state.selection.nodeIds.has(hit.nodeId)){if(!e.shiftKey)clearSelection();state.selection.nodeIds.add(hit.nodeId);}
    pushSnapshot();
    const sel=[...state.selection.nodeIds].map(id=>state.nodes.get(id)).filter(Boolean);
    state.dragging={type:'node',startWorld:{x:world.x,y:world.y},nodeStarts:new Map(sel.map(n=>[n.id,{x:n.x,y:n.y}]))};
    state.dirty=true;return;
  }
  if(hit.type==='groupResize'){
    state.dragging={type:'groupResize',groupId:hit.groupId,startWorld:{x:world.x,y:world.y},startW:hit.group.width,startH:hit.group.height};
    state.dirty=true;return;
  }
  if(hit.type==='group'){
    if(!state.selection.groupIds.has(hit.groupId)){if(!e.shiftKey)clearSelection();state.selection.groupIds.add(hit.groupId);}
    state.dragging={type:'group',groupId:hit.groupId,startWorld:{x:world.x,y:world.y},groupStart:{x:hit.group.x,y:hit.group.y}};
    state.dirty=true;return;
  }
  if(!e.shiftKey)clearSelection();
  state.lasso={points:[world],additive:e.shiftKey};state.dirty=true;
}

function onMouseMove(e){
  const wx=e.offsetX,wy=e.offsetY;
  const world=screenToWorld(wx,wy);
  if(mouseDownButton===2&&mouseDownPos){
    const dx=wx-mouseDownPos.sx,dy=wy-mouseDownPos.sy;
    if(!rightPanActive&&Math.sqrt(dx*dx+dy*dy)>PAN_THRESHOLD){
      rightPanActive=true;rightMoved=true;canvasEl.classList.add('panning');
      state._panStart={panX:state.viewport.x,panY:state.viewport.y,sx:mouseDownPos.sx,sy:mouseDownPos.sy};
    }
    if(rightPanActive&&state._panStart){
      state.viewport.x=state._panStart.panX+(wx-state._panStart.sx);
      state.viewport.y=state._panStart.panY+(wy-state._panStart.sy);
      state.dirty=true;
    }
    return;
  }
  if(mouseDownButton===1&&state.dragging?.type==='canvas'){
    state.viewport.x=state.dragging.startPanX+(wx-state.dragging.startSX);
    state.viewport.y=state.dragging.startPanY+(wy-state.dragging.startSY);
    state.dirty=true;return;
  }
  if(state.connecting){state.connecting.currentX=world.x;state.connecting.currentY=world.y;state.dirty=true;return;}
  if(state.dragging?.type==='node'){
    const dx=world.x-state.dragging.startWorld.x,dy=world.y-state.dragging.startWorld.y;
    for(const[id,start]of state.dragging.nodeStarts){
      const node=state.nodes.get(id);if(!node)continue;
      const ox=node.x,oy=node.y;node.x=start.x+dx;node.y=start.y+dy;updateNodeInGrid(node,ox,oy);
    }
    state.dirty=true;markDirty();return;
  }
  if(state.dragging?.type==='group'){
    const dx=world.x-state.dragging.startWorld.x,dy=world.y-state.dragging.startWorld.y;
    const g=state.groups.get(state.dragging.groupId);
    if(g){g.x=state.dragging.groupStart.x+dx;g.y=state.dragging.groupStart.y+dy;state.dirty=true;markDirty();}
    return;
  }
  if(state.dragging?.type==='groupResize'){
    const dx=world.x-state.dragging.startWorld.x,dy=world.y-state.dragging.startWorld.y;
    const g=state.groups.get(state.dragging.groupId);
    if(g){g.width=Math.max(100,state.dragging.startW+dx);g.height=Math.max(60,state.dragging.startH+dy);state.dirty=true;markDirty();}
    return;
  }
  if(state.lasso){
    state.lasso.points.push(world);
    for(const node of state.nodes.values()){
      if(!state.selection.nodeIds.has(node.id)){
        const sz=getNodeSize(node);
        if(world.x>=node.x&&world.x<=node.x+sz.w&&world.y>=node.y&&world.y<=node.y+sz.h)
          state.selection.nodeIds.add(node.id);
      }
    }
    state.dirty=true;return;
  }
  updateHover(world.x,world.y);
}

function onMouseUp(e){
  const wx=e.offsetX,wy=e.offsetY;
  const world=screenToWorld(wx,wy);
  if(e.button===2){
    canvasEl.classList.remove('panning');state._panStart=null;
    if(!rightMoved) showContextMenuAt(e.clientX,e.clientY,world.x,world.y);
    mouseDownButton=-1;mouseDownPos=null;rightPanActive=false;rightMoved=false;return;
  }
  if(e.button===1){canvasEl.classList.remove('panning');state.dragging=null;mouseDownButton=-1;return;}
  if(state.connecting){
    canvasEl.classList.remove('connecting');
    finishConnection(world.x,world.y,e.clientX,e.clientY);
    state.connecting=null;state.dirty=true;mouseDownButton=-1;return;
  }
  if(state.dragging){state.dragging=null;markDirty();}
  if(state.lasso){state.lasso=null;state.dirty=true;}
  mouseDownButton=-1;mouseDownPos=null;
}

function onDblClick(e){
  const world=screenToWorld(e.offsetX,e.offsetY);
  for(const node of [...state.nodes.values()].reverse())
    if(hitTestNodeBody(node,world.x,world.y)){openNodePanel(node.id);return;}
}

function onKeyDown(e){
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA')return;
  if(e.key==='Delete'||e.key==='Backspace'){deleteSelected();e.preventDefault();}
  else if(e.key==='Escape'){
    if(state.connecting){state.connecting=null;canvasEl.classList.remove('connecting');state.dirty=true;}
    else if(state.editingNode){closeNodePanel();}
    else{clearSelection();state.dirty=true;}
    hideContextMenu();hideConnectionPopup();
  }
  else if(e.ctrlKey&&e.key==='s'){e.preventDefault();saveCurrentFile();}
  else if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
  else if(e.ctrlKey&&e.key==='c'){copySelected();}
  else if(e.ctrlKey&&e.key==='v'){pasteClipboard();}
  else if(e.ctrlKey&&e.key==='d'){e.preventDefault();copySelected();pasteClipboard();}
  else if(e.key==='f'||e.key==='F'){fitToScreen();}
  else if(e.key==='Tab'){e.preventDefault();cycleSelection();}
}

function hitTestAll(wx,wy){
  for(const node of [...state.nodes.values()].reverse()){
    const port=hitTestPort(node,wx,wy);
    if(port)return{type:'port',nodeId:node.id,port};
  }
  for(const node of [...state.nodes.values()].reverse())
    if(hitTestNodeBody(node,wx,wy))return{type:'node',nodeId:node.id};
  for(const group of [...state.groups.values()].reverse()){
    const zone=hitTestGroup(group,wx,wy);
    if(zone==='resize')return{type:'groupResize',groupId:group.id,group};
    if(zone==='label'||zone==='border')return{type:'group',groupId:group.id,group};
  }
  return{type:'canvas'};
}

function updateHover(wx,wy){
  let changed=false;
  for(const node of state.nodes.values()){
    const port=hitTestPort(node,wx,wy);
    if(node._hoveredPort!==(port||null)){node._hoveredPort=port||null;changed=true;}
  }
  if(changed)state.dirty=true;
}

function finishConnection(wx,wy,clientX,clientY){
  const{connecting}=state;if(!connecting)return;
  const srcNode=state.nodes.get(connecting.fromNodeId);
  if(srcNode&&hitTestNodeBody(srcNode,wx,wy))return;
  for(const node of [...state.nodes.values()].reverse()){
    if(node.id===connecting.fromNodeId)continue;
    if(hitTestPort(node,wx,wy)||hitTestNodeBody(node,wx,wy)){
      showConnectionPopup(clientX,clientY,type=>{
        if(!type)return;
        const conn=createConnection({fromNodeId:connecting.fromNodeId,toNodeId:node.id,type,
          color:mixColors(srcNode?.color||'#888',node.color)});
        state.connections.set(conn.id,conn);state.dirty=true;markDirty();
      });
      return;
    }
  }
  // Release on empty → create node
  const newNode=createNode({x:wx-90,y:wy-40,color:srcNode?.color||'#4a7fc1',name:'New Node'});
  state.nodes.set(newNode.id,newNode);addNodeToGrid(newNode);state.dirty=true;
  showConnectionPopup(clientX,clientY,type=>{
    if(!type)return;
    const conn=createConnection({fromNodeId:connecting.fromNodeId,toNodeId:newNode.id,type,
      color:mixColors(srcNode?.color||'#888',newNode.color)});
    state.connections.set(conn.id,conn);state.dirty=true;markDirty();
  });
}

function clearSelection(){
  state.selection.nodeIds.clear();state.selection.connectionIds.clear();state.selection.groupIds.clear();
}

function deleteSelected(){
  if(state.selection.nodeIds.size===0&&state.selection.connectionIds.size===0)return;
  pushSnapshot();
  for(const id of state.selection.nodeIds){
    const node=state.nodes.get(id);if(node)removeNodeFromGrid(node);
    state.nodes.delete(id);
    for(const[cid,conn]of state.connections)
      if(conn.fromNodeId===id||conn.toNodeId===id)state.connections.delete(cid);
  }
  for(const id of state.selection.connectionIds)state.connections.delete(id);
  clearSelection();
  if(state.editingNode&&!state.nodes.has(state.editingNode))closeNodePanel();
  state.dirty=true;markDirty();
}

function copySelected(){
  if(state.selection.nodeIds.size===0)return;
  const selectedIds=new Set(state.selection.nodeIds);
  state.clipboard={
    nodes:[...selectedIds].map(id=>({...state.nodes.get(id)})).filter(Boolean),
    connections:[...state.connections.values()].filter(c=>selectedIds.has(c.fromNodeId)&&selectedIds.has(c.toNodeId)).map(c=>({...c})),
  };
}

function pasteClipboard(){
  if(!state.clipboard)return;
  pushSnapshot();
  const idMap=new Map();const newNodes=[];
  for(const node of state.clipboard.nodes){
    const newId=generateUUID();idMap.set(node.id,newId);
    const n={...node,id:newId,x:node.x+20,y:node.y+20};
    state.nodes.set(newId,n);addNodeToGrid(n);newNodes.push(n);
  }
  for(const conn of state.clipboard.connections){
    const nc={...conn,id:generateUUID(),fromNodeId:idMap.get(conn.fromNodeId),toNodeId:idMap.get(conn.toNodeId)};
    if(nc.fromNodeId&&nc.toNodeId)state.connections.set(nc.id,nc);
  }
  clearSelection();for(const n of newNodes)state.selection.nodeIds.add(n.id);
  state.dirty=true;markDirty();
}

function cycleSelection(){
  const ids=[...state.nodes.keys()];if(!ids.length)return;
  if(state.selection.nodeIds.size===0){clearSelection();state.selection.nodeIds.add(ids[0]);}
  else{
    const cur=[...state.selection.nodeIds][0];const idx=ids.indexOf(cur);
    clearSelection();state.selection.nodeIds.add(ids[(idx+1)%ids.length]);
  }
  state.dirty=true;
}

function showContextMenuAt(clientX,clientY,worldX,worldY){
  const hit=hitTestAll(worldX,worldY);
  if(hit.type==='node'){
    const id=hit.nodeId;
    showContextMenu(clientX,clientY,[
      {label:'Edit',action:()=>openNodePanel(id)},
      {label:'Duplicate',action:()=>duplicateNode(id)},
      {separator:true},
      {label:'Normal',action:()=>setNodeSize(id,'normal')},
      {label:'Large', action:()=>setNodeSize(id,'large')},
      {label:'Wide',  action:()=>setNodeSize(id,'wide')},
      {label:'X-Large',action:()=>setNodeSize(id,'xlarge')},
      {separator:true},
      {label:'Delete',danger:true,action:()=>{clearSelection();state.selection.nodeIds.add(id);deleteSelected();}},
    ]);return;
  }
  if(hit.type==='group'){
    const id=hit.groupId;
    showContextMenu(clientX,clientY,[
      {label:'Rename',action:()=>{const n=prompt('Rename group:',state.groups.get(id)?.name);if(n!==null){state.groups.get(id).name=n;state.dirty=true;markDirty();}}},
      {label:'Delete',danger:true,action:()=>{state.groups.delete(id);state.dirty=true;markDirty();}},
    ]);return;
  }
  const items=[
    {label:'Add Standard Node',action:()=>addNodeAt(worldX,worldY,'standard')},
    {label:'Add Text Node',    action:()=>addNodeAt(worldX,worldY,'text')},
    {label:'Add Group',        action:()=>{const g=createGroup({x:worldX-100,y:worldY-80});state.groups.set(g.id,g);state.dirty=true;markDirty();}},
  ];
  if(state.clipboard){items.push({separator:true});items.push({label:'Paste',action:pasteClipboard});}
  showContextMenu(clientX,clientY,items);
}

function addNodeAt(wx,wy,type){
  pushSnapshot();
  const node=createNode({x:wx-90,y:wy-40,type});
  state.nodes.set(node.id,node);addNodeToGrid(node);
  clearSelection();state.selection.nodeIds.add(node.id);
  state.dirty=true;markDirty();
}

function duplicateNode(nodeId){
  const node=state.nodes.get(nodeId);if(!node)return;
  pushSnapshot();
  const n={...node,id:generateUUID(),x:node.x+20,y:node.y+20};
  state.nodes.set(n.id,n);addNodeToGrid(n);clearSelection();state.selection.nodeIds.add(n.id);
  state.dirty=true;markDirty();
}

function setNodeSize(nodeId,size){
  const node=state.nodes.get(nodeId);if(!node)return;
  node.size=size;updateNodeInGrid(node,node.x,node.y);state.dirty=true;markDirty();
}

// ── main / boot ───────────────────────────────────────────────

async function boot(){
  _scheduleSaveFn=scheduleSave;

  const canvas=document.getElementById('diagram-canvas');
  initCanvas(canvas);
  initInteraction(canvas);

  document.getElementById('btn-save').addEventListener('click',saveCurrentFile);
  document.getElementById('btn-new').addEventListener('click',async()=>{
    const name=prompt('New project name:');if(!name?.trim())return;
    await createNewProject(name.trim());
  });
  document.getElementById('btn-fit').addEventListener('click',fitToScreen);

  try{
    const projects=await listProjects();
    showProjectGrid(
      projects,
      async proj=>{await loadProject(proj.name);hideStartupModal();},
      async ()=>{
        const name=prompt('Project name:');if(!name?.trim())return;
        await createNewProject(name.trim());hideStartupModal();
      }
    );
  }catch(e){
    console.error('Storage error:',e);
    hideStartupModal();
  }
}

boot();
