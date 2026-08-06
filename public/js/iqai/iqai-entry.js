import { IqaiV2App } from './v2-app.js';

/** Dedicated IQAI page — always loads V2 (no classic UI fallback). */
async function boot() {
  localStorage.removeItem('iqai-v2-disabled');

  const loading = document.getElementById('iqai-boot-loading');
  const errEl = document.getElementById('iqai-boot-error');

  const app = new IqaiV2App();
  try {
    await app.init();
    loading?.classList.add('hidden');
  } catch (err) {
    loading?.classList.add('hidden');
    if (errEl) {
      errEl.textContent = `IQAI Spatial failed to load: ${err.message}`;
      errEl.classList.remove('hidden');
    }
    console.error(err);
  }
}

boot();
