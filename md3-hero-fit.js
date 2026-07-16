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
   * NyZx3.jpg is landscape; model is right-of-center (~70% X).
   * On tall phone covers, crop onto her face and dress — not the plant.
   */
  function updateHeroBgFocus() {
    const img = document.querySelector("#md3-hero .hero-bg-img");
    if (!img) return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const w = window.innerWidth;
    const h = window.innerHeight || 1;
    const ar = w / h;

    if (isMobile) {
      // Portrait cover: keep face in upper third, body framed
      img.style.objectPosition = "70% 34%";
      return;
    }

    if (DESKTOP_MQ.matches) {
      const x = Math.min(62, Math.max(52, 56 + (ar - 1.6) * 2));
      const y = Math.min(50, Math.max(40, 44 + (1.85 - ar) * 4));
      img.style.objectPosition = x.toFixed(1) + "% " + y.toFixed(1) + "%";
      return;
    }

    img.style.objectPosition = "64% 40%";
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
