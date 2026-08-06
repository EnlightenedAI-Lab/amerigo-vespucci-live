const STORAGE_KEY = 'vespucci-theme';

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

export function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  updateThemeButton(next);
  return next;
}

export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function updateThemeButton(theme) {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  btn.textContent = theme === 'dark' ? '☀' : '☾';
  btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

export function initTheme() {
  let theme = 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch { /* ignore */ }
  setTheme(theme);
  document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);
}

initTheme();
