/**
 * Public AI settings only — NO API keys.
 * Gemini runs on Cloud Functions / local API (scripts/dev-admin-ai.mjs).
 * Keys: .env GEMINI_API_KEY → Functions secrets / local server only.
 */
window.MD3_AI_CONFIG = {
  "provider": "gemini",
  "adminAiBaseUrl": "http://127.0.0.1:8787",
  "geminiModel": "gemini-3-flash-preview",
  "geminiImageModel": "gemini-2.5-flash-image",
  "geminiImageSize": "1K",
  "geminiImageAspect": "3:4",
  "model": "gpt-4o-mini"
};
