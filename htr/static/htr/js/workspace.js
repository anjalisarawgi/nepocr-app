// upload button
// click - file picker opens
document.getElementById('upload-trigger').addEventListener('click', () => {
  document.querySelector('#upload-form input[type="file"]').click();
})


// continued: wait for the user to pick the file
// finds upload-form in html 
// submits the form to Django and Django saves the file (based on views)
// note: when submitting - it goes to urls which calls the upload_image function and then goes to the url essentially by callin git
document.querySelector('#upload-form input[type="file"]').addEventListener('change', () => {
  document.getElementById('upload-form').submit();
})

/////////////////////////////////////////////////////////////////////////////


let cropStart = null;

const cropBtn = document.getElementById('crop-btn');
const cropConfirmBtn = document.getElementById('crop-confirm-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const cropOverlay = document.getElementById('crop-overlay');
const cropBox = document.getElementById('crop-box');
const previewImage = document.getElementById('preview-image');
const handle = document.getElementById('resize-handle');
const handleRight = document.getElementById('resize-handle-right');
const workspace = document.querySelector('.workspace');
const beforeAfterToggle = document.getElementById('before-after-toggle');
const beforeBtn = document.getElementById('before-btn');
const afterBtn = document.getElementById('after-btn');

///////////////////////////// some design overall layout fixes ////////////////////////////////////////////////

// when one step is open lets close the other step
document.getElementById('accordion').addEventListener('click', (e) => {
  const header = e.target.closest('.accordion-header');
  if (!header) return;
  const section = header.closest('.accordion-section');
  if (section.classList.contains('locked')) return;

  const willOpen = !section.classList.contains('open');
  document.querySelectorAll('.accordion-section').forEach((s) => s.classList.remove('open'));
  if (willOpen) section.classList.add('open');
});
document.getElementById('accordion').addEventListener('click', () => requestAnimationFrame(layoutWorkspace));



// Resizable sidebars
let isDragging = false;
let isDraggingRight = false;
// panel widths (remembered per browser after the user drags them)
let currentSidebarWidth = 220;
let currentRightWidth = 550;
try {
  currentSidebarWidth = parseInt(localStorage.getItem('sidebarWidth')) || 220;
  currentRightWidth = parseInt(localStorage.getItem('rightWidth')) || 550;
} catch (e) {}
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === '1'; } catch (e) {}

// AI drawer width (the right column grows by this much while the drawer is open)
let aiDrawerWidth = 340;
try { aiDrawerWidth = parseInt(localStorage.getItem('aiDrawerWidth')) || 340; } catch (e) {}

function aiDrawerExtraWidth() {
  const box = document.getElementById('ai-summary');
  const panel = document.getElementById('ocr-results-panel');
  const open = box && !box.classList.contains('collapsed') && panel && panel.offsetParent !== null;
  return open ? aiDrawerWidth : 0;
}

function layoutWorkspace() {
  const left = sidebarCollapsed ? 44 : currentSidebarWidth;
  const right = currentRightWidth + aiDrawerExtraWidth();
  workspace.style.gridTemplateColumns = `${left}px 6px 1fr 6px ${right}px`;
  workspace.classList.toggle('sidebar-collapsed', sidebarCollapsed);

  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.title = sidebarCollapsed ? 'Show documents' : 'Collapse documents';
    toggle.setAttribute('aria-expanded', sidebarCollapsed ? 'false' : 'true');
  }

  const split = document.querySelector('.ocr-split');
  if (split) split.style.setProperty('--ai-w', aiDrawerWidth + 'px');
}
layoutWorkspace();

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  try { localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0'); } catch (e) {}
  layoutWorkspace();
});



// when we press on the left handle 
handle.addEventListener('mousedown', (e) => {
  if (sidebarCollapsed) return;
  e.preventDefault();
  
  isDragging = true;
  handle.classList.add('dragging');
  workspace.classList.add('resizing');
});

handleRight.addEventListener('mousedown', (e) => {
  e.preventDefault();
  isDraggingRight = true;
  handleRight.classList.add('dragging');
  workspace.classList.add('resizing');
});
// when the mouse is moving
document.addEventListener('mousemove', (e) => {
  if (mouseDownPos) {
    const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
    if (dist > 4) didDrag = true;
  }

  if (isDragging) {
    const left = workspace.getBoundingClientRect().left;
    currentSidebarWidth = Math.min(Math.max(e.clientX - left, 160), 420);
    layoutWorkspace();
  }
  if (isDraggingRight) {
    const right = workspace.getBoundingClientRect().right;
    currentRightWidth = Math.min(Math.max(right - e.clientX - aiDrawerExtraWidth(), 380), 1100);
    layoutWorkspace();
  }

  if (!isPanning) return;
  panX = e.clientX - panStart.x;
  panY = e.clientY - panStart.y;
  applyZoom();
});


// when the mouse is released - stop dragging and remember the widths
document.addEventListener('mouseup', () => {
  isPanning = false;
  mouseDownPos = null;
  previewImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';

  if (isDragging || isDraggingRight) {
    try {
      localStorage.setItem('sidebarWidth', currentSidebarWidth);
      localStorage.setItem('rightWidth', currentRightWidth);
    } catch (e) {}
  }
  isDragging = false;
  isDraggingRight = false;
  handle.classList.remove('dragging');
  handleRight.classList.remove('dragging');
  workspace.classList.remove('resizing');
});


///////////////////////////////////////// the keyboard shortcuts : ///////////////////////////////////////
document.addEventListener('keydown', (e) => {
  const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (isTyping) return;


  // cntrol + a  = select all 
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    if (segmentationLines.length > 0) {
      e.preventDefault();
      selectedIndices = new Set(segmentationLines.map((_, i) => i));
      renderOverlay();
    }
  }
  // cntrol + z == undo 
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    document.getElementById('undo-segmentation-btn').click();
  }
  // escape = desleelct
  if (e.key === 'Escape') {
    selectedIndices = new Set();
    renderOverlay();
  }
});



///////////////////////////////////////// cropping : ///////////////////////////////////////

if (cropBtn) {

function endCropMode() {
  cropOverlay.style.display = 'none';
  cropBox.style.display = 'none';
  cropBtn.style.display = 'flex';
  cropConfirmBtn.style.display = 'none';
  cropCancelBtn.style.display = 'none';
}

// when we click the crop button - show the transparent overlay - hide drop - show the green and red options
cropBtn.addEventListener('click', () => {
  cropOverlay.style.display = 'block'; // overlay
  cropBtn.style.display = 'none'; // the hide crop buttn
  cropConfirmBtn.style.display = 'flex'; // the green tick
  cropCancelBtn.style.display = 'flex'; // the red x button
});

cropCancelBtn.addEventListener('click', endCropMode); // cancel button which undos / hides eveyrthing and shows the crop button again

// now: drawginthe crop box code  [ start drawing, recording the start position]
let imageBounds = null;
let cropInteractionMode = null;
let cropDragStart = null;

cropOverlay.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  if (e.target.classList.contains('crop-handle') || e.target === cropBox) return; // if user clicked on a corner handle or the box itself - stop here, dont start drawing a new box

  imageBounds = getVisibleImageRect(); // to find out where exactly the image is on screen
  const rect = cropOverlay.getBoundingClientRect();
  const rawX = e.clientX - rect.left// converingt he mouse position to relative to the overlay and not the whole screen
  const rawY = e.clientY - rect.top;

  // clamp so that it doesnt go outside while drawing
  cropStart = {
    x: clamp(rawX, imageBounds.left, imageBounds.left + imageBounds.width),
    y: clamp(rawY, imageBounds.top, imageBounds.top + imageBounds.height),
  };
  cropInteractionMode = 'drawing'; // entering drawing mode
  cropBox.style.left = cropStart.x + 'px';
  cropBox.style.top = cropStart.y + 'px';
  cropBox.style.width = '0px';
  cropBox.style.height = '0px';
  cropBox.style.display = 'block';
});



// now the drawing block rules -- [ grow the box following the mouse]
cropOverlay.addEventListener('mousemove', (e) => {
  if (cropInteractionMode !== 'drawing' || !cropStart || !imageBounds) return;
  const rect = cropOverlay.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;

  // keep inside the image
  const x = clamp(rawX, imageBounds.left, imageBounds.left + imageBounds.width);
  const y = clamp(rawY, imageBounds.top, imageBounds.top + imageBounds.height);

  cropBox.style.left = Math.min(x, cropStart.x) + 'px';
  cropBox.style.top = Math.min(y, cropStart.y) + 'px';
  cropBox.style.width = Math.abs(x - cropStart.x) + 'px';
  cropBox.style.height = Math.abs(y - cropStart.y) + 'px';
});

// when the user releases themouse, stop drawing, -- the box remains wheere it is 
cropOverlay.addEventListener('mouseup', () => {
  if (cropInteractionMode === 'drawing') {
    cropInteractionMode = null; // stop drawing mode
    cropStart = null; 
  }
});

// Move the whole crop box around
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

// Resize via corner handles the crop box
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



