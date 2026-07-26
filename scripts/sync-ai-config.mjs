#!/usr/bin/env node
/**
 * Generate public ai-config.js (endpoint URLs + models — NO API keys).
 * Deletes any legacy ai-secrets.js so Gemini keys cannot live in the browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './lib/load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicPath = path.join(root, 'ai-config.js');
const secretsPath = path.join(root, 'ai-secrets.js');

const env = loadEnv(root);

const projectId = env.FIREBASE_PROJECT_ID || 'md3scadi';
const region = env.ADMIN_AI_REGION || 'europe-west1';
const cloudBase = `https://${region}-${projectId}.cloudfunctions.net`;

// Never bake localhost into the committed public config — browser JS overrides on localhost.
const publicConfig = {
  provider: 'gemini',
  adminAiBaseUrl: cloudBase,
  geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash',
  geminiImageModel: env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image',
  geminiImageSize: env.GEMINI_IMAGE_SIZE || '2K',
  geminiImageAspect: env.GEMINI_IMAGE_ASPECT || '3:4',
  model: env.OPENAI_MODEL || 'gpt-4o-mini',
};

fs.writeFileSync(
  publicPath,
  `/**
 * Public AI settings only — NO API keys.
 * Gemini: Cloud Functions / node scripts/dev-admin-ai.mjs (key only in .env).
 */
window.MD3_AI_CONFIG = ${JSON.stringify(publicConfig, null, 2)};
`,
  'utf8'
);

// Remove legacy browser secret file entirely
try {
  if (fs.existsSync(secretsPath)) fs.unlinkSync(secretsPath);
} catch (_) {}

console.log('Wrote', path.relative(root, publicPath), '(no keys)');
console.log('adminAiBaseUrl:', publicConfig.adminAiBaseUrl);
console.log('Removed ai-secrets.js (keys must stay in .env only)');
