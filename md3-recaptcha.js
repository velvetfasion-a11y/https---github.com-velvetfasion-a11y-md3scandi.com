/**
 * reCAPTCHA Enterprise — token + optional assessment (md3scandi)
 * Requires recaptcha-config.js before this script.
 */
(function (global) {
  let scriptPromise = null;

  function cfg() {
    return global.MD3_RECAPTCHA_CONFIG || {};
  }

  function siteKey() {
    const k = cfg().siteKey;
    return k && !String(k).includes('YOUR_') ? k : '';
  }

  function loadScript() {
    const key = siteKey();
    if (!key) return Promise.resolve(false);
    if (global.grecaptcha && global.grecaptcha.enterprise) return Promise.resolve(true);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-md3-recaptcha]');
      if (existing) {
        existing.addEventListener('load', () => resolve(true));
        existing.addEventListener('error', reject);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + encodeURIComponent(key);
      s.async = true;
      s.defer = true;
      s.dataset.md3Recaptcha = '1';
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('reCAPTCHA script failed to load'));
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  function execute(action) {
    const key = siteKey();
    if (!key) return Promise.resolve(null);
    return loadScript().then(
      () =>
        new Promise((resolve, reject) => {
          global.grecaptcha.enterprise.ready(async () => {
            try {
              const token = await global.grecaptcha.enterprise.execute(key, {
                action: action || 'LOGIN',
              });
              resolve(token);
            } catch (e) {
              reject(e);
            }
          });
        })
    );
  }

  async function assess(token, expectedAction) {
    const c = cfg();
    const apiKey = c.apiKey;
    const projectId = c.projectId || 'md3scandi';
    if (!apiKey || String(apiKey).includes('YOUR_') || !token) {
      return { ok: true, skipped: true };
    }

    const base =
      c.assessmentUrl ||
      'https://recaptchaenterprise.googleapis.com/v1/projects/' + projectId + '/assessments';
    const url = base + (base.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          token,
          expectedAction: expectedAction || 'LOGIN',
          siteKey: siteKey(),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('reCAPTCHA assessment', res.status, text);
      return { ok: false, error: text };
    }

    const data = await res.json();
    const valid = !!(data.tokenProperties && data.tokenProperties.valid);
    const actionOk =
      !data.tokenProperties ||
      !data.tokenProperties.action ||
      data.tokenProperties.action === expectedAction;
    const score =
      data.riskAnalysis && typeof data.riskAnalysis.score === 'number'
        ? data.riskAnalysis.score
        : 1;
    const minScore = typeof c.minScore === 'number' ? c.minScore : 0.5;
    const ok = valid && actionOk && score >= minScore;
    return { ok, score, valid, actionOk, data };
  }

  /** Run execute + assess; skips silently if not configured */
  async function guard(action) {
    if (!siteKey()) return { ok: true, skipped: true };
    const token = await execute(action);
    if (!token) return { ok: false, error: 'no_token' };
    return assess(token, action);
  }

  global.MD3Recaptcha = {
    loadScript,
    execute,
    assess,
    guard,
    isConfigured: () => !!siteKey(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
