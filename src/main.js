/**
 * ClearCut — a free, open-source background remover.
 * Copyright (C) 2026 ClearCut contributors
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at
 * your option) any later version. See the LICENSE file for the full text.
 */
import './style.css';
import { removeBackground } from '@imgly/background-removal';

// ---------- DOM references ----------
const uploadScreen = document.getElementById('upload-screen');
const editorScreen = document.getElementById('editor-screen');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');

const bgCanvas = document.getElementById('bg-canvas');
const mainCanvas = document.getElementById('main-canvas');
const drawCanvas = document.getElementById('draw-canvas');
const cropOverlay = document.getElementById('crop-overlay');
const canvasWrap = document.getElementById('canvas-wrap');
const canvasContainer = document.getElementById('canvas-container');
const bgCtx = bgCanvas.getContext('2d');
const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
const drawCtx = drawCanvas.getContext('2d');
const cropCtx = cropOverlay.getContext('2d');

const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomFitBtn = document.getElementById('zoom-fit-btn');

const textInputOverlay = document.getElementById('text-input-overlay');
const textAnnotationInput = document.getElementById('text-annotation-input');

const statusText = document.getElementById('status-text');
const progressFill = document.getElementById('progress-fill');

const toolBtns = document.querySelectorAll('.tool-btn');
const brushSettings = document.getElementById('brush-settings');
const brushSizeInput = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');
const cornerRadiusInput = document.getElementById('corner-radius');
const cornerRadiusValue = document.getElementById('corner-radius-value');

const swatches = document.querySelectorAll('.swatch[data-bg]');
const customColorInput = document.getElementById('custom-color-input');
const customColorSwatch = document.getElementById('custom-color-swatch');
const bgSettings = document.getElementById('bg-settings');

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const resetBtn = document.getElementById('reset-btn');
const newImageBtn = document.getElementById('new-image-btn');

const exportFormat = document.getElementById('export-format');
const exportQuality = document.getElementById('export-quality');
const downloadBtn = document.getElementById('download-btn');
const clearDrawingsBtn = document.getElementById('clear-drawings-btn');

const cropActions = document.getElementById('crop-actions');
const cropApplyBtn = document.getElementById('crop-apply-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const removeBgBtn = document.getElementById('remove-bg-btn');

// Draw tool DOM
const drawSettings = document.getElementById('draw-settings');
const drawColorInput = document.getElementById('draw-color');
const drawSwatches = document.querySelectorAll('.draw-swatch');
const drawSizeInput = document.getElementById('draw-size');
const drawSizeValue = document.getElementById('draw-size-value');
const drawFontSizeInput = document.getElementById('draw-font-size');
const drawFontSizeValue = document.getElementById('draw-font-size-value');
const drawFontSizeLabel = document.getElementById('draw-text-label');
const drawOpacityInput = document.getElementById('draw-opacity');
const drawOpacityValue = document.getElementById('draw-opacity-value');

// Offscreen canvas holding the untouched original photo (for the Restore brush)
const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d');

// ---------- State ----------
let currentTool = 'none';
let brushSize = 30;
let cornerRadiusPct = 0; // 0–50% of the shorter side (50% = circle / pill)
let bgColor = null; // null = transparent
let isPointerDown = false;
let lastPoint = null;
let cropStart = null;
let cropRect = null;
let marchAntsOffset = 0;
let marchAntsTimer = null;

let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 20;
let strokeBeforeSnapshot = null; // snapshot taken right before the in-progress brush stroke / crop
let initialCutout = null; // { dataURL, width, height } snapshot used by Reset
let initialOriginalImg = null; // untouched original photo, for Reset after a crop
let isRemovingBackground = false;
let removalToken = 0;

// ---------- Draw tool state ----------
const DRAW_TOOLS = ['draw-pencil', 'draw-line', 'draw-rect', 'draw-arrow', 'draw-text', 'draw-eraser'];
let drawColor = '#ff3b30';
let drawSize = 4;
let drawFontSize = 24;
let drawOpacity = 1.0;

// Object model — every annotation is stored here so it can be selected/moved/copied
let drawObjects = [];        // committed objects
let currentDrawObj = null;   // object currently being drawn (in-progress)
let drawObjectCounter = 0;
function newDrawId() { return ++drawObjectCounter; }

// Selection & drag & edit
let selectedObjectId = null;
let isSelectDragging = false;
let selectDragLast = null;
let editingTextObj = null;
let didDragOrResize = false;

// Resize via corner handles
let isResizing = false;
let resizeHandle = null;            // 'nw' | 'ne' | 'sw' | 'se'
let resizeObjSnapshot = null;       // deep copy of obj at resize-start
let resizeStartVisualBounds = null; // visual (non-padded) bounding box at resize-start

// Copy/paste buffer
let copyBuffer = null;
let loadedFileName = 'image';

// Shorthand
let hasDrawings = false;

// ---------- Zoom & Pan state ----------
let baseFittedWidth = 0;
let baseFittedHeight = 0;
let zoomLevel = 1.0;
let isPanning = false;
let panStart = null;
let isSpacePressed = false;
// ---------- Utility ----------
function setStatus(text) {
  if (statusText) statusText.textContent = text;
}
function setProgress(pct) {
  if (progressFill) progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function updateCanvasContainerSize() {
  if (!mainCanvas.width || !mainCanvas.height || !canvasWrap) return;
  const wrapRect = canvasWrap.getBoundingClientRect();
  let availableW = wrapRect.width - 32;
  let availableH = wrapRect.height - 32;

  if (availableW <= 0 || availableH <= 0) {
    availableW = Math.max(200, (canvasWrap.clientWidth || window.innerWidth - 460) - 32);
    availableH = Math.max(200, (canvasWrap.clientHeight || window.innerHeight - 140) - 32);
  }

  const imgW = mainCanvas.width;
  const imgH = mainCanvas.height;

  const scale = Math.min(availableW / imgW, availableH / imgH);
  baseFittedWidth = imgW * scale;
  baseFittedHeight = imgH * scale;

  applyZoom();
}

function setZoom(newZoom, pivot = null) {
  const clamped = Math.max(0.25, Math.min(5.0, Math.round(newZoom * 100) / 100));
  const oldZoom = zoomLevel;
  zoomLevel = clamped;

  if (zoomResetBtn) {
    zoomResetBtn.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  const containerW = baseFittedWidth * zoomLevel;
  const containerH = baseFittedHeight * zoomLevel;

  const oldScrollLeft = canvasWrap.scrollLeft;
  const oldScrollTop = canvasWrap.scrollTop;

  if (canvasContainer) {
    canvasContainer.style.width = `${containerW}px`;
    canvasContainer.style.height = `${containerH}px`;
  }

  if (pivot && oldZoom > 0) {
    const wrapRect = canvasWrap.getBoundingClientRect();
    const cursorX = pivot.x - wrapRect.left;
    const cursorY = pivot.y - wrapRect.top;
    const targetX = oldScrollLeft + cursorX;
    const targetY = oldScrollTop + cursorY;
    const ratio = zoomLevel / oldZoom;
    canvasWrap.scrollLeft = targetX * ratio - cursorX;
    canvasWrap.scrollTop = targetY * ratio - cursorY;
  }

  applyCornerRadiusPreview();
}

function applyZoom(pivot = null) {
  setZoom(zoomLevel, pivot);
}

function sizeCanvases(w, h, resetZoom = false) {
  [bgCanvas, mainCanvas, drawCanvas, cropOverlay, originalCanvas].forEach((c) => {
    c.width = w;
    c.height = h;
  });
  if (resetZoom) {
    zoomLevel = 1.0;
  }
  updateCanvasContainerSize();
}

function cornerRadiusPx() {
  if (!mainCanvas.width || !mainCanvas.height) return 0;
  return (cornerRadiusPct / 100) * Math.min(mainCanvas.width, mainCanvas.height);
}

function applyCornerRadiusPreview() {
  const px = cornerRadiusPx();
  const rect = mainCanvas.getBoundingClientRect();
  const scale = mainCanvas.width ? rect.width / mainCanvas.width : 1;
  const css = `${Math.max(0, px * scale)}px`;
  bgCanvas.style.borderRadius = css;
  mainCanvas.style.borderRadius = css;
  drawCanvas.style.borderRadius = css;
  cornerRadiusValue.textContent = String(Math.round(px));
}

function clipRoundedRect(ctx, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(0, 0, w, h);
  } else if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, w, h, r);
  } else {
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
  }
}

