

// Exclusive accordion: opening one section closes the others.
document.getElementById('accordion').addEventListener('click', (e) => {
  const header = e.target.closest('.accordion-header');
  if (!header) return;
  const section = header.closest('.accordion-section');
  if (section.classList.contains('locked')) return;

  const willOpen = !section.classList.contains('open');
  document.querySelectorAll('.accordion-section').forEach((s) => s.classList.remove('open'));
  if (willOpen) section.classList.add('open');
});

// Sub-tabs inside the OCR section (placeholder switching, no content yet).
document.querySelectorAll('.subtabs').forEach((group) => {
  group.querySelectorAll('.subtab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      group.querySelectorAll('.subtab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});

// Export chip toggles (placeholder).
document.querySelectorAll('.export-chip').forEach((chip) => {
  chip.addEventListener('click', () => chip.classList.toggle('checked'));
});




// Resizable sidebar

const handle = document.getElementById('resize-handle');
const handleRight = document.getElementById('resize-handle-right');
const workspace = document.querySelector('.workspace');
let isDragging = false;
let isDraggingRight = false;

let currentSidebarWidth = 280;
let currentRightWidth = 550;

handle.addEventListener('mousedown', () => {
  isDragging = true;
  handle.classList.add('dragging');
});

handleRight.addEventListener('mousedown', () => {
  isDraggingRight = true;
  handleRight.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (mouseDownPos) {
    const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
    if (dist > 4) didDrag = true;
  }

  if (isDragging) {
    currentSidebarWidth = Math.min(Math.max(e.clientX, 160), 480);
    workspace.style.gridTemplateColumns = `${currentSidebarWidth}px 6px 1fr 6px ${currentRightWidth}px`;
  }

  if (isDraggingRight) {
    const distanceFromRight = window.innerWidth - e.clientX;
    currentRightWidth = Math.min(Math.max(distanceFromRight, 320), 800);
    workspace.style.gridTemplateColumns = `${currentSidebarWidth}px 6px 1fr 6px ${currentRightWidth}px`;
  }

  if (!isPanning) return;
  panX = e.clientX - panStart.x;
  panY = e.clientY - panStart.y;
  applyZoom();
});

document.addEventListener('mouseup', () => {
  isPanning = false;
  mouseDownPos = null;
  previewImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';

  if (isDragging) {
    isDragging = false;
    handle.classList.remove('dragging');
  }
  if (isDraggingRight) {
    isDraggingRight = false;
    handleRight.classList.remove('dragging');
  }
});

document.addEventListener('keydown', (e) => {
  const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (isTyping) return;

  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    if (segmentationLines.length > 0) {
      e.preventDefault();
      selectedIndices = new Set(segmentationLines.map((_, i) => i));
      renderOverlay();
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    document.getElementById('undo-segmentation-btn').click();
  }

  if (e.key === 'Escape') {
    selectedIndices = new Set();
    renderOverlay();
  }
});
////// crop //

let cropStart = null;

const cropBtn = document.getElementById('crop-btn');
const cropConfirmBtn = document.getElementById('crop-confirm-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const cropOverlay = document.getElementById('crop-overlay');
const cropBox = document.getElementById('crop-box');
const previewImage = document.getElementById('preview-image');

if (cropBtn) {

function endCropMode() {
  cropOverlay.style.display = 'none';
  cropBox.style.display = 'none';
  cropBtn.style.display = 'flex';
  cropConfirmBtn.style.display = 'none';
  cropCancelBtn.style.display = 'none';
}

cropBtn.addEventListener('click', () => {
  cropOverlay.style.display = 'block';
  cropBtn.style.display = 'none';
  cropConfirmBtn.style.display = 'flex';
  cropCancelBtn.style.display = 'flex';
});

cropCancelBtn.addEventListener('click', endCropMode);

let imageBounds = null;

let cropBoxRect = null;
let cropInteractionMode = null;
let cropDragStart = null;

cropOverlay.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  if (e.target.classList.contains('crop-handle') || e.target === cropBox) return;

  imageBounds = getVisibleImageRect();
  const rect = cropOverlay.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;

  cropStart = {
    x: clamp(rawX, imageBounds.left, imageBounds.left + imageBounds.width),
    y: clamp(rawY, imageBounds.top, imageBounds.top + imageBounds.height),
  };
  cropInteractionMode = 'drawing';
  cropBox.style.left = cropStart.x + 'px';
  cropBox.style.top = cropStart.y + 'px';
  cropBox.style.width = '0px';
  cropBox.style.height = '0px';
  cropBox.style.display = 'block';
});

cropOverlay.addEventListener('mousemove', (e) => {
  if (cropInteractionMode !== 'drawing' || !cropStart || !imageBounds) return;
  const rect = cropOverlay.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;

  const x = clamp(rawX, imageBounds.left, imageBounds.left + imageBounds.width);
  const y = clamp(rawY, imageBounds.top, imageBounds.top + imageBounds.height);

  cropBox.style.left = Math.min(x, cropStart.x) + 'px';
  cropBox.style.top = Math.min(y, cropStart.y) + 'px';
  cropBox.style.width = Math.abs(x - cropStart.x) + 'px';
  cropBox.style.height = Math.abs(y - cropStart.y) + 'px';
});

cropOverlay.addEventListener('mouseup', () => {
  if (cropInteractionMode === 'drawing') {
    cropInteractionMode = null;
    cropStart = null;
  }
});

// Move the whole box
cropBox.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  if (e.target.classList.contains('crop-handle')) return;
  imageBounds = getVisibleImageRect();
  cropInteractionMode = 'moving';
  cropDragStart = {
    mouseX: e.clientX,
    mouseY: e.clientY,
    boxLeft: parseFloat(cropBox.style.left),
    boxTop: parseFloat(cropBox.style.top),
  };
});

