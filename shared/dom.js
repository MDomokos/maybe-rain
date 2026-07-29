const $ = id => document.getElementById(id);
const show = (el, visible = true) => el.classList.toggle('hidden', !visible);
const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