function paintBackgroundLayer() {
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  if (bgColor) {
    bgCtx.fillStyle = bgColor;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  }
}

function snapshotCurrent() {
  return {
    w: mainCanvas.width,
    h: mainCanvas.height,
    data: mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height),
    originalData: originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height),
    drawObjects: JSON.parse(JSON.stringify(drawObjects)),
    bgColor: bgColor,
  };
}

// Call BEFORE a destructive edit starts, to remember what to undo back to.
function beginEdit() {
  if (!strokeBeforeSnapshot) {
    strokeBeforeSnapshot = snapshotCurrent();
  }
}

// Call AFTER a destructive edit finishes, committing the "before" snapshot to the undo stack.
function commitEdit() {
  if (!strokeBeforeSnapshot) return;
  undoStack.push(strokeBeforeSnapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  strokeBeforeSnapshot = null;
  updateHistoryButtons();
  updateBgGroupVisibility();
}

function updateBgGroupVisibility() {
  if (!bgSettings || !mainCanvas.width || !mainCanvas.height) return;
  const imgData = mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height).data;
  let hasTransparent = false;
  // Check alpha bytes (every 4th pixel for high performance)
  for (let i = 3; i < imgData.length; i += 16) {
    if (imgData[i] < 250) {
      hasTransparent = true;
      break;
    }
  }
  bgSettings.classList.toggle('hidden', !hasTransparent);
}

function restoreSnapshot(snap) {
  sizeCanvases(snap.w, snap.h);
  mainCtx.putImageData(snap.data, 0, 0);
  originalCtx.putImageData(snap.originalData, 0, 0);
  drawObjects = JSON.parse(JSON.stringify(snap.drawObjects || []));
  selectedObjectId = null;
  hasDrawings = drawObjects.length > 0;
  renderDrawCanvas();
  updateClearDrawingsBtn();
  setBgSwatch(snap.bgColor !== undefined ? snap.bgColor : null, null, true);
  updateBgGroupVisibility();
}

function doUndo() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  redoStack.push(snapshotCurrent());
  restoreSnapshot(prev);
  cancelCrop();
  updateHistoryButtons();
}

function doRedo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(snapshotCurrent());
  restoreSnapshot(next);
  cancelCrop();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function canvasPointFromEvent(e) {
  const rect = cropOverlay.getBoundingClientRect();
  const scaleX = cropOverlay.width / rect.width;
  const scaleY = cropOverlay.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

// ---------- Upload flow ----------
function openFilePicker() {
  fileInput.click();
}
browseBtn.addEventListener('click', openFilePicker);
dropzone.addEventListener('click', openFilePicker);

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }

  loadedFileName = file.name.replace(/\.[^/.]+$/, '') || 'image';
  const img = await loadImageFromFile(file);

  uploadScreen.classList.remove('active');
  editorScreen.classList.add('active');
  undoStack = [];
  redoStack = [];
  strokeBeforeSnapshot = null;
  drawObjects = [];
  selectedObjectId = null;
  hasDrawings = false;
  renderDrawCanvas();
  updateHistoryButtons();
  resetTool();
  setBgSwatch(null, null, true);

  sizeCanvases(img.naturalWidth, img.naturalHeight, true);
  originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  originalCtx.drawImage(img, 0, 0);
  initialOriginalImg = img;
  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  mainCtx.drawImage(img, 0, 0);
  paintBackgroundLayer();

  initialCutout = { dataURL: mainCanvas.toDataURL('image/png'), w: mainCanvas.width, h: mainCanvas.height };
  setCornerRadiusPct(0);
  setRemoveBgBusy(false);
  updateBgGroupVisibility();
  setStatus('Ready — crop, change background, or remove it.');
  setProgress(0);
}

function setRemoveBgBusy(busy) {
  isRemovingBackground = busy;
  removeBgBtn.disabled = busy;
  removeBgBtn.textContent = busy ? 'Removing…' : 'Remove Background';
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the canvas.'));
    }, 'image/png');
  });
}

async function runBackgroundRemoval() {
  if (isRemovingBackground) return;

  const token = ++removalToken;
  setRemoveBgBusy(true);
  setStatus('Removing background…');
  setProgress(4);
  beginEdit();

  try {
    const source = await canvasToBlob(mainCanvas);
    const blob = await removeBackground(source, {
      progress: (key, current, total) => {
        if (token !== removalToken) return;
        if (total > 0) setProgress((current / total) * 100);
      },
    });
    if (token !== removalToken) return;
    const cutoutImg = await loadImageFromBlob(blob);
    if (token !== removalToken) return;

    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(cutoutImg, 0, 0, mainCanvas.width, mainCanvas.height);

    initialCutout = { dataURL: mainCanvas.toDataURL('image/png'), w: mainCanvas.width, h: mainCanvas.height };
    commitEdit();
    setStatus('Done — refine with Erase / Restore, or Crop.');
    setProgress(100);
    setTimeout(() => setProgress(0), 600);
  } catch (err) {
    if (token !== removalToken) return;
    console.error(err);
    strokeBeforeSnapshot = null;
    setStatus('Background removal failed — you can still crop & paint manually.');
    setProgress(0);
  } finally {
    if (token === removalToken) setRemoveBgBusy(false);
  }
}

removeBgBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  runBackgroundRemoval();
});

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function loadImageFromBlob(blob) {
  return loadImageFromFile(blob);
}

newImageBtn.addEventListener('click', () => {
  removalToken += 1;
  setRemoveBgBusy(false);
  setProgress(0);
  editorScreen.classList.remove('active');
  uploadScreen.classList.add('active');
});

// ---------- Tool selection ----------
toolBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (currentTool === 'crop' && btn.dataset.tool !== 'crop') {
      cancelCrop();
    }
    selectTool(btn.dataset.tool);
  });
});

function selectTool(tool) {
  currentTool = tool;
  toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));

  const isEdit = tool === 'erase' || tool === 'restore';
  const isDraw = DRAW_TOOLS.includes(tool);
  const isEraser = tool === 'draw-eraser';
  const isText = tool === 'draw-text';
  const isSelectMode = tool === 'none';

  brushSettings.classList.toggle('hidden', !isEdit);
  drawSettings.classList.toggle('hidden', !isDraw);

  if (isDraw) {
    drawSettings.querySelector('.draw-color-row').classList.toggle('hidden', isEraser);
    drawSettings.querySelector('.draw-swatches').classList.toggle('hidden', isEraser);
    drawOpacityInput.classList.toggle('hidden', isEraser);
    drawSettings.querySelector('label.draw-label.opacity-label').classList.toggle('hidden', isEraser);
    const sizeLabelEl = drawSettings.querySelector('label.draw-label.size-label');
    if (sizeLabelEl) sizeLabelEl.classList.toggle('hidden', isText);
    drawSizeInput.classList.toggle('hidden', isText);
    drawFontSizeLabel.classList.toggle('hidden', !isText);
    drawFontSizeInput.classList.toggle('hidden', !isText);
  }

  // Deselect annotation when switching away from select mode
  if (!isSelectMode) {
    selectedObjectId = null;
    renderDrawCanvas();
  }

  canvasWrap.classList.toggle('cropping', tool === 'crop');
  // drawCanvas handles both draw tools AND select mode
  drawCanvas.style.pointerEvents = (isDraw || isSelectMode) ? 'auto' : 'none';
  drawCanvas.style.cursor = isSelectMode ? 'default' : 'crosshair';
  cropOverlay.style.pointerEvents = (isEdit || tool === 'crop') ? 'auto' : 'none';
  cropActions.classList.toggle('hidden', tool !== 'crop' || !cropRect);

  if (tool !== 'draw-text') hideTextInput();
}
function resetTool() {
  selectTool('none');
}

brushSizeInput.addEventListener('input', () => {
  brushSize = Number(brushSizeInput.value);
  brushSizeValue.textContent = brushSize;
});

function setCornerRadiusPct(pct) {
  cornerRadiusPct = Math.max(0, Math.min(50, Number(pct)));
  cornerRadiusInput.value = String(cornerRadiusPct);
  applyCornerRadiusPreview();
}
cornerRadiusInput.addEventListener('input', () => {
  setCornerRadiusPct(cornerRadiusInput.value);
});

// ---------- Background color swatches ----------
swatches.forEach((sw) => {
  sw.addEventListener('click', () => {
    const val = sw.dataset.bg;
    setBgSwatch(val === 'transparent' ? null : val);
  });
});
customColorInput.addEventListener('input', () => {
  setBgSwatch(customColorInput.value, customColorSwatch);
});
function setBgSwatch(color, activeEl, skipHistory = false) {
  if (!skipHistory && bgColor !== color) {
    beginEdit();
  }
  bgColor = color;
  swatches.forEach((s) => s.classList.remove('active'));
  if (activeEl) {
    activeEl.classList.add('active');
  } else {
    const match = [...swatches].find((s) => s.dataset.bg === (color ?? 'transparent'));
    if (match) match.classList.add('active');
  }
  paintBackgroundLayer();
  if (!skipHistory && strokeBeforeSnapshot) {
    commitEdit();
  }
}

// ---------- Pointer interaction (erase / restore / crop) ----------
cropOverlay.addEventListener('pointerdown', (e) => {
  if (currentTool === 'none') return;
  isPointerDown = true;
  cropOverlay.setPointerCapture(e.pointerId);
  const p = canvasPointFromEvent(e);

  if (currentTool === 'crop') {
    cropStart = p;
    cropRect = null;
    cropActions.classList.add('hidden');
  } else {
    beginEdit();
    lastPoint = p;
    paintDot(p);
  }
});

cropOverlay.addEventListener('pointermove', (e) => {
  if (!isPointerDown) return;
  const p = canvasPointFromEvent(e);

  if (currentTool === 'crop') {
    drawCropRect(cropStart, p);
  } else if (currentTool === 'erase' || currentTool === 'restore') {
    paintStroke(lastPoint, p, currentTool);
    lastPoint = p;
  }
});

['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
  cropOverlay.addEventListener(evt, (e) => {
    if (!isPointerDown) return;
    isPointerDown = false;

    if (currentTool === 'crop') {
      if (cropRect && cropRect.w > 4 && cropRect.h > 4) {
        cropActions.classList.remove('hidden');
        startMarchingAnts();
      } else {
        cropRect = null;
        cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
      }
    } else if (currentTool === 'erase' || currentTool === 'restore') {
      lastPoint = null;
      commitEdit();
    }
  });
});

