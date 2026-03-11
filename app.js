/**
 * Camera Scanner - app.js
 * Main application controller
 */

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  stream: null,
  facingMode: 'environment',   // 'environment' (back) | 'user' (front)
  currentMode: 'AUTO',         // AUTO | DOC | PHOTO | QR
  flashEnabled: false,
  timerDelay: 0,               // 0 | 3 | 5 | 10
  gridVisible: true,
  scans: [],                   // Array of { id, dataUrl, date, size, mode }
  activePreview: null,
  timerInterval: null,
  settings: {
    resolution: 'fhd',
    enhance: true,
    saveToDevice: true,
    format: 'png',
    quality: 92,
    sound: true,
  },
};

const RESOLUTIONS = {
  hd:  { width: 1280, height: 720 },
  fhd: { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

const video          = $('camera-video');
const canvas         = $('camera-canvas');
const ctx            = canvas.getContext('2d');

const splashScreen   = $('splash-screen');
const app            = $('app');

const modeBtns       = document.querySelectorAll('.mode-btn');
const modeBadge      = $('mode-badge');
const zoomIndicator  = $('zoom-indicator');
const flashEffect    = $('flash-effect');
const gridOverlay    = $('grid-overlay');
const timerCountdown = $('timer-countdown');
const timerNumber    = $('timer-number');

const btnShutter     = $('btn-shutter');
const btnFlip        = $('btn-flip');
const btnFlash       = $('btn-flash');
const flashLabel     = $('flash-label');
const btnTimer       = $('btn-timer');
const timerLabel     = $('timer-label');
const btnGrid        = $('btn-grid');
const btnLastScan    = $('btn-last-scan');

const btnGallery     = $('btn-gallery');
const galleryPanel   = $('gallery-panel');
const galleryGrid    = $('gallery-grid');
const closeGallery   = $('close-gallery');
const btnClearAll    = $('btn-clear-all');

const btnSettings    = $('btn-settings');
const settingsPanel  = $('settings-panel');
const closeSettings  = $('close-settings');

const previewModal   = $('preview-modal');
const modalBg        = $('modal-bg');
const closeModal     = $('close-modal');
const previewImage   = $('preview-image');
const previewDate    = $('preview-date');
const previewSize    = $('preview-size');
const btnDownload    = $('btn-download');
const btnShare       = $('btn-share');
const btnDeleteScan  = $('btn-delete-scan');

const toast          = $('toast');
const storageUsed    = $('storage-used');

// ─── INIT ─────────────────────────────────────────────────────────────────────
(function init() {
  loadScansFromStorage();
  loadSettingsFromStorage();
  applySettings();

  // Hide splash and show app after 2.4s
  setTimeout(() => {
    splashScreen.style.display = 'none';
    app.classList.remove('hidden');
    startCamera();
  }, 2400);

  bindEvents();
})();

// ─── CAMERA ───────────────────────────────────────────────────────────────────
async function startCamera() {
  stopCamera();

  const res = RESOLUTIONS[state.settings.resolution] || RESOLUTIONS.fhd;

  const constraints = {
    video: {
      facingMode: { ideal: state.facingMode },
      width:  { ideal: res.width },
      height: { ideal: res.height },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    removeCameraError();
  } catch (err) {
    console.error('Camera error:', err);
    showCameraError(err);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
    video.srcObject = null;
  }
}

function showCameraError(err) {
  let msg = 'Unable to access camera.';
  if (err.name === 'NotAllowedError') msg = 'Camera permission denied. Please allow camera access in your browser settings.';
  else if (err.name === 'NotFoundError') msg = 'No camera found on this device.';
  else if (err.name === 'NotReadableError') msg = 'Camera is already in use by another app.';

  const wrapper = $$('.camera-wrapper');
  if (!wrapper.querySelector('.no-camera-msg')) {
    const div = document.createElement('div');
    div.className = 'no-camera-msg';
    div.innerHTML = `
      <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
        <path d="M8 20l8-8h32l8 8v24l-8 8H16l-8-8V20z" stroke="currentColor" stroke-width="2"/>
        <circle cx="32" cy="32" r="8" stroke="currentColor" stroke-width="2"/>
        <path d="M16 16l32 32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <h3>Camera unavailable</h3>
      <p>${msg}</p>
      <button onclick="startCamera()" style="margin-top:12px;background:var(--accent);color:#000;padding:10px 20px;border-radius:10px;font-weight:700;font-size:0.9rem;">Retry</button>
    `;
    wrapper.appendChild(div);
  }
}

function removeCameraError() {
  const el = $$('.no-camera-msg');
  if (el) el.remove();
}

// ─── CAPTURE ──────────────────────────────────────────────────────────────────
function capture() {
  if (!state.stream) { showToast('No camera stream', 'error'); return; }

  // Draw frame to canvas
  canvas.width  = video.videoWidth  || 1920;
  canvas.height = video.videoHeight || 1080;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Enhance if enabled
  if (state.settings.enhance) applyEnhancement();

  const fmt = state.settings.format === 'jpeg' ? 'image/jpeg'
            : state.settings.format === 'webp' ? 'image/webp'
            : 'image/png';
  const quality = state.settings.quality / 100;
  const dataUrl = canvas.toDataURL(fmt, quality);

  const scan = {
    id: Date.now(),
    dataUrl,
    date: new Date().toLocaleString(),
    size: Math.round((dataUrl.length * 0.75) / 1024),  // approx kB
    mode: state.currentMode,
  };

  state.scans.unshift(scan);
  saveScansToStorage();
  updateThumbnail(dataUrl);
  renderGallery();

  // Flash effect
  flashEffect.classList.remove('hidden');
  setTimeout(() => flashEffect.classList.add('hidden'), 300);

  // Sound
  if (state.settings.sound) playShutterSound();

  // Save to device
  if (state.settings.saveToDevice) autoDownload(scan);

  showToast('Scan saved!', 'success');
}

function applyEnhancement() {
  // Simple contrast + brightness boost for document scanning
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const contrast = 1.15;
  const brightness = 8;
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.min(255, Math.max(0, (data[i]   - 128) * contrast + 128 + brightness));
    data[i+1] = Math.min(255, Math.max(0, (data[i+1] - 128) * contrast + 128 + brightness));
    data[i+2] = Math.min(255, Math.max(0, (data[i+2] - 128) * contrast + 128 + brightness));
  }
  ctx.putImageData(imgData, 0, 0);
}

function autoDownload(scan) {
  const ext = state.settings.format;
  const a = document.createElement('a');
  a.href = scan.dataUrl;
  a.download = `scan_${scan.id}.${ext}`;
  a.click();
}

function playShutterSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ac = new AudioCtx();
    const oscillator = ac.createOscillator();
    const gainNode = ac.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ac.destination);
    oscillator.frequency.setValueAtTime(1200, ac.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(600, ac.currentTime + 0.08);
    gainNode.gain.setValueAtTime(0.3, ac.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
    oscillator.start(ac.currentTime);
    oscillator.stop(ac.currentTime + 0.15);
  } catch (_) {}
}

// ─── TIMER CAPTURE ────────────────────────────────────────────────────────────
function startTimerCapture() {
  if (state.timerDelay === 0) { capture(); return; }

  let count = state.timerDelay;
  timerNumber.textContent = count;
  timerCountdown.classList.remove('hidden');

  state.timerInterval = setInterval(() => {
    count--;
    timerNumber.textContent = count;
    if (count <= 0) {
      clearInterval(state.timerInterval);
      timerCountdown.classList.add('hidden');
      capture();
    }
  }, 1000);
}

// ─── FLIP / FLASH ─────────────────────────────────────────────────────────────
function flipCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

const TIMER_OPTIONS = [0, 3, 5, 10];
function cycleTimer() {
  const idx = TIMER_OPTIONS.indexOf(state.timerDelay);
  state.timerDelay = TIMER_OPTIONS[(idx + 1) % TIMER_OPTIONS.length];
  timerLabel.textContent = state.timerDelay === 0 ? 'No Timer' : `${state.timerDelay}s`;
  btnTimer.classList.toggle('active', state.timerDelay > 0);
  showToast(state.timerDelay === 0 ? 'Timer off' : `Timer: ${state.timerDelay}s`);
}

function toggleFlash() {
  state.flashEnabled = !state.flashEnabled;
  flashLabel.textContent = state.flashEnabled ? 'Flash On' : 'Flash Off';
  btnFlash.classList.toggle('active', state.flashEnabled);

  // Apply torch mode if supported
  if (state.stream) {
    const track = state.stream.getVideoTracks()[0];
    if (track && track.getCapabilities && track.getCapabilities().torch) {
      track.applyConstraints({ advanced: [{ torch: state.flashEnabled }] })
        .catch(() => showToast('Torch not supported', 'error'));
    } else {
      showToast(state.flashEnabled ? 'Flash on (simulated)' : 'Flash off');
    }
  }
}

function toggleGrid() {
  state.gridVisible = !state.gridVisible;
  gridOverlay.style.display = state.gridVisible ? 'block' : 'none';
  btnGrid.classList.toggle('active', state.gridVisible);
}

// ─── MODE ─────────────────────────────────────────────────────────────────────
function setMode(mode) {
  state.currentMode = mode;
  modeBadge.textContent = mode;
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  // Adjust scan line visibility per mode
  const scanLine = $$('.scan-line');
  if (mode === 'PHOTO') {
    scanLine.style.display = 'none';
  } else {
    scanLine.style.display = 'block';
  }
}

// ─── GALLERY ──────────────────────────────────────────────────────────────────
function renderGallery() {
  if (state.scans.length === 0) {
    galleryGrid.innerHTML = `
      <div class="gallery-empty">
        <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
          <rect x="8" y="14" width="48" height="36" rx="5" stroke="currentColor" stroke-width="2" opacity="0.3"/>
          <circle cx="32" cy="32" r="8" stroke="currentColor" stroke-width="2" opacity="0.3"/>
        </svg>
        <p>No scans yet.<br/>Capture your first scan!</p>
      </div>`;
    return;
  }

  galleryGrid.innerHTML = state.scans.map(scan => `
    <div class="gallery-item" data-id="${scan.id}">
      <img src="${scan.dataUrl}" alt="Scan ${scan.id}" loading="lazy" />
      <div class="item-badge">${scan.mode}</div>
    </div>
  `).join('');

  galleryGrid.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id);
      openPreview(id);
    });
  });

  // Update storage info
  updateStorageInfo();
}

