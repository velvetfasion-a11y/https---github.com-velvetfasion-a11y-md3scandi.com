/**
 * Browser AI config — generated from .env (do not copy/edit this file by hand).
 *
 * 1. cp .env.example .env
 * 2. Set GEMINI_API_KEY and optional AI_* / GEMINI_* / OPENAI_* vars in .env
 * 3. node scripts/sync-ai-config.mjs
 *
 * Output: ai-config.js (gitignored, loaded by compte.html)
 */
window.MD3_AI_CONFIG = {
  provider: 'gemini',
  geminiApiKey: 'YOUR_GEMINI_API_KEY',
  geminiModel: 'gemini-2.5-pro',
  geminiImageModel: 'gemini-3-pro-image-preview',
  geminiImageSize: '2K',
  geminiImageAspect: '3:4',
  openaiApiKey: '',
  model: 'gpt-4o-mini',
};