// Resize via corner handles
document.querySelectorAll('.crop-handle').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    imageBounds = getVisibleImageRect();
    cropInteractionMode = 'resizing';
    cropDragStart = {
      corner: handle.dataset.corner,
      boxLeft: parseFloat(cropBox.style.left),
      boxTop: parseFloat(cropBox.style.top),
      boxWidth: parseFloat(cropBox.style.width),
      boxHeight: parseFloat(cropBox.style.height),
      mouseX: e.clientX,
      mouseY: e.clientY,
    };
  });
});

document.addEventListener('mousemove', (e) => {
  if (cropInteractionMode === 'moving' && cropDragStart && imageBounds) {
    const dx = e.clientX - cropDragStart.mouseX;
    const dy = e.clientY - cropDragStart.mouseY;
    const boxWidth = parseFloat(cropBox.style.width);
    const boxHeight = parseFloat(cropBox.style.height);

    let newLeft = clamp(cropDragStart.boxLeft + dx, imageBounds.left, imageBounds.left + imageBounds.width - boxWidth);
    let newTop = clamp(cropDragStart.boxTop + dy, imageBounds.top, imageBounds.top + imageBounds.height - boxHeight);

    cropBox.style.left = newLeft + 'px';
    cropBox.style.top = newTop + 'px';
  }

  if (cropInteractionMode === 'resizing' && cropDragStart && imageBounds) {
    const dx = e.clientX - cropDragStart.mouseX;
    const dy = e.clientY - cropDragStart.mouseY;
    const { corner, boxLeft, boxTop, boxWidth, boxHeight } = cropDragStart;

    let newLeft = boxLeft, newTop = boxTop, newWidth = boxWidth, newHeight = boxHeight;

    if (corner === 'se') {
      newWidth = clamp(boxWidth + dx, 10, imageBounds.left + imageBounds.width - boxLeft);
      newHeight = clamp(boxHeight + dy, 10, imageBounds.top + imageBounds.height - boxTop);
    } else if (corner === 'sw') {
      newWidth = clamp(boxWidth - dx, 10, boxLeft + boxWidth - imageBounds.left);
      newLeft = boxLeft + boxWidth - newWidth;
      newHeight = clamp(boxHeight + dy, 10, imageBounds.top + imageBounds.height - boxTop);
    } else if (corner === 'ne') {
      newWidth = clamp(boxWidth + dx, 10, imageBounds.left + imageBounds.width - boxLeft);
      newHeight = clamp(boxHeight - dy, 10, boxTop + boxHeight - imageBounds.top);
      newTop = boxTop + boxHeight - newHeight;
    } else if (corner === 'nw') {
      newWidth = clamp(boxWidth - dx, 10, boxLeft + boxWidth - imageBounds.left);
      newLeft = boxLeft + boxWidth - newWidth;
      newHeight = clamp(boxHeight - dy, 10, boxTop + boxHeight - imageBounds.top);
      newTop = boxTop + boxHeight - newHeight;
    }

    cropBox.style.left = newLeft + 'px';
    cropBox.style.top = newTop + 'px';
    cropBox.style.width = newWidth + 'px';
    cropBox.style.height = newHeight + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (cropInteractionMode === 'moving' || cropInteractionMode === 'resizing') {
    cropInteractionMode = null;
    cropDragStart = null;
  }
});

function getVisibleImageRect() {
  const elementRect = previewImage.getBoundingClientRect();
  const overlayRect = cropOverlay.getBoundingClientRect();

  const naturalAspect = previewImage.naturalWidth / previewImage.naturalHeight;
  const elementAspect = elementRect.width / elementRect.height;

  let renderedWidth, renderedHeight, offsetX, offsetY;

  if (naturalAspect > elementAspect) {
    renderedWidth = elementRect.width;
    renderedHeight = elementRect.width / naturalAspect;
    offsetX = 0;
    offsetY = (elementRect.height - renderedHeight) / 2;
  } else {
    renderedHeight = elementRect.height;
    renderedWidth = elementRect.height * naturalAspect;
    offsetX = (elementRect.width - renderedWidth) / 2;
    offsetY = 0;
  }

  return {
    left: elementRect.left + offsetX - overlayRect.left,
    top: elementRect.top + offsetY - overlayRect.top,
    width: renderedWidth,
    height: renderedHeight,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return match ? match.pop() : '';
}

cropConfirmBtn.addEventListener('click', () => {
  const elementRect = previewImage.getBoundingClientRect();
  const overlayRect = cropOverlay.getBoundingClientRect();

  // Figure out the REAL visible image area inside the <img> box,
  // accounting for object-fit: contain letterboxing
  const naturalAspect = previewImage.naturalWidth / previewImage.naturalHeight;
  const elementAspect = elementRect.width / elementRect.height;

  let renderedWidth, renderedHeight, offsetX, offsetY;

  if (naturalAspect > elementAspect) {
    // image is letterboxed top/bottom
    renderedWidth = elementRect.width;
    renderedHeight = elementRect.width / naturalAspect;
    offsetX = 0;
    offsetY = (elementRect.height - renderedHeight) / 2;
  } else {
    // image is letterboxed left/right
    renderedHeight = elementRect.height;
    renderedWidth = elementRect.height * naturalAspect;
    offsetX = (elementRect.width - renderedWidth) / 2;
    offsetY = 0;
  }

  const visibleImageLeft = elementRect.left + offsetX;
  const visibleImageTop = elementRect.top + offsetY;

  const boxLeft = parseFloat(cropBox.style.left);
  const boxTop = parseFloat(cropBox.style.top);
  const boxWidth = parseFloat(cropBox.style.width);
  const boxHeight = parseFloat(cropBox.style.height);

  const imgOffsetX = visibleImageLeft - overlayRect.left;
  const imgOffsetY = visibleImageTop - overlayRect.top;
  const scaleX = previewImage.naturalWidth / renderedWidth;
  const scaleY = previewImage.naturalHeight / renderedHeight;

  const sx = (boxLeft - imgOffsetX) * scaleX;
  const sy = (boxTop - imgOffsetY) * scaleY;
  const sw = boxWidth * scaleX;
  const sh = boxHeight * scaleY;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(previewImage, sx, sy, sw, sh, 0, 0, sw, sh);

  canvas.toBlob((blob) => {
    const formData = new FormData();
    formData.append('cropped_image', blob, 'cropped.png');

    fetch(`/crop/${currentDocId}/`, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCookie('csrftoken') },
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          location.reload();
        } else {
          endCropMode();
        }
      });
  }, 'image/png');
});