// ---------- Draw Object Model ----------
function renderObject(ctx, obj) {
  ctx.save();
  if (obj.type === 'draw-eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = obj.opacity ?? 1;
  }
  ctx.strokeStyle = obj.color;
  ctx.fillStyle = obj.color;
  ctx.lineWidth = obj.size;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (obj.type === 'draw-pencil' || obj.type === 'draw-eraser') {
    const pts = obj.points;
    if (!pts || pts.length === 0) { ctx.restore(); return; }
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  } else if (obj.type === 'draw-line') {
    ctx.beginPath();
    ctx.moveTo(obj.from.x, obj.from.y);
    ctx.lineTo(obj.to.x, obj.to.y);
    ctx.stroke();
  } else if (obj.type === 'draw-rect') {
    ctx.beginPath();
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
  } else if (obj.type === 'draw-arrow') {
    ctx.beginPath();
    ctx.moveTo(obj.from.x, obj.from.y);
    ctx.lineTo(obj.to.x, obj.to.y);
    ctx.stroke();
    const angle = Math.atan2(obj.to.y - obj.from.y, obj.to.x - obj.from.x);
    const alen = Math.max(12, obj.size * 4);
    ctx.beginPath();
    ctx.moveTo(obj.to.x, obj.to.y);
    ctx.lineTo(obj.to.x - alen * Math.cos(angle - Math.PI / 6), obj.to.y - alen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(obj.to.x - alen * Math.cos(angle + Math.PI / 6), obj.to.y - alen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (obj.type === 'draw-text') {
    if (obj === editingTextObj) { ctx.restore(); return; }
    ctx.font = `bold ${obj.fontSize}px Inter, sans-serif`;
    ctx.fillText(obj.text, obj.x, obj.y);
  }
  ctx.restore();
}

function getObjectBounds(obj) {
  const pad = (obj.size || 4) / 2 + 6;
  if (obj.type === 'draw-pencil' || obj.type === 'draw-eraser') {
    const xs = obj.points.map(p => p.x);
    const ys = obj.points.map(p => p.y);
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (obj.type === 'draw-line') {
    return { x: Math.min(obj.from.x, obj.to.x) - pad, y: Math.min(obj.from.y, obj.to.y) - pad, w: Math.abs(obj.to.x - obj.from.x) + pad * 2, h: Math.abs(obj.to.y - obj.from.y) + pad * 2 };
  }
  if (obj.type === 'draw-arrow') {
    const ap = Math.max(obj.size * 4, 12) + 4;
    return { x: Math.min(obj.from.x, obj.to.x) - ap, y: Math.min(obj.from.y, obj.to.y) - ap, w: Math.abs(obj.to.x - obj.from.x) + ap * 2, h: Math.abs(obj.to.y - obj.from.y) + ap * 2 };
  }
  if (obj.type === 'draw-rect') {
    return { x: Math.min(obj.x, obj.x + obj.w) - pad, y: Math.min(obj.y, obj.y + obj.h) - pad, w: Math.abs(obj.w) + pad * 2, h: Math.abs(obj.h) + pad * 2 };
  }
  if (obj.type === 'draw-text') {
    const cw = obj.fontSize * 0.55;
    return { x: obj.x - 4, y: obj.y - obj.fontSize * 1.1, w: obj.text.length * cw + 8, h: obj.fontSize * 1.4 };
  }
  return null;
}

function renderSelectionBox(obj) {
  const b = getObjectBounds(obj);
  if (!b || !drawCanvas.getBoundingClientRect().width) return;
  const sr = drawCanvas.width / drawCanvas.getBoundingClientRect().width; // px-per-CSS-px
  drawCtx.save();
  drawCtx.globalCompositeOperation = 'source-over';
  drawCtx.globalAlpha = 1;

  // Dashed bounding rect
  drawCtx.strokeStyle = '#2dd4c8';
  drawCtx.lineWidth = 2 * sr;
  drawCtx.setLineDash([8 * sr, 4 * sr]);
  drawCtx.strokeRect(b.x, b.y, b.w, b.h);
  drawCtx.setLineDash([]);

  // Corner handles — circles: white fill + teal stroke, easy to target
  const hr = 6 * sr; // handle radius in canvas px
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
  corners.forEach(([cx, cy]) => {
    drawCtx.beginPath();
    drawCtx.arc(cx, cy, hr, 0, Math.PI * 2);
    drawCtx.fillStyle = '#ffffff';
    drawCtx.fill();
    drawCtx.strokeStyle = '#2dd4c8';
    drawCtx.lineWidth = 2 * sr;
    drawCtx.stroke();
  });

  drawCtx.restore();
}

function renderDrawCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  for (const obj of drawObjects) renderObject(drawCtx, obj);
  if (currentDrawObj) renderObject(drawCtx, currentDrawObj);
  if (selectedObjectId) {
    const obj = drawObjects.find(o => o.id === selectedObjectId);
    if (obj) renderSelectionBox(obj);
  }
}

function hitTest(x, y) {
  // Topmost object first
  for (let i = drawObjects.length - 1; i >= 0; i--) {
    const obj = drawObjects[i];
    if (obj.type === 'draw-eraser') continue;
    const b = getObjectBounds(obj);
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return obj;
  }
  return null;
}

function moveObject(obj, dx, dy) {
  if (obj.type === 'draw-pencil' || obj.type === 'draw-eraser') {
    obj.points = obj.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else if (obj.type === 'draw-line' || obj.type === 'draw-arrow') {
    obj.from = { x: obj.from.x + dx, y: obj.from.y + dy };
    obj.to = { x: obj.to.x + dx, y: obj.to.y + dy };
  } else if (obj.type === 'draw-rect') {
    obj.x += dx; obj.y += dy;
  } else if (obj.type === 'draw-text') {
    obj.x += dx; obj.y += dy;
  }
}

function cloneDrawObj(src) {
  return JSON.parse(JSON.stringify({ ...src, id: newDrawId() }));
}

// Tight visual bounds (no hit-test padding) used for resize math
function getObjectVisualBounds(obj) {
  if (obj.type === 'draw-pencil' || obj.type === 'draw-eraser') {
    const xs = obj.points.map(p => p.x), ys = obj.points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (obj.type === 'draw-line' || obj.type === 'draw-arrow') {
    return { x: Math.min(obj.from.x, obj.to.x), y: Math.min(obj.from.y, obj.to.y), w: Math.abs(obj.to.x - obj.from.x), h: Math.abs(obj.to.y - obj.from.y) };
  }
  if (obj.type === 'draw-rect') {
    return { x: Math.min(obj.x, obj.x + obj.w), y: Math.min(obj.y, obj.y + obj.h), w: Math.abs(obj.w), h: Math.abs(obj.h) };
  }
  if (obj.type === 'draw-text') {
    return { x: obj.x, y: obj.y - obj.fontSize, w: obj.text.length * obj.fontSize * 0.55, h: obj.fontSize * 1.2 };
  }
  return null;
}

// Returns which handle corner the pointer is over, or null
function getHandleAtPoint(px, py, obj) {
  const b = getObjectBounds(obj);
  if (!b || !drawCanvas.getBoundingClientRect().width) return null;
  const sr = drawCanvas.width / drawCanvas.getBoundingClientRect().width;
  const hitR = 10 * sr; // 10 CSS px in canvas coords
  const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
  for (const [name, [hx, hy]] of Object.entries(corners)) {
    if (Math.abs(px - hx) <= hitR && Math.abs(py - hy) <= hitR) return name;
  }
  return null;
}

const RESIZE_CURSORS = { nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize' };

// Compute the fixed corner and new bounds when dragging a handle
function computeNewBounds(handle, ob, px, py) {
  const fixed = {
    nw: { x: ob.x + ob.w, y: ob.y + ob.h },
    ne: { x: ob.x,        y: ob.y + ob.h },
    sw: { x: ob.x + ob.w, y: ob.y        },
    se: { x: ob.x,        y: ob.y        },
  }[handle];
  const nx = Math.min(px, fixed.x);
  const ny = Math.min(py, fixed.y);
  const nw = Math.max(Math.abs(px - fixed.x), 10);
  const nh = Math.max(Math.abs(py - fixed.y), 10);
  return { nx, ny, nw, nh };
}

// Apply proportional bounding-box transform for all object types
function applyResize(obj, handle, px, py) {
  const ob = resizeStartVisualBounds;
  if (!ob) return;
  const { nx, ny, nw, nh } = computeNewBounds(handle, ob, px, py);
  const sx = nw / Math.max(ob.w, 1);
  const sy = nh / Math.max(ob.h, 1);
  // Map a point from old visual-bounds space to new bounds
  const mapPt = (x, y) => ({ x: nx + (x - ob.x) * sx, y: ny + (y - ob.y) * sy });
  const snap = resizeObjSnapshot;

  if (obj.type === 'draw-pencil' || obj.type === 'draw-eraser') {
    obj.points = snap.points.map(p => mapPt(p.x, p.y));
  } else if (obj.type === 'draw-line' || obj.type === 'draw-arrow') {
    const mf = mapPt(snap.from.x, snap.from.y);
    const mt = mapPt(snap.to.x, snap.to.y);
    obj.from = mf; obj.to = mt;
  } else if (obj.type === 'draw-rect') {
    obj.x = nx; obj.y = ny; obj.w = nw; obj.h = nh;
  } else if (obj.type === 'draw-text') {
    const scale = Math.max(sx, sy);
    obj.fontSize = Math.max(10, Math.round(snap.fontSize * scale));
    obj.x = nx + 4;
    obj.y = ny + obj.fontSize;
  }
}

// Update cursor based on what's under the pointer in select mode (no drag)
function updateSelectHoverCursor(px, py) {
  const selObj = drawObjects.find(o => o.id === selectedObjectId);
  if (selObj) {
    const handle = getHandleAtPoint(px, py, selObj);
    if (handle) { drawCanvas.style.cursor = RESIZE_CURSORS[handle]; return; }
    const hit = hitTest(px, py);
    drawCanvas.style.cursor = hit ? 'grab' : 'default';
  } else {
    const hit = hitTest(px, py);
    drawCanvas.style.cursor = hit ? 'pointer' : 'default';
  }
}

// ---------- Draw canvas events ----------
function drawCanvasPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

drawCanvas.addEventListener('pointerdown', (e) => {
  const isDraw = DRAW_TOOLS.includes(currentTool);
  const isSelect = currentTool === 'none';
  if (!isDraw && !isSelect) return;

  const p = drawCanvasPoint(e);

  if (isSelect) {
    didDragOrResize = false;
    // 1. Check if clicking on a resize handle of the currently-selected object
    const selObj = drawObjects.find(o => o.id === selectedObjectId);
    if (selObj) {
      const handle = getHandleAtPoint(p.x, p.y, selObj);
      if (handle) {
        beginEdit();
        isResizing = true;
        resizeHandle = handle;
        resizeObjSnapshot = cloneDrawObj(selObj);
        resizeStartVisualBounds = getObjectVisualBounds(selObj);
        drawCanvas.setPointerCapture(e.pointerId);
        drawCanvas.style.cursor = RESIZE_CURSORS[handle];
        return;
      }
    }
    // 2. Otherwise hit-test for drag / select
    const hit = hitTest(p.x, p.y);
    if (hit) {
      beginEdit();
      selectedObjectId = hit.id;
      isSelectDragging = true;
      selectDragLast = p;
      drawCanvas.setPointerCapture(e.pointerId);
      drawCanvas.style.cursor = 'grabbing';
      updateDrawSettingsForSelectedObject(hit);
    } else {
      selectedObjectId = null;
      isSelectDragging = false;
      updateDrawSettingsForSelectedObject(null);
    }
    renderDrawCanvas();
    return;
  }

  if (currentTool === 'draw-text') {
    showTextInput(p);
    return;
  }

  beginEdit();
  isPointerDown = true;
  drawCanvas.setPointerCapture(e.pointerId);

  if (currentTool === 'draw-pencil' || currentTool === 'draw-eraser') {
    currentDrawObj = { id: newDrawId(), type: currentTool, color: drawColor, opacity: drawOpacity, size: drawSize, points: [p] };
  } else {
    currentDrawObj = { id: newDrawId(), type: currentTool, color: drawColor, opacity: drawOpacity, size: drawSize, from: { ...p }, to: { ...p }, x: p.x, y: p.y, w: 0, h: 0 };
  }
  renderDrawCanvas();
});

drawCanvas.addEventListener('pointermove', (e) => {
  const p = drawCanvasPoint(e);

  // Select-mode resize
  if (currentTool === 'none' && isResizing && selectedObjectId) {
    const obj = drawObjects.find(o => o.id === selectedObjectId);
    if (obj) {
      didDragOrResize = true;
      applyResize(obj, resizeHandle, p.x, p.y);
      renderDrawCanvas();
    }
    return;
  }

  // Select-mode drag
  if (currentTool === 'none' && isSelectDragging && selectedObjectId && selectDragLast) {
    const obj = drawObjects.find(o => o.id === selectedObjectId);
    if (obj) {
      didDragOrResize = true;
      moveObject(obj, p.x - selectDragLast.x, p.y - selectDragLast.y);
      selectDragLast = p;
      renderDrawCanvas();
    }
    return;
  }

  // Hover cursor update (select mode, mouse not held)
  if (currentTool === 'none') {
    updateSelectHoverCursor(p.x, p.y);
    return;
  }

  if (!isPointerDown || !currentDrawObj) return;

  if (currentTool === 'draw-pencil' || currentTool === 'draw-eraser') {
    currentDrawObj.points.push(p);
  } else if (currentTool === 'draw-line' || currentTool === 'draw-arrow') {
    currentDrawObj.to = { ...p };
  } else if (currentTool === 'draw-rect') {
    currentDrawObj.w = p.x - currentDrawObj.x;
    currentDrawObj.h = p.y - currentDrawObj.y;
  }
  renderDrawCanvas();
});

['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
  drawCanvas.addEventListener(evt, () => {
    if (currentTool === 'none') {
      if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        resizeObjSnapshot = null;
        resizeStartVisualBounds = null;
      }
      isSelectDragging = false;
      selectDragLast = null;
      drawCanvas.style.cursor = 'default';

      if (didDragOrResize) {
        commitEdit();
        didDragOrResize = false;
      } else {
        strokeBeforeSnapshot = null;
      }
      return;
    }
    if (!isPointerDown) return;
    isPointerDown = false;
    if (currentDrawObj) {
      drawObjects.push(currentDrawObj);
      currentDrawObj = null;
      hasDrawings = drawObjects.length > 0;
      renderDrawCanvas();
      updateClearDrawingsBtn();
      commitEdit();
    }
  });
});

function updateClearDrawingsBtn() {
  clearDrawingsBtn.classList.toggle('hidden', drawObjects.length === 0);
}

clearDrawingsBtn.addEventListener('click', () => {
  beginEdit();
  drawObjects = [];
  selectedObjectId = null;
  currentDrawObj = null;
  hasDrawings = false;
  renderDrawCanvas();
  updateClearDrawingsBtn();
  commitEdit();
});

// ---------- Text annotation ----------
let pendingTextPos = null;

function showDrawSettingsForTextEdit(obj) {
  drawSettings.classList.remove('hidden');
  drawSettings.querySelector('.draw-color-row').classList.remove('hidden');
  drawSettings.querySelector('.draw-swatches').classList.remove('hidden');
  drawOpacityInput.classList.remove('hidden');
  drawSettings.querySelector('label.draw-label.opacity-label').classList.remove('hidden');
  const sizeLabelEl = drawSettings.querySelector('label.draw-label.size-label');
  if (sizeLabelEl) sizeLabelEl.classList.add('hidden');
  drawSizeInput.classList.add('hidden');
  drawFontSizeLabel.classList.remove('hidden');
  drawFontSizeInput.classList.remove('hidden');

  if (obj) {
    drawColor = obj.color;
    drawColorInput.value = obj.color;
    drawSwatches.forEach((s) => s.classList.toggle('active', s.dataset.color === obj.color));

    drawFontSize = obj.fontSize;
    drawFontSizeInput.value = String(obj.fontSize);
    drawFontSizeValue.textContent = String(obj.fontSize);

    drawOpacity = obj.opacity ?? 1.0;
    const opPct = Math.round(drawOpacity * 100);
    drawOpacityInput.value = String(opPct);
    drawOpacityValue.textContent = String(opPct);
  }
}

function updateDrawSettingsForSelectedObject(obj) {
  if (!obj) {
    if (!DRAW_TOOLS.includes(currentTool)) {
      drawSettings.classList.add('hidden');
    }
    return;
  }
  if (obj.type === 'draw-text') {
    showDrawSettingsForTextEdit(obj);
  } else {
    drawSettings.classList.remove('hidden');
    const isEraser = obj.type === 'draw-eraser';
    drawSettings.querySelector('.draw-color-row').classList.toggle('hidden', isEraser);
    drawSettings.querySelector('.draw-swatches').classList.toggle('hidden', isEraser);
    drawOpacityInput.classList.toggle('hidden', isEraser);
    drawSettings.querySelector('label.draw-label.opacity-label').classList.toggle('hidden', isEraser);
    const sizeLabelEl = drawSettings.querySelector('label.draw-label.size-label');
    if (sizeLabelEl) sizeLabelEl.classList.remove('hidden');
    drawSizeInput.classList.remove('hidden');
    drawFontSizeLabel.classList.add('hidden');
    drawFontSizeInput.classList.add('hidden');

    drawColor = obj.color;
    drawColorInput.value = obj.color;
    drawSwatches.forEach((s) => s.classList.toggle('active', s.dataset.color === obj.color));

    drawSize = obj.size || 4;
    drawSizeInput.value = String(drawSize);
    drawSizeValue.textContent = String(drawSize);

    drawOpacity = obj.opacity ?? 1.0;
    const opPct = Math.round(drawOpacity * 100);
    drawOpacityInput.value = String(opPct);
    drawOpacityValue.textContent = String(opPct);
  }
}

function editTextObject(obj) {
  beginEdit();
  editingTextObj = obj;
  pendingTextPos = { x: obj.x, y: obj.y };
  selectedObjectId = obj.id;
  const canvasRect = drawCanvas.getBoundingClientRect();
  const scaleX = canvasRect.width / drawCanvas.width;
  const scaleY = canvasRect.height / drawCanvas.height;
  const screenX = canvasRect.left + obj.x * scaleX + window.scrollX;
  const screenY = canvasRect.top + obj.y * scaleY + window.scrollY;
  textInputOverlay.style.left = `${screenX}px`;
  textInputOverlay.style.top = `${screenY}px`;
  textAnnotationInput.style.fontSize = `${Math.max(12, obj.fontSize * scaleY)}px`;
  textAnnotationInput.style.color = obj.color;
  textAnnotationInput.value = obj.text;
  textInputOverlay.classList.remove('hidden');

  showDrawSettingsForTextEdit(obj);

  renderDrawCanvas();
  requestAnimationFrame(() => {
    textAnnotationInput.focus();
    textAnnotationInput.select();
  });
}

function showTextInput(canvasPos) {
  beginEdit();
  editingTextObj = null;
  pendingTextPos = canvasPos;
  const canvasRect = drawCanvas.getBoundingClientRect();
  const scaleX = canvasRect.width / drawCanvas.width;
  const scaleY = canvasRect.height / drawCanvas.height;
  const screenX = canvasRect.left + canvasPos.x * scaleX + window.scrollX;
  const screenY = canvasRect.top + canvasPos.y * scaleY + window.scrollY;
  textInputOverlay.style.left = `${screenX}px`;
  textInputOverlay.style.top = `${screenY}px`;
  textAnnotationInput.style.fontSize = `${Math.max(12, drawFontSize * scaleY)}px`;
  textAnnotationInput.style.color = drawColor;
  textAnnotationInput.value = '';
  textInputOverlay.classList.remove('hidden');
  requestAnimationFrame(() => textAnnotationInput.focus());
}

function hideTextInput() {
  textInputOverlay.classList.add('hidden');
  pendingTextPos = null;
  if (editingTextObj) {
    editingTextObj = null;
    renderDrawCanvas();
  }
  strokeBeforeSnapshot = null;
  if (!DRAW_TOOLS.includes(currentTool) && !selectedObjectId) {
    drawSettings.classList.add('hidden');
  }
}

function commitTextAnnotation() {
  const text = textAnnotationInput.value.trim();
  if (editingTextObj) {
    if (text) {
      editingTextObj.text = text;
      commitEdit();
    } else {
      drawObjects = drawObjects.filter(o => o.id !== editingTextObj.id);
      if (selectedObjectId === editingTextObj.id) selectedObjectId = null;
      commitEdit();
    }
    editingTextObj = null;
    hasDrawings = drawObjects.length > 0;
    renderDrawCanvas();
    updateClearDrawingsBtn();
  } else if (text && pendingTextPos) {
    const obj = {
      id: newDrawId(),
      type: 'draw-text',
      color: drawColor,
      opacity: drawOpacity,
      size: 0,
      fontSize: drawFontSize,
      text,
      x: pendingTextPos.x,
      y: pendingTextPos.y,
    };
    drawObjects.push(obj);
    selectedObjectId = obj.id;
    hasDrawings = true;
    renderDrawCanvas();
    updateClearDrawingsBtn();
    commitEdit();
  } else {
    strokeBeforeSnapshot = null;
  }
  hideTextInput();
}

drawCanvas.addEventListener('dblclick', (e) => {
  if (currentTool !== 'none' && currentTool !== 'draw-text') return;
  const p = drawCanvasPoint(e);
  const hit = hitTest(p.x, p.y);
  if (hit && hit.type === 'draw-text') {
    editTextObject(hit);
  }
});

textAnnotationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitTextAnnotation();
  } else if (e.key === 'Escape') {
    hideTextInput();
  }
});
textAnnotationInput.addEventListener('blur', () => {
  setTimeout(() => {
    if (textAnnotationInput.value.trim()) {
      commitTextAnnotation();
    } else {
      hideTextInput();
    }
  }, 150);
});

// ---------- Draw tool controls ----------
function updateSelectedObjectColor(color) {
  drawColor = color;
  drawColorInput.value = drawColor;
  drawSwatches.forEach((s) => s.classList.toggle('active', s.dataset.color === drawColor));

  const targetObj = editingTextObj || (selectedObjectId ? drawObjects.find(o => o.id === selectedObjectId) : null);
  if (targetObj) {
    targetObj.color = drawColor;
    if (editingTextObj) {
      textAnnotationInput.style.color = drawColor;
    }
    renderDrawCanvas();
  }
}

drawColorInput.addEventListener('input', () => { updateSelectedObjectColor(drawColorInput.value); });
drawSwatches.forEach((sw) => {
  sw.addEventListener('click', () => { updateSelectedObjectColor(sw.dataset.color); });
});

drawSizeInput.addEventListener('input', () => {
  drawSize = Number(drawSizeInput.value);
  drawSizeValue.textContent = drawSize;
  const targetObj = selectedObjectId ? drawObjects.find(o => o.id === selectedObjectId) : null;
  if (targetObj && targetObj.type !== 'draw-text') {
    targetObj.size = drawSize;
    renderDrawCanvas();
  }
});

drawFontSizeInput.addEventListener('input', () => {
  drawFontSize = Number(drawFontSizeInput.value);
  drawFontSizeValue.textContent = drawFontSize;
  const targetObj = editingTextObj || (selectedObjectId ? drawObjects.find(o => o.id === selectedObjectId) : null);
  if (targetObj && targetObj.type === 'draw-text') {
    targetObj.fontSize = drawFontSize;
    if (editingTextObj) {
      const canvasRect = drawCanvas.getBoundingClientRect();
      const scaleY = canvasRect.height / drawCanvas.height;
      textAnnotationInput.style.fontSize = `${Math.max(12, drawFontSize * scaleY)}px`;
    }
    renderDrawCanvas();
  }
});

drawOpacityInput.addEventListener('input', () => {
  drawOpacity = Number(drawOpacityInput.value) / 100;
  drawOpacityValue.textContent = drawOpacityInput.value;
  const targetObj = editingTextObj || (selectedObjectId ? drawObjects.find(o => o.id === selectedObjectId) : null);
  if (targetObj) {
    targetObj.opacity = drawOpacity;
    renderDrawCanvas();
  }
});

function paintDot(p) {
  applyBrush(mainCtx, [p], currentTool);
  if (currentTool === 'erase') {
    // handled inside applyBrush
  }
}

function paintStroke(from, to, mode) {
  applyBrush(mainCtx, [from, to], mode);
}

function applyBrush(ctx, points, mode) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = brushSize;

  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    strokePathAndDot(ctx, points);
  } else if (mode === 'restore') {
    // Paint with a pattern of the untouched original photo so the stroke
    // "reveals" the original pixels (full opacity/color) under the brush.
    ctx.globalCompositeOperation = 'source-over';
    const pattern = ctx.createPattern(originalCanvas, 'no-repeat');
    ctx.strokeStyle = pattern;
    ctx.fillStyle = pattern;
    strokePathAndDot(ctx, points);
  }
  ctx.restore();
}