// 
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

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// split text into whole Devanagari characters (e.g. "कि" stays together)
function splitGraphemes(s) {
  if (window.Intl && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

// compare model text with edited text, colour what the user added/changed
function diffHtml(original, edited) {
  const a = splitGraphemes(original);
  const b = splitGraphemes(edited);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0, j = 0, out = '', deleted = '';
  const flushDeleted = () => {
    if (deleted) {
      out += `<span class="edit-del" title="Removed: ${escapeHtml(deleted)}"></span>`;
      deleted = '';
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flushDeleted();
      out += escapeHtml(b[j]);
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      flushDeleted();
      out += `<span class="edit-ins">${escapeHtml(b[j])}</span>`;
      j++;
    } else {
      deleted += a[i];
      i++;
    }
  }
  flushDeleted();
  return out;
}

// one place that decides how a line is shown
// one place that decides how a line is shown
function renderLineText(el) {
  if (el.isContentEditable) return; // don't touch the line being edited
  const plain = el.dataset.plain || '';
  const original = el.dataset.original ?? plain;
  const isEdited = original !== plain;
  const row = el.closest('.ocr-line-result');
  if (row) row.classList.toggle('is-edited', isEdited);

  if (textView === 'original') {
    el.textContent = original; // the model's prediction, untouched
    return;
  }
  if (isEdited) {
    el.innerHTML = diffHtml(original, plain);
  } else {
    el.textContent = plain;
  }
}

cropConfirmBtn.addEventListener('click', () => {
  const overlayRect = cropOverlay.getBoundingClientRect();
  const bounds = getVisibleImageRect();
  
  const visibleImageLeft = bounds.left + overlayRect.left;
  const visibleImageTop = bounds.top + overlayRect.top;
  const renderedWidth = bounds.width;
  const renderedHeight = bounds.height;

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


// ///////////////////////////////////////////////////////  // ///////////////////////////////////////////////////////
let zoomLevel = 1; // current zoom (1 = normal, 2 = double size)
let panX = 0; // how far is image dragged vertically
let panY = 0;// how far is image dragged horizontally
let isPanning = false; // is the user currently dragging?
let panStart = { x: 0, y: 0 }; 
let mouseDownPos = null; // where was the mouse clicked 
let didDrag = false;// did the user drag or just click? 


// this is when we click on the image , line overlay , or preview card, three elemets all use the same start pan function
function startPan(e) {
  mouseDownPos = { x: e.clientX, y: e.clientY };
  didDrag = false;
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY }; // moves the iamge but enables the image to still stay under the cursors
  previewImage.style.cursor = 'grabbing'; // the grab hand cursor
}

// all three of these trigger the same pan function 
previewImage.addEventListener('mousedown', startPan);
document.getElementById('line-overlay').addEventListener('mousedown', startPan);
document.getElementById('preview-card').addEventListener('mousedown', startPan);

///////////////////////////////// keep the page inside the viewer /////////////////////////////////
function imageFitInfo() {
  const bw = previewImage.clientWidth, bh = previewImage.clientHeight;
  const nw = previewImage.naturalWidth, nh = previewImage.naturalHeight;
  if (!bw || !bh || !nw || !nh) return null;
  const s = Math.min(bw / nw, bh / nh);          // how the page is fitted at zoom 1
  return { bw, bh, w: nw * s, h: nh * s };
}

// stop the page from being dragged/scrolled off into empty grey space
function clampPan() {
  const f = imageFitInfo();
  if (!f) return;
  const margin = 16;
  const w = f.w * zoomLevel, h = f.h * zoomLevel;
  const maxX = (w - f.bw) / 2 + margin;
  const maxY = (h - f.bh) / 2 + margin;
  panX = w <= f.bw ? 0 : Math.min(Math.max(panX, -maxX), maxX);
  panY = h <= f.bh ? 0 : Math.min(Math.max(panY, -maxY), maxY);
}

// fill the panel width, start at the top of the page
function fitToWidth() {
  const f = imageFitInfo();
  if (!f) return;
  zoomLevel = Math.max(1, (f.bw - 32) / f.w);
  panX = 0;
  panY = Infinity; // clampPan turns this into "top of the page"
  applyZoom();
}

function initialFit() {
  if (docStatus === 'uploaded') return; // keep the whole page visible while cropping
  fitToWidth();
}

if (previewImage.complete && previewImage.naturalWidth) initialFit();
else previewImage.addEventListener('load', initialFit, { once: true });

// re-check the limits when the window or the side panels are resized
window.addEventListener('resize', applyZoom);
if (window.ResizeObserver) {
  new ResizeObserver(() => applyZoom()).observe(document.getElementById('preview-card'));
}


// zoom buddonts
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  zoomLevel = Math.min(zoomLevel + 0.25, 8); // adds 0.25 but never goes above 8x
  applyZoom();
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.5);  // subs 0.25 but never goes above 0.5x
  applyZoom();
});

document.getElementById('zoom-reset-btn').addEventListener('click', () => {
  if (docStatus === 'uploaded') {
    zoomLevel = 1; panX = 0; panY = 0;
    applyZoom();
  } else {
    fitToWidth();
  }
});

// // added feature: double click also zooms
// previewImage.addEventListener('dblclick', () => {
//   zoomLevel = Math.min(zoomLevel + 0.5, 3);
//   applyZoom();
// });


// control + scroll also does = zoom in or zoom out 
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

    // to scroll without control:
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

document.getElementById('preview-card').addEventListener('wheel', handleWheel, { passive: false });