document.getElementById('reset-btn').addEventListener('click', () => {
  fetch(`/reset/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
})

} // closes "if (cropBtn)"

let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let mouseDownPos = null;
let didDrag = false;

function startPan(e) {
  mouseDownPos = { x: e.clientX, y: e.clientY };
  didDrag = false;
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY };
  previewImage.style.cursor = 'grabbing';
}


previewImage.addEventListener('mousedown', startPan);
document.getElementById('line-overlay').addEventListener('mousedown', startPan);
document.getElementById('preview-card').addEventListener('mousedown', startPan);


document.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - panStart.x;
  panY = e.clientY - panStart.y;
  applyZoom();
});

document.addEventListener('mouseup', () => {
  isPanning = false;
  previewImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
});



document.getElementById('zoom-in-btn').addEventListener('click', () => {
  zoomLevel = Math.min(zoomLevel + 0.25, 8);
  applyZoom();
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.5);
  applyZoom();
});

document.getElementById('zoom-reset-btn').addEventListener('click', () => {
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyZoom();
});


// zoom 2 
previewImage.addEventListener('dblclick', () => {
  zoomLevel = Math.min(zoomLevel + 0.5, 3);
  applyZoom();
});

let pinchStartDistance = null;
let pinchStartZoom = 1;

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function handleWheel(e) {
  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    const delta = -e.deltaY * 0.015;
    zoomLevel = Math.min(Math.max(zoomLevel + delta, 1), 8);
    if (zoomLevel === 1) {
      panX = 0;
      panY = 0;
    }
    applyZoom();
  } else if (zoomLevel > 1) {
    if (e.shiftKey && e.deltaX === 0) {
      panX -= e.deltaY;
    } else {
      panX -= e.deltaX;
      panY -= e.deltaY;
    }
    applyZoom();
  }
}

// previewImage.addEventListener('wheel', handleWheel, { passive: false });
document.getElementById('preview-card').addEventListener('wheel', handleWheel, { passive: false });

// 
document.getElementById('next-step-btn').addEventListener('click', () => {
  fetch(`/advance/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
});



// // gaussian
//
const gaussianCheckbox = document.getElementById('gaussian-checkbox');
const sauvolaCheckbox = document.getElementById('sauvola-checkbox');

const kernelSlider = document.getElementById('kernel-slider');
const sigmaSlider = document.getElementById('sigma-slider');
const kernelValue = document.getElementById('kernel-value');
const sigmaValue = document.getElementById('sigma-value');
const kernelRow = document.getElementById('kernel-slider-row');
const sigmaRow = document.getElementById('sigma-slider-row');

const windowSlider = document.getElementById('window-slider');
const kSlider = document.getElementById('k-slider');
const windowValue = document.getElementById('window-value');
const kValue = document.getElementById('k-value');
const windowRow = document.getElementById('window-slider-row');
const kRow = document.getElementById('k-slider-row');

const clahecheckbox = document.getElementById('clahe-checkbox');
const clipSlider = document.getElementById('clip-slider');
const tileSlider = document.getElementById('tile-slider');
const clipValue = document.getElementById('clip-value');
const tileValue = document.getElementById('tile-value');
const clipRow = document.getElementById('clip-slider-row');
const tileRow = document.getElementById('tile-slider-row');

// const openingCheckbox = document.getElementById('opening-checkbox');
// const openingSlider = document.getElementById('opening-slider');
// const openingValue = document.getElementById('opening-value');
// const openingRow = document.getElementById('opening-slider-row');

function runPreprocessing() {
  document.getElementById('processing-overlay').style.display = 'flex';

  const formData = new FormData();
  formData.append('gaussian', gaussianCheckbox.checked ? 'true' : 'false');
  formData.append('clahe', clahecheckbox.checked ? 'true' : 'false');
  formData.append('sauvola', sauvolaCheckbox.checked ? 'true' : 'false');
  // formData.append('opening', openingCheckbox.checked ? 'true' : 'false');

  formData.append('kernel_size', kernelSlider.value);
  formData.append('sigma', sigmaSlider.value);
  formData.append('clip_limit', clipSlider.value / 10);
  formData.append('tile_size', tileSlider.value);
  formData.append('window_size', windowSlider.value);
  formData.append('k', kSlider.value / 100);
  // formData.append('opening_size', openingSlider.value);

  fetch(`/preprocess/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
    body: formData,
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        afterUrl = data.new_url + '?t=' + Date.now();
        beforeAfterToggle.style.display = 'flex';
        setMode('after');
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
}


let sliderDebounce;
function debouncedRun() {
  clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(runPreprocessing, 300);
}

gaussianCheckbox.addEventListener('change', () => {
  gaussianCheckbox.closest('.option-card').classList.toggle('checked', gaussianCheckbox.checked);
  kernelRow.style.display = gaussianCheckbox.checked ? 'flex' : 'none';
  sigmaRow.style.display = gaussianCheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});

sauvolaCheckbox.addEventListener('change', () => {
  sauvolaCheckbox.closest('.option-card').classList.toggle('checked', sauvolaCheckbox.checked);
  windowRow.style.display = sauvolaCheckbox.checked ? 'flex' : 'none';
  kRow.style.display = sauvolaCheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});

clahecheckbox.addEventListener('change', () => {
  clahecheckbox.closest('.option-card').classList.toggle('checked', clahecheckbox.checked);
  clipRow.style.display = clahecheckbox.checked ? 'flex' : 'none';
  tileRow.style.display = clahecheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});



kernelSlider.addEventListener('input', () => { kernelValue.textContent = kernelSlider.value; debouncedRun(); });
sigmaSlider.addEventListener('input', () => { sigmaValue.textContent = sigmaSlider.value; debouncedRun(); });
windowSlider.addEventListener('input', () => { windowValue.textContent = windowSlider.value; debouncedRun(); });
kSlider.addEventListener('input', () => { kValue.textContent = (kSlider.value / 100).toFixed(2); debouncedRun(); });
clipSlider.addEventListener('input', () => { clipValue.textContent = (clipSlider.value / 10).toFixed(1); debouncedRun(); });
tileSlider.addEventListener('input', () => { tileValue.textContent = tileSlider.value; debouncedRun(); });
// openingSlider.addEventListener('input', () => { openingValue.textContent = openingSlider.value; debouncedRun(); });



// toggle for before after
const beforeAfterToggle = document.getElementById('before-after-toggle');
const beforeBtn = document.getElementById('before-btn');
const afterBtn = document.getElementById('after-btn');

let beforeUrl = lockedImageUrl;
let afterUrl = processedImageUrl;


if (afterUrl) {
  beforeAfterToggle.style.display = 'flex';
}


function setMode(mode) {
  beforeBtn.classList.toggle('active', mode === 'before');
  afterBtn.classList.toggle('active', mode === 'after');
  previewImage.src = mode === 'before' ? beforeUrl : afterUrl;


}

beforeBtn.addEventListener('click', () => setMode('before'));
afterBtn.addEventListener('click', () => setMode('after'));

// segmentation


const paddingControls = document.getElementById('padding-controls');
const paddingTop = document.getElementById('padding-top');
const paddingBottom = document.getElementById('padding-bottom');
const paddingLeft = document.getElementById('padding-left');
const paddingRight = document.getElementById('padding-right');

let basePolygons = {};

function captureBasePolygons() {
  basePolygons = {};
  selectedIndices.forEach((idx) => {
    if (segmentationLines[idx]) {
      basePolygons[idx] = segmentationLines[idx].polygon.map(p => [p[0], p[1]]);
    }
  });
}

function applyPadding() {
  const top = parseFloat(paddingTop.value);
  const bottom = parseFloat(paddingBottom.value);
  const left = parseFloat(paddingLeft.value);
  const right = parseFloat(paddingRight.value);

  selectedIndices.forEach((idx) => {
    const base = basePolygons[idx];
    if (!base) return;

    const xs = base.map(p => p[0]);
    const ys = base.map(p => p[1]);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;

    segmentationLines[idx].polygon = base.map(([x, y]) => {
      let newX = x;
      let newY = y;
      if (y < midY) newY = y - top;
      else newY = y + bottom;
      if (x < midX) newX = x - left;
      else newX = x + right;
      return [newX, newY];
    });
  });

  renderOverlay();
}

let paddingDebounce;
function debouncedApplyPadding() {
  clearTimeout(paddingDebounce);
  paddingDebounce = setTimeout(() => {
    autoSaveSegmentation();
  }, 400);
}

[paddingTop, paddingBottom, paddingLeft, paddingRight].forEach((slider) => {
  slider.addEventListener('mousedown', () => {
    pushHistory();
    isAdjustingPadding = true;
    renderOverlay();
  });
  slider.addEventListener('input', () => {
    applyPadding();
    debouncedApplyPadding();
  });
  slider.addEventListener('mouseup', () => {
    isAdjustingPadding = false;
    renderOverlay();
  });
});

document.getElementById('run-segmentation-btn').addEventListener('click', () => {
  fetch(`/advance-segmentation/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
});

// kraken
document.getElementById('run-segmentation-model-btn').addEventListener('click', () => {
  if (segmentationLines.length > 0) {
    const confirmed = confirm('This will replace your existing segmentation lines. Continue?');
    if (!confirmed) return;
  }

  document.getElementById('processing-overlay').style.display = 'flex';

  fetch(`/segment/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        drawLineOverlay(data.lines, data.page_width, data.page_height);
        autoSaveSegmentation();
        document.getElementById('advance-to-ocr-btn').disabled = false;

      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});

let segmentationLines = [];
let selectedIndices = new Set();
let hoveredLineIndex = null;
let isAdjustingPadding = false;

let overlayPageWidth, overlayPageHeight;
let showPolygons = true;
let showBaselines = docStatus !== 'ocr_done';
const isReadOnlyOverlay = docStatus === 'ocr_done';


function getOverlayScale() {
  const referenceWidth = 1500;
  return overlayPageWidth / referenceWidth;
}


function drawLineOverlay(lines, pageWidth, pageHeight) {
  if (segmentationLines.length > 0) pushHistory();
  segmentationLines = lines.map(l => ({
    polygon: l.polygon.map(p => [p[0], p[1]]),
    baseline: l.baseline ? l.baseline.map(p => [p[0], p[1]]) : [],
  }));
  selectedIndices = new Set();
  overlayPageWidth = pageWidth;
  overlayPageHeight = pageHeight;
  document.getElementById('overlay-toggle-group').style.display = 'flex';
  renderOverlay();
}

function renderOverlay() {
  
  const svg = document.getElementById('line-overlay');
  svg.setAttribute('viewBox', `0 0 ${overlayPageWidth} ${overlayPageHeight}`);
  svg.innerHTML = '';
  svg.style.display = (segmentationLines.length || isDrawingBaseline) ? 'block' : 'none';
  const scale = getOverlayScale();

  segmentationLines.forEach((line, index) => {
    const points = line.polygon.map(p => p.join(',')).join(' ');

    if (showPolygons) {
      const polygonHalo = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygonHalo.setAttribute('points', points);
      polygonHalo.setAttribute('fill', 'none');
      // polygonHalo.setAttribute('stroke', '#ffffff');
      // polygonHalo.setAttribute('stroke-width', (selectedIndices.has(index) ? 0 : 7) * scale);
      // polygonHalo.setAttribute('stroke-opacity', '0.6');
      polygonHalo.style.pointerEvents = 'none';
      svg.appendChild(polygonHalo);

      const isHovered = index === hoveredLineIndex;
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      const isSelected = selectedIndices.has(index);
      polygon.setAttribute('fill', isHovered ? 'rgba(212,138,90,0.35)' : (isSelected ? 'rgba(168,81,46,0.30)' : 'rgba(30,90,200,0.22)'));
      polygon.setAttribute('stroke', isHovered ? 'none' : (isSelected ? '#A8512E' : '#1E3A5F'));
      polygon.setAttribute('stroke-width', (isHovered ? 0 : (isSelected ? 2.5 : 0)) * scale);
      polygon.style.pointerEvents = 'auto';
      polygon.style.cursor = isReadOnlyOverlay ? 'not-allowed' : 'pointer';
      if (!isReadOnlyOverlay) {
        polygon.addEventListener('click', (e) => {
          e.stopPropagation();
          if (didDrag) return;
          if (e.metaKey || e.ctrlKey) {
            if (selectedIndices.has(index)) {
              selectedIndices.delete(index);
            } else {
              selectedIndices.add(index);
            }
          } else {
            selectedIndices = new Set([index]);
          }
          if (paddingTop) {
            paddingTop.value = 0;
            paddingBottom.value = 0;
            paddingLeft.value = 0;
            paddingRight.value = 0;
            captureBasePolygons();
          }
          renderOverlay();
        });
      } else {
        polygon.addEventListener('click', (e) => {
          e.stopPropagation();
          if (didDrag) return;
          selectOcrResultForLine(index);
        });
      }
      svg.appendChild(polygon);
    }

    if (showBaselines && line.baseline && line.baseline.length > 0) {
      const baselinePoints = line.baseline.map(p => p.join(',')).join(' ');
    
      const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      baseline.setAttribute('points', baselinePoints);
      baseline.setAttribute('fill', 'none');
      baseline.setAttribute('stroke', '#9F1239');
      baseline.setAttribute('stroke-width', 4 * scale);
      baseline.setAttribute('stroke-solid', `${8 * scale} ${3 * scale}`);
      baseline.style.pointerEvents = 'none';
      svg.appendChild(baseline);
    }
  });

  if (!isReadOnlyOverlay && !isAdjustingPadding) {
    selectedIndices.forEach((selIndex) => {
      if (!segmentationLines[selIndex]) return;
    
      if (showPolygons) {
      segmentationLines[selIndex].polygon.forEach((point, vIndex) => {
        const size = 14 * scale;
        const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        square.setAttribute('x', point[0] - size / 2);
        square.setAttribute('y', point[1] - size / 2);
        square.setAttribute('width', size);
        square.setAttribute('height', size);
        square.setAttribute('fill', 'rgba(255,255,255,0.85)');
        square.setAttribute('stroke', '#1E3A5F');
        square.setAttribute('stroke-width', 2 * scale);
        square.classList.add('overlay-handle');
        square.style.transformOrigin = `${point[0]}px ${point[1]}px`;
        square.style.pointerEvents = 'auto';
        square.style.cursor = 'grab';
        square.addEventListener('mousedown', (e) => startVertexDrag(e, selIndex, vIndex, 'polygon'));
        svg.appendChild(square);
      });
    }
  
    if (showBaselines) {
      const baselinePoints = segmentationLines[selIndex].baseline;
      const showEvery = baselinePoints.length > 15 ? 2 : 1;
  
      baselinePoints.forEach((point, vIndex) => {
        if (vIndex % showEvery !== 0 && vIndex !== baselinePoints.length - 1) return;
  
        const width = 16 * scale;
        const height = 16 * scale;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', point[0] - width / 2);
        rect.setAttribute('y', point[1] - height / 2);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', 'rgba(255,255,255,0.9)');
        rect.setAttribute('stroke', '#9F1239');
        rect.setAttribute('stroke-width', 2.5 * scale);
        rect.classList.add('overlay-handle');
        rect.style.transformOrigin = `${point[0]}px ${point[1]}px`;
        rect.style.pointerEvents = 'auto';
        rect.style.cursor = 'grab';
        rect.addEventListener('mousedown', (e) => startVertexDrag(e, selIndex, vIndex, 'baseline'));
        svg.appendChild(rect);
      });
    }
  });
  
  updateHandleCounterScale();


}
document.getElementById('delete-line-btn').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';
document.getElementById('padding-controls').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';

}


let toastTimeout;
function showReadOnlyToast() {
  const toast = document.getElementById('readonly-toast');
  toast.style.display = 'block';
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.style.display = 'none';
    }, 200);
  }, 2200);
}

overlayPageWidth = savedPageWidth;
overlayPageHeight = savedPageHeight;

if (savedLines && savedLines.length > 0 && (docStatus === 'segmented' || docStatus === 'ocr_done')) {
  drawLineOverlay(savedLines, savedPageWidth, savedPageHeight);
}

document.getElementById('show-polygons-checkbox').addEventListener('change', (e) => {
  showPolygons = e.target.checked;
  renderOverlay();
});

document.getElementById('show-baselines-checkbox').addEventListener('change', (e) => {
  showBaselines = e.target.checked;
  renderOverlay();
});

//
function selectOcrResultForLine(lineIndex) {
  const resultsDiv = document.getElementById('ocr-results');
  if (!resultsDiv) return;

  const row = resultsDiv.querySelector(`.ocr-line-result[data-line-index="${lineIndex}"]`);
  if (!row) return;

  resultsDiv.querySelectorAll('.ocr-line-result.selected').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });

  selectedIndices = new Set([lineIndex]);
  renderOverlay();
}

function setupOcrHoverHighlight() {
  const resultsDiv = document.getElementById('ocr-results');
  if (!resultsDiv) return;

  resultsDiv.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    const idx = parseInt(row.dataset.lineIndex, 10);
    if (!isNaN(idx)) {
      hoveredLineIndex = idx;
      renderOverlay();
    }
  });

  resultsDiv.addEventListener('mouseout', (e) => {
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    hoveredLineIndex = null;
    renderOverlay();
  });
}

setupOcrHoverHighlight();

function startVertexDrag(e, lineIndex, vertexIndex, type) {
  e.stopPropagation();
  e.preventDefault();
  pushHistory();

  const svg = document.getElementById('line-overlay');

  function screenToSvgPoint(clientX, clientY) {
    const pt = new DOMPoint(clientX, clientY);
    const ctm = svg.getScreenCTM().inverse();
    return pt.matrixTransform(ctm);
  }

  function onMouseMove(moveEvent) {
    const svgPoint = screenToSvgPoint(moveEvent.clientX, moveEvent.clientY);
    segmentationLines[lineIndex][type][vertexIndex] = [svgPoint.x, svgPoint.y];
    renderOverlay();
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    debouncedSaveSegmentation();
  }


  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}


document.getElementById('delete-line-btn').addEventListener('click', () => {
  pushHistory();
  segmentationLines = segmentationLines.filter((_, i) => !selectedIndices.has(i));
  selectedIndices = new Set();
  renderOverlay();
  autoSaveSegmentation();
  document.getElementById('advance-to-ocr-btn').disabled = segmentationLines.length === 0;
});

let segmentationSaveDebounce;

function autoSaveSegmentation() {
  fetch(`/save-segmentation/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: segmentationLines }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        const status = document.getElementById('segmentation-save-status');
        if (status) {
          status.textContent = 'Saved';
          status.classList.add('visible');
          setTimeout(() => status.classList.remove('visible'), 1200);
        }
      }
    });
}

