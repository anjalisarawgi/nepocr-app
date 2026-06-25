

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
const workspace = document.querySelector('.workspace');
let isDragging = false;

handle.addEventListener('mousedown', () => {
  isDragging = true;
  handle.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (mouseDownPos) {
    const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
    if (dist > 4) didDrag = true;
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

cropOverlay.addEventListener('mousedown', (e) => {
  const rect = cropOverlay.getBoundingClientRect();
  cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  cropBox.style.left = cropStart.x + 'px';
  cropBox.style.top = cropStart.y + 'px';
  cropBox.style.width = '0px';
  cropBox.style.height = '0px';
  cropBox.style.display = 'block';
});

cropOverlay.addEventListener('mousemove', (e) => {
  if (!cropStart) return;
  const rect = cropOverlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  cropBox.style.left = Math.min(x, cropStart.x) + 'px';
  cropBox.style.top = Math.min(y, cropStart.y) + 'px';
  cropBox.style.width = Math.abs(x - cropStart.x) + 'px';
  cropBox.style.height = Math.abs(y - cropStart.y) + 'px';
});

cropOverlay.addEventListener('mouseup', () => {
  cropStart = null;
});

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

// reset button
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
  if (zoomLevel <= 1) return;
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY };
  previewImage.style.cursor = 'grabbing';
}

previewImage.addEventListener('mousedown', startPan);
document.getElementById('line-overlay').addEventListener('mousedown', startPan);


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
  zoomLevel = Math.min(zoomLevel + 0.25, 3);
  applyZoom();
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  zoomLevel = Math.max(zoomLevel - 0.25, 1);
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


previewImage.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = -e.deltaY * 0.01;
    zoomLevel = Math.min(Math.max(zoomLevel + delta, 1), 3);
    applyZoom();
  }
}, { passive: false });


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

const openingCheckbox = document.getElementById('opening-checkbox');
const openingSlider = document.getElementById('opening-slider');
const openingValue = document.getElementById('opening-value');
const openingRow = document.getElementById('opening-slider-row');

function runPreprocessing() {
  document.getElementById('processing-overlay').style.display = 'flex';

  const formData = new FormData();
  formData.append('gaussian', gaussianCheckbox.checked ? 'true' : 'false');
  formData.append('clahe', clahecheckbox.checked ? 'true' : 'false');
  formData.append('sauvola', sauvolaCheckbox.checked ? 'true' : 'false');
  formData.append('opening', openingCheckbox.checked ? 'true' : 'false');

  formData.append('kernel_size', kernelSlider.value);
  formData.append('sigma', sigmaSlider.value);
  formData.append('clip_limit', clipSlider.value / 10);
  formData.append('tile_size', tileSlider.value);
  formData.append('window_size', windowSlider.value);
  formData.append('k', kSlider.value / 100);
  formData.append('opening_size', openingSlider.value);

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

openingCheckbox.addEventListener('change', () => {
  openingCheckbox.closest('.option-card').classList.toggle('checked', openingCheckbox.checked);
  openingRow.style.display = openingCheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});


kernelSlider.addEventListener('input', () => { kernelValue.textContent = kernelSlider.value; debouncedRun(); });
sigmaSlider.addEventListener('input', () => { sigmaValue.textContent = sigmaSlider.value; debouncedRun(); });
windowSlider.addEventListener('input', () => { windowValue.textContent = windowSlider.value; debouncedRun(); });
kSlider.addEventListener('input', () => { kValue.textContent = (kSlider.value / 100).toFixed(2); debouncedRun(); });
clipSlider.addEventListener('input', () => { clipValue.textContent = (clipSlider.value / 10).toFixed(1); debouncedRun(); });
tileSlider.addEventListener('input', () => { tileValue.textContent = tileSlider.value; debouncedRun(); });
openingSlider.addEventListener('input', () => { openingValue.textContent = openingSlider.value; debouncedRun(); });



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
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});

