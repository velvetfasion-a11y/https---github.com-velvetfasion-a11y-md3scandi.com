/**
 * Public AI settings only — NO API keys.
 * Gemini: Cloud Functions / node scripts/dev-admin-ai.mjs (key only in .env).
 */
window.MD3_AI_CONFIG = {
  "provider": "gemini",
  "adminAiBaseUrl": "https://europe-west1-md3scadi.cloudfunctions.net",
  "geminiModel": "gemini-3-flash-preview",
  "geminiImageModel": "gemini-2.5-flash-image",
  "geminiImageSize": "1K",
  "geminiImageAspect": "3:4",
  "model": "gpt-4o-mini"
};
