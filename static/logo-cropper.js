function setupLogoCropper(form) {
  const input = form && form.querySelector('[name="logo_image"]');
  if (!input) return;
  const hidden = form.querySelector('[name="logo_image_cropped"]');
  const panel = form.querySelector('.logo-cropper');
  panel.innerHTML = '<p>Drag your logo inside the circle. Use the slider to zoom.</p><canvas width="128" height="128" aria-label="Circular station logo preview"></canvas><label>Zoom <input aria-label="Logo zoom" type="range" min="1" max="8" step="0.01" value="1"></label><button type="button">Reset crop</button><p role="status"></p>';
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  const zoom = panel.querySelector('input'), status = panel.querySelector('[role="status"]');
  let img = null, x = 0.5, y = 0.5, drag = null, generation = 0;
  function draw() {
    if (!img) return;
    const size = Math.min(img.width, img.height) / Number(zoom.value);
    ctx.clearRect(0, 0, 128, 128);
    ctx.save(); ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, x * (img.width - size), y * (img.height - size), size, size, 0, 0, 128, 128);
    ctx.restore(); hidden.value = canvas.toDataURL('image/png');
  }
  function reset() { x = y = 0.5; zoom.value = '1'; draw(); }
  zoom.addEventListener('input', draw);
  panel.querySelector('button').addEventListener('click', reset);
  canvas.addEventListener('pointerdown', e => {
    if (!img) return;
    drag = {id: e.pointerId, x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId || !img) return;
    const size = Math.min(img.width, img.height) / Number(zoom.value);
    const scale = size / canvas.getBoundingClientRect().width;
    if (img.width > size) x = Math.max(0, Math.min(1, x - (e.clientX - drag.x) * scale / (img.width - size)));
    if (img.height > size) y = Math.max(0, Math.min(1, y - (e.clientY - drag.y) * scale / (img.height - size)));
    drag.x = e.clientX; drag.y = e.clientY; draw();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => canvas.addEventListener(event, () => { drag = null; }));
  input.addEventListener('change', () => {
    const ticket = ++generation; img = null; hidden.value = ''; input.setCustomValidity('');
    const file = input.files[0]; panel.classList.toggle('active', !!file);
    if (!file) return;
    status.textContent = 'Loading logo…'; input.setCustomValidity('Wait for your logo to load.');
    const candidate = new Image(), url = URL.createObjectURL(file);
    candidate.onload = () => {
      URL.revokeObjectURL(url); if (ticket !== generation) return;
      img = candidate; reset(); input.setCustomValidity(''); status.textContent = 'This circular crop will be used for your station logo.';
    };
    candidate.onerror = () => {
      URL.revokeObjectURL(url); if (ticket !== generation) return;
      status.textContent = 'Unable to open this image. Choose a PNG, JPG or WebP image.';
      input.setCustomValidity('Choose a valid logo image.');
    };
    candidate.src = url;
  });
  form.addEventListener('reset', () => { generation++; img = null; hidden.value = ''; input.setCustomValidity(''); panel.classList.remove('active'); });
}
