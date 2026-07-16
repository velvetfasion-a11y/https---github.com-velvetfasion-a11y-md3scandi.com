/** Hero title sizing + seamless background focal shift on resize */
(function () {
  const DESKTOP_MQ = window.matchMedia("(min-width: 769px)");
  /** Slightly under full width so the title isn’t edge-to-edge huge */
  const TITLE_WIDTH_RATIO = 0.92;

  function fitHeroTitle() {
    const el = document.getElementById("heroTitle");
    if (!el) return;
    el.style.fontSize = "";
    el.style.letterSpacing = "";
    el.querySelectorAll("*").forEach((child) => {
      child.style.fontSize = "";
      child.style.letterSpacing = "";
    });
  }

  /**
   * NyZx3.jpg is landscape; keep the subject (center-right) in frame.
   * On tall mobile covers, bias X toward the model and Y slightly up.
   */
  function updateHeroBgFocus() {
    const img = document.querySelector("#md3-hero .hero-bg-img");
    if (!img) return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const w = window.innerWidth;
    const h = window.innerHeight || 1;
    const ar = w / h;

    if (isMobile) {
      img.style.objectPosition = "58% 40%";
      return;
    }

    if (DESKTOP_MQ.matches) {
      const x = Math.min(56, Math.max(50, 52 + (ar - 1.6) * 2));
      const y = Math.min(50, Math.max(42, 46 + (1.85 - ar) * 4));
      img.style.objectPosition = x.toFixed(1) + "% " + y.toFixed(1) + "%";
      return;
    }

    img.style.objectPosition = "54% 44%";
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
    });
  }

  scheduleUpdates();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdates).catch(function () {});
  }

  window.addEventListener("resize", scheduleUpdates);
  if (DESKTOP_MQ.addEventListener) {
    DESKTOP_MQ.addEventListener("change", scheduleUpdates);
  } else {
    DESKTOP_MQ.addListener(scheduleUpdates);
  }

  window.MD3HeroFit = { fit: scheduleUpdates, updateBg: updateHeroBgFocus };
})();
