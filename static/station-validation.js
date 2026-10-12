// Validate both station submission forms before any request is sent.
document.querySelectorAll('form').forEach(form => {
  if (form.id !== 'addStationForm' && form.getAttribute('action') !== '/api/add-station') return;
  const fields = ['name', 'url', 'subtitle', 'contact_email', 'location'];
  fields.forEach(name => {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) return;
    field.required = true;
    field.addEventListener('input', () => field.setCustomValidity(''));
    field.addEventListener('change', () => field.setCustomValidity(''));
  });
  form.addEventListener('submit', event => {
    fields.forEach(name => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) return;
      field.value = field.value.trim();
      field.setCustomValidity(field.value ? '' : 'Please fill in this field.');
      if (name === 'url' && field.value) {
        try {
          const url = new URL(field.value);
          if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || /\s/.test(field.value)) throw new Error();
        } catch (_) { field.setCustomValidity('Enter a valid http:// or https:// stream URL.'); }
      }
    });
    if (!form.reportValidity()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
});