///////////////////////////////// next step button in preview bar /////////////////////////////////
const nextStepBtn = document.getElementById('next-step-btn');
if (nextStepBtn) {
  nextStepBtn.addEventListener('click', () => {
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
}

///////////////////////////////// before after toggle /////////////////////////////////
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



///////////////////////////////// DATA PREPROCESSING: /////////////////////////////////
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

function runPreprocessing() {
  document.getElementById('processing-overlay').style.display = 'flex'; // show the sponner 

  const formData = new FormData(); // to send to django -- collects all current checkboxes and slider values 
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

  // sending to django which will run the actual image processing in python
  fetch(`/preprocess/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
    body: formData,
  })
    .then((res) => res.json())
    .then((data) => { // handle the response (cleaned data) from django
      if (data.success) {
        afterUrl = data.new_url + '?t=' + Date.now();
        beforeAfterToggle.style.display = 'flex';
        setMode('after');
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';// then hide the spinner 
    });
}

// wait 3ms after slider has been changed before sending it to django -- otherwise the slider would send hundreds of requests per second to django
let sliderDebounce;
function debouncedRun() {
  clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(runPreprocessing, 400);
}


// this is when we click the gaussian tick -- 
// this highlights the card visually, shwos the kernel and sigma slides, and runs preprocessing immediately
gaussianCheckbox.addEventListener('change', () => {
  gaussianCheckbox.closest('.option-card').classList.toggle('checked', gaussianCheckbox.checked);
  kernelRow.style.display = gaussianCheckbox.checked ? 'flex' : 'none';
  sigmaRow.style.display = gaussianCheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});
//same
sauvolaCheckbox.addEventListener('change', () => {
  sauvolaCheckbox.closest('.option-card').classList.toggle('checked', sauvolaCheckbox.checked);
  windowRow.style.display = sauvolaCheckbox.checked ? 'flex' : 'none';
  kRow.style.display = sauvolaCheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});
// same
clahecheckbox.addEventListener('change', () => {
  clahecheckbox.closest('.option-card').classList.toggle('checked', clahecheckbox.checked);
  clipRow.style.display = clahecheckbox.checked ? 'flex' : 'none';
  tileRow.style.display = clahecheckbox.checked ? 'flex' : 'none';
  runPreprocessing();
});



kernelSlider.addEventListener('input', () => { kernelValue.textContent = kernelSlider.value; debouncedRun(); }); // update the number shown and run after 300ms pause
sigmaSlider.addEventListener('input', () => { sigmaValue.textContent = sigmaSlider.value; debouncedRun(); }); // update the number shown and run after 300ms pause
windowSlider.addEventListener('input', () => { windowValue.textContent = windowSlider.value; debouncedRun(); }); // same ...
kSlider.addEventListener('input', () => { kValue.textContent = (kSlider.value / 100).toFixed(2); debouncedRun(); });
clipSlider.addEventListener('input', () => { clipValue.textContent = (clipSlider.value / 10).toFixed(1); debouncedRun(); });
tileSlider.addEventListener('input', () => { tileValue.textContent = tileSlider.value; debouncedRun(); });


// run segementation step button
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


///////////////////////////////// STEP 2: SEGMENTATION /////////////////////////////////

// these are the 4 sliders which moves polygons
const paddingTop = document.getElementById('padding-top');
const paddingBottom = document.getElementById('padding-bottom');
const paddingLeft = document.getElementById('padding-left');
const paddingRight = document.getElementById('padding-right');

let basePolygons = {};
let originalPolygons = {}; // shape of the polygon before adding any padding
let linePaddingValues = {}; // last slider value per line
// taking a snapshot of the polygon position before padding is added to maintain the consistency adn to avoid doublel shifts
function captureBasePolygons() {
  basePolygons = {};
  selectedIndices.forEach((idx) => {
    if (segmentationLines[idx]) {
      if (!originalPolygons[idx]) {
        // only capture original if we haven't seen this line before
        originalPolygons[idx] = segmentationLines[idx].polygon.map(p => [p[0], p[1]]);
      }
      basePolygons[idx] = originalPolygons[idx].map(p => [p[0], p[1]]);
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

    linePaddingValues[idx] = { top, bottom, left, right };   // ← ADD THIS LINE
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
    pushHistory(); // save state for undo 
    isAdjustingPadding = true; //hides the corner points when we are adjusting the padding
    renderOverlay();
  });
  slider.addEventListener('input', () => {
    applyPadding(); // update polygon live as we drag
    debouncedApplyPadding(); // saving in 400ms pause
  });
  slider.addEventListener('mouseup', () => {
    isAdjustingPadding = false; // handles for dragging reappear
    renderOverlay();
  });
});



///////////////////////////////// SEGMENTATION: Kraken /////////////////////////////////
// which line detection model to use (remembered per browser)
let segEngine = 'kraken';
try { segEngine = localStorage.getItem('segEngine') || 'kraken'; } catch (e) {}
const segEngineToggle = document.getElementById('seg-engine-toggle');

function setSegEngine(engine) {
  segEngine = engine;
  try { localStorage.setItem('segEngine', engine); } catch (e) {}

  if (segEngineToggle) {
    segEngineToggle.querySelectorAll('.engine-card').forEach((card) => {
      const on = card.dataset.engine === engine;
      card.classList.toggle('active', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  const runBtn = document.getElementById('run-segmentation-model-btn');
  if (runBtn) {
    runBtn.textContent = engine === 'paddle' ? 'Run PaddleOCR detection' : 'Run Kraken segmentation';
  }
}

if (segEngineToggle) {
  segEngineToggle.addEventListener('click', (e) => {
    const card = e.target.closest('.engine-card');
    if (card) setSegEngine(card.dataset.engine);
  });
  setSegEngine(segEngine);
}

// run segemnetation model button
document.getElementById('run-segmentation-model-btn').addEventListener('click', () => {
  if (segmentationLines.length > 0) {
    const confirmed = confirm('This will replace your existing segmentation lines. Continue?');
    if (!confirmed) return;
  }

  document.getElementById('processing-overlay').style.display = 'flex';
  // send to django to un kraken
  const segForm = new FormData();
  segForm.append('engine', segEngine);

  fetch(`/segment/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
    body: segForm,
  })
    .then((res) => res.json())
    .then((data) => { // django sends the detected lines back
      if (data.success) {
        drawLineOverlay(data.lines, data.page_width, data.page_height);  // draws them on screen 
        autoSaveSegmentation(); // saves then 
        document.getElementById('advance-to-ocr-btn').disabled = data.lines.length === 0;
      } else {
        alert(data.error || 'Segmentation failed.');
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none'; // always hide the spinner when done
    });
});


///////////////////////////////// SEGMENTATION: polygons and overlays /////////////////////////////////

let segmentationLines = []; // all the polygon lines on the image
let selectedIndices = new Set(); // which line currently selected -- orange
let hoveredLineIndex = null; // which line mouse is hoveing at ?
let isAdjustingPadding = false; // is the user dragging a padding slider
let overlayPageWidth, overlayPageHeight; // dimensions of the original image
let showPolygons = true; // are polygons visible?
// OCR
let showBaselines = docStatus !== 'ocr_done'; // hide baselines in OCR mode
const isReadOnlyOverlay = docStatus === 'ocr_done'; // not allowed to edit segmentation in OCR mode


// scaling the image so that the kraken polygons can fit somehow
function getOverlayScale() {
  // const referenceWidth = previewImage.getBoundingClientRect().width;
  const referenceWidth = 1500;
  return overlayPageWidth / referenceWidth;
}

// stroes the lines and draws then 
function drawLineOverlay(lines, pageWidth, pageHeight) {
  if (segmentationLines.length > 0) pushHistory(); // if there are already lines on screen -- save them 
  segmentationLines = lines.map(l => ({ // takes the lines django sent back and has 2 things: polygon and baseline
    polygon: l.polygon.map(p => [p[0], p[1]]), // p[0] -- x coord , p[1] -- y coord
    baseline: l.baseline ? l.baseline.map(p => [p[0], p[1]]) : [], // is baselines ecist copy it, or else use empty array instead
    source: l.source || null, // which model detected this line (kraken / paddle / manual)
  }));
  selectedIndices = new Set(); // after drawing, we just dont want to select anything by default, so it just makes sure nothign i selecting by resetting it to an empty index
  overlayPageWidth = pageWidth; 
  overlayPageHeight = pageHeight;
  document.getElementById('overlay-toggle-group').style.display = 'flex'; // show the checbox of polygon and basleline when the lines are drawn
  renderOverlay(); // actually draw everything on screen 
}




function startVertexDrag(e, lineIndex, vertexIndex, type) {
  e.stopPropagation();
  e.preventDefault();
  pushHistory();

  const svg = document.getElementById('line-overlay');
  // tricky because the mouse gives coordinates in screen pixels and the SVG uses image coordinates so the function converts between the two using a transformation matrix
  function screenToSvgPoint(clientX, clientY) {
    const pt = new DOMPoint(clientX, clientY);
    const ctm = svg.getScreenCTM().inverse();
    return pt.matrixTransform(ctm);
  }

  function onMouseMove(moveEvent) {
    const svgPoint = screenToSvgPoint(moveEvent.clientX, moveEvent.clientY);
    segmentationLines[lineIndex][type][vertexIndex] = [svgPoint.x, svgPoint.y];
    renderOverlay(); // updates as added - redrawn immediately
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    debouncedSaveSegmentation();
  }


  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}


// highlight the transcription row of a line hovered on the image
function highlightOcrRow(lineIndex, on) {
  const row = document.querySelector(`.ocr-line-result[data-line-index="${lineIndex}"]`);
  if (!row) return;
  row.classList.toggle('hovered', on);
  if (on) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// image units per screen pixel (at zoom 1), so handles look the same size on any image
function unitsPerPx() {
  const svg = document.getElementById('line-overlay');
  const rect = svg.getBoundingClientRect();
  const s = Math.min(rect.width / overlayPageWidth, rect.height / overlayPageHeight) / zoomLevel;
  return s > 0 && isFinite(s) ? 1 / s : getOverlayScale();
}


// one square drag handle
function makeHandle(point, r, kind, u) {
  const size = r * 2;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  s.setAttribute('x', point[0] - r);
  s.setAttribute('y', point[1] - r);
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('rx', 1.5 * u);          // very slightly softened corners
  s.setAttribute('stroke-width', 1.5 * u);
  s.classList.add('overlay-handle', kind);
  s.style.transformOrigin = `${point[0]}px ${point[1]}px`;
  s.style.pointerEvents = 'auto';
  return s;
}

// small chip in the preview bar: which model the lines come from + how many
const ENGINE_LABELS = { kraken: 'Kraken', paddle: 'PaddleOCR', manual: 'manual' };

function updateSegSourceTag() {
  const tag = document.getElementById('seg-source-tag');
  if (!tag) return;
  const n = segmentationLines.length;
  if (!n) {
    tag.style.display = 'none';
    return;
  }
  const sources = [...new Set(segmentationLines.map((l) => l.source).filter(Boolean))];
  sources.sort((a, b) => (a === 'manual') - (b === 'manual')); // model first, "manual" last
  const names = sources.map((s) => ENGINE_LABELS[s] || s).join(' + ');

  tag.textContent = (names ? names + ' · ' : '') + `${n} line${n === 1 ? '' : 's'}`;
  tag.title = names ? `Lines detected with ${names}` : `${n} lines`;
  tag.style.display = 'inline-flex';
}


function renderOverlay() {
  document.querySelectorAll('.ocr-line-result.hovered').forEach((r) => r.classList.remove('hovered'));
  const svg = document.getElementById('line-overlay');
  svg.setAttribute('viewBox', `0 0 ${overlayPageWidth} ${overlayPageHeight}`);
  svg.innerHTML = '';
  svg.style.display = (segmentationLines.length || isDrawingBaseline) ? 'block' : 'none';
  const scale = getOverlayScale();
  const u = unitsPerPx();
  // loop through each line 
  segmentationLines.forEach((line, index) => {
    const points = line.polygon.map(p => p.join(',')).join(' ');


    // draw the polygons - but creating scg polygons with coordinates
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
            polygon.setAttribute('stroke-width', isHovered ? 0 : (isSelected ? 1.5 * u : 0));
      polygon.style.pointerEvents = 'auto';
      polygon.style.cursor = isReadOnlyOverlay ? 'not-allowed' : 'pointer';

      // polygon clicking behaviour
      if (!isReadOnlyOverlay) {
        polygon.addEventListener('click', (e) => {
          e.stopPropagation();
          if (didDrag) return;
          if (isEditingOcr) return;
          if (isDrawingBaseline) return;
        
          if (e.metaKey || e.ctrlKey) {
            if (selectedIndices.has(index)) {
              selectedIndices.delete(index);
              delete originalPolygons[index]; // ← clear when deselecting
            } else {
              selectedIndices.add(index);
            }
          } else {
            // clear originals for any previously selected lines that are no longer selected
            selectedIndices.forEach(i => {
              if (i !== index) delete originalPolygons[i]; // ← clear old ones
            });
            selectedIndices = new Set([index]);
          }
        
          if (paddingTop) {
            const saved = linePaddingValues[index] || { top: 0, bottom: 0, left: 0, right: 0 };
            paddingTop.value = saved.top;
            paddingBottom.value = saved.bottom;
            paddingLeft.value = saved.left;
            paddingRight.value = saved.right;
            captureBasePolygons();
          }
          renderOverlay();
        });
      } else {
        // in OCR mode -- the clikcing highlights the ocr results instead
        polygon.addEventListener('click', (e) => {
          e.stopPropagation();
          if (didDrag) return;
          selectOcrResultForLine(index);
        });

        // hovering a line on the image highlights its transcription row
        polygon.addEventListener('mouseenter', () => {
          if (isPanning) return;
          highlightOcrRow(index, true);
          polygon.setAttribute('fill', 'rgba(212,138,90,0.35)');
        });
        polygon.addEventListener('mouseleave', () => {
          highlightOcrRow(index, false);
          polygon.setAttribute('fill', isSelected ? 'rgba(168,81,46,0.30)' : 'rgba(30,90,200,0.22)');
        });
      }
      svg.appendChild(polygon);
    }
    


    // drawign the baseline -- the one krakne predicted
    if (showBaselines && line.baseline && line.baseline.length > 0) {
      const baselinePoints = line.baseline.map(p => p.join(',')).join(' ');
    
      const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      baseline.setAttribute('points', baselinePoints);
      baseline.setAttribute('fill', 'none');
      baseline.setAttribute('stroke', '#9F1239');
      baseline.setAttribute('stroke-width', 2 * u);
      baseline.setAttribute('stroke-solid', `${8 * scale} ${3 * scale}`);
      baseline.style.pointerEvents = 'none';
      svg.appendChild(baseline);
    }
  });


  // drawing dragebale handles in selected polygon  -- when the corner is slee ted the startVertexDrag is started which moves that corner
    // draggable handles on the selected line(s)
  if (!isReadOnlyOverlay && !isAdjustingPadding) {
    selectedIndices.forEach((selIndex) => {
      const line = segmentationLines[selIndex];
      if (!line) return;

      // polygon corners: white circles with a terracotta outline
      if (showPolygons) {
        line.polygon.forEach((point, vIndex) => {
          const c = makeHandle(point, 5 * u, 'vertex', u);
          c.addEventListener('mousedown', (e) => startVertexDrag(e, selIndex, vIndex, 'polygon'));
          svg.appendChild(c);
        });
      }

      // baseline points: small solid crimson dots
      if (showBaselines && line.baseline && line.baseline.length) {
        const pts = line.baseline;
        const showEvery = pts.length > 15 ? 2 : 1;
        pts.forEach((point, vIndex) => {
          if (vIndex % showEvery !== 0 && vIndex !== pts.length - 1) return;
          const c = makeHandle(point, 4 * u, 'baseline-pt', u);
          c.addEventListener('mousedown', (e) => startVertexDrag(e, selIndex, vIndex, 'baseline'));
          svg.appendChild(c);
        });
      }
    });

    updateHandleCounterScale();
  }

// shows delete button and padding controls when somehting is selected 
document.getElementById('delete-line-btn').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';
document.getElementById('padding-controls').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';
updateSegSourceTag();
}

// restrore page, lines segments image etc when reloaded
overlayPageWidth = savedPageWidth;
overlayPageHeight = savedPageHeight;

if (savedLines && savedLines.length > 0 && (docStatus === 'segmented' || docStatus === 'ocr_done')) {
  drawLineOverlay(savedLines, savedPageWidth, savedPageHeight);
}


// the checkboxes on the preview bar //
document.getElementById('show-polygons-checkbox').addEventListener('change', (e) => {
  showPolygons = e.target.checked;
  renderOverlay();
});

document.getElementById('show-baselines-checkbox').addEventListener('change', (e) => {
  showBaselines = e.target.checked;
  renderOverlay();
});



// forward and back buttons
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




// auto save segmentation block
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


//  save the lines 
function debouncedSaveSegmentation() {
  clearTimeout(segmentationSaveDebounce);
  segmentationSaveDebounce = setTimeout(autoSaveSegmentation, 600); // wait 6 sec before saving the polygon drags to django 
}

function updateHandleCounterScale() {
  const counterScale = 1 / Math.max(zoomLevel, 0.5); // keep handles the same size on screen at any zoom
  document.querySelectorAll('.overlay-handle').forEach((el) => {
    el.style.transform = `scale(${counterScale})`;
  });
}

// zooming with the overlays
function applyZoom() {
  clampPan();
  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  previewImage.style.transform = transform; // move + scale the image

  const lineOverlay = document.getElementById('line-overlay'); // move + scale the overlay too 
  if (lineOverlay) {
    lineOverlay.style.transform = transform;
    lineOverlay.style.transformOrigin = previewImage.style.transformOrigin || 'center center';
  }

  updateHandleCounterScale(); // keeps the handles the right size
}


// download image button
document.getElementById('download-image-btn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = previewImage.src;
  link.download = currentDocId ? `document-${currentDocId}.jpg` : 'image.jpg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});



// select button when we click somehwere in the background or not polygon in the preview
function deselectIfEmpty(e) {
  if (didDrag) return;
  if (isDrawingBaseline) return;
  if (selectedIndices.size === 0) return;
  selectedIndices = new Set();
  originalPolygons = {};
  linePaddingValues = {}; // ← add this
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




///////////////////////////////////  OCR? ///////////////////////////////////

// when we click a polygon in OCR mode
// find the mathcing result row -- highlight it -- scroll to it -- highlight the polygon ornage 
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
  focusExplainItem(lineIndex);   // NEW: jump to this line's explanation
}


function setupOcrHoverHighlight() {
  const resultsDiv = document.getElementById('ocr-results');
  if (!resultsDiv) return;

  resultsDiv.addEventListener('mouseover', (e) => {
    if (isEditingOcr) return;
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    hoveredLineIndex = parseInt(row.dataset.lineIndex);
    renderOverlay();
    
  });

  resultsDiv.addEventListener('mouseout', (e) => {
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    hoveredLineIndex = null;
    renderOverlay();
  });
  // no click listener here anymore
}

setupOcrHoverHighlight();




//////////////////////////////////// OCR Confidence ////////////////////////////////////
const confidenceCheckbox = document.getElementById('show-confidence-checkbox');
// remember the confidence toggle across page refreshes
try { confidenceCheckbox.checked = localStorage.getItem('showConfidence') === '1'; } catch (e) {}

// Original / Edited view switch
let textView = 'edited';
const textViewToggle = document.getElementById('text-view-toggle');

function setTextView(view) {
  textView = view;
  if (textViewToggle) {
    textViewToggle.querySelectorAll('.ba-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }
  applyConfidenceVisibility();
}

if (textViewToggle) {
  textViewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.ba-btn');
    if (btn) setTextView(btn.dataset.view);
  });
}

// confidence checkbox
function confBucket(c) {
  if (c >= 0.8) return 'high';
  if (c >= 0.6) return 'mid';
  if (c >= 0.4) return 'low';
  return 'vlow';
}

// colour the whole row + show a % badge
// per-character confidence → runs of the same colour, snapped to whole Devanagari characters
function graphemeConfRuns(text, charConf) {
  const runs = [];
  let pos = 0;
  splitGraphemes(text).forEach((g) => {
    const s = pos, e = pos + g.length;
    pos = e;
    let c = 1;
    for (const [ts, te, tc] of charConf) {
      if (ts < e && te > s) c *= tc;
    }
    const bucket = confBucket(c);
    const last = runs[runs.length - 1];
    if (last && last.bucket === bucket) last.end = e;
    else runs.push({ start: s, end: e, bucket });
  });
  return runs;
}

// match characters of the model's text to the edited text (same logic as the edit colouring)
function alignGraphemes(original, edited) {
  const a = splitGraphemes(original);
  const b = splitGraphemes(edited);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = []; // [origStart, origEnd, newStart, newEnd] for each unchanged character
  let i = 0, j = 0, ai = 0, bj = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([ai, ai + a[i].length, bj, bj + b[j].length]);
      ai += a[i].length; bj += b[j].length; i++; j++;
    } else if (dp[i][j + 1] >= dp[i + 1][j]) {
      bj += b[j].length; j++;
    } else {
      ai += a[i].length; i++;
    }
  }
  return pairs;
}