function updateThumbnail(dataUrl) {
  const inner = btnLastScan.querySelector('.thumb-placeholder');
  if (inner) {
    const img = document.createElement('img');
    img.src = dataUrl;
    btnLastScan.innerHTML = '';
    btnLastScan.appendChild(img);
  } else {
    const img = btnLastScan.querySelector('img');
    if (img) img.src = dataUrl;
  }
}

function updateStorageInfo() {
  let totalBytes = 0;
  state.scans.forEach(s => { totalBytes += s.size * 1024; });
  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  if (storageUsed) storageUsed.textContent = `${mb} MB`;
}

// ─── PREVIEW MODAL ────────────────────────────────────────────────────────────
function openPreview(id) {
  const scan = state.scans.find(s => s.id === id);
  if (!scan) return;
  state.activePreview = scan;

  previewImage.src = scan.dataUrl;
  previewDate.textContent = scan.date;
  previewSize.textContent = `${scan.size} KB`;

  previewModal.classList.remove('hidden');
}

function closePreview() {
  previewModal.classList.add('hidden');
  state.activePreview = null;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function saveScansToStorage() {
  try {
    // Only keep last 30 scans to avoid quota issues
    const toSave = state.scans.slice(0, 30);
    localStorage.setItem('camera_scanner_scans', JSON.stringify(toSave));
  } catch (e) {
    console.warn('Storage quota exceeded, skipping save.');
  }
}

function loadScansFromStorage() {
  try {
    const raw = localStorage.getItem('camera_scanner_scans');
    if (raw) state.scans = JSON.parse(raw);
    if (state.scans.length > 0) updateThumbnail(state.scans[0].dataUrl);
  } catch (_) { state.scans = []; }
}

function saveSettingsFromUI() {
  state.settings.resolution   = $('setting-resolution').value;
  state.settings.enhance      = $('setting-enhance').checked;
  state.settings.saveToDevice = $('setting-save').checked;
  state.settings.format       = $('setting-format').value;
  state.settings.quality      = parseInt($('setting-quality').value);
  state.settings.sound        = $('setting-sound').checked;
  localStorage.setItem('camera_scanner_settings', JSON.stringify(state.settings));
}

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem('camera_scanner_settings');
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch (_) {}
}

