/** Hero focal crop — desktop scales NyZx3 down from under the nav */
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
   * NyZx3 face is high in-frame (~10–35% from top) and right-of-center (~68% X).
   * Desktop cinema AR ≈ the photo AR, so object-position cannot move her —
   * CSS scale+translate handles that. JS only sets mobile crop / clears overrides.
   */
  function updateHeroBgFocus() {
    const img = document.querySelector('#md3-hero .hero-bg-img');
    if (!img) return;

    if (MOBILE_MQ.matches) {
      img.style.objectPosition = '70% 34%';
      img.style.transform = '';
      return;
    }

    if (DESKTOP_MQ.matches) {
      // Let CSS desktop scale/translate win — clear any old inline object-position
      img.style.objectPosition = '';
      img.style.transform = '';
      return;
    }

    img.style.objectPosition = '65% 40%';
    img.style.transform = '';
  }

  function clearCtaScrollState() {
    const copy = document.getElementById('homeHeroCopy');
    if (!copy) return;
    copy.classList.remove('is-cta-fixed', 'is-cta-parked');
    copy.style.bottom = '';
    copy.style.position = '';
    copy.style.left = '';
    copy.style.right = '';
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
      clearCtaScrollState();
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
    updateCtas: clearCtaScrollState,
  };
})();
