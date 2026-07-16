/** Hero focal crop + phone CTA sticky follow within the hero */
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

  /**
   * Phone CTAs: start higher, stick to the viewport while scrolling the hero,
   * then park at the hero bottom (never follow into the next section).
   */
  function updateStickyCtas() {
    const hero = document.getElementById('md3-hero');
    const foot = document.querySelector('.home-hero-foot');
    if (!hero || !foot) return;

    if (!MOBILE_MQ.matches) {
      foot.classList.remove('is-cta-fixed', 'is-cta-parked');
      foot.style.bottom = '';
      return;
    }

    const vh = window.innerHeight || 1;
    const footH = foot.offsetHeight || 160;
    const safe =
      Math.max(
        0,
        Number.parseFloat(
          getComputedStyle(document.documentElement).paddingBottom || '0'
        )
      ) || 0;
    // Natural stop — same place buttons used to sit at the hero bottom
    const stopBottom = Math.max(14 + safe, vh * 0.045);
    // Start higher on the screen (larger offset from viewport bottom)
    const startBottom = Math.max(stopBottom + 72, vh * 0.2);

    const heroRect = hero.getBoundingClientRect();
    const heroBottom = heroRect.bottom;

    // If fixed at startBottom, foot's bottom edge is at (vh - startBottom)
    const footBottomIfFixed = vh - startBottom;
    // Lowest allowed foot bottom while still inside the hero
    const maxAllowedFootBottom = heroBottom - stopBottom;

    const park =
      heroBottom <= stopBottom + footH * 0.35 || footBottomIfFixed > maxAllowedFootBottom;

    if (park) {
      foot.classList.add('is-cta-parked');
      foot.classList.remove('is-cta-fixed');
      foot.style.bottom = '';
    } else {
      foot.classList.add('is-cta-fixed');
      foot.classList.remove('is-cta-parked');
      foot.style.bottom = startBottom + 'px';
    }
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
      updateStickyCtas();
    });
  }

  scheduleUpdates();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdates).catch(function () {});
  }

  window.addEventListener('scroll', updateStickyCtas, { passive: true });
  window.addEventListener('resize', scheduleUpdates);
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
    updateCtas: updateStickyCtas,
  };
})();