function strokePathAndDot(ctx, points) {
  ctx.beginPath();
  if (points.length === 1) {
    ctx.arc(points[0].x, points[0].y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
  }
}

// ---------- Crop ----------
function drawCropRect(start, current) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  cropRect = { x, y, w, h };
  renderCropOverlay();
}

function renderCropOverlay() {
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  if (!cropRect) return;
  cropCtx.save();
  cropCtx.fillStyle = 'rgba(0,0,0,0.55)';
  cropCtx.fillRect(0, 0, cropOverlay.width, cropOverlay.height);
  cropCtx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  cropCtx.strokeStyle = '#f5a524';
  cropCtx.lineWidth = 2;
  cropCtx.setLineDash([8, 6]);
  cropCtx.lineDashOffset = -marchAntsOffset;
  cropCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  cropCtx.restore();
}

function startMarchingAnts() {
  stopMarchingAnts();
  marchAntsTimer = setInterval(() => {
    marchAntsOffset = (marchAntsOffset + 1) % 14;
    renderCropOverlay();
  }, 60);
}
function stopMarchingAnts() {
  if (marchAntsTimer) clearInterval(marchAntsTimer);
  marchAntsTimer = null;
}

function cancelCrop() {
  cropRect = null;
  cropStart = null;
  stopMarchingAnts();
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  cropActions.classList.add('hidden');
}
cropCancelBtn.addEventListener('click', cancelCrop);