// confidence data for the text currently shown (moved onto unchanged characters if the line was edited)
function charConfForCurrentText(row, textSpan) {
  const charConf = JSON.parse(row.dataset.charConf || '[]');
  const plain = textSpan.dataset.plain || '';
  const original = textSpan.dataset.original ?? plain;
  if (textView === 'original' || original === plain) return charConf;
  if (row._confCache && row._confCache.plain === plain) return row._confCache.data;

  const mapped = [];
  alignGraphemes(original, plain).forEach(([os, oe, ns, ne]) => {
    let found = false, c = 1, alts = null;
    for (const [ts, te, tc, ta] of charConf) {
      if (ts < oe && te > os) {
        found = true;
        if (tc <= c) { c = tc; alts = ta || null; }
      }
    }
    if (found) mapped.push([ns, ne, c, alts]);
  });
  row._confCache = { plain, data: mapped };
  return mapped;
}

// a Range over characters [start, end) of an element, even if the text is split into several pieces
function rangeFor(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0, node, last = null, started = false;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (!started && start <= pos + len) { range.setStart(node, start - pos); started = true; }
    if (started && end <= pos + len) { range.setEnd(node, end - pos); return range; }
    pos += len;
    last = node;
  }
  if (started && last) { range.setEnd(last, last.textContent.length); return range; }
  return null;
}