function applySettings() {
  $('setting-resolution').value  = state.settings.resolution;
  $('setting-enhance').checked   = state.settings.enhance;
  $('setting-save').checked      = state.settings.saveToDevice;
  $('setting-format').value      = state.settings.format;
  $('setting-quality').value     = state.settings.quality;
  $('setting-sound').checked     = state.settings.sound;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ` ${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function bindEvents() {
  // Shutter
  btnShutter.addEventListener('click', startTimerCapture);

  // Flip camera
  btnFlip.addEventListener('click', () => { flipCamera(); showToast('Camera flipped'); });

  // Flash
  btnFlash.addEventListener('click', toggleFlash);

  // Timer
  btnTimer.addEventListener('click', cycleTimer);

  // Grid
  btnGrid.addEventListener('click', toggleGrid);

  // Last scan → open preview
  btnLastScan.addEventListener('click', () => {
    if (state.scans.length > 0) openPreview(state.scans[0].id);
    else showToast('No scans yet');
  });

  // Scan modes
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Gallery
  btnGallery.addEventListener('click', () => {
    renderGallery();
    galleryPanel.classList.remove('hidden');
  });
  closeGallery.addEventListener('click', () => galleryPanel.classList.add('hidden'));
  btnClearAll.addEventListener('click', () => {
    if (confirm('Delete all scans?')) {
      state.scans = [];
      saveScansToStorage();
      renderGallery();
      btnLastScan.innerHTML = `<div class="thumb-placeholder"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 9h18M9 21V9" stroke="currentColor" stroke-width="1.5"/></svg></div>`;
      showToast('All scans deleted');
    }
  });

  // Settings
  btnSettings.addEventListener('click', () => settingsPanel.classList.remove('hidden'));
  closeSettings.addEventListener('click', () => {
    saveSettingsFromUI();
    settingsPanel.classList.add('hidden');
    // Restart camera if resolution changed
    startCamera();
    showToast('Settings saved');
  });

  // Modal
  closeModal.addEventListener('click', closePreview);
  modalBg.addEventListener('click', closePreview);

  btnDownload.addEventListener('click', () => {
    if (!state.activePreview) return;
    const a = document.createElement('a');
    a.href = state.activePreview.dataUrl;
    a.download = `scan_${state.activePreview.id}.${state.settings.format}`;
    a.click();
    showToast('Downloading…');
  });

  btnShare.addEventListener('click', async () => {
    if (!state.activePreview) return;
    if (navigator.share) {
      try {
        const blob = await (await fetch(state.activePreview.dataUrl)).blob();
        const file = new File([blob], `scan_${state.activePreview.id}.${state.settings.format}`, { type: blob.type });
        await navigator.share({ files: [file], title: 'Camera Scanner', text: 'Shared from Camera Scanner' });
      } catch (err) {
        if (err.name !== 'AbortError') showToast('Share failed', 'error');
      }
    } else {
      showToast('Share not supported on this device', 'error');
    }
  });

  btnDeleteScan.addEventListener('click', () => {
    if (!state.activePreview) return;
    state.scans = state.scans.filter(s => s.id !== state.activePreview.id);
    saveScansToStorage();
    renderGallery();
    closePreview();
    showToast('Scan deleted');
  });

  // Pinch-to-zoom (basic)
  let lastDist = null;
  let currentZoom = 1.0;

  $$('.camera-wrapper').addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastDist = null;
  }, { passive: true });

  $$('.camera-wrapper').addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (lastDist !== null) {
      const delta = dist / lastDist;
      currentZoom = Math.min(4, Math.max(1, currentZoom * delta));
      video.style.transform = `scale(${currentZoom})`;
      zoomIndicator.textContent = `${currentZoom.toFixed(1)}x`;
    }
    lastDist = dist;
  }, { passive: true });

  $$('.camera-wrapper').addEventListener('touchend', e => {
    if (e.touches.length < 2) lastDist = null;
  }, { passive: true });

  // Tap to focus indicator
  $$('.camera-wrapper').addEventListener('click', e => {
    if (e.touches && e.touches.length > 1) return;
    showFocusRing(e.clientX, e.clientY);
  });

  // Keyboard (desktop testing)
  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); startTimerCapture(); }
    if (e.code === 'KeyF') toggleFlash();
    if (e.code === 'KeyG') toggleGrid();
  });

  // Handle page visibility (stop/start camera)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if (!galleryPanel.classList.contains('hidden') === false &&
             !settingsPanel.classList.contains('hidden') === false) {
      startCamera();
    } else startCamera();
  });
}