cropApplyBtn.addEventListener('click', () => {
  if (!cropRect) return;
  beginEdit();
  const { x, y, w, h } = cropRect;
  const rx = Math.round(x), ry = Math.round(y), rw = Math.round(w), rh = Math.round(h);

  const cropOne = (srcCanvas) => {
    const tmp = document.createElement('canvas');
    tmp.width = rw;
    tmp.height = rh;
    tmp.getContext('2d').drawImage(srcCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
    return tmp;
  };

  const newMain = cropOne(mainCanvas);
  const newOriginal = cropOne(originalCanvas);

  sizeCanvases(rw, rh);
  mainCtx.drawImage(newMain, 0, 0);
  originalCtx.drawImage(newOriginal, 0, 0);
  paintBackgroundLayer();

  cancelCrop();
  commitEdit();
  selectTool('none');
  // Transform all draw object coordinates by the crop offset
  drawObjects.forEach(obj => moveObject(obj, -rx, -ry));
  renderDrawCanvas();
});

// ---------- Undo / Redo / Reset ----------
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);

window.addEventListener('keydown', (e) => {
  if (!editorScreen.classList.contains('active')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  // Annotation selection shortcuts (no modifier needed for Delete, Enter/F2 to edit text)
  const isInTextInput = document.activeElement === textAnnotationInput;
  if (!isInTextInput && (e.key === 'Delete' || e.key === 'Backspace') && selectedObjectId) {
    e.preventDefault();
    beginEdit();
    drawObjects = drawObjects.filter(o => o.id !== selectedObjectId);
    selectedObjectId = null;
    hasDrawings = drawObjects.length > 0;
    renderDrawCanvas();
    updateClearDrawingsBtn();
    commitEdit();
    return;
  }
  if (!isInTextInput && (e.key === 'Enter' || e.key === 'F2') && selectedObjectId) {
    const obj = drawObjects.find(o => o.id === selectedObjectId);
    if (obj && obj.type === 'draw-text') {
      e.preventDefault();
      editTextObject(obj);
      return;
    }
  }

  if (!mod) return;

  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    doUndo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    doRedo();
  } else if (key === 'c' && selectedObjectId) {
    e.preventDefault();
    const obj = drawObjects.find(o => o.id === selectedObjectId);
    if (obj) copyBuffer = cloneDrawObj(obj);
  } else if (key === 'v' && copyBuffer) {
    e.preventDefault();
    beginEdit();
    const pasted = cloneDrawObj(copyBuffer);
    // Offset paste so it doesn't land exactly on top of the source
    moveObject(pasted, 20, 20);
    drawObjects.push(pasted);
    selectedObjectId = pasted.id;
    hasDrawings = true;
    renderDrawCanvas();
    updateClearDrawingsBtn();
    commitEdit();
    } else if (key === '=' || key === '+') {
      e.preventDefault();
      setZoom(zoomLevel * 1.25);
    } else if (key === '-') {
      e.preventDefault();
      setZoom(zoomLevel / 1.25);
    } else if (key === '0') {
      e.preventDefault();
      setZoom(1.0);
    }
});

