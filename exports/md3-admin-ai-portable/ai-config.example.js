/**
 * Example AI config — copy to ai-config.js and fill in your key.
 * Or generate from .env: node sync-ai-config.mjs
 */
window.MD3_AI_CONFIG = {
  provider: 'gemini',
  geminiApiKey: 'YOUR_GEMINI_API_KEY', // from https://aistudio.google.com/apikey (AQ… or AIza…)
  geminiModel: 'gemini-3-flash-preview', // chat / planning
  geminiImageModel: 'gemini-3-pro-image', // Nano Banana image generation
  geminiImageSize: '2K',
  geminiImageAspect: '3:4',
  openaiApiKey: '', // optional fallback
  model: 'gpt-4o-mini',
};