// draw coloured blocks BEHIND the text (text itself is never split)
// draw coloured blocks BEHIND the text (text itself is never split)
function applyLineConfidence(row) {
  let layer = row.querySelector('.conf-layer');
  if (layer) layer.innerHTML = '';

  const textSpan = row.querySelector('.ocr-line-text');
  if (!textSpan || !confidenceCheckbox.checked || textSpan.isContentEditable) return;

  const charConf = charConfForCurrentText(row, textSpan);
  if (charConf.length === 0) return;

  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'conf-layer';
    row.prepend(layer);
  }

  const rowRect = row.getBoundingClientRect();
  const text = textSpan.textContent;
  graphemeConfRuns(text, charConf).forEach((run) => {
    if (run.bucket === 'high') return; // confident parts (and newly typed text) stay plain
    const range = rangeFor(textSpan, run.start, Math.min(run.end, text.length));
    if (!range) return;
    const lineH = parseFloat(getComputedStyle(textSpan).lineHeight) || 0;
    for (const r of range.getClientRects()) {
      // stretch to the full line height so matras above/below (े ु ृ ...) are covered too
      const h = Math.max(r.height, lineH);
      const top = r.top + r.height / 2 - h / 2;

      const box = document.createElement('div');
      box.className = 'conf-box ' + run.bucket;
      box.style.left = (r.left - rowRect.left) + 'px';
      box.style.top = (top - rowRect.top) + 'px';
      box.style.width = r.width + 'px';
      box.style.height = h + 'px';
      layer.appendChild(box);
    }
  });
}




function applyConfidenceVisibility() {
  document.querySelectorAll('.ocr-line-text').forEach(renderLineText);
  document.querySelectorAll('.ocr-line-result').forEach(applyLineConfidence);
}

const ocrResultsEl = document.getElementById('ocr-results');
if (window.ResizeObserver && ocrResultsEl) {
  new ResizeObserver(() => {
    document.querySelectorAll('.ocr-line-result').forEach(applyLineConfidence);
  }).observe(ocrResultsEl);
}


if (document.fonts) document.fonts.ready.then(applyConfidenceVisibility);

//////////// confidence tooltip (top alternatives on hover) ////////////
const confTip = document.createElement('div');
confTip.className = 'conf-tooltip';
confTip.style.display = 'none';
document.body.appendChild(confTip);

function hideConfTip() {
  confTip.style.display = 'none';
  confTip.dataset.key = '';
}

// show a vowel sign / virama on a dotted circle so it is visible on its own (e.g. ◌ु)
function displayPiece(piece) {
  return /^\p{M}/u.test(piece) ? '◌' + piece : piece;
}

function showConfTip(key, rect, entries, text, grapheme) {
  if (confTip.dataset.key === key && confTip.style.display === 'block') return;
  confTip.dataset.key = key;
  confTip.innerHTML = '';

  // one column per token (e.g. ष | ◌ु), side by side
  const cols = document.createElement('div');
  cols.className = 'conf-tooltip-cols';

  entries.forEach(([ts, te, tc, alts]) => {
    const col = document.createElement('div');
    col.className = 'conf-tooltip-col';


    if (alts) {
      const [toks, probs] = alts;
      toks.forEach((t, i) => {
        const line = document.createElement('div');
        line.className = 'conf-tooltip-row' + (i === 0 ? ' top' : '');
        const tok = document.createElement('span');
        tok.textContent = t ? displayPiece(t) : '∅';
        const p = document.createElement('span');
        p.textContent = (probs[i] ?? 0).toFixed(3);
        line.append(tok, p);
        col.appendChild(line);
      });
    }

    cols.appendChild(col);
  });

  confTip.appendChild(cols);


  confTip.style.display = 'block';
  const tipRect = confTip.getBoundingClientRect();
  let left = rect.left;
  if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
  let top = rect.top - tipRect.height - 6;
  if (top < 8) top = rect.bottom + 6;
  confTip.style.left = left + 'px';
  confTip.style.top = top + 'px';
}



ocrResultsEl.addEventListener('mousemove', (e) => {
  if (!confidenceCheckbox.checked || isEditingOcr) return hideConfTip();

  const textSpan = e.target.closest('.ocr-line-text');
  const row = textSpan && textSpan.closest('.ocr-line-result');
  if (!row) return hideConfTip();

  const charConf = charConfForCurrentText(row, textSpan);
  const text = textSpan.textContent;
  const pad = 6; // a little extra above/below for matras

  // find the whole Devanagari character under the mouse (e.g. "षु", not just "ष")
  let pos = 0;
  for (const g of splitGraphemes(text)) {
    const s = pos, end = pos + g.length;
    pos = end;
    const range = rangeFor(textSpan, s, end);
    if (!range) continue;
    for (const r of range.getClientRects()) {
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
        // every token that produced part of this character
        const entries = charConf.filter(([ts, te]) => ts < end && te > s);
        if (!entries.length) return hideConfTip();
        showConfTip(`${row.dataset.lineIndex}:${s}`, r, entries, text, g);
        return;
      }
    }
  }
  hideConfTip();
});



ocrResultsEl.addEventListener('mouseleave', hideConfTip);
ocrResultsEl.addEventListener('scroll', hideConfTip);


confidenceCheckbox.addEventListener('change', () => {
  try { localStorage.setItem('showConfidence', confidenceCheckbox.checked ? '1' : '0'); } catch (e) {}
  applyConfidenceVisibility();
});
applyConfidenceVisibility();


// run ocr button - 
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
          row.dataset.confidence = pred.confidence ?? '';
          row.dataset.charConf = JSON.stringify(pred.char_conf || []);
        
          const numberSpan = document.createElement('span');
          numberSpan.className = 'ocr-line-number';
          numberSpan.textContent = i + 1;
        
          const textSpan = document.createElement('span');
          textSpan.className = 'ocr-line-text';
          textSpan.dataset.html = pred.html;
          textSpan.dataset.plain = pred.text;
          textSpan.dataset.original = pred.text;
          renderLineText(textSpan);
        
          // matched words chips
          row.dataset.matchedWords = JSON.stringify(pred.matched_words || []);

          const dictBtn = document.createElement('button');
          dictBtn.type = 'button';
          dictBtn.className = 'ocr-line-dict-btn';
          dictBtn.title = 'Show matched words';
          dictBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>`;
          
          if (!pred.matched_words || pred.matched_words.length === 0) {
            dictBtn.style.display = 'none';
          }
        
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'ocr-line-edit-btn';
          editBtn.title = 'Edit this line';
          editBtn.innerHTML = `
            <svg class="icon-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <svg class="icon-save" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <polyline points="20 6 9 17 4 12"/>
            </svg>`;
        
          row.appendChild(numberSpan);
          row.appendChild(textSpan);
          row.appendChild(dictBtn); 
          row.appendChild(editBtn);
          resultsDiv.appendChild(row);
          applyLineConfidence(row);
        });

        
        document.getElementById('ocr-results-panel').style.display = 'flex';
        layoutWorkspace();
        document.getElementById('ocr-stale-warning').style.display = 'none';
        const intro = document.getElementById('ocr-intro');
        if (intro) intro.style.display = 'none';

        aiOutputs = {};      
        renderAiOutputs();
      }
    })
    .finally(() => {
      document.getElementById('processing-overlay').style.display = 'none';
    });
});

// back button
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


///////////////////////////////// SEGMENTATION: Draw baseline /////////////////////////////////
let isDrawingBaseline = false; // are we in drawign mode?
let drawnBaselinePoints = []; // the points the user has clicked so far

const drawBaselineBtn = document.getElementById('draw-baseline-btn');
const drawBaselineActions = document.getElementById('draw-baseline-actions');
const finishBaselineBtn = document.getElementById('finish-baseline-btn');
const cancelBaselineBtn = document.getElementById('cancel-baseline-btn');
const lineOverlay = document.getElementById('line-overlay');

if (drawBaselineBtn) { // only draw if the button exists ont his page 

  // like before -- converts mouse screen position to image coordinates
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



// keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!isDrawingBaseline) return;
  if (e.key === 'Backspace' || e.key === 'Delete') { // removing last point
    e.preventDefault();
    drawnBaselinePoints.pop();
    renderDrawingPreview();
  }

  // finish drawing 
  if (e.key === 'Enter') {
    e.preventDefault();
    finishBaselineBtn.click();
  }
});

// start drwsing shwos crosshair cursar making the overlay clicable 
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


// clicking to add points 
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
  originalPolygons = {};
  linePaddingValues = {}; 
  selectedIndices = new Set();
  if (paddingTop) {
    paddingTop.value = 0;
    paddingBottom.value = 0;
    paddingLeft.value = 0;
    paddingRight.value = 0;
  }
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
        const newIndex = segmentationLines.length;
        segmentationLines.push({ polygon: data.polygon, baseline: data.baseline, source: 'manual' });
        linePaddingValues[newIndex] = { top: 0, bottom: 0, left: 0, right: 0 }; // ← explicit zero
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



// undo button?
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






///////////////////////////////// INFO / MANUAL /////////////////////////////////
const infoModalBackdrop = document.getElementById('info-modal-backdrop');
const infoModalTitle = document.getElementById('info-modal-title');
const infoModalBody = document.getElementById('info-modal-body');

const STEP_INFO = {
  '1': {
    title: 'Some notes',
    body: `
      <p> All three methods are optional. You can apply none, one, or several.<p>

      <ol class="info-steps">
      <li><strong>Gaussian normalization</strong>: It estimates the background texture, and then removes it from the image. It works very well for images which have dark shadows and the text is hard to read. Most recommended.</li>
      <li><strong>Sauvola binarization</strong>: It converts the image to black and white, and is effective for areas with dark shadows and stains, but can damage faded text areas, and reduce model accuracy. Please use carefully.</li>
      <li><strong>CLAHE lighting correction</strong>: It balances lighting across the page by balancing contrast (locally), and can thereby help improve the text readability. It is useful when one part of the page is very light, and the other part is very dark.</li>