function debouncedSaveSegmentation() {
  clearTimeout(segmentationSaveDebounce);
  segmentationSaveDebounce = setTimeout(autoSaveSegmentation, 600);
}

function updateHandleCounterScale() {
  const counterScale = 1 / Math.sqrt(Math.max(zoomLevel, 0.5));
  document.querySelectorAll('.overlay-handle').forEach((el) => {
    el.style.transform = `scale(${counterScale})`;
  });
}

function applyZoom() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  previewImage.style.transform = transform;

  const lineOverlay = document.getElementById('line-overlay');
  if (lineOverlay) {
    lineOverlay.style.transform = transform;
    lineOverlay.style.transformOrigin = previewImage.style.transformOrigin || 'center center';
  }

  updateHandleCounterScale();
}

document.getElementById('download-image-btn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = previewImage.src;
  link.download = currentDocId ? `document-${currentDocId}.jpg` : 'image.jpg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});




//// draw baseline



let isDrawingBaseline = false;
let drawnBaselinePoints = [];

const drawBaselineBtn = document.getElementById('draw-baseline-btn');
const drawBaselineActions = document.getElementById('draw-baseline-actions');
const finishBaselineBtn = document.getElementById('finish-baseline-btn');
const cancelBaselineBtn = document.getElementById('cancel-baseline-btn');
const lineOverlay = document.getElementById('line-overlay');

if (drawBaselineBtn) {

function screenToImagePoint(clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  const ctm = lineOverlay.getScreenCTM().inverse();
  const svgPoint = pt.matrixTransform(ctm);
  return [svgPoint.x, svgPoint.y];
}

lineOverlay.addEventListener('mousemove', (e) => {
  if (!isDrawingBaseline || drawnBaselinePoints.length === 0) return;
  if (!isPointInsideImage(e.clientX, e.clientY)) return;
  const currentPoint = screenToImagePoint(e.clientX, e.clientY);
  renderDrawingPreview(currentPoint);
});

// document.addEventListener('keydown', (e) => {
//   if (!isDrawingBaseline) return;
//   if (e.key === 'Backspace' || e.key === 'Delete') {
//     e.preventDefault();
//     drawnBaselinePoints.pop();
//     renderDrawingPreview();
//   }
// });

document.addEventListener('keydown', (e) => {
  if (!isDrawingBaseline) return;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    drawnBaselinePoints.pop();
    renderDrawingPreview();
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    finishBaselineBtn.click();
  }
});

// lineOverlay.addEventListener('dblclick', (e) => {
//   if (!isDrawingBaseline) return;
//   e.preventDefault();
//   finishBaselineBtn.click();
// });


drawBaselineBtn.addEventListener('click', () => {
  isDrawingBaseline = true;
  drawnBaselinePoints = [];
  drawBaselineActions.style.display = 'flex';
  drawBaselineBtn.style.display = 'none';
  lineOverlay.style.cursor = 'crosshair';
  lineOverlay.style.display = 'block';
  lineOverlay.style.pointerEvents = 'auto';
  renderOverlay();
});

function isPointInsideImage(clientX, clientY) {
  const elementRect = previewImage.getBoundingClientRect();
  const naturalAspect = previewImage.naturalWidth / previewImage.naturalHeight;
  const elementAspect = elementRect.width / elementRect.height;

  let renderedWidth, renderedHeight, offsetX, offsetY;

  if (naturalAspect > elementAspect) {
    renderedWidth = elementRect.width;
    renderedHeight = elementRect.width / naturalAspect;
    offsetX = 0;
    offsetY = (elementRect.height - renderedHeight) / 2;
  } else {
    renderedHeight = elementRect.height;
    renderedWidth = elementRect.height * naturalAspect;
    offsetX = (elementRect.width - renderedWidth) / 2;
    offsetY = 0;
  }

  const visibleLeft = elementRect.left + offsetX;
  const visibleTop = elementRect.top + offsetY;

  return (
    clientX >= visibleLeft &&
    clientX <= visibleLeft + renderedWidth &&
    clientY >= visibleTop &&
    clientY <= visibleTop + renderedHeight
  );
}

lineOverlay.addEventListener('click', (e) => {
  if (!isDrawingBaseline || didDrag) return;
  if (!isPointInsideImage(e.clientX, e.clientY)) return;
  const point = screenToImagePoint(e.clientX, e.clientY);
  drawnBaselinePoints.push(point);
  renderDrawingPreview();
});

function renderDrawingPreview(livePoint) {
  renderOverlay();
  const scale = getOverlayScale();

  if (drawnBaselinePoints.length > 0) {
    const allPoints = livePoint ? [...drawnBaselinePoints, livePoint] : drawnBaselinePoints;
    const pts = allPoints.map(p => p.join(',')).join(' ');

    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    preview.setAttribute('points', pts);
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke', '#15803D');
    preview.setAttribute('stroke-width', 6 * scale);
    if (livePoint) preview.setAttribute('stroke-solid', `${10 * scale} ${6 * scale}`);
    preview.style.pointerEvents = 'none';
    lineOverlay.appendChild(preview);

    drawnBaselinePoints.forEach((point) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', point[0]);
      circle.setAttribute('cy', point[1]);
      circle.setAttribute('r', 5 * scale);
      circle.setAttribute('fill', '#15803D');
      circle.style.pointerEvents = 'none';
      lineOverlay.appendChild(circle);
    });
  }
}
function exitDrawMode() {
  isDrawingBaseline = false;
  drawnBaselinePoints = [];
  drawBaselineActions.style.display = 'none';
  drawBaselineBtn.style.display = 'inline-block';
  lineOverlay.style.cursor = 'default';
  lineOverlay.style.pointerEvents = 'none';
  renderOverlay();
}