// ─── FOCUS RING ───────────────────────────────────────────────────────────────
function showFocusRing(x, y) {
  const existing = $$('.focus-ring');
  if (existing) existing.remove();

  const ring = document.createElement('div');
  ring.className = 'focus-ring';
  ring.style.cssText = `
    position:absolute;
    left:${x}px;top:${y}px;
    width:56px;height:56px;
    margin:-28px 0 0 -28px;
    border:2px solid var(--accent);
    border-radius:50%;
    pointer-events:none;
    animation:focusAnim 0.4s ease forwards;
    z-index:5;
  `;

  // Inject keyframes if not present
  if (!document.querySelector('#focusStyle')) {
    const style = document.createElement('style');
    style.id = 'focusStyle';
    style.textContent = `@keyframes focusAnim { 0%{opacity:1;transform:scale(1.3)} 100%{opacity:0;transform:scale(1)} }`;
    document.head.appendChild(style);
  }

  $$('.camera-wrapper').appendChild(ring);
  setTimeout(() => ring.remove(), 450);
}

// ─── QR DETECTION (basic, if BarcodeDetector available) ───────────────────────
let qrInterval = null;

function startQRScan() {
  if (!('BarcodeDetector' in window)) return;

  const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'code_128'] });

  qrInterval = setInterval(async () => {
    if (state.currentMode !== 'QR') { stopQRScan(); return; }
    if (!video.readyState || video.readyState < 2) return;

    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        const result = codes[0].rawValue;
        stopQRScan();
        showQRResult(result);
      }
    } catch (_) {}
  }, 500);
}

function stopQRScan() {
  clearInterval(qrInterval);
  qrInterval = null;
}

function showQRResult(value) {
  const isUrl = value.startsWith('http://') || value.startsWith('https://');
  const msg = isUrl ? `QR: ${value.slice(0, 40)}…` : `QR: ${value.slice(0, 50)}`;
  showToast(msg, 'success');

  // Auto-open URL
  if (isUrl && confirm(`Open URL?\n${value}`)) {
    window.open(value, '_blank', 'noopener');
  }

  // Resume scanning after 3s
  setTimeout(() => {
    if (state.currentMode === 'QR') startQRScan();
  }, 3000);
}

// Watch mode changes to start/stop QR
const origSetMode = setMode;
window.setMode = function(mode) {
  origSetMode(mode);
  if (mode === 'QR') startQRScan();
  else stopQRScan();
};
