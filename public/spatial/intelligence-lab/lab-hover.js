/**
 * Lightweight hover card for map intelligence.
 */

export class LabHoverCard {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'lab-hover-card lab-hidden';
    document.body.appendChild(this.el);
  }

  show(html, x, y) {
    this.el.innerHTML = html;
    this.el.classList.remove('lab-hidden');
    const pad = 12;
    const rect = this.el.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  hide() {
    this.el.classList.add('lab-hidden');
    this.el.innerHTML = '';
    this.el.removeAttribute('style');
  }

  destroy() {
    this.hide();
    this.el.remove();
  }
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