cancelBaselineBtn.addEventListener('click', exitDrawMode);

finishBaselineBtn.addEventListener('click', () => {
  if (drawnBaselinePoints.length < 2) {
    alert('Click at least 2 points along the line before finishing.');
    return;
  }

  document.getElementById('processing-overlay').style.display = 'flex';

  fetch(`/add-baseline/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline: drawnBaselinePoints }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        pushHistory();
        segmentationLines.push({ polygon: data.polygon, baseline: data.baseline });
        exitDrawMode();
        autoSaveSegmentation();
        document.getElementById('advance-to-ocr-btn').disabled = segmentationLines.length === 0;   // 👈 add this line
      } else {
        alert(data.error || 'Could not generate a polygon for this baseline.');
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});
}




let segmentationHistory = [];

function pushHistory() {
  if (isReadOnlyOverlay) return;
  segmentationHistory.push(JSON.parse(JSON.stringify(segmentationLines)));
  if (segmentationHistory.length > 30) segmentationHistory.shift();
  document.getElementById('undo-segmentation-btn').style.display = 'flex';
}

document.getElementById('undo-segmentation-btn').addEventListener('click', () => {
  if (segmentationHistory.length === 0) return;
  segmentationLines = segmentationHistory.pop();
  selectedIndices = new Set();
  renderOverlay();
  autoSaveSegmentation();
  if (segmentationHistory.length === 0) {
    document.getElementById('undo-segmentation-btn').style.display = 'none';
  }
});

document.getElementById('back-to-preprocessing-btn').addEventListener('click', () => {
  fetch(`/back-to-preprocessing/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
});


document.getElementById('advance-to-ocr-btn').addEventListener('click', () => {
  fetch(`/advance-ocr/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
});


document.getElementById('back-to-segmentation-btn').addEventListener('click', () => {
  fetch(`/back-to-segmentation/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        location.reload();
      }
    });
});


