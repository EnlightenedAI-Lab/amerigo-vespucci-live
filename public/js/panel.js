const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 380;
const STORAGE_KEY = 'vespucci-sidebar-width';
const COLLAPSED_KEY = 'vespucci-sidebar-collapsed';

export function isPanelCollapsed() {
  return document.getElementById('sidebar')?.classList.contains('collapsed') ?? false;
}

export function setPanelCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const expandBtn = document.getElementById('btn-panel-expand');
  const collapseBtn = document.getElementById('btn-panel-collapse');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed', collapsed);
  resizer?.classList.toggle('hidden', collapsed);
  expandBtn?.classList.toggle('hidden', !collapsed);
  if (collapseBtn) collapseBtn.textContent = collapsed ? '▶' : '◀';

  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
}

export function togglePanelCollapsed() {
  setPanelCollapsed(!isPanelCollapsed());
}

function setSidebarWidth(px) {
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, px));
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* ignore */ }
}

export function initPanel() {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH) setSidebarWidth(stored);
    else setSidebarWidth(DEFAULT_WIDTH);
    if (localStorage.getItem(COLLAPSED_KEY) === '1') setPanelCollapsed(true);
  } catch { /* ignore */ }

  document.getElementById('btn-panel-collapse')?.addEventListener('click', togglePanelCollapsed);
  document.getElementById('btn-panel-expand')?.addEventListener('click', () => setPanelCollapsed(false));

  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    if (isPanelCollapsed()) return;
    dragging = true;
    resizer.classList.add('active');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const width = window.innerWidth - e.clientX;
    setSidebarWidth(width);
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      resizer.classList.remove('active');
      window.dispatchEvent(new Event('resize'));
    }
  });
}

initPanel();
