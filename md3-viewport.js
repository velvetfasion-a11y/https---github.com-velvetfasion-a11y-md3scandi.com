/**
 * Sets html[data-viewport="desktop"|"mobile"] for layout-specific CSS.
 * Breakpoint: 768px (iPhone vs computer).
 */
(function (global) {
  const MQ = global.matchMedia('(min-width: 768px)');

  function applyViewport() {
    const root = document.documentElement;
    const mode = MQ.matches ? 'desktop' : 'mobile';
    root.dataset.viewport = mode;
    root.classList.toggle('is-desktop', mode === 'desktop');
    root.classList.toggle('is-mobile', mode === 'mobile');
  }

  function init() {
    applyViewport();
    if (MQ.addEventListener) MQ.addEventListener('change', applyViewport);
    else MQ.addListener(applyViewport);
  }

  global.MD3Viewport = { init, apply: applyViewport, MQ };

  if (document.documentElement) init();
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