// OCR 
const confidenceCheckbox = document.getElementById('show-confidence-checkbox');

function applyConfidenceVisibility() {
  const showConfidence = confidenceCheckbox.checked;
  document.querySelectorAll('.ocr-line-text').forEach((el) => {
    el.innerHTML = showConfidence ? el.dataset.html : el.dataset.plain;
  });
}

confidenceCheckbox.addEventListener('change', applyConfidenceVisibility);
applyConfidenceVisibility();


document.getElementById('run-ocr-btn').addEventListener('click', () => {
  document.getElementById('processing-overlay').style.display = 'flex';

  fetch(`/run-ocr/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        const resultsDiv = document.getElementById('ocr-results');
        resultsDiv.innerHTML = '';
        data.predictions.forEach((pred, i) => {
          const row = document.createElement('div');
          row.className = 'ocr-line-result';
          row.dataset.lineIndex = pred.line_index;
          const textSpan = document.createElement('span');
          textSpan.className = 'ocr-line-text';
          textSpan.dataset.html = pred.html;
          textSpan.dataset.plain = pred.text;
          textSpan.innerHTML = confidenceCheckbox.checked ? pred.html : pred.text;
    
          const numberSpan = document.createElement('span');
          numberSpan.className = 'ocr-line-number';
          numberSpan.textContent = i + 1;
    
          row.appendChild(numberSpan);
          row.appendChild(textSpan);
          resultsDiv.appendChild(row);
        });
        document.getElementById('ocr-results-panel').style.display = 'flex'; 
        document.getElementById('ocr-stale-warning').style.display = 'none';

      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});



function deselectIfEmpty(e) {
  if (didDrag) return;
  if (isDrawingBaseline) return;
  if (selectedIndices.size === 0) return;
  selectedIndices = new Set();
  if (paddingTop) {
    paddingTop.value = 0;
    paddingBottom.value = 0;
    paddingLeft.value = 0;
    paddingRight.value = 0;
  }
  document.querySelectorAll('.ocr-line-result.selected').forEach(r => r.classList.remove('selected'));
  renderOverlay();
}

previewImage.addEventListener('click', deselectIfEmpty);
document.getElementById('line-overlay').addEventListener('click', deselectIfEmpty);


function fitTextToImageWidth(text, whiteLeftFrac = 0, whiteWidthFrac = 1) {
  const popupImg = document.getElementById('line-popup-img');
  const textEl = document.getElementById('line-popup-text');

  const imageWidth = popupImg.clientWidth || popupImg.naturalWidth;
  const targetWidth = imageWidth * whiteWidthFrac;
  const leftOffset = imageWidth * whiteLeftFrac;

  // Measure the text's actual rendered width at a baseline font size,
  // then scale it so the line exactly spans the white region.
  const baseFontSize = 24;
  textEl.style.whiteSpace = 'nowrap';
  textEl.style.display = 'inline-block';
  textEl.style.width = 'auto';
  textEl.style.fontSize = baseFontSize + 'px';

  const measuredWidth = textEl.scrollWidth || 1;
  let fontSize = (targetWidth / measuredWidth) * baseFontSize;
  fontSize = Math.min(Math.max(fontSize, 14), 64);

  textEl.style.fontSize = fontSize + 'px';
  textEl.style.whiteSpace = 'normal';
  textEl.style.display = 'block';
  textEl.style.width = targetWidth + 'px';
  textEl.style.marginLeft = leftOffset + 'px';
  textEl.style.marginRight = 'auto';
}


let currentPopupText = '';
let currentPopupHtml = '';

function openLinePreviewPopup(lineIndex, predText, predHtml) {
  const line = segmentationLines[lineIndex];
  if (!line || !line.polygon || line.polygon.length < 3) return;

  const polygon = line.polygon;
  const xs = polygon.map(p => p[0]);
  const ys = polygon.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // Wider padding than before, so there's visible context around the polygon.
  const padX = (maxX - minX) * 0.08 + 8;
  const padY = (maxY - minY) * 0.18 + 8;
  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(previewImage.naturalWidth - cropX, (maxX - minX) + padX * 2);
  const cropH = Math.min(previewImage.naturalHeight - cropY, (maxY - minY) + padY * 2);
  const whiteLeftFrac = (minX - cropX) / cropW;
  const whiteWidthFrac = (maxX - minX) / cropW;
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');

  // 1. Draw the full crop region at normal brightness — gives surrounding context.
  ctx.drawImage(previewImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // 2. Dim everything...
  ctx.save();
  ctx.fillStyle = 'rgba(20,20,20,0.6)';
  ctx.fillRect(0, 0, cropW, cropH);
  ctx.restore();

  // 3. ...except re-draw the polygon region at full brightness, so it "pops"
  //    against the dimmed surroundings. This is the exact region used for the prediction.
  ctx.save();
  ctx.beginPath();
  polygon.forEach((p, i) => {
    const x = p[0] - cropX;
    const y = p[1] - cropY;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(previewImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  ctx.restore();

  // 4. Outline the polygon so the boundary is unambiguous.
  ctx.beginPath();
  polygon.forEach((p, i) => {
    const x = p[0] - cropX;
    const y = p[1] - cropY;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(30,144,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  document.getElementById('line-popup-img').src = canvas.toDataURL('image/png');
  document.getElementById('line-popup-text').innerHTML =
    confidenceCheckbox.checked ? predHtml : predText;
  
  // Wait a tick for the image to lay out before measuring its width.
  requestAnimationFrame(() => fitTextToImageWidth(predText, whiteLeftFrac, whiteWidthFrac));

  
  document.getElementById('line-popup-backdrop').style.display = 'flex';
}

function setupOcrClickPopup() {
  const resultsDiv = document.getElementById('ocr-results');
  if (!resultsDiv) return;

  resultsDiv.addEventListener('click', (e) => {
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    const idx = parseInt(row.dataset.lineIndex, 10);
    if (isNaN(idx)) return;
    const textSpan = row.querySelector('.ocr-line-text');
    openLinePreviewPopup(idx, textSpan.dataset.plain, textSpan.dataset.html);
  });
}

document.getElementById('line-popup-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'line-popup-backdrop' || e.target.id === 'line-popup-close') {
    document.getElementById('line-popup-backdrop').style.display = 'none';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('line-popup-backdrop').style.display = 'none';
  }
});
