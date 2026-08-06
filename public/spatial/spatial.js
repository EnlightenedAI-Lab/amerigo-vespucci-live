const creation = document.querySelector('#creation');
const workspace = document.querySelector('#workspace');
const loading = document.querySelector('#loading');
const panel = document.querySelector('#detail-panel');
const backdrop = document.querySelector('#backdrop');
const trigger = document.querySelector('#panel-trigger');

function openPanel() {
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  trigger.setAttribute('aria-expanded', 'true');
  backdrop.hidden = false;
  document.querySelector('#close-panel').focus();
}
function closePanel() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  backdrop.hidden = true;
  trigger.focus();
}
document.querySelector('#create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  creation.hidden = true;
  workspace.hidden = false;
  loading.hidden = false;
  window.setTimeout(() => { loading.hidden = true; trigger.focus(); }, 900);
});
document.querySelector('#back-button').addEventListener('click', () => {
  closePanel(); workspace.hidden = true; creation.hidden = false; document.querySelector('#map-prompt').focus();
});
trigger.addEventListener('click', openPanel);
document.querySelector('#close-panel').addEventListener('click', closePanel);
backdrop.addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.classList.contains('open')) closePanel(); });
document.querySelectorAll('[role="tab"]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('[role="tab"]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
  document.querySelectorAll('[role="tabpanel"]').forEach((content) => { content.hidden = content.id !== tab.dataset.tab; });
}));
document.querySelectorAll('.examples button').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('#map-prompt').value = button.textContent; document.querySelector('#map-prompt').focus();
}));
document.querySelector('#attach-button').addEventListener('click', () => document.querySelector('#file-input').click());
document.querySelector('#file-input').addEventListener('change', (event) => { document.querySelector('#file-status').textContent = event.target.files[0] ? `${event.target.files[0].name} ready to use` : ''; });
document.querySelector('#url-button').addEventListener('click', () => { document.querySelector('#url-entry').hidden = false; document.querySelector('#data-url').focus(); });
document.querySelector('#add-url').addEventListener('click', () => { const input = document.querySelector('#data-url'); if (input.value) { document.querySelector('#file-status').textContent = 'Data URL ready to use'; document.querySelector('#url-entry').hidden = true; } });
document.querySelector('#revision-form').addEventListener('submit', (event) => { event.preventDefault(); const toast = document.querySelector('#toast'); toast.hidden = false; event.target.reset(); window.setTimeout(() => { toast.hidden = true; }, 2200); });
