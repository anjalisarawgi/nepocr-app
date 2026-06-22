// Exclusive accordion: opening one section closes the others.
const sections = document.querySelectorAll('.accordion-section:not(.locked)');
sections.forEach((section) => {
  const header = section.querySelector('.accordion-header');
  header.addEventListener('click', () => {
    const willOpen = !section.classList.contains('open');
    sections.forEach((s) => s.classList.remove('open'));
    if (willOpen) section.classList.add('open');
  });
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

// Toggle each document's file dropdown
document.querySelectorAll('.doc-item').forEach((header) => {
  header.addEventListener('click', () => {
    header.closest('.doc-group').classList.toggle('open');
  });
});

// Clicking an actual file shows it in the preview
document.querySelectorAll('.doc-file').forEach((file) => {
  file.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.doc-file').forEach((f) => f.classList.remove('active'));
    file.classList.add('active');

    const url = file.dataset.imageUrl;
    document.getElementById('preview-placeholder').style.display = 'none';
    const img = document.getElementById('preview-image');
    img.src = url;
    img.style.display = 'block';

    document.getElementById('preview-bar').style.display = 'flex';
    const docName = file.dataset.docName;
    const fileLabel = file.textContent;
    document.getElementById('preview-filename').textContent = `${docName} / ${fileLabel}`;

  });
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
  workspace.style.gridTemplateColumns = `${newWidth}px 6px 1fr 580px`;


});

document.addEventListener('mouseup', () => {
  isDragging = false;
  handle.classList.remove('dragging');
});


////// crop //
let currentDocId = null;
let cropStart = null;

const cropBtn = document.getElementById('crop-btn');
const cropConfirmBtn = document.getElementById('crop-confirm-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const cropOverlay = document.getElementById('crop-overlay');
const cropBox = document.getElementById('crop-box');
const previewImage = document.getElementById('preview-image');

// remember which document is currently shown, whenever one is clicked
document.querySelectorAll('.doc-file').forEach((file) => {
  file.addEventListener('click', () => {
    currentDocId = file.dataset.docId;
    document.getElementById('reset-btn').style.display =
      file.dataset.hasBackup === 'true' ? 'flex' : 'none';
  });
});

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
  const imgRect = previewImage.getBoundingClientRect();
  const overlayRect = cropOverlay.getBoundingClientRect();

  const boxLeft = parseFloat(cropBox.style.left);
  const boxTop = parseFloat(cropBox.style.top);
  const boxWidth = parseFloat(cropBox.style.width);
  const boxHeight = parseFloat(cropBox.style.height);

  const imgOffsetX = imgRect.left - overlayRect.left;
  const imgOffsetY = imgRect.top - overlayRect.top;
  const scaleX = previewImage.naturalWidth / imgRect.width;
  const scaleY = previewImage.naturalHeight / imgRect.height;

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
          previewImage.src = data.new_url + '?t=' + Date.now();
          document.getElementById('reset-btn').style.display = 'flex';
        }
        endCropMode();

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
        previewImage.src = data.new_url + '?t=' + Date.now();
        document.getElementById('reset-btn').style.display = 'none';
      }
    });
});