let segmentationLines = [];
let selectedIndices = new Set();
let overlayPageWidth, overlayPageHeight;
let showPolygons = true;
let showBaselines = true;

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

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      polygon.setAttribute('fill', selectedIndices.has(index) ? 'rgba(30,90,200,0.15)' : 'rgba(30,90,200,0.22)');
      polygon.setAttribute('stroke', '#1E3A5F');
      polygon.setAttribute('stroke-width', (selectedIndices.has(index) ? 2.5 : 0) * scale);
      polygon.style.pointerEvents = 'auto';
      polygon.style.cursor = 'pointer';
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
        renderOverlay();
      });
      svg.appendChild(polygon);
    }

    if (showBaselines && line.baseline && line.baseline.length > 0) {
      const baselinePoints = line.baseline.map(p => p.join(',')).join(' ');

      const baselineHalo = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      baselineHalo.setAttribute('points', baselinePoints);
      baselineHalo.setAttribute('fill', 'none');
      baselineHalo.setAttribute('stroke', '#ffffff');
      baselineHalo.setAttribute('stroke-width', 6 * scale);
      baselineHalo.setAttribute('stroke-opacity', '0.55');
      baselineHalo.style.pointerEvents = 'none';
      svg.appendChild(baselineHalo);

      const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      baseline.setAttribute('points', baselinePoints);
      baseline.setAttribute('fill', 'none');
      baseline.setAttribute('stroke', '#7E22CE');
      baseline.setAttribute('stroke-width', 4 * scale);
      baseline.setAttribute('stroke-solid', `${8 * scale} ${3 * scale}`);
      baseline.style.pointerEvents = 'none';
      svg.appendChild(baseline);
    }
  });

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
        rect.setAttribute('stroke', '#7E22CE');
        rect.setAttribute('stroke-width', 2.5 * scale);
        rect.style.pointerEvents = 'auto';
        rect.style.cursor = 'grab';
        rect.addEventListener('mousedown', (e) => startVertexDrag(e, selIndex, vIndex, 'baseline'));
        svg.appendChild(rect);
      });
    }
  });
  
  document.getElementById('delete-line-btn').style.display = selectedIndices.size > 0 ? 'flex' : 'none';
}




if (savedLines && savedLines.length > 0) {
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
        status.textContent = 'Saved';
        status.classList.add('visible');
        setTimeout(() => status.classList.remove('visible'), 1200);
      }
    });
}

function debouncedSaveSegmentation() {
  clearTimeout(segmentationSaveDebounce);
  segmentationSaveDebounce = setTimeout(autoSaveSegmentation, 600);
}


function applyZoom() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  previewImage.style.transform = transform;

  const lineOverlay = document.getElementById('line-overlay');
  if (lineOverlay) {
    lineOverlay.style.transform = transform;
    lineOverlay.style.transformOrigin = previewImage.style.transformOrigin || 'center center';
  }
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

function screenToImagePoint(clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  const ctm = lineOverlay.getScreenCTM().inverse();
  const svgPoint = pt.matrixTransform(ctm);
  return [svgPoint.x, svgPoint.y];
}

lineOverlay.addEventListener('mousemove', (e) => {
  if (!isDrawingBaseline || drawnBaselinePoints.length === 0) return;
  const currentPoint = screenToImagePoint(e.clientX, e.clientY);
  renderDrawingPreview(currentPoint);
});

document.addEventListener('keydown', (e) => {
  if (!isDrawingBaseline) return;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    drawnBaselinePoints.pop();
    renderDrawingPreview();
  }
});

lineOverlay.addEventListener('dblclick', (e) => {
  if (!isDrawingBaseline) return;
  e.preventDefault();
  finishBaselineBtn.click();
});


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

lineOverlay.addEventListener('click', (e) => {
  if (!isDrawingBaseline || didDrag) return;
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
    preview.setAttribute('stroke', '#0D9488');
    preview.setAttribute('stroke-width', 4 * scale);
    if (livePoint) preview.setAttribute('stroke-dasharray', `${10 * scale} ${6 * scale}`);
    preview.style.pointerEvents = 'none';
    lineOverlay.appendChild(preview);

    drawnBaselinePoints.forEach((point) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', point[0]);
      circle.setAttribute('cy', point[1]);
      circle.setAttribute('r', 5 * scale);
      circle.setAttribute('fill', '#0D9488');
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
      } else {
        alert(data.error || 'Could not generate a polygon for this baseline.');
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});



let segmentationHistory = [];

function pushHistory() {
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