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

function existingConfigLooksValid() {
  if (!fs.existsSync(outPath)) return false;
  try {
    const body = fs.readFileSync(outPath, 'utf8');
    const gemini = body.match(/"geminiApiKey"\s*:\s*"([^"]*)"/);
    const openai = body.match(/"openaiApiKey"\s*:\s*"([^"]*)"/);
    const g = (gemini && gemini[1]) || '';
    const o = (openai && openai[1]) || '';
    return (g.length > 8 && !g.includes('YOUR_')) || (o.length > 8 && !o.includes('YOUR_'));
  } catch (_) {
    return false;
  }
}

if (!config.geminiApiKey && !config.openaiApiKey) {
  const msg =
    'No GEMINI_API_KEY or OPENAI_API_KEY — admin AI will not work on the deployed site.';
  if (existingConfigLooksValid()) {
    console.warn('Warning: ' + msg);
    console.warn('Keeping existing ai-config.js (do not overwrite with empty values).');
    process.exit(0);
  }
  console.error('Error: ' + msg);
  if (isCI()) {
    console.error(
      'Add GEMINI_API_KEY in GitHub → Settings → Secrets → Actions, or commit a valid ai-config.js.'
    );
  } else {
    console.error('Set GEMINI_API_KEY in .env and re-run this script.');
  }
  process.exit(1);
}

if (/^ya29\./i.test(config.geminiApiKey)) {
  console.error(
    'GEMINI_API_KEY looks like a Google sign-in OAuth token (ya29.…), not a Gemini API key. Use https://aistudio.google.com/apikey (AQ.… or AIza…).'
  );
  process.exit(1);
}

const body = `/**
 * Auto-generated from .env — DO NOT EDIT. Secrets live only in .env (local) or GitHub Actions secrets (production).
 * Regenerate: node scripts/sync-ai-config.mjs
 * Verify key:  node scripts/test-gemini.mjs
 */
window.MD3_AI_CONFIG = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('Wrote', path.relative(root, outPath));