</ol>
    <div class="info-note">
      <strong>Note:</strong> The default values are a good starting point. One way to check if a method is helping is to zoom in and see if the text pixels look smooth (smoother edges generally mean better model performance). 
    </div>
      `
  },
  '2': {
    title: 'Some notes',
    body: `
    <ol class="info-steps">
      <li>Click  <strong>Run segmentation</strong> which will automatically detect individual text lines</li>
      <li>Please note that segmentations usually requires some editing</li>
      <li>There are three types edit options available:
      <ol class="info-substeps">

      <li> <strong>Delete:</strong> click a polygon to select it, then click the delete button that appears</li>
      <li> <strong>Reshape:</strong> click a polygon to select it, then drag its corner handles to adjust</li>
      <li> <strong>Draw new:</strong> click the line icon in the preview bar, then click along the text line to place points on the image, finally press Enter to save. Additionally, the delete key can be also used to undo a drawn baseline point.</li>
</ol>
</li>
      </ol>
    <div class="info-note">
      <strong>Note 1:</strong> When a polygon is selected, padding slides appear on the right (top/down/left/right) which allow to shift all coordinates on one side at once.
      <br>
      <strong>Note 2:</strong> <strong>Ctrl + A</strong> selects all polygons at once, and can be deleted in once click (if required). 

    </div>
    `
  },
  '3': {
    title: 'Some notes',
    body: `
        <ol class="info-steps">
      <li>Please click on <strong>Run OCR</strong> to run the trained HTR/OCR model</li>
      <li> It will give the image transcriptions line by line</li>
      <li> Clicking on any polygon on the image highlights its corresponding transcription in the right pannel</li>
      <li> The model confidence for each predicted token can be viewed using the checkbox</li>
      <li> To edit the predictions, click on pen icon; and to see if any words matched with the lexicon click on dictionary icon</li>
      <li> Download the models predicted transcription (with edits, if any) using the download transcription button</li>
      </ol>

      <div class="info-note">
      <strong>Note:</strong> Please note that the probabilities are just an indication of how confident a model was while predicting a specific character and does not indicate a correct or incorrect prediction.
      

      </div>

    `
  },
'crop': {
  title: 'Some notes',
  body: `
    <ol class="info-steps">
      <li>If you like, you can crop the document using the cropping icon tool.</li>
      <li>Once cropped, click the green tickmark to save, or the red X to discard.</li>
      <li>You can also continue without cropping.</li>
      <li>Click <strong>Next</strong> to continue.</li>
    </ol>
    <div class="info-note">
      <strong>Note:</strong> the segmentation model usually works better when the page boundaries are still visible, so try not to crop aggressively.
    </div>
  `
},
};

document.querySelectorAll('.info-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't toggle the accordion section
    const step = btn.dataset.infoStep;
    const info = STEP_INFO[step];
    if (!info) return;
    infoModalTitle.textContent = info.title;
    infoModalBody.innerHTML = info.body;
    infoModalBackdrop.style.display = 'flex';
  });
});

infoModalBackdrop.addEventListener('click', (e) => {
  if (e.target.id === 'info-modal-backdrop' || e.target.id === 'info-modal-close') {
    infoModalBackdrop.style.display = 'none';
  }
});


///////////////////////////////// OCR EDIT MODE /////////////////////////////////
// this is to store which line we are currently editing etc
let isEditingOcr = false;
let editingLineIndex = null;
const nepaliKeyboard = document.getElementById('nepali-keyboard');
let activeEditableEl = null;

// for dictionary matched words! 
const wordsPopup = document.createElement('div');
wordsPopup.id = 'matched-words-popup';
wordsPopup.className = 'matched-words-popup';
wordsPopup.style.display = 'none';
document.body.appendChild(wordsPopup)

// 
function saveOcrEdits() {
  const rows = document.querySelectorAll('.ocr-line-result');
  const updatedPredictions = [];

  rows.forEach((row) => {
    const lineIndex = parseInt(row.dataset.lineIndex); // for each row we want to get its line number and read whatever text is currently visible
    const textSpan = row.querySelector('.ocr-line-text');
    const newText = (textSpan.dataset.plain || '').trim();
    //  note: we have data-html (colored confidence versions) and data-plain (the  plain text version)
    // so this part makes sure that when the user edits the text, only the visible content changes
    // textSpan.dataset.plain = newText;
    updatedPredictions.push({ line_index: lineIndex, text: newText });
  });

  // re-apply confidence visibility logic (for checbox) because after edit, the text becomes raw text and loses it
  // so if the checkbox is ticked - we show the coloured data-html and if not, we show the updated data-plain
  applyConfidenceVisibility();

  // send all updates to Django in one post request, and django will save it ot the databas e so if the user refreshes the page, the edits are preserved
  fetch(`/edit-ocr/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ predictions: updatedPredictions }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) return;
      console.log('OCR edits saved');
      if (data.changed) {
        Object.values(aiOutputs).forEach((out) => {
          if (out.summary) out.summary_stale = true;
          if (out.explanation) out.explanation_stale = true;
        });
        renderAiOutputs();
      }
    });
}


//// nepali keyboard
function positionKeyboardBelowLine(row) {
  // get the right panels position
  const rightCol = document.querySelector('.right-col');
  const rightColRect = rightCol.getBoundingClientRect();
  const kb = nepaliKeyboard;
  
  // reset it with these new values
  kb.style.top = 'auto';
  kb.style.bottom = '16px';
  kb.style.left = 'auto';
  kb.style.right = (window.innerWidth - rightColRect.left + 8) + 'px'; // positioning it to the left of the panel 

  // if keyboard is taller than available space, we cap the hight and scroll it so its jis just a safety check
  const maxHeight = window.innerHeight - 32;
  kb.style.maxHeight = maxHeight + 'px';
  kb.style.overflowY = kb.scrollHeight > maxHeight ? 'auto' : 'visible';
}



///
function startEditingLine(lineIndex) { 
  isEditingOcr = true; // editing mode indicator state 
  editingLineIndex = lineIndex; // and this editing is in line X

  // highlights the polygon of the selected line
  selectedIndices = new Set([lineIndex]); 
  renderOverlay();

  // this resets everythign residual befor editiing this line 
  // eg: cleans and makes sure the editing on all lines is turned off, removes all highlights, removes any leftover save buttons etc
  document.querySelectorAll('.ocr-line-text').forEach((el) => { el.contentEditable = false; });
  document.querySelectorAll('.ocr-line-result').forEach((r) => {
    r.classList.remove('editing-row', 'selected');
  });
  document.querySelectorAll('.ocr-line-edit-btn').forEach((btn) => {
    btn.classList.remove('is-saving');
  });
  document.querySelectorAll('.ocr-save-btn').forEach(b => b.remove());

  // activates thsi specific line 
  const row = document.querySelector(`.ocr-line-result[data-line-index="${lineIndex}"]`);
  if (!row) return;

  row.classList.add('editing-row', 'selected');
  const textSpan = row.querySelector('.ocr-line-text');
  textSpan.textContent = textSpan.dataset.plain;
  textSpan.contentEditable = true;
  applyLineConfidence(row);
  textSpan.focus();

  // swapping pencil icon to checmark
  const editBtn = row.querySelector('.ocr-line-edit-btn');
  editBtn.classList.add('is-saving');

  // the green save button after the text span
  // svg is the green icon
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'ocr-save-btn';
  saveBtn.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // ??
    stopEditingLine(); // when green icon is clicked, then it triggers stopEditingLine
  });
  row.appendChild(saveBtn);

  // lock other rows when one is beign edited
  document.getElementById('ocr-results').classList.add('locked-editing');

  // show the nepali keyboard also on eiditng nad position it 
  nepaliKeyboard.style.display = 'flex';
  positionKeyboardBelowLine(row);
}



// the exact reverse kind of of starteditiing line
// undoes everything
function stopEditingLine() {
  // store what was typed in the line being edited (must run BEFORE editing-row is removed)
  const editedSpan = document.querySelector('.ocr-line-result.editing-row .ocr-line-text');
  if (editedSpan) editedSpan.dataset.plain = editedSpan.innerText.trim();

  isEditingOcr = false; // flag to say we are not editing anything
  editingLineIndex = null;


  // undo ll vidual changes
  document.querySelectorAll('.ocr-line-text').forEach((el) => { 
    el.contentEditable = false;
  });
  document.querySelectorAll('.ocr-line-result').forEach((r) => { r.classList.remove('editing-row'); }); // turn of typing 
  document.querySelectorAll('.ocr-line-edit-btn').forEach((btn) => { btn.classList.remove('is-saving'); }); // remove orange border highlights from each row
  document.querySelectorAll('.ocr-save-btn').forEach(b => b.remove()); // swap checkmark icon to the pencil icon

  // unlock all rows (oppositive in line eiditng active which locks it)
  document.getElementById('ocr-results').classList.remove('locked-editing');
  nepaliKeyboard.style.display = 'none';

  // nepaliKeyboard.style.top = 'auto';
  // nepaliKeyboard.style.left = 'auto';
  // nepaliKeyboard.style.bottom = '16px';
  // nepaliKeyboard.style.right = '';

  activeEditableEl = null; 
  saveOcrEdits(); // the final edit state
}
///////////////////////////////////////////////////////

