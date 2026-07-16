/** Hero focal crop — CTAs use CSS sticky on mobile (no scroll JS) */
(function () {
  const DESKTOP_MQ = window.matchMedia('(min-width: 769px)');
  const MOBILE_MQ = window.matchMedia('(max-width: 767px)');

  function fitHeroTitle() {
    const el = document.getElementById('heroTitle');
    if (!el) return;
    el.style.fontSize = '';
    el.style.letterSpacing = '';
    el.querySelectorAll('*').forEach((child) => {
      child.style.fontSize = '';
      child.style.letterSpacing = '';
    });
  }

  /**
   * NyZx3.jpg is landscape; model is right-of-center (~70% X).
   * On tall phone covers, crop onto her face and dress — not the plant.
   */
  function updateHeroBgFocus() {
    const img = document.querySelector('#md3-hero .hero-bg-img');
    if (!img) return;

    const isMobile = MOBILE_MQ.matches;
    const w = window.innerWidth;
    const h = window.innerHeight || 1;
    const ar = w / h;

    if (isMobile) {
      img.style.objectPosition = '70% 34%';
      return;
    }

    if (DESKTOP_MQ.matches) {
      const x = Math.min(62, Math.max(52, 56 + (ar - 1.6) * 2));
      const y = Math.min(50, Math.max(40, 44 + (1.85 - ar) * 4));
      img.style.objectPosition = x.toFixed(1) + '% ' + y.toFixed(1) + '%';
      return;
    }

    img.style.objectPosition = '64% 40%';
  }

  function clearStickyCtaInline() {
    const copy = document.getElementById('homeHeroCopy');
    if (!copy) return;
    copy.classList.remove('is-cta-fixed', 'is-cta-parked');
    copy.style.bottom = '';
    copy.style.position = '';
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
      clearStickyCtaInline();
    });
  }

  scheduleUpdates();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdates).catch(function () {});
  }

  window.addEventListener('resize', scheduleUpdates, { passive: true });
  if (DESKTOP_MQ.addEventListener) {
    DESKTOP_MQ.addEventListener('change', scheduleUpdates);
    MOBILE_MQ.addEventListener('change', scheduleUpdates);
  } else {
    DESKTOP_MQ.addListener(scheduleUpdates);
    MOBILE_MQ.addListener(scheduleUpdates);
  }

  window.MD3HeroFit = {
    fit: scheduleUpdates,
    updateBg: updateHeroBgFocus,
    updateCtas: clearStickyCtaInline,
  };
})();
