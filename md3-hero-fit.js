/** Hero title sizing + seamless background focal shift on resize */
(function () {
  const DESKTOP_MQ = window.matchMedia("(min-width: 769px)");
  /** Slightly under full width so the title isn’t edge-to-edge huge */
  const TITLE_WIDTH_RATIO = 0.92;

  function fitHeroTitle() {
    const el = document.getElementById("heroTitle");
    if (!el) return;

    const containerW = window.innerWidth * TITLE_WIDTH_RATIO;
    el.style.fontSize = "100px";
    el.style.letterSpacing = "0em";

    let size = 100;
    while (el.scrollWidth < containerW && size < 600) {
      size += 2;
      el.style.fontSize = size + "px";
    }
    while (el.scrollWidth > containerW && size > 10) {
      size -= 0.5;
      el.style.fontSize = size + "px";
    }

    const remaining = containerW - el.scrollWidth;
    const charCount = el.textContent.length;
    if (charCount > 0 && size > 0) {
      el.style.letterSpacing = remaining / charCount / size + "em";
    }
  }

  /**
   * Wider viewport = more vertical crop → move focal point down in the source
   * image (higher %) so we lose ceiling and keep the model's face visible.
   */
  function updateHeroBgFocus() {
    const img = document.querySelector("#md3-hero .hero-bg-img");
    if (!img) return;

    const w = window.innerWidth;
    const h = window.innerHeight || 1;
    const ar = w / h;

    if (DESKTOP_MQ.matches) {
      const x = Math.min(62, Math.max(53, 53 + (ar - 1) * 4));
      const y = Math.min(30, Math.max(20, 20 + (ar - 0.9) * 8));
      img.style.objectPosition = x.toFixed(1) + "% " + y.toFixed(1) + "%";
      return;
    }

    let y = 22 + (0.75 - ar) * 8;
    y = Math.max(18, Math.min(30, y));
    img.style.objectPosition = "center " + y.toFixed(1) + "%";
  }

  function scheduleUpdates() {
    requestAnimationFrame(function () {
      fitHeroTitle();
      updateHeroBgFocus();
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdates);
  } else {
    scheduleUpdates();
  }

  window.addEventListener("resize", scheduleUpdates);
  if (DESKTOP_MQ.addEventListener) {
    DESKTOP_MQ.addEventListener("change", scheduleUpdates);
  } else {
    DESKTOP_MQ.addListener(scheduleUpdates);
  }

  window.MD3HeroFit = { fit: scheduleUpdates, updateBg: updateHeroBgFocus };
})();
