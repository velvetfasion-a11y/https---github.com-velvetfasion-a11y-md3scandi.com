/** Hero focal crop + pin title/CTAs to the viewport bottom until the hero ends */
(function () {
  const DESKTOP_MQ = window.matchMedia('(min-width: 769px)');
  const MOBILE_MQ = window.matchMedia('(max-width: 767px)');

  let pinRaf = 0;
  let lastMode = '';

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
      const x = Math.min(62, Math.max(54, 58 + (ar - 1.6) * 2));
      const y = Math.min(22, Math.max(12, 16 + (1.85 - ar) * 2));
      img.style.objectPosition = x.toFixed(1) + '% ' + y.toFixed(1) + '%';
      return;
    }

    img.style.objectPosition = '58% 18%';
  }

  function bottomPad() {
    return MOBILE_MQ.matches ? 16 : 28;
  }

  /**
   * Stick copy to the bottom of the viewport while the hero still covers that edge;
   * park it at the bottom of the hero once the hero scrolls up.
   */
  function updateCtaPin() {
    const hero = document.getElementById('md3-hero');
    const copy = document.getElementById('homeHeroCopy');
    if (!hero || !copy) return;

    const rect = hero.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const pad = bottomPad();

    if (rect.bottom <= 0 || rect.top >= vh) {
      if (lastMode !== 'parked') {
        copy.classList.add('is-cta-parked');
        copy.classList.remove('is-cta-fixed');
        lastMode = 'parked';
      }
      return;
    }

    const mode = rect.bottom >= vh - pad ? 'fixed' : 'parked';
    if (mode === lastMode) return;

    if (mode === 'fixed') {
      copy.classList.add('is-cta-fixed');
      copy.classList.remove('is-cta-parked');
    } else {
      copy.classList.add('is-cta-parked');
      copy.classList.remove('is-cta-fixed');
    }
    lastMode = mode;
  }

  function schedulePin() {
    if (pinRaf) return;
    pinRaf = requestAnimationFrame(function () {
      pinRaf = 0;
      updateCtaPin();
    });
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
      lastMode = '';
      updateCtaPin();
    });
  }

  scheduleUpdates();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdates).catch(function () {});
  }

  window.addEventListener('scroll', schedulePin, { passive: true });
  window.addEventListener('resize', scheduleUpdates, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedulePin, { passive: true });
  }

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
    updateCtas: schedulePin,
  };
})();
