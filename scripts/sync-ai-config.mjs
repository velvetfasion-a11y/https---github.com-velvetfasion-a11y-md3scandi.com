#!/usr/bin/env node
/**
 * Generate public ai-config.js (endpoint URLs + models — NO API keys).
 * Gemini keys stay in .env / Cloud Functions secrets only.
 *
 * Usage: node scripts/sync-ai-config.mjs
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
const defaultBase = `https://${region}-${projectId}.cloudfunctions.net`;
const localBase = env.ADMIN_AI_BASE_URL || '';

const publicConfig = {
  provider: 'gemini',
  /** Cloud Functions / local API base — keys never ship to the browser */
  adminAiBaseUrl: localBase || defaultBase,
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
 * Gemini runs on Cloud Functions / local API (scripts/dev-admin-ai.mjs).
 * Keys: .env GEMINI_API_KEY → Functions secrets / local server only.
 */
window.MD3_AI_CONFIG = ${JSON.stringify(publicConfig, null, 2)};
`,
  'utf8'
);

// Wipe any legacy browser secret file so keys cannot leak via Pages
fs.writeFileSync(
  secretsPath,
  `/**
 * Legacy stub — API keys are NOT loaded in the browser anymore.
 * Use Cloud Functions or: node scripts/dev-admin-ai.mjs
 */
window.MD3_AI_SECRETS = {};
`,
  'utf8'
);

console.log('Wrote', path.relative(root, publicPath), '(no keys)');
console.log('adminAiBaseUrl:', publicConfig.adminAiBaseUrl);
console.log('Wrote', path.relative(root, secretsPath), '(empty stub)');
