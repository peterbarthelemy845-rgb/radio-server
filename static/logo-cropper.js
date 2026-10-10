function setupLogoCropper(form) {
  const input = form && form.querySelector('[name="logo_image"]');
  if (!input) return;
  const hidden = form.querySelector('[name="logo_image_cropped"]');
  const panel = form.querySelector('.logo-cropper');
  if (!hidden || !panel) return;
  panel.innerHTML = '<p>Preview your logo in the Library card frame. Drag to position it or use the slider to zoom.</p><canvas width="400" height="528" aria-label="Rectangular station logo preview"></canvas><label>Zoom <input aria-label="Logo zoom" type="range" min="1" max="8" step="0.01" value="1"></label><button type="button" data-fit>Fit entire logo</button><button type="button" data-fill>Fill frame</button><p role="status"></p>';
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  canvas.style.setProperty('width', '240px', 'important');
  canvas.style.setProperty('height', 'auto', 'important');
  canvas.style.setProperty('aspect-ratio', '400 / 528', 'important');
  canvas.style.setProperty('border-radius', '16px', 'important');
  const zoom = panel.querySelector('input'), status = panel.querySelector('[role="status"]');
  let img = null, panX = 0, panY = 0, drag = null, generation = 0, mode = 'fit';
  function dimensions() {
    const scale = (mode === 'fit' ? Math.min : Math.max)(canvas.width / img.width, canvas.height / img.height) * Number(zoom.value);
    return {width: img.width * scale, height: img.height * scale};
  }
  function draw() {
    if (!img) return;
    const size = dimensions();
    const limitX = Math.max(0, (size.width - canvas.width) / 2);
    const limitY = Math.max(0, (size.height - canvas.height) / 2);
    panX = Math.max(-limitX, Math.min(limitX, panX));
    panY = Math.max(-limitY, Math.min(limitY, panY));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, (canvas.width - size.width) / 2 + panX, (canvas.height - size.height) / 2 + panY, size.width, size.height);
    hidden.value = canvas.toDataURL('image/png');
  }
  function setMode(next) {
    mode = next; panX = panY = 0; zoom.value = '1'; draw();
    status.textContent = next === 'fit' ? 'The entire logo will be saved without cutting off its edges.' : 'The frame will be filled. Drag to choose which part stays visible.';
    panel.querySelector('[data-fit]').setAttribute('aria-pressed', String(next === 'fit'));
    panel.querySelector('[data-fill]').setAttribute('aria-pressed', String(next === 'fill'));
  }
  zoom.addEventListener('input', draw);
  panel.querySelector('[data-fit]').addEventListener('click', () => setMode('fit'));
  panel.querySelector('[data-fill]').addEventListener('click', () => setMode('fill'));
  canvas.addEventListener('pointerdown', e => {
    if (!img) return;
    drag = {id: e.pointerId, x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId || !img) return;
    const bounds = canvas.getBoundingClientRect();
    panX += (e.clientX - drag.x) * canvas.width / bounds.width;
    panY += (e.clientY - drag.y) * canvas.height / bounds.height;
    drag.x = e.clientX; drag.y = e.clientY; draw();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => canvas.addEventListener(event, () => { drag = null; }));
  input.addEventListener('change', () => {
    const ticket = ++generation; img = null; drag = null; hidden.value = ''; input.setCustomValidity('');
    const file = input.files[0]; panel.classList.toggle('active', !!file);
    if (!file) return;
    status.textContent = 'Loading logo…'; input.setCustomValidity('Wait for your logo to load.');
    const candidate = new Image(), url = URL.createObjectURL(file);
    candidate.onload = () => {
      URL.revokeObjectURL(url); if (ticket !== generation) return;
      img = candidate; setMode('fit'); input.setCustomValidity('');
    };
    candidate.onerror = () => {
      URL.revokeObjectURL(url); if (ticket !== generation) return;
      status.textContent = 'Unable to open this image. Choose a PNG, JPG or WebP image.';
      input.setCustomValidity('Choose a valid logo image.');
    };
    candidate.src = url;
  });
  form.addEventListener('reset', () => { generation++; img = null; drag = null; hidden.value = ''; input.setCustomValidity(''); panel.classList.remove('active'); });
}
