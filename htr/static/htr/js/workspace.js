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