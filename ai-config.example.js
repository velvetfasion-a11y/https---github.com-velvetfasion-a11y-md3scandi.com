/**
 * Copy to ai-config.js for OpenAI-powered admin assistant (optional).
 * Without a key, the assistant uses built-in command parsing.
 */
window.MD3_AI_CONFIG = {
  provider: 'gemini',
  geminiApiKey: 'YOUR_GEMINI_API_KEY',
  /** Reasoning / chat — gemini-2.5-pro or gemini-3.1-pro-preview */
  geminiModel: 'gemini-2.5-pro',
  /** Product image generation — gemini-3-pro-image-preview */
  geminiImageModel: 'gemini-3-pro-image-preview',
  geminiImageSize: '2K',
  geminiImageAspect: '3:4',
  openaiApiKey: '',
  model: 'gpt-4o-mini',
};