resetBtn.addEventListener('click', () => {
  if (!initialCutout) return;
  beginEdit();
  const img = new Image();
  img.onload = () => {
    sizeCanvases(initialCutout.w, initialCutout.h, true);
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(img, 0, 0);
    originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    originalCtx.drawImage(initialOriginalImg, 0, 0, originalCanvas.width, originalCanvas.height);
    drawObjects = [];
    selectedObjectId = null;
    hasDrawings = false;
    renderDrawCanvas();
    updateClearDrawingsBtn();
    setBgSwatch(null, null, true);
    cancelCrop();
    commitEdit();
  };
  img.src = initialCutout.dataURL;
});

// ---------- Export ----------
downloadBtn.addEventListener('click', () => {
  const format = exportFormat.value;
  const quality = Number(exportQuality.value);
  const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';

  const out = document.createElement('canvas');
  out.width = mainCanvas.width;
  out.height = mainCanvas.height;
  const octx = out.getContext('2d');
  const radius = cornerRadiusPx();

  octx.save();
  if (radius > 0) {
    clipRoundedRect(octx, out.width, out.height, radius);
    octx.clip();
  }

  if (bgColor) {
    octx.fillStyle = bgColor;
    octx.fillRect(0, 0, out.width, out.height);
  } else if (format === 'image/jpeg') {
    // JPEGs do not support transparency — fill with white instead of letting browser default to black
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
  }

  // Draw main cutout image
  octx.drawImage(mainCanvas, 0, 0);

  // Render clean annotations directly without selection box or handles
  for (const obj of drawObjects) {
    renderObject(octx, obj);
  }

  octx.restore();

  out.toBlob(
    (blob) => {
      if (!blob) {
        alert('Could not export image file.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${loadedFileName}-clearcut.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    format,
    format === 'image/png' ? undefined : quality
  );
});

exportFormat.addEventListener('change', () => {
  const isJpegLike = exportFormat.value !== 'image/png';
  exportQuality.disabled = !isJpegLike;
});
exportQuality.disabled = exportFormat.value === 'image/png';
undoBtn.disabled = true;
redoBtn.disabled = true;

// ---------- Zoom & Pan Event Listeners ----------
if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(zoomLevel * 1.25));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel / 1.25));
if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => setZoom(1.0));
if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => setZoom(1.0));

