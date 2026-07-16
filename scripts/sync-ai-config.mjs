#!/usr/bin/env node
/**
 * Generate ai-config.js from .env (and process.env for CI).
 * Usage: node scripts/sync-ai-config.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isCI, loadEnv } from './lib/load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'ai-config.js');

const env = loadEnv(root);

const config = {
  provider: env.AI_PROVIDER || 'gemini',
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-3-flash-preview',
  geminiImageModel: env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image',
  geminiImageSize: env.GEMINI_IMAGE_SIZE || '2K',
  geminiImageAspect: env.GEMINI_IMAGE_ASPECT || '3:4',
  openaiApiKey: env.OPENAI_API_KEY || '',
  model: env.OPENAI_MODEL || 'gpt-4o-mini',
};

const body = `/**
 * Auto-generated from .env — DO NOT EDIT. Secrets live only in .env (local) or GitHub Actions secrets (production).
 * Regenerate: node scripts/sync-ai-config.mjs
 * Verify key:  node scripts/test-gemini.mjs
 */
window.MD3_AI_CONFIG = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('Wrote', path.relative(root, outPath));

const isCIRun = isCI();

if (!config.geminiApiKey && !config.openaiApiKey) {
  const msg =
    'No GEMINI_API_KEY or OPENAI_API_KEY — admin AI image generation will not work on the deployed site.';
  // Never block GitHub Pages deploy — the storefront must still publish.
  console.warn('Warning: ' + msg);
  if (isCIRun) {
    console.warn('Add repository secret GEMINI_API_KEY (Settings → Secrets and variables → Actions) for admin AI.');
  }
} else if (/^ya29\./i.test(config.geminiApiKey)) {
  console.warn(
    'Warning: GEMINI_API_KEY looks like a Google sign-in OAuth token (ya29.…), not a Gemini API key. Use https://aistudio.google.com/apikey (AQ.… or AIza…).'
  );
}
