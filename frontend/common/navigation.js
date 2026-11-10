"use strict";

// Native form controls can match :focus-visible even after a pointer click.
document.addEventListener('pointerdown', () => document.documentElement.classList.add('pointer-input'), true);
document.addEventListener('keydown', event => {
  if (event.key === 'Tab') document.documentElement.classList.remove('pointer-input');
}, true);

// Native disclosure and links retain browser navigation, modified clicks and Back/Forward.
// Add roving focus shortcuts without replacing standard Tab or link semantics.
for (const menu of document.querySelectorAll('[data-view-menu], [data-field-options]')) {
  const summary = menu.querySelector('summary');
  const isViewMenu = menu.hasAttribute('data-view-menu');
  const close = (restoreFocus = false) => {
    menu.open = false;
    if (restoreFocus) summary.focus({ preventScroll: true });
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
    if (!isViewMenu) return;
    const links = [...menu.querySelectorAll('nav a')];
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const wasClosed = !menu.open;
    menu.open = true;
    const index = links.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
      : wasClosed || index < 0 ? (event.key === 'ArrowUp' ? links.length - 1 : 0)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links[next]?.focus();
  });
  window.addEventListener('pageshow', () => close());
  // The dust filters stay open during field interactions.
  if (!isViewMenu) continue;
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) close(); });
}