if (canvasWrap) {
  canvasWrap.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      setZoom(zoomLevel * factor, { x: e.clientX, y: e.clientY });
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const isTextInput = document.activeElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable);
    if (e.code === 'Space' && !isTextInput && editorScreen.classList.contains('active')) {
      e.preventDefault();
      if (!isSpacePressed) {
        isSpacePressed = true;
        canvasWrap.style.cursor = 'grab';
        if (canvasContainer) canvasContainer.style.pointerEvents = 'none';
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      const isTextInput = document.activeElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable);
      if (!isTextInput) {
        e.preventDefault();
      }
      isSpacePressed = false;
      isPanning = false;
      panStart = null;
      canvasWrap.style.cursor = 'default';
      if (canvasContainer) canvasContainer.style.pointerEvents = 'auto';
    }
  });

  canvasWrap.addEventListener('pointerdown', (e) => {
    if (isSpacePressed || e.button === 1) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, scrollLeft: canvasWrap.scrollLeft, scrollTop: canvasWrap.scrollTop };
      try { canvasWrap.setPointerCapture(e.pointerId); } catch (_) {}
      canvasWrap.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  canvasWrap.addEventListener('pointermove', (e) => {
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      canvasWrap.scrollLeft = panStart.scrollLeft - dx;
      canvasWrap.scrollTop = panStart.scrollTop - dy;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((evt) => {
    window.addEventListener(evt, (e) => {
      if (isPanning) {
        isPanning = false;
        panStart = null;
        canvasWrap.style.cursor = isSpacePressed ? 'grab' : 'default';
        try { canvasWrap.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }, true);
  });
}

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => updateCanvasContainerSize()).observe(canvasWrap);
} else {
  window.addEventListener('resize', updateCanvasContainerSize);
}
