/**
 * Copy to recaptcha-config.js (gitignored).
 * Values should match .env — used by the browser on login / signup.
 */
window.MD3_RECAPTCHA_CONFIG = {
  siteKey: 'YOUR_RECAPTCHA_SITE_KEY',
  projectId: 'md3scandi',
  apiKey: 'YOUR_GOOGLE_CLOUD_API_KEY',
  assessmentUrl:
    'https://recaptchaenterprise.googleapis.com/v1/projects/md3scandi/assessments',
  googleOAuthClientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  /** Minimum risk score (0–1) when server assessment is enabled */
  minScore: 0.5,
};