///////// dictionary popup ///////
function highlightWordsInLine(row, words) {
  const textSpan = row.querySelector('.ocr-line-text');
  if (!textSpan) return;
  const plain = textSpan.textContent;
  textSpan.dataset.beforeHighlight = plain;

  // handle both [{word, lemma}] and ['word'] formats ??
  const wordStrings = words.map(w => typeof w === 'string' ? w : w.word);
  const escaped = wordStrings.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  const highlighted = plain.replace(pattern, `<mark class="dict-highlight">$1</mark>`);
  textSpan.innerHTML = highlighted;
}


// this function restores the line back -- after the dict popups
function restoreLineText(row) {
  const textSpan = row.querySelector('.ocr-line-text');
  if (!textSpan || !textSpan.dataset.beforeHighlight) return;
  delete textSpan.dataset.beforeHighlight;
  renderLineText(textSpan);
}


// just a click listener
document.getElementById('ocr-results').addEventListener('click', (e) => {
  // 1. was the dictionary button that was clicked?
  const dictBtn = e.target.closest('.ocr-line-dict-btn');
  if (dictBtn) {
    e.stopPropagation();
    const row = dictBtn.closest('.ocr-line-result');
    const words = JSON.parse(row.dataset.matchedWords || '[]');
    if (words.length === 0) return;

    if (wordsPopup.dataset.activeRow === row.dataset.lineIndex && wordsPopup.style.display !== 'none') {
      wordsPopup.style.display = 'none';
      restoreLineText(row);
      return;
    }

    document.querySelectorAll('.ocr-line-result').forEach(r => restoreLineText(r));
    wordsPopup.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'matched-words-label';
    label.textContent = 'Matched words (word → lemma):';
    wordsPopup.appendChild(label);
    words.forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'matched-word-chip';
      const word = typeof item === 'string' ? item : item.word;
      const lemma = typeof item === 'object' ? item.lemma : null;
      if (lemma) {
        chip.innerHTML = `${word} <span class="chip-lemma">→ ${lemma}</span>`;
      } else {
        chip.textContent = word;
      }
      wordsPopup.appendChild(chip);
    });

    highlightWordsInLine(row, words);
    const btnRect = dictBtn.getBoundingClientRect();
    wordsPopup.style.display = 'flex';

    const popupWidth = wordsPopup.offsetWidth || 300;
    const popupHeight = wordsPopup.offsetHeight || 100;

    let left = btnRect.left;
    if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;
    if (left < 8) left = 8;

    let top = btnRect.top - popupHeight - 8;
    if (top < 8) top = btnRect.bottom + 8;

    wordsPopup.style.left = left + 'px';
    wordsPopup.style.top = top + 'px';
    wordsPopup.dataset.activeRow = row.dataset.lineIndex;
    return;
  }

  // 2. was it the edit button that was clicked?
  const editBtn = e.target.closest('.ocr-line-edit-btn');
  if (editBtn) {
    e.stopPropagation();
    const row = editBtn.closest('.ocr-line-result');
    const lineIndex = parseInt(row.dataset.lineIndex);
    if (isEditingOcr && editingLineIndex === lineIndex) {
      stopEditingLine();
    } else if (!isEditingOcr) {
      if (textView === 'original') setTextView('edited');
      startEditingLine(lineIndex);
    }
    return;
  }

  // 3. was the row clicked? → highlight polygon + show its explanation
  if (isEditingOcr) return;
  const row = e.target.closest('.ocr-line-result');
  if (!row) return;
  const lineIndex = parseInt(row.dataset.lineIndex);
  hoveredLineIndex = null;
  selectedIndices = new Set([lineIndex]);
  document.querySelectorAll('.ocr-line-result.selected').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');
  renderOverlay();
  focusExplainItem(lineIndex);   // NEW: jump to this line's explanation
});

// when clicked outside, close the dict popup (registered once, outside the handler)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ocr-line-dict-btn') && !e.target.closest('#matched-words-popup')) {
    wordsPopup.style.display = 'none';
    document.querySelectorAll('.ocr-line-result').forEach(r => restoreLineText(r));
  }
});

//////////// keyboard functions ////
// rememebers the text box before we click the keyboard key making typing with the keyboard possible
document.getElementById('ocr-results').addEventListener('focusin', (e) => {
  if (e.target.classList.contains('ocr-line-text')) {
    activeEditableEl = e.target;
  }
});

// keyboard handler
nepaliKeyboard.addEventListener('click', (e) => {
  const btn = e.target.closest('.key'); // check that a key was actually clicked 
  if (!btn || !activeEditableEl) return; // and also if we ahve a text box to type into -- if any one of them is missing, do nothign

  activeEditableEl.focus(); // refocus the text span (because clicked the keyboard took the focus away)

  // check if the key has a special data-key element (only backspace and space have this)
  const key = btn.dataset.key;
  if (key === 'backspace') {
    document.execCommand('delete');
  } else if (key === 'space') {
    document.execCommand('insertText', false, ' ');
  } else {
    document.execCommand('insertText', false, btn.textContent);
  }
});



// Draggable keyboard setup
const keyboard = document.getElementById('nepali-keyboard');
let kbDragging = false, kbStartX, kbStartY, kbOrigLeft, kbOrigTop; // are we dragging it dcurrently?. where did the drag start?  where was the keyboard when the drag started
document.querySelector('.keyboard-drag-handle').addEventListener('mousedown', (e) => {
  kbDragging = true;  
  kbStartX = e.clientX;  // mouse original position to remember
  kbStartY = e.clientY; 

  // read current rendered position regardless of which properties are set
  const rect = keyboard.getBoundingClientRect();
  kbOrigLeft = rect.left; // keyboards original position to remember
  kbOrigTop = rect.top;
  e.preventDefault();  // stopping the highhlgithing text thing when we drag 
});


// move keyboard by the same amount by which the mouse moved
document.addEventListener('mousemove', (e) => {
  if (!kbDragging) return; // only do when we are dragging
  const dx = e.clientX - kbStartX; // how far has the mouse moved horizontally
  const dy = e.clientY - kbStartY; // how far has the mouse moved veritically

  // always drag using top/left
  keyboard.style.bottom = 'auto';
  keyboard.style.right = 'auto';
  keyboard.style.top = (kbOrigTop + dy) + 'px'; // original position + how far it moved
  keyboard.style.left = (kbOrigLeft + dx) + 'px';
});

// when we release the mouse - stop dragging -- stop
document.addEventListener('mouseup', () => { kbDragging = false; });



////////////////////// download ocr button ///////////////////////
// download ocr  - to also be able to download the updates

