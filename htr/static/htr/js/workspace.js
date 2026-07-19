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



// Resizable sidebars
let isDragging = false;
let isDraggingRight = false;
let currentSidebarWidth = 280;
let currentRightWidth = 550;

// when we press on the left handle 
handle.addEventListener('mousedown', () => {
  isDragging = true;
  handle.classList.add('dragging');
});

// when we press on the right handle 
handleRight.addEventListener('mousedown', () => {
  isDraggingRight = true;
  handleRight.classList.add('dragging');
});


// when the mouse is moving
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


// when the mouse is released - stop dragging -- then cursor goes back to normal (css off)
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
  zoomLevel = 1; // back to normal 
  panX = 0; // reset position
  panY = 0;
  applyZoom();
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

// run segemnetation model button
document.getElementById('run-segmentation-model-btn').addEventListener('click', () => {
  if (segmentationLines.length > 0) {
    const confirmed = confirm('This will replace your existing segmentation lines. Continue?');
    if (!confirmed) return;
  }

  document.getElementById('processing-overlay').style.display = 'flex';
  // send to django to un kraken
  fetch(`/segment/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
  })
    .then((res) => res.json())
    .then((data) => { // django sends the detected lines back
      if (data.success) {
        drawLineOverlay(data.lines, data.page_width, data.page_height);  // draws them on screen 
        autoSaveSegmentation(); // saves then 
        document.getElementById('advance-to-ocr-btn').disabled = false; // enables the next step button
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



function renderOverlay() {
  
  const svg = document.getElementById('line-overlay');
  svg.setAttribute('viewBox', `0 0 ${overlayPageWidth} ${overlayPageHeight}`);
  svg.innerHTML = '';
  svg.style.display = (segmentationLines.length || isDrawingBaseline) ? 'block' : 'none';
  const scale = getOverlayScale();

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
      polygon.setAttribute('stroke-width', (isHovered ? 0 : (isSelected ? 4 : 0)) * scale);
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
      baseline.setAttribute('stroke-width', 4 * scale);
      baseline.setAttribute('stroke-solid', `${8 * scale} ${3 * scale}`);
      baseline.style.pointerEvents = 'none';
      svg.appendChild(baseline);
    }
  });


  // drawing dragebale handles in selected polygon  -- when the corner is slee ted the startVertexDrag is started which moves that corner
  if (!isReadOnlyOverlay && !isAdjustingPadding) {
    selectedIndices.forEach((selIndex) => {
      if (!segmentationLines[selIndex]) return;
    
      if (showPolygons) {
      segmentationLines[selIndex].polygon.forEach((point, vIndex) => {
        const size = 22 * scale;
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
  
        const width = 24 * scale;
        const height = 24 * scale;
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

// shows delete button and padding controls when somehting is selected 
document.getElementById('delete-line-btn').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';
document.getElementById('padding-controls').style.display = (!isReadOnlyOverlay && selectedIndices.size > 0) ? 'flex' : 'none';

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
  const counterScale = 1 / Math.sqrt(Math.max(zoomLevel, 0.5)); // scales the handles smaller when zoomed
  document.querySelectorAll('.overlay-handle').forEach((el) => {
    el.style.transform = `scale(${counterScale})`;
  });
}

// zooming with the overlays
function applyZoom() {
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
}

function setupOcrHoverHighlight() {
  const resultsDiv = document.getElementById('ocr-results');
  if (!resultsDiv) return;

  // hover over result -- highlight polygon
  resultsDiv.addEventListener('mouseover', (e) => {
    if (isEditingOcr) return;   
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    hoveredLineIndex = parseInt(row.dataset.lineIndex);
    renderOverlay();
  });

  // mouse leaves results -- unhighlight polygon
  resultsDiv.addEventListener('mouseout', (e) => {
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    hoveredLineIndex = null;
    renderOverlay();
  });

  // click result row maching polygon
  resultsDiv.addEventListener('click', (e) => {
    if (e.target.closest('.ocr-line-edit-btn')) return;  
    if (isEditingOcr) return; 
    const row = e.target.closest('.ocr-line-result');
    if (!row) return;
    const lineIndex = parseInt(row.dataset.lineIndex);
    hoveredLineIndex = null;
    selectedIndices = new Set([lineIndex]);
  
    // highlight the clicked row
    resultsDiv.querySelectorAll('.ocr-line-result.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
  
    renderOverlay();
  });
}

setupOcrHoverHighlight();




//////////////////////////////////// OCR Confidence ////////////////////////////////////
const confidenceCheckbox = document.getElementById('show-confidence-checkbox');

// confidence checkbox
function applyConfidenceVisibility() {
  const showConfidence = confidenceCheckbox.checked;
  document.querySelectorAll('.ocr-line-text').forEach((el) => {
    el.innerHTML = showConfidence ? el.dataset.html : el.dataset.plain;
  });
}

confidenceCheckbox.addEventListener('change', applyConfidenceVisibility);
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
        
          const numberSpan = document.createElement('span');
          numberSpan.className = 'ocr-line-number';
          numberSpan.textContent = i + 1;
        
          const textSpan = document.createElement('span');
          textSpan.className = 'ocr-line-text';
          textSpan.dataset.html = pred.html;
          textSpan.dataset.plain = pred.text;
          textSpan.innerHTML = confidenceCheckbox.checked ? pred.html : pred.text;
        
          // matched words chips
          const wordsDiv = document.createElement('div');
          wordsDiv.className = 'matched-words';
          
          if (pred.matched_words && pred.matched_words.length > 0) {
            pred.matched_words.forEach(word => {
              const chip = document.createElement('span');
              chip.className = 'matched-word-chip';
              chip.textContent = word;
              wordsDiv.appendChild(chip);
            });
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
          row.appendChild(wordsDiv);  // ← add words below text
          row.appendChild(editBtn);
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
  linePaddingValues = {}; // ← add this
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
        segmentationLines.push({ polygon: data.polygon, baseline: data.baseline });
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
        <ol class="info-steps">
      <p> You can choose neither, one or more options as preferred.<p>
      <li><strong>Gaussian normalization</strong>: This method is quite good in my experience and I would recommend it. It estimates the background texture, and then removes it from the image. It works very well for images which have dark shadows and the text is hard to read</li>

      <li><strong>Sauvola binarization</strong>: This method is also good, but can be very harsh for the scripts. I think it works well too for dark shaded regions, but can spoil the faded text areas, and the model performance reduces. Be careful when using.</li>
      <li><strong>CLAHE lighting correction</strong>: It is useful as a method when there is uneven ligting in the document. For example, if one half of the page is very light, and the other half is very dark. It balances the contrast (locally), and can help improve the text readability.</li>
</ol>
    <div class="info-note">
      <strong>Note:</strong> The default ranges set are what worked the best when I tried generally, but you can change it as you like. Also a nice way to check it is by zooming in the image well, and seeing if the text pixels are smooth, or if it ends abruptly. If it is smooth, it is better for the model.
    </div>
      `
  },
  '2': {
    title: 'Some notes',
    body: `
    <ol class="info-steps">
      <li>Click  <strong>Run segmentation</strong> which will automatically detect individual text lines</li>
      <li>Please note that it is very rare that the segmentations are perfect (we need to improve the model as we go)</li>
      <li>Since there are errors, you can choose to edit it (like in eScriptorium)</li>
      <li>There are three edits you can make:
      <ol class="info-substeps">

      <li> Click on the polygon (in the image) →you can delete it</li>

      <li> Click on the polygon (in the image) →you can move around the coordinates to improve the predicted coordinates</li>
      <li> If there is no polygon for a specific line, or you would like to redraw one →there is a small icon with a line and two dots in the preview bar → click on it → then click on the begining of the line you want to segment →  a green dot and line will appear → then click on the end of the line → then press ENTER to save → the polygon will appear </li>
</ol>
</li>
      </ol>
    <div class="info-note">
      <strong>Note 1:</strong> There is also a box with top/down/left/right rows which is active when you click on a polygon. Since it can be tedious to drag each polygon coordinate one by one, this option lets you drag all coordinates in one side of the polygon (eg all coordinates at the top) together. It is just a faster way and can help sometimes. 
      <strong>Note 2:</strong> You can press control + A to select all polygons and delete. 

    </div>
    `
  },
  '3': {
    title: 'Some notes',
    body: `
        <ol class="info-steps">
      <li>Please click on <strong>Run OCR</strong> to run the trained HTR/OCR model.</li>
      <li> It will give the image transcriptions line by line. </li>
      <li>You can also click on any polygon on the image to check the model's prediction for that specific polygon/line.</li>
      <li> Along with, you should also see the model confidence predicted. </li>
            </ol>

      <div class="info-note">
      <strong>Note:</strong> Please note that the probabilities are just an indication of how confident a model was while predicting a specific character and does not indicate a correct / incorrect prediction. It can be both helpful and not helpful to find the errors.
      
      <strong>Note:</strong> To add: dictionary / lexicon matching of the words.

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


// ///////////////////////////////// OCR EDIT MODE /////////////////////////////////
// const editOcrBtn = document.getElementById('edit-ocr-btn');
// let isEditingOcr = false;

// function saveOcrEdits() {
//   const rows = document.querySelectorAll('.ocr-line-result');
//   const updatedPredictions = [];

//   rows.forEach((row) => {
//     const lineIndex = parseInt(row.dataset.lineIndex);
//     const textSpan = row.querySelector('.ocr-line-text');
//     const newText = textSpan.innerText.trim();
//     updatedPredictions.push({ line_index: lineIndex, text: newText });
//   });

//   fetch(`/edit-ocr/${currentDocId}/`, {
//     method: 'POST',
//     headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
//     body: JSON.stringify({ predictions: updatedPredictions }),
//   })
//     .then((res) => res.json())
//     .then((data) => {
//       if (data.success) {
//         console.log('OCR edits saved');
//       }
//     });
// }

// const nepaliKeyboard = document.getElementById('nepali-keyboard');
// let activeEditableEl = null;

// // SINGLE listener now — handles toggle + keyboard + save
// editOcrBtn.addEventListener('click', () => {
//   isEditingOcr = !isEditingOcr;

//   document.querySelectorAll('.ocr-line-text').forEach((el) => {
//     el.contentEditable = isEditingOcr;
//   });

//   document.querySelectorAll('.ocr-line-result').forEach((row) => {
//     row.classList.toggle('editing-row', isEditingOcr);   // ← toggle on the row
//   });

//   nepaliKeyboard.style.display = isEditingOcr ? 'flex' : 'none';
//   editOcrBtn.textContent = isEditingOcr ? 'Save' : 'Edit';

//   if (!isEditingOcr) {
//     saveOcrEdits();
//     activeEditableEl = null;
//   }
// });


// // track which line is currently focused for typing
// document.getElementById('ocr-results').addEventListener('focusin', (e) => {
//   if (e.target.classList.contains('ocr-line-text')) {
//     activeEditableEl = e.target;
//   }
// });

// // keyboard button clicks insert at cursor
// nepaliKeyboard.addEventListener('click', (e) => {
//   const btn = e.target.closest('.key');
//   if (!btn || !activeEditableEl) return;

//   activeEditableEl.focus();
//   const key = btn.dataset.key;

//   if (key === 'backspace') {
//     document.execCommand('delete');
//   } else if (key === 'space') {
//     document.execCommand('insertText', false, ' ');
//   } else {
//     document.execCommand('insertText', false, btn.textContent);
//   }
// });

///////////////////////////////// OCR EDIT MODE /////////////////////////////////
let isEditingOcr = false;
let editingLineIndex = null;
const nepaliKeyboard = document.getElementById('nepali-keyboard');
let activeEditableEl = null;

function saveOcrEdits() {
  const rows = document.querySelectorAll('.ocr-line-result');
  const updatedPredictions = [];

  rows.forEach((row) => {
    const lineIndex = parseInt(row.dataset.lineIndex);
    const textSpan = row.querySelector('.ocr-line-text');
    const newText = textSpan.innerText.trim();
    
    // only update plain text, leave data-html (confidence) intact
    textSpan.dataset.plain = newText;
    
    updatedPredictions.push({ line_index: lineIndex, text: newText });
  });

  // re-apply confidence visibility based on current checkbox state
  applyConfidenceVisibility();

  fetch(`/edit-ocr/${currentDocId}/`, {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ predictions: updatedPredictions }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) console.log('OCR edits saved');
    });
}


function startEditingLine(lineIndex) {
  isEditingOcr = true;
  editingLineIndex = lineIndex;

  selectedIndices = new Set([lineIndex]);
  renderOverlay();

  document.querySelectorAll('.ocr-line-text').forEach((el) => { el.contentEditable = false; });
  document.querySelectorAll('.ocr-line-result').forEach((r) => {
    r.classList.remove('editing-row', 'selected');
  });
  document.querySelectorAll('.ocr-line-edit-btn').forEach((btn) => {
    btn.classList.remove('is-saving');
  });
  // remove any leftover save buttons
  document.querySelectorAll('.ocr-save-btn').forEach(b => b.remove());

  const row = document.querySelector(`.ocr-line-result[data-line-index="${lineIndex}"]`);
  if (!row) return;

  row.classList.add('editing-row', 'selected');
  const textSpan = row.querySelector('.ocr-line-text');
  textSpan.contentEditable = true;
  textSpan.focus();

  const editBtn = row.querySelector('.ocr-line-edit-btn');
  editBtn.classList.add('is-saving');

  // inject save button after the text span
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'ocr-save-btn';
  saveBtn.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopEditingLine();
  });
  row.appendChild(saveBtn);

  document.getElementById('ocr-results').classList.add('locked-editing');

  nepaliKeyboard.style.display = 'flex';
  positionKeyboardBelowLine(row);
}

function positionKeyboardBelowLine(row) {
  const rightCol = document.querySelector('.right-col');
  const rightColRect = rightCol.getBoundingClientRect();
  const kb = nepaliKeyboard;
  
  // reset first so we can measure true height
  kb.style.top = 'auto';
  kb.style.bottom = '16px';
  kb.style.left = 'auto';
  kb.style.right = (window.innerWidth - rightColRect.left + 8) + 'px';

  // if keyboard is taller than available space, cap it and scroll
  const maxHeight = window.innerHeight - 32;
  kb.style.maxHeight = maxHeight + 'px';
  kb.style.overflowY = kb.scrollHeight > maxHeight ? 'auto' : 'visible';
}



function stopEditingLine() {
  isEditingOcr = false;
  editingLineIndex = null;

  document.querySelectorAll('.ocr-line-text').forEach((el) => { 
    el.contentEditable = false;
  });
  document.querySelectorAll('.ocr-line-result').forEach((r) => { r.classList.remove('editing-row'); });
  document.querySelectorAll('.ocr-line-edit-btn').forEach((btn) => { btn.classList.remove('is-saving'); });
  document.querySelectorAll('.ocr-save-btn').forEach(b => b.remove());

  document.getElementById('ocr-results').classList.remove('locked-editing');
  nepaliKeyboard.style.display = 'none';

  nepaliKeyboard.style.top = 'auto';
  nepaliKeyboard.style.left = 'auto';
  nepaliKeyboard.style.bottom = '16px';
  nepaliKeyboard.style.right = '';

  activeEditableEl = null;

  saveOcrEdits(); // this now calls applyConfidenceVisibility() at the end
}




document.getElementById('ocr-results').addEventListener('click', (e) => {
  const editBtn = e.target.closest('.ocr-line-edit-btn');
  if (!editBtn) return;
  e.stopPropagation();

  const row = editBtn.closest('.ocr-line-result');
  const lineIndex = parseInt(row.dataset.lineIndex);

  if (isEditingOcr && editingLineIndex === lineIndex) {
    stopEditingLine();       // clicking the checkmark on the active line → save
  } else if (!isEditingOcr) {
    startEditingLine(lineIndex);   // clicking pencil on a line → start editing
  }
});

document.getElementById('ocr-results').addEventListener('focusin', (e) => {
  if (e.target.classList.contains('ocr-line-text')) {
    activeEditableEl = e.target;
  }
});

nepaliKeyboard.addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn || !activeEditableEl) return;

  activeEditableEl.focus();
  const key = btn.dataset.key;

  if (key === 'backspace') {
    document.execCommand('delete');
  } else if (key === 'space') {
    document.execCommand('insertText', false, ' ');
  } else {
    document.execCommand('insertText', false, btn.textContent);
  }
});


// Draggable keyboard
const keyboard = document.getElementById('nepali-keyboard');
let kbDragging = false, kbStartX, kbStartY, kbOrigLeft, kbOrigTop;


document.querySelector('.keyboard-drag-handle').addEventListener('mousedown', (e) => {
  kbDragging = true;
  kbStartX = e.clientX;
  kbStartY = e.clientY;

  // read current rendered position regardless of which properties are set
  const rect = keyboard.getBoundingClientRect();
  kbOrigLeft = rect.left;
  kbOrigTop = rect.top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!kbDragging) return;
  const dx = e.clientX - kbStartX;
  const dy = e.clientY - kbStartY;

  // always drag using top/left
  keyboard.style.bottom = 'auto';
  keyboard.style.right = 'auto';
  keyboard.style.top = (kbOrigTop + dy) + 'px';
  keyboard.style.left = (kbOrigLeft + dx) + 'px';
});

document.addEventListener('mouseup', () => { kbDragging = false; });


// download ocr update
document.getElementById('download-ocr-btn').addEventListener('click', () => {
  const rows = document.querySelectorAll('.ocr-line-result');
  const lines = [];

  rows.forEach((row) => {
    const textSpan = row.querySelector('.ocr-line-text');
    if (textSpan) {
      lines.push(textSpan.innerText.trim());
    }
  });

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transcription-${currentDocId}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});


document.querySelector('.right-col').addEventListener('scroll', () => {
  if (nepaliKeyboard.style.display !== 'none') {
    positionKeyboardBelowLine(document.querySelector('.ocr-line-result.editing-row'));
  }
});