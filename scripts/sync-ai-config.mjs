#!/usr/bin/env node
/**
 * Generate ai-config.js from .env (and process.env for CI).
 * Usage: node scripts/sync-ai-config.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const outPath = path.join(root, 'ai-config.js');

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function loadEnv() {
  const merged = {};
  if (fs.existsSync(envPath)) {
    Object.assign(merged, parseEnvFile(fs.readFileSync(envPath, 'utf8')));
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (val != null && val !== '') merged[key] = val;
  }
  return merged;
}

const env = loadEnv();

const config = {
  provider: env.AI_PROVIDER || 'gemini',
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-pro',
  geminiImageModel: env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview',
  geminiImageSize: env.GEMINI_IMAGE_SIZE || '2K',
  geminiImageAspect: env.GEMINI_IMAGE_ASPECT || '3:4',
  openaiApiKey: env.OPENAI_API_KEY || '',
  model: env.OPENAI_MODEL || 'gpt-4o-mini',
};

const body = `/**
 * Auto-generated from .env — do not edit by hand.
 * Edit .env then run: node scripts/sync-ai-config.mjs
 */
window.MD3_AI_CONFIG = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('Wrote', path.relative(root, outPath));

if (!config.geminiApiKey && !config.openaiApiKey) {
  console.warn('Warning: no GEMINI_API_KEY or OPENAI_API_KEY set — admin AI will use local parsing only.');
}
