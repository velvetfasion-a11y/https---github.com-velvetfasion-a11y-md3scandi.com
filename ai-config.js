/**
 * Public AI settings only — NO API keys.
 * Keys live in .env (local) / GitHub Actions secrets (CI) and are written to
 * gitignored ai-secrets.js by: node scripts/sync-ai-config.mjs
 */
window.MD3_AI_CONFIG = {
  "provider": "gemini",
  "geminiModel": "gemini-3-flash-preview",
  "geminiImageModel": "gemini-2.5-flash-image",
  "geminiImageSize": "1K",
  "geminiImageAspect": "3:4",
  "model": "gpt-4o-mini"
};
