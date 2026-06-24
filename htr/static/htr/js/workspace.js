

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
  if (!isDragging) return;
  const newWidth = Math.min(Math.max(e.clientX, 160), 480); // clamp between 160px and 480px
  // workspace.style.gridTemplateColumns = `${newWidth}px 6px 50fr 40fr`;
  workspace.style.gridTemplateColumns = `${newWidth}px 6px 1fr 500px`;


});

document.addEventListener('mouseup', () => {
  isDragging = false;
  handle.classList.remove('dragging');
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



previewImage.addEventListener('mousedown', (e) => {
  if (zoomLevel <= 1) return;
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY };
  previewImage.style.cursor = 'grabbing';
});

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
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});

let segmentationLines = [];
let selectedLineIndex = null;
let overlayPageWidth, overlayPageHeight;
let showPolygons = true;
let showBaselines = true;

function getOverlayScale() {
  const referenceWidth = 1500;
  return overlayPageWidth / referenceWidth;
}


function drawLineOverlay(lines, pageWidth, pageHeight) {
  segmentationLines = lines.map(l => ({
    polygon: l.polygon.map(p => [p[0], p[1]]),
    baseline: l.baseline ? l.baseline.map(p => [p[0], p[1]]) : [],
  }));
  selectedLineIndex = null;
  overlayPageWidth = pageWidth;
  overlayPageHeight = pageHeight;
  document.getElementById('overlay-toggle-group').style.display = 'flex';
  renderOverlay();
}


function renderOverlay() {
  const svg = document.getElementById('line-overlay');
  svg.setAttribute('viewBox', `0 0 ${overlayPageWidth} ${overlayPageHeight}`);
  svg.innerHTML = '';
  svg.style.display = segmentationLines.length ? 'block' : 'none';
  const scale = getOverlayScale();



  segmentationLines.forEach((line, index) => {
    const points = line.polygon.map(p => p.join(',')).join(' ');

    if (showPolygons) {
      const polygonHalo = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygonHalo.setAttribute('points', points);
      polygonHalo.setAttribute('fill', 'none');
      polygonHalo.setAttribute('stroke', '#ffffff');
      polygonHalo.setAttribute('stroke-width', (index === selectedLineIndex ? 8 : 7) * scale);
      polygonHalo.setAttribute('stroke-opacity', '0.6');
      polygonHalo.style.pointerEvents = 'none';
      svg.appendChild(polygonHalo);

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      polygon.setAttribute('fill', index === selectedLineIndex ? 'rgba(30,90,200,0.15)' : 'rgba(30,90,200,0.22)');
      polygon.setAttribute('stroke', '#1E5AC8');
      polygon.setAttribute('stroke-width', (index === selectedLineIndex ? 4 : 0) * scale);
      polygon.style.pointerEvents = 'auto';
      polygon.style.cursor = 'pointer';
      polygon.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedLineIndex = index;
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
      baseline.setAttribute('stroke', '#7A1230');
      baseline.setAttribute('stroke-width', 5 * scale);
      baseline.setAttribute('stroke-dasharray', `${8 * scale} ${5 * scale}`);
      baseline.style.pointerEvents = 'none';
      svg.appendChild(baseline);
    }
  });

  if (selectedLineIndex !== null && segmentationLines[selectedLineIndex]) {
    if (showPolygons) {
      segmentationLines[selectedLineIndex].polygon.forEach((point, vIndex) => {
        const size = 16 * scale;
        const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        square.setAttribute('x', point[0] - size / 2);
        square.setAttribute('y', point[1] - size / 2);
        square.setAttribute('width', size);
        square.setAttribute('height', size);
        square.setAttribute('fill', 'rgba(255,255,255,0.85)');
        square.setAttribute('stroke', '#1E5AC8');
        square.setAttribute('stroke-width', 2.5 * scale);
        square.style.pointerEvents = 'auto';
        square.style.cursor = 'grab';
        square.addEventListener('mousedown', (e) => startVertexDrag(e, selectedLineIndex, vIndex, 'polygon'));
        svg.appendChild(square);
      });
    }

    if (showBaselines) {
      const baselinePoints = segmentationLines[selectedLineIndex].baseline;
      const showEvery = baselinePoints.length > 15 ? 2 : 1;

      baselinePoints.forEach((point, vIndex) => {
        if (vIndex % showEvery !== 0 && vIndex !== baselinePoints.length - 1) return;

        const width = 18 * scale;
        const height = 12 * scale;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', point[0] - width / 2);
        rect.setAttribute('y', point[1] - height / 2);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', 'rgba(255,255,255,0.9)');
        rect.setAttribute('stroke', '#7A1230');
        rect.setAttribute('stroke-width', 2.5 * scale);
        rect.style.pointerEvents = 'auto';
        rect.style.cursor = 'grab';
        rect.addEventListener('mousedown', (e) => startVertexDrag(e, selectedLineIndex, vIndex, 'baseline'));
        svg.appendChild(rect);
      });
    }
  }

  document.getElementById('delete-line-btn').style.display = selectedLineIndex !== null ? 'flex' : 'none';
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
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}


document.getElementById('delete-line-btn').addEventListener('click', () => {
  if (selectedLineIndex !== null) {
    segmentationLines.splice(selectedLineIndex, 1);
    selectedLineIndex = null;
    renderOverlay();
  }
});

document.getElementById('save-segmentation-btn').addEventListener('click', () => {
  fetch(`/save-segmentation/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: segmentationLines }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        const btn = document.getElementById('save-segmentation-btn');
        const original = btn.textContent;
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
    });
});



function applyZoom() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  previewImage.style.transform = transform;

  const lineOverlay = document.getElementById('line-overlay');
  if (lineOverlay) {
    lineOverlay.style.transform = transform;
    lineOverlay.style.transformOrigin = previewImage.style.transformOrigin || 'center center';
  }
}