document.getElementById('download-ocr-btn').addEventListener('click', () => {
  const rows = document.querySelectorAll('.ocr-line-result');
  const lines = [];
  // collect from every OCR line on the screen into an array
  rows.forEach((row) => {
    const textSpan = row.querySelector('.ocr-line-text');
    if (textSpan) {
      lines.push(textSpan.innerText.trim());
    }
  });

  // join th elines all together with a new line 
  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }); // blob is just a file in memory
  const url = URL.createObjectURL(blob); // createObjectURL gives a temporary link so the browser can treat it like a downloadable file
  
  // triggers file downalod and downloads
  const a = document.createElement('a'); 
  a.href = url;
  a.download = `transcription-${currentDocId}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

//////////////////////////////////////////////////////////////
////////////////////// AI panel (summary + line by line, per model) ///////////////////////
const aiSummaryBox = document.getElementById('ai-summary');
const aiSummaryToggle = document.getElementById('ai-summary-toggle');
const aiTabs = document.getElementById('ai-tabs');
const providerToggle = document.getElementById('summary-provider-toggle');
const singleProvider = document.getElementById('summary-provider-single');

const aiSummaryBtn = document.getElementById('ai-summary-btn');
const aiSummaryText = document.getElementById('ai-summary-text');
const aiSummaryNote = document.getElementById('ai-summary-note');
const aiSummaryEmpty = document.getElementById('ai-summary-empty');

const explainBtn = document.getElementById('ai-explain-btn');
const explainList = document.getElementById('ai-explain-list');
const explainNote = document.getElementById('ai-explain-note');
const explainEmpty = document.getElementById('ai-explain-empty');

// saved results per model: { qwen: { summary, explanation: { segments } }, gemini: {...} }
let aiOutputs = {};
try { aiOutputs = JSON.parse(document.getElementById('ai-outputs-data')?.textContent || '{}') || {}; } catch (e) {}

let summaryProvider = singleProvider ? singleProvider.value : 'qwen';
let summaryBusy = false;
let explainBusy = false;

function providerLabel(id) {
  const btn = providerToggle && providerToggle.querySelector(`.ba-btn[data-provider="${id}"]`);
  return btn ? btn.textContent.trim() : id.charAt(0).toUpperCase() + id.slice(1);
}

// ---- collapse ----
function setSummaryCollapsed(collapsed) {
  if (!aiSummaryBox) return;
  aiSummaryBox.classList.toggle('collapsed', collapsed);
  if (aiSummaryToggle) {
    aiSummaryToggle.title = collapsed ? 'Show' : 'Close';
    aiSummaryToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  const drawerBtn = document.getElementById('ai-drawer-btn');
  if (drawerBtn) {
    drawerBtn.classList.toggle('active', !collapsed);
    drawerBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  try { localStorage.setItem('summaryCollapsed', collapsed ? '1' : '0'); } catch (e) {}
  layoutWorkspace();
}

// ---- tabs ----
function setAiTab(tab) {
  if (!aiSummaryBox || !aiTabs) return;
  aiSummaryBox.dataset.tab = tab;
  aiTabs.querySelectorAll('.ai-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  try { localStorage.setItem('aiTab', tab); } catch (e) {}
}

// ---- line by line ----
function highlightLines(indices) {
  selectedIndices = new Set(indices);
  document.querySelectorAll('.ocr-line-result').forEach((r) => {
    r.classList.toggle('selected', indices.includes(parseInt(r.dataset.lineIndex)));
  });
  const first = document.querySelector(`.ocr-line-result[data-line-index="${indices[0]}"]`);
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  renderOverlay();
}



function renderExplanation(segments) {
  if (!explainList) return;
  explainList.innerHTML = '';
  segments.forEach((seg) => {
    const item = document.createElement('div');
    item.className = 'ai-explain-item';

    const badge = document.createElement('span');
    badge.className = 'ai-explain-lines';
    const a = seg.lines[0], b = seg.lines[seg.lines.length - 1];
    badge.textContent = a === b ? `L${a}` : `L${a}–${b}`;

    const body = document.createElement('div');
    body.className = 'ai-explain-body';
      [['translation', 'ai-explain-translation'], ['romanized', 'ai-explain-roman'], ['note', 'ai-explain-note']]
      .forEach(([key, cls]) => {
        if (!seg[key]) return;
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = seg[key];
        body.appendChild(el);
      });

    item.append(badge, body);
    item._lines = seg.line_indices || [];

    item.addEventListener('click', () => {
      explainList.querySelectorAll('.ai-explain-item.active').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      highlightLines(item._lines);
    });

    // hover an explanation → light up its rows
    item.addEventListener('mouseenter', () => {
      item._lines.forEach((li) => {
        document.querySelector(`.ocr-line-result[data-line-index="${li}"]`)?.classList.add('hovered');
      });
    });
    item.addEventListener('mouseleave', () => {
      document.querySelectorAll('.ocr-line-result.hovered').forEach((r) => r.classList.remove('hovered'));
    });
    explainList.appendChild(item);
  });
  explainList.hidden = segments.length === 0;
}

// a row or polygon was clicked → show its explanation in the drawer
function focusExplainItem(lineIndex) {
  if (!explainList || !aiSummaryBox || aiSummaryBox.classList.contains('collapsed')) return;
  explainList.querySelectorAll('.ai-explain-item.active').forEach((x) => x.classList.remove('active'));
  const item = [...explainList.children].find((el) => (el._lines || []).includes(lineIndex));
  if (!item) return;
  if (aiSummaryBox.dataset.tab !== 'explain') setAiTab('explain');
  item.classList.add('active');
  item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---- show the selected model's results (or an empty state) ----
function renderAiOutputs() {
  const out = aiOutputs[summaryProvider] || {};
  const label = providerLabel(summaryProvider);

  const summary = out.summary || '';
  if (aiSummaryText) { aiSummaryText.textContent = summary; aiSummaryText.hidden = !summary; }
  if (aiSummaryNote) {
    aiSummaryNote.hidden = !summary;
    aiSummaryNote.textContent = out.summary_stale
      ? `⚠ The transcription was edited after this summary was generated. Click Regenerate to update it.`
      : `Generated by ${label} from the transcription. It may contain mistakes.`;
    aiSummaryNote.classList.toggle('is-stale', !!out.summary_stale);   // NEW
  }
  if (aiSummaryEmpty) aiSummaryEmpty.textContent = `No summary from ${label} yet. Click Summarize to create one.`;
  if (aiSummaryBtn && !summaryBusy) aiSummaryBtn.textContent = summary ? 'Regenerate' : 'Summarize';

  const segments = (out.explanation && out.explanation.segments) || [];
  renderExplanation(segments);
  if (explainNote) {
    explainNote.hidden = segments.length === 0;
    explainNote.textContent = out.explanation_stale
      ? `⚠ The transcription was edited after this was generated. Click Regenerate to update it.`
      : `Generated by ${label} from the transcription. Check it against the original.`;
    explainNote.classList.toggle('is-stale', !!out.explanation_stale);   // NEW
  }
  if (explainEmpty) explainEmpty.textContent = `No line-by-line reading from ${label} yet. Click Explain to create one.`;
  if (explainBtn && !explainBusy) explainBtn.textContent = segments.length ? 'Regenerate' : 'Explain';
}

function setSummaryProvider(id) {
  if (providerToggle && !providerToggle.querySelector(`.ba-btn[data-provider="${id}"]`)) return;
  summaryProvider = id;
  if (providerToggle) {
    providerToggle.querySelectorAll('.ba-btn').forEach((b) => b.classList.toggle('active', b.dataset.provider === id));
  }
  try { localStorage.setItem('summaryProvider', id); } catch (e) {}
  renderAiOutputs();
}

// ---- generate (summary or explanation) for the selected model ----
function runAi(kind) {
  const isSummary = kind === 'summary';
  const btn = isSummary ? aiSummaryBtn : explainBtn;
  const provider = summaryProvider;   // remembered, in case the user switches while waiting

  if (isSummary) summaryBusy = true; else explainBusy = true;
  btn.disabled = true;
  btn.textContent = isSummary ? 'Summarizing…' : 'Explaining…';

  const body = new FormData();
  body.append('provider', provider);

  fetch(`/${isSummary ? 'summarize' : 'explain'}/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
    body,
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert(data.error || 'The model returned an empty answer.');
        return;
      }
      const out = aiOutputs[provider] || (aiOutputs[provider] = {});
      if (isSummary) { out.summary = data.summary; out.summary_stale = false; }
      else { out.explanation = { segments: data.segments || [] }; out.explanation_stale = false; }
      setSummaryCollapsed(false);
    })
    .catch(() => alert('Could not reach the server.'))
    .finally(() => {
      if (isSummary) summaryBusy = false; else explainBusy = false;
      btn.disabled = false;
      renderAiOutputs();
    });
}

// ---- init ----
setSummaryCollapsed(true);  

aiSummaryToggle?.addEventListener('click', () => setSummaryCollapsed(true));
document.getElementById('ai-drawer-btn')?.addEventListener('click', () => {
  setSummaryCollapsed(!aiSummaryBox.classList.contains('collapsed'));
});

if (aiTabs) {
  try { setAiTab(localStorage.getItem('aiTab') || 'summary'); } catch (e) {}
  aiTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-tab');
    if (!btn) return;
    setAiTab(btn.dataset.tab);
    setSummaryCollapsed(false);
  });
}

if (providerToggle) {
  let saved = null;
  try { saved = localStorage.getItem('summaryProvider'); } catch (e) {}
  const first = providerToggle.querySelector('.ba-btn');
  if (!(saved && providerToggle.querySelector(`.ba-btn[data-provider="${saved}"]`))) {
    saved = first ? first.dataset.provider : summaryProvider;
  }
  providerToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.ba-btn');
    if (btn) setSummaryProvider(btn.dataset.provider);
  });
  setSummaryProvider(saved);
} else {
  renderAiOutputs();
}

aiSummaryBtn?.addEventListener('click', () => runAi('summary'));
explainBtn?.addEventListener('click', () => runAi('explain'));

// ---- resizable AI drawer (drag its left edge) ----
const aiResizeHandle = document.getElementById('ai-resize-handle');
const AI_MIN_W = 260, AI_MAX_W = 720, AI_DEFAULT_W = 340;

if (aiResizeHandle && aiSummaryBox) {
  aiResizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiDrawerWidth;
    aiResizeHandle.setPointerCapture(e.pointerId);
    aiResizeHandle.classList.add('dragging');
    workspace.classList.add('resizing');
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => {   // drag left = wider
      aiDrawerWidth = Math.round(Math.min(Math.max(startW + (startX - ev.clientX), AI_MIN_W), AI_MAX_W));
      layoutWorkspace();
    };
    const onUp = () => {
      aiResizeHandle.removeEventListener('pointermove', onMove);
      aiResizeHandle.removeEventListener('pointerup', onUp);
      aiResizeHandle.classList.remove('dragging');
      workspace.classList.remove('resizing');
      document.body.style.cursor = '';
      try { localStorage.setItem('aiDrawerWidth', aiDrawerWidth); } catch (e) {}
    };
    aiResizeHandle.addEventListener('pointermove', onMove);
    aiResizeHandle.addEventListener('pointerup', onUp);
  });

  aiResizeHandle.addEventListener('dblclick', () => {   // double-click = default width
    aiDrawerWidth = AI_DEFAULT_W;
    layoutWorkspace();
    try { localStorage.removeItem('aiDrawerWidth'); } catch (e) {}
  });
}