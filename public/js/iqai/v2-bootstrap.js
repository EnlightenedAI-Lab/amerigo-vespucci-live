import { IqaiV2App } from './v2-app.js';

async function bootstrapIqaiV2() {
  const params = new URLSearchParams(window.location.search);
  const forceV2 = params.get('v2') === '1';
  if (forceV2) localStorage.removeItem('iqai-v2-disabled');
  const disabled = localStorage.getItem('iqai-v2-disabled') === '1' && !forceV2;

  let config = { v2Enabled: false, legacyUiEnabled: true };
  try {
    const res = await fetch('/api/spatial/config');
    if (res.ok) config = await res.json();
  } catch {
    if (!forceV2) return;
  }

  const useV2 = !disabled && (config.v2ShellEnabled || config.v2Enabled || forceV2);
  if (!useV2) return;

  if (!document.querySelector('link[data-iqai-v2-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/iqai-v2.css';
    link.dataset.iqaiV2Css = 'true';
    document.head.appendChild(link);
  }

  document.getElementById('app')?.classList.add('hidden');
  const shell = document.getElementById('iqai-v2-app');
  shell?.classList.remove('hidden');

  const app = new IqaiV2App();
  try {
    await app.init();
  } catch (err) {
    const errEl = document.getElementById('iqai-boot-error');
    if (errEl) {
      errEl.textContent = `IQAI Spatial failed to load: ${err.message}`;
      errEl.classList.remove('hidden');
    }
    document.getElementById('app')?.classList.remove('hidden');
    shell?.classList.add('hidden');
  }
}

bootstrapIqaiV2();
