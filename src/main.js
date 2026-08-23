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
const cropOverlay = document.getElementById('crop-overlay');
const canvasWrap = document.getElementById('canvas-wrap');
const bgCtx = bgCanvas.getContext('2d');
const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
const cropCtx = cropOverlay.getContext('2d');

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

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const resetBtn = document.getElementById('reset-btn');
const newImageBtn = document.getElementById('new-image-btn');

const exportFormat = document.getElementById('export-format');
const exportQuality = document.getElementById('export-quality');
const downloadBtn = document.getElementById('download-btn');

const cropActions = document.getElementById('crop-actions');
const cropApplyBtn = document.getElementById('crop-apply-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const removeBgBtn = document.getElementById('remove-bg-btn');

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

// ---------- Utility ----------
function setStatus(text) {
  statusText.textContent = text;
}
function setProgress(pct) {
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function sizeCanvases(w, h) {
  [bgCanvas, mainCanvas, cropOverlay, originalCanvas].forEach((c) => {
    c.width = w;
    c.height = h;
  });
  requestAnimationFrame(applyCornerRadiusPreview);
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
  };
}

// Call BEFORE a destructive edit starts, to remember what to undo back to.
function beginEdit() {
  strokeBeforeSnapshot = snapshotCurrent();
}

// Call AFTER a destructive edit finishes, committing the "before" snapshot to the undo stack.
function commitEdit() {
  if (!strokeBeforeSnapshot) return;
  undoStack.push(strokeBeforeSnapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  strokeBeforeSnapshot = null;
  updateHistoryButtons();
}

function restoreSnapshot(snap) {
  sizeCanvases(snap.w, snap.h);
  mainCtx.putImageData(snap.data, 0, 0);
  originalCtx.putImageData(snap.originalData, 0, 0);
  paintBackgroundLayer();
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

  const img = await loadImageFromFile(file);

  uploadScreen.classList.remove('active');
  editorScreen.classList.add('active');
  undoStack = [];
  redoStack = [];
  strokeBeforeSnapshot = null;
  updateHistoryButtons();
  resetTool();
  setBgSwatch(null);

  sizeCanvases(img.naturalWidth, img.naturalHeight);
  originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  originalCtx.drawImage(img, 0, 0);
  initialOriginalImg = img;
  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  mainCtx.drawImage(img, 0, 0);
  paintBackgroundLayer();

  initialCutout = { dataURL: mainCanvas.toDataURL('image/png'), w: mainCanvas.width, h: mainCanvas.height };
  setCornerRadiusPct(0);
  setRemoveBgBusy(false);
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
  brushSettings.classList.toggle('hidden', tool !== 'erase' && tool !== 'restore');
  canvasWrap.classList.toggle('cropping', tool === 'crop');
  cropOverlay.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
  cropActions.classList.toggle('hidden', tool !== 'crop' || !cropRect);
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
function setBgSwatch(color, activeEl) {
  bgColor = color;
  swatches.forEach((s) => s.classList.remove('active'));
  if (activeEl) {
    activeEl.classList.add('active');
  } else {
    const match = [...swatches].find((s) => s.dataset.bg === (color ?? 'transparent'));
    if (match) match.classList.add('active');
  }
  paintBackgroundLayer();
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
});

// ---------- Undo / Redo / Reset ----------
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);

window.addEventListener('keydown', (e) => {
  if (!editorScreen.classList.contains('active')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const key = e.key.toLowerCase();

  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    doUndo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    doRedo();
  }
});

resetBtn.addEventListener('click', () => {
  if (!initialCutout) return;
  beginEdit();
  const img = new Image();
  img.onload = () => {
    sizeCanvases(initialCutout.w, initialCutout.h);
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(img, 0, 0);
    originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    originalCtx.drawImage(initialOriginalImg, 0, 0, originalCanvas.width, originalCanvas.height);
    paintBackgroundLayer();
    cancelCrop();
    commitEdit();
  };
  img.src = initialCutout.dataURL;
});

// ---------- Export ----------
downloadBtn.addEventListener('click', () => {
  const out = document.createElement('canvas');
  out.width = mainCanvas.width;
  out.height = mainCanvas.height;
  const octx = out.getContext('2d');
  const radius = cornerRadiusPx();
  octx.save();
  clipRoundedRect(octx, out.width, out.height, radius);
  octx.clip();
  if (bgColor) {
    octx.fillStyle = bgColor;
    octx.fillRect(0, 0, out.width, out.height);
  }
  octx.drawImage(mainCanvas, 0, 0);
  octx.restore();

  const format = exportFormat.value;
  const quality = Number(exportQuality.value);
  out.toBlob(
    (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
      a.href = url;
      a.download = `clearcut-export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
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

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => applyCornerRadiusPreview()).observe(canvasWrap);
} else {
  window.addEventListener('resize', applyCornerRadiusPreview);
}